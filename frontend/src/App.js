import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart, Calendar, Upload, Plus, X, CheckCircle,
  Image, Trash2, Pencil, AlertCircle, Zap
} from 'lucide-react';
import './App.css';

const POLL_INTERVAL = 30000; // 30 giây

// ─── Helper: đọc EXIF date từ File (client-side, không cần thư viện) ────────
// JPEG/TIFF lưu EXIF date dạng "YYYY:MM:DD HH:MM:SS" trong binary
async function readExifDateFromFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        const dataView = new DataView(buffer);

        // Chỉ xử lý JPEG (bắt đầu bằng FFD8)
        if (dataView.getUint16(0) !== 0xFFD8) return resolve(null);

        let offset = 2;
        while (offset < buffer.byteLength - 2) {
          const marker = dataView.getUint16(offset);
          if (marker === 0xFFE1) { // APP1 marker (EXIF)
            const exifStr = new Uint8Array(buffer, offset + 10, 500);
            const str = String.fromCharCode(...exifStr);
            // Tìm pattern ngày: "YYYY:MM:DD"
            const match = str.match(/(\d{4}):(\d{2}):(\d{2})/);
            if (match) {
              const [, y, m, d] = match;
              const year = parseInt(y);
              if (year >= 1990 && year <= new Date().getFullYear()) {
                return resolve(`${y}-${m}-${d}`);
              }
            }
            break;
          }
          const segLen = dataView.getUint16(offset + 2);
          offset += 2 + segLen;
        }
        resolve(null);
      } catch (err) {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file.slice(0, 65536)); // chỉ đọc 64KB đầu
  });
}

// ─── Helper: ngày hôm nay dạng YYYY-MM-DD ───────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ─── Floating Hearts Component ───────────────────────────────────────────────
const HEART_COUNT = 18;
const FloatingHearts = () => {
  const hearts = Array.from({ length: HEART_COUNT }, (_, i) => ({
    id: i,
    x: Math.random() * 100,          // % ngang (0–100vw)
    delay: Math.random() * 1.8,      // giây delay trước khi bắt đầu
    duration: 2.5 + Math.random() * 2, // thời gian bay lên
    size: 14 + Math.random() * 22,   // px
    opacity: 0.55 + Math.random() * 0.45,
  }));

  return (
    <div className="floating-hearts-container" aria-hidden="true">
      {hearts.map((h) => (
        <motion.div
          key={h.id}
          className="floating-heart"
          style={{ left: `${h.x}%`, fontSize: h.size, opacity: h.opacity }}
          initial={{ y: 0, opacity: h.opacity, scale: 0.6 }}
          animate={{
            y: [0, -120, -260, -420],
            opacity: [h.opacity, h.opacity, h.opacity * 0.5, 0],
            scale: [0.6, 1, 0.9, 0.5],
            x: [0, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 60],
          }}
          transition={{
            duration: h.duration,
            delay: h.delay,
            repeat: Infinity,
            repeatDelay: Math.random() * 1.5,
            ease: 'easeOut',
          }}
        >
          ❤️
        </motion.div>
      ))}
    </div>
  );
};

// ─── Notification helper ─────────────────────────────────────────────────────
const useNotification = () => {
  const [notification, setNotification] = useState(null);
  const show = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };
  return { notification, showSuccess: (m) => show('success', m), showError: (m) => show('error', m) };
};

