const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const { Storage } = require('@google-cloud/storage'); // Thêm thư viện GCS

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;
const bucketName = process.env.GCS_BUCKET_NAME || 'love-gallery-bucket-01'; // Tên bucket của bạn

// Khởi tạo GCS Client (Sẽ tự động lấy quyền từ Workload Identity trên GKE)
const storage = new Storage();

// Cấu hình kết nối MySQL (giữ nguyên như cũ)
const dbConfig = {
  host: process.env.DB_HOST ,
  user: process.env.DB_USER ,
  password: process.env.DB_PASSWORD ,
  database: process.env.DB_NAME ,
};

app.get('/health', (req, res) => res.status(200).send('OK'));

// API MỚI: Lấy danh sách ảnh và tạo Signed URL
app.get('/api/photos', async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT * FROM photos ORDER BY date_taken DESC');
    await connection.end();

    if (rows.length === 0) {
      return res.json({ status: 'success', data: [] });
    }

    // Lặp qua từng ảnh trong DB và tạo Signed URL (có hiệu lực 15 phút)
    const photosWithUrls = await Promise.all(rows.map(async (photo) => {
      const options = {
        version: 'v4',
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000, // 15 phút
      };

      const [url] = await storage
        .bucket(bucketName)
        .file(photo.gcs_object_name)
        .getSignedUrl(options);

      return {
        id: photo.id,
        caption: photo.caption,
        date_taken: photo.date_taken,
        imageUrl: url // Trả URL đã sign về cho Frontend React hiển thị
      };
    }));

    res.json({ status: 'success', data: photosWithUrls });

  } catch (error) {
    console.error('Lỗi API:', error);
    res.status(500).json({ status: 'error', message: 'Lỗi server khi lấy ảnh' });
  }
});

app.listen(port, () => {
  console.log(`Backend đang chạy tại port ${port}`);
});