import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Heart, Calendar, Camera } from 'lucide-react';
import './App.css';

const App = () => {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Gọi API từ Backend GKE
    fetch('/api/photos')
      .then(res => res.json())
      .then(res => {
        if (res.status === 'success') setPhotos(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Lỗi:", err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="app-container">
      {/* Header lãng mạn */}
      <header>
        <motion.div 
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1 }}
        >
          <Heart className="heart-icon" fill="red" color="red" />
          <h1>Kỷ Niệm Của Chúng Mình</h1>
          <p>Nơi lưu giữ những khoảnh khắc hạnh phúc nhất</p>
        </motion.div>
      </header>

      {loading ? (
        <div className="loader">Đang chuẩn bị những món quà... 🎁</div>
      ) : (
        <motion.div 
          className="gallery-grid"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.2 }
            }
          }}
        >
          {photos.map((photo, index) => (
            <motion.div 
              key={photo.id}
              className="photo-card"
              variants={{
                hidden: { y: 20, opacity: 0 },
                visible: { y: 0, opacity: 1 }
              }}
              whileHover={{ scale: 1.05 }}
            >
              <div className="image-wrapper">
                <img src={photo.imageUrl} alt={photo.caption} />
              </div>
              <div className="photo-info">
                <div className="date">
                  <Calendar size={14} /> 
                  <span>{new Date(photo.date_taken).toLocaleDateString('vi-VN')}</span>
                </div>
                <p className="caption">{photo.caption}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <footer>
        <p>Made with ❤️ by Kubernetes Engineer</p>
      </footer>
    </div>
  );
};

export default App;