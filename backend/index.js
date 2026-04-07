const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const exifr = require('exifr'); // Đọc EXIF metadata từ ảnh

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;
const bucketName = process.env.GCS_BUCKET_NAME || 'love-gallery-bucket-01';

// GCS Client — tự động dùng Workload Identity trên GKE
const storage = new Storage();

// Cấu hình MySQL từ env (inject qua ConfigMap/Secret trên K8s)
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  connectTimeout: 10000,
};

// Helper: tạo DB connection
async function getConnection() {
  return mysql.createConnection(dbConfig);
}

// Helper: format Date thành YYYY-MM-DD cho MySQL
function toDateString(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
}

// ========== Health Check ==========
app.get('/health', (req, res) => res.status(200).send('OK'));

// ========== GET /api/photos ==========
// Đọc danh sách ảnh từ DB, tạo Signed URL từ GCS (tự động load/refresh)
app.get('/api/photos', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    const [rows] = await connection.execute(
      'SELECT id, gcs_object_name, caption, date_taken FROM photos ORDER BY date_taken DESC'
    );

    if (rows.length === 0) {
      return res.json({ status: 'success', data: [] });
    }

    // Tạo Signed URL cho mỗi ảnh (hiệu lực 60 phút)
    const photosWithUrls = await Promise.all(
      rows.map(async (photo) => {
        try {
          const [url] = await storage
            .bucket(bucketName)
            .file(photo.gcs_object_name)
            .getSignedUrl({
              version: 'v4',
              action: 'read',
              expires: Date.now() + 60 * 60 * 1000, // 60 phút
            });

          return {
            id: photo.id,
            caption: photo.caption,
            date_taken: photo.date_taken,
            imageUrl: url,
          };
        } catch (signErr) {
          console.error(`Lỗi tạo signed URL cho ${photo.gcs_object_name}:`, signErr.message);
          return null;
        }
      })
    );

    const validPhotos = photosWithUrls.filter(Boolean);
    res.json({ status: 'success', data: validPhotos });

  } catch (error) {
    console.error('Lỗi GET /api/photos:', error.message);
    res.status(500).json({ status: 'error', message: 'Lỗi server khi lấy danh sách ảnh' });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== POST /api/upload ==========
// Upload ảnh lên GCS, đọc EXIF date, lưu metadata vào MySQL
app.post('/api/upload', upload.single('file'), async (req, res) => {
  let connection;
  try {
    const { caption, date_taken } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ status: 'error', message: 'Vui lòng chọn ảnh' });
    }

    // === Đọc EXIF date từ buffer (fallback nếu frontend không đọc được) ===
    let resolvedDate = date_taken || null;
    if (!resolvedDate) {
      try {
        const exifData = await exifr.parse(file.buffer, { pick: ['DateTimeOriginal', 'CreateDate', 'DateTime'] });
        if (exifData) {
          const exifDate = exifData.DateTimeOriginal || exifData.CreateDate || exifData.DateTime;
          if (exifDate) {
            resolvedDate = toDateString(exifDate);
            console.log(`EXIF date tìm thấy (backend): ${resolvedDate}`);
          }
        }
      } catch (exifErr) {
        console.warn('Không đọc được EXIF (backend):', exifErr.message);
      }
    }

    // Tên file duy nhất trên GCS
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const gcsFileName = `photos/${Date.now()}-${safeOriginalName}`;

    // Upload lên GCS
    const blob = storage.bucket(bucketName).file(gcsFileName);
    const blobStream = blob.createWriteStream({
      resumable: false,
      contentType: file.mimetype,
      metadata: { cacheControl: 'no-cache' },
    });

    await new Promise((resolve, reject) => {
      blobStream.on('error', reject);
      blobStream.on('finish', resolve);
      blobStream.end(file.buffer);
    });

    // Lưu metadata vào MySQL
    const finalDate = resolvedDate || toDateString(new Date());
    connection = await getConnection();
    await connection.execute(
      'INSERT INTO photos (gcs_object_name, caption, date_taken) VALUES (?, ?, ?)',
      [gcsFileName, caption || '', finalDate]
    );

    console.log(`Upload thành công: ${gcsFileName}, date: ${finalDate}`);
    res.json({
      status: 'success',
      message: 'Tải ảnh lên thành công! ❤️',
      exif_date: resolvedDate, // trả về để frontend biết có đọc được EXIF không
    });

  } catch (error) {
    console.error('Lỗi POST /api/upload:', error.message);
    res.status(500).json({ status: 'error', message: `Upload thất bại: ${error.message}` });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== PUT /api/photos/:id ==========
// Cập nhật caption và date_taken của một ảnh
app.put('/api/photos/:id', async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { caption, date_taken } = req.body;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ status: 'error', message: 'ID không hợp lệ' });
    }

    connection = await getConnection();
    const [result] = await connection.execute(
      'UPDATE photos SET caption = ?, date_taken = ? WHERE id = ?',
      [caption || '', date_taken || toDateString(new Date()), Number(id)]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy ảnh' });
    }

    console.log(`Cập nhật ảnh id=${id}`);
    res.json({ status: 'success', message: 'Đã cập nhật kỷ niệm! ✏️' });

  } catch (error) {
    console.error('Lỗi PUT /api/photos/:id:', error.message);
    res.status(500).json({ status: 'error', message: `Cập nhật thất bại: ${error.message}` });
  } finally {
    if (connection) await connection.end();
  }
});

// ========== DELETE /api/photos/:id ==========
// Xóa ảnh khỏi MySQL và GCS
app.delete('/api/photos/:id', async (req, res) => {
  let connection;
  try {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ status: 'error', message: 'ID không hợp lệ' });
    }

    // Lấy tên file GCS trước khi xóa
    connection = await getConnection();
    const [rows] = await connection.execute(
      'SELECT gcs_object_name FROM photos WHERE id = ?',
      [Number(id)]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy ảnh' });
    }

    const gcsFileName = rows[0].gcs_object_name;

    // Xóa khỏi MySQL
    await connection.execute('DELETE FROM photos WHERE id = ?', [Number(id)]);

    // Xóa file khỏi GCS (không throw lỗi nếu file không tồn tại)
    try {
      await storage.bucket(bucketName).file(gcsFileName).delete();
      console.log(`Đã xóa file GCS: ${gcsFileName}`);
    } catch (gcsErr) {
      console.warn(`Không xóa được file GCS ${gcsFileName}:`, gcsErr.message);
    }

    console.log(`Đã xóa ảnh id=${id}`);
    res.json({ status: 'success', message: 'Đã xóa kỷ niệm 🗑️' });

  } catch (error) {
    console.error('Lỗi DELETE /api/photos/:id:', error.message);
    res.status(500).json({ status: 'error', message: `Xóa thất bại: ${error.message}` });
  } finally {
    if (connection) await connection.end();
  }
});

app.listen(port, () => {
  console.log(`Backend đang chạy tại port ${port}`);
  console.log(`GCS Bucket: ${bucketName}`);
});