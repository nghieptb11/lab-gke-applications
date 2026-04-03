const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors()); // Cho phép gọi API từ frontend domain khác
app.use(express.json());

const port = process.env.PORT || 3000;

// Cấu hình kết nối MySQL
const dbConfig = {
  host: process.env.DB_HOST || 'mysql-service',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'appdb',
};

// Route Healthcheck cho GKE Load Balancer
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// API lấy dữ liệu từ DB
app.get('/api/message', async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT content FROM messages LIMIT 1');
    await connection.end();
    
    if (rows.length > 0) {
      res.json({ status: 'success', data: rows[0].content });
    } else {
      res.json({ status: 'success', data: 'Không có dữ liệu.' });
    }
  } catch (error) {
    console.error('Database connection failed:', error);
    res.status(500).json({ status: 'error', message: 'Lỗi kết nối database' });
  }
});

app.listen(port, () => {
  console.lang=`Backend đang chạy tại port ${port}`;
});