// ════════════════════════════════════════════════════════════════════════════
const App = () => {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);

  // Lightbox state
  const [lightbox, setLightbox] = useState(null); // { imageUrl, caption, date_taken }

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [exifDetected, setExifDetected] = useState(false);
  const [uploadForm, setUploadForm] = useState({ file: null, caption: '', date_taken: todayStr() });

  // Edit modal state
  const [editPhoto, setEditPhoto] = useState(null); // { id, caption, date_taken }
  const [saving, setSaving] = useState(false);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, caption }
  const [deleting, setDeleting] = useState(false);

  const { notification, showSuccess, showError } = useNotification();

  // ─── Fetch photos ─────────────────────────────────────────────────────────
  const fetchPhotos = () => {
    fetch('/api/photos')
      .then(res => res.json())
      .then(res => {
        if (res.status === 'success') setPhotos(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Lỗi khi tải ảnh:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchPhotos();
    const interval = setInterval(fetchPhotos, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // ─── Upload handlers ──────────────────────────────────────────────────────
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Preview
    setPreviewUrl(URL.createObjectURL(file));

    // Thử đọc EXIF date
    setExifDetected(false);
    const exifDate = await readExifDateFromFile(file);
    if (exifDate) {
      setUploadForm(prev => ({ ...prev, file, date_taken: exifDate }));
      setExifDetected(true);
    } else {
      setUploadForm(prev => ({ ...prev, file }));
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!uploadForm.file) return;
    setUploading(true);

    const data = new FormData();
    data.append('file', uploadForm.file);
    data.append('caption', uploadForm.caption);
    data.append('date_taken', uploadForm.date_taken);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: data });
      const result = await res.json();

      if (result.status === 'success') {
        showSuccess('Đã lưu giữ thêm một kỷ niệm! ✨');
        closeUploadModal();
        fetchPhotos();
      } else {
        showError(result.message || 'Upload thất bại!');
      }
    } catch {
      showError('Có lỗi kết nối, vui lòng thử lại.');
    } finally {
      setUploading(false);
    }
  };

  const closeUploadModal = () => {
    setShowUpload(false);
    setUploadForm({ file: null, caption: '', date_taken: todayStr() });
    setPreviewUrl(null);
    setExifDetected(false);
  };

  // ─── Edit handlers ────────────────────────────────────────────────────────
  const openEdit = (photo) => {
    // date_taken từ DB có thể là Date object hoặc string ISO
    const dateStr = photo.date_taken
      ? new Date(photo.date_taken).toISOString().split('T')[0]
      : todayStr();
    setEditPhoto({ id: photo.id, caption: photo.caption || '', date_taken: dateStr });
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/photos/${editPhoto.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: editPhoto.caption, date_taken: editPhoto.date_taken }),
      });
      const result = await res.json();

      if (result.status === 'success') {
        showSuccess('Đã cập nhật kỷ niệm! ✏️');
        setEditPhoto(null);
        fetchPhotos();
      } else {
        showError(result.message || 'Cập nhật thất bại!');
      }
    } catch {
      showError('Có lỗi kết nối, vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete handlers ──────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/photos/${deleteTarget.id}`, { method: 'DELETE' });
      const result = await res.json();

      if (result.status === 'success') {
        showSuccess('Đã xóa kỷ niệm 🗑️');
        setDeleteTarget(null);
        fetchPhotos();
      } else {
        showError(result.message || 'Xóa thất bại!');
      }
    } catch {
      showError('Có lỗi kết nối, vui lòng thử lại.');
    } finally {
      setDeleting(false);
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  return (
    <div className="app-container">

      {/* ── Notification Toast ── */}
      <AnimatePresence>
        {notification && (
          <motion.div
            className={`notification ${notification.type}`}
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 20, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            {notification.type === 'success'
              ? <CheckCircle size={18} />
              : <AlertCircle size={18} />}
            <span>{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <header>
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="header-content"
        >
          <Heart className="heart-icon" fill="#ff4d6d" color="#ff4d6d" size={40} />
          <h1>Kỷ Niệm Của Chúng Mình</h1>
          <p>Nơi lưu giữ những khoảnh khắc hạnh phúc nhất</p>
        </motion.div>
        <motion.button
          className="btn-add"
          onClick={() => setShowUpload(true)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <Plus size={18} />
          <span>Thêm Kỷ Niệm</span>
        </motion.button>
      </header>

      {/* ── Gallery ── */}
      {loading ? (
        <div className="loader">
          <Heart className="loader-heart" fill="#ff4d6d" color="#ff4d6d" />
          <p>Đang tải những kỷ niệm... 🎁</p>
        </div>
      ) : photos.length === 0 ? (
        <motion.div className="empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Image size={60} color="#ffb3c1" />
          <p>Chưa có kỷ niệm nào. Hãy thêm ảnh đầu tiên! 💕</p>
        </motion.div>
      ) : (
        <motion.div
          className="gallery-grid"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.12 } }
          }}
        >
          {photos.map((photo) => (
            <motion.div
              key={photo.id}
              className="photo-card"
              variants={{ hidden: { y: 30, opacity: 0 }, visible: { y: 0, opacity: 1 } }}
              whileHover={{ scale: 1.03, y: -5 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              <div className="image-wrapper" onClick={() => setLightbox(photo)}>
                <img src={photo.imageUrl} alt={photo.caption} loading="lazy" />
                <div className="image-overlay">
                  <Heart fill="white" color="white" size={22} />
                  <span className="expand-hint">Nhấn để xem</span>
                </div>
                {/* ─ Action Buttons ─ */}
                <div className="card-actions">
                  <motion.button
                    className="card-btn edit-btn"
                    title="Chỉnh sửa"
                    onClick={(e) => { e.stopPropagation(); openEdit(photo); }}
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <Pencil size={14} />
                  </motion.button>
                  <motion.button
                    className="card-btn delete-btn"
                    title="Xóa ảnh"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(photo); }}
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <Trash2 size={14} />
                  </motion.button>
                </div>
              </div>
              <div className="photo-info">
                <div className="date">
                  <Calendar size={13} />
                  <span>{new Date(photo.date_taken).toLocaleDateString('vi-VN')}</span>
                </div>
                <p className="caption">{photo.caption || 'Kỷ niệm của chúng mình 💕'}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* ── Upload Modal ── */}
      <AnimatePresence>
        {showUpload && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => e.target === e.currentTarget && closeUploadModal()}
          >
            <motion.div
              className="modal-content"
              initial={{ scale: 0.8, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 50 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <button className="close-btn" onClick={closeUploadModal}><X size={20} /></button>
              <div className="modal-header">
                <Heart fill="#ff4d6d" color="#ff4d6d" size={26} />
                <h2>Thêm Kỷ Niệm Mới</h2>
              </div>

              <form onSubmit={handleUpload}>
                {/* File drop zone + preview */}
                <label className="file-drop-zone">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Preview" className="preview-img" />
                  ) : (
                    <div className="file-drop-placeholder">
                      <Upload size={34} color="#ff4d6d" />
                      <span>Nhấn để chọn ảnh</span>
                      <small>JPG, PNG, WEBP · Tối đa 10MB</small>
                    </div>
                  )}
                  <input type="file" accept="image/*" onChange={handleFileChange} required style={{ display: 'none' }} />
                </label>

                {/* EXIF badge */}
                <AnimatePresence>
                  {exifDetected && (
                    <motion.div
                      className="exif-badge"
                      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    >
                      <Zap size={13} />
                      <span>Ngày tháng được đọc tự động từ metadata ảnh</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Date field */}
                <div className="form-group">
                  <label className="form-label">
                    <Calendar size={14} /> Ngày chụp
                  </label>
                  <input
                    type="date"
                    className="caption-input"
                    value={uploadForm.date_taken}
                    max={todayStr()}
                    onChange={(e) => setUploadForm({ ...uploadForm, date_taken: e.target.value })}
                  />
                </div>

                {/* Caption field */}
                <div className="form-group">
                  <label className="form-label">
                    <Heart size={13} color="#ff4d6d" /> Lời nhắn nhủ
                  </label>
                  <input
                    type="text"
                    className="caption-input"
                    placeholder="Khoảnh khắc này... 💌"
                    value={uploadForm.caption}
                    onChange={(e) => setUploadForm({ ...uploadForm, caption: e.target.value })}
                  />
                </div>

                <motion.button
                  type="submit"
                  className="btn-submit"
                  disabled={uploading || !uploadForm.file}
                  whileHover={{ scale: uploading ? 1 : 1.02 }}
                  whileTap={{ scale: uploading ? 1 : 0.98 }}
                >
                  {uploading ? (
                    <span className="uploading-text"><span className="spinner" /> Đang lưu lên GCS...</span>
                  ) : (
                    <><Upload size={16} /><span>Lưu Kỷ Niệm ❤️</span></>
                  )}
                </motion.button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Edit Modal ── */}
      <AnimatePresence>
        {editPhoto && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => e.target === e.currentTarget && setEditPhoto(null)}
          >
            <motion.div
              className="modal-content modal-small"
              initial={{ scale: 0.85, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.85, opacity: 0, y: 30 }}
              transition={{ type: 'spring', stiffness: 350, damping: 28 }}
            >
              <button className="close-btn" onClick={() => setEditPhoto(null)}><X size={20} /></button>
              <div className="modal-header">
                <Pencil color="#ff4d6d" size={24} />
                <h2>Chỉnh Sửa Kỷ Niệm</h2>
              </div>

              <form onSubmit={handleEdit}>
                <div className="form-group">
                  <label className="form-label"><Calendar size={14} /> Ngày chụp</label>
                  <input
                    type="date"
                    className="caption-input"
                    value={editPhoto.date_taken}
                    max={todayStr()}
                    onChange={(e) => setEditPhoto({ ...editPhoto, date_taken: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label"><Heart size={13} color="#ff4d6d" /> Lời nhắn nhủ</label>
                  <input
                    type="text"
                    className="caption-input"
                    placeholder="Khoảnh khắc này... 💌"
                    value={editPhoto.caption}
                    onChange={(e) => setEditPhoto({ ...editPhoto, caption: e.target.value })}
                  />
                </div>
                <motion.button
                  type="submit"
                  className="btn-submit"
                  disabled={saving}
                  whileHover={{ scale: saving ? 1 : 1.02 }}
                  whileTap={{ scale: saving ? 1 : 0.98 }}
                >
                  {saving
                    ? <span className="uploading-text"><span className="spinner" /> Đang lưu...</span>
                    : <><Pencil size={15} /><span>Lưu Thay Đổi</span></>}
                </motion.button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete Confirm Modal ── */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => e.target === e.currentTarget && setDeleteTarget(null)}
          >
            <motion.div
              className="modal-content modal-small confirm-modal"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <div className="confirm-icon">
                <Trash2 size={32} color="#ff4d6d" />
              </div>
              <h3>Xóa kỷ niệm này?</h3>
              <p className="confirm-caption">
                "{deleteTarget.caption || 'Kỷ niệm của chúng mình'}"
              </p>
              <p className="confirm-desc">Ảnh sẽ bị xóa khỏi GCS và database. Không thể hoàn tác!</p>
              <div className="confirm-actions">
                <button className="btn-cancel" onClick={() => setDeleteTarget(null)}>Hủy</button>
                <motion.button
                  className="btn-delete"
                  onClick={handleDelete}
                  disabled={deleting}
                  whileHover={{ scale: deleting ? 1 : 1.03 }}
                  whileTap={{ scale: deleting ? 1 : 0.97 }}
                >
                  {deleting
                    ? <span className="uploading-text"><span className="spinner" /> Đang xóa...</span>
                    : <><Trash2 size={15} /> Xóa</>}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Lightbox ── */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="lightbox-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => setLightbox(null)}
          >
            {/* Floating hearts */}
            <FloatingHearts />

            {/* Close button */}
            <motion.button
              className="lightbox-close"
              onClick={() => setLightbox(null)}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              whileHover={{ scale: 1.1, rotate: 90 }}
            >
              <X size={22} />
            </motion.button>

            {/* Image card */}
            <motion.div
              className="lightbox-card"
              layoutId={`photo-${lightbox.id}`}
              initial={{ scale: 0.6, opacity: 0, y: 60 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.6, opacity: 0, y: 60 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={lightbox.imageUrl}
                alt={lightbox.caption}
                className="lightbox-img"
              />
              <div className="lightbox-info">
                <div className="lightbox-date">
                  <Calendar size={14} />
                  <span>{new Date(lightbox.date_taken).toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
                <p className="lightbox-caption">
                  {lightbox.caption || 'Kỷ niệm của chúng mình 💕'}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer>
        <p>Made with ❤️ by Kubernetes Engineer · Auto-sync từ GCS mỗi 30s</p>
      </footer>
    </div>
  );
};

export default App;