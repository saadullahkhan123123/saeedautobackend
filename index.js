const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

/* -----------------------------------------
   ✅ CORS CONFIG (Frontend + Local)
------------------------------------------- */
app.use(
  cors({
    origin: [
      'https://inventory-system-seven-alpha.vercel.app', // PRODUCTION FRONTEND
      'http://localhost:5173', // Vite Local
      'http://localhost:3000', // React Local
      'http://localhost:5000'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  })
);

// Parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -----------------------------------------
   ✅ Connect MongoDB Atlas (Local Development)
------------------------------------------- */
const connectDB = async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      console.log('✅ MongoDB already connected');
      return;
    }

    const connectionOptions = {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
    };

    await mongoose.connect(process.env.MONGO_URI, connectionOptions);
    console.log('✅ MongoDB Atlas connected');
    console.log('📊 Database:', mongoose.connection.db?.databaseName || 'Unknown');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error('❌ Connection error details:', err);
  }
};

connectDB();

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected - attempting reconnect...');
  setTimeout(() => {
    if (mongoose.connection.readyState === 0) {
      connectDB();
    }
  }, 5000);
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

/* -----------------------------------------
   ✅ Root route (IMPORTANT for Render)
------------------------------------------- */
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Backend is live and working!',
    time: new Date(),
    health: 'All systems functional',
  });
});

/* -----------------------------------------
   ✅ Test routes
------------------------------------------- */
app.get('/test', (req, res) => {
  res.json({
    message: 'Backend test API is running!',
    timestamp: new Date(),
    endpoints: ['/api/items', '/api/income', '/api/slips', '/api/analytics'],
    backend: 'Local Development',
  });
});

app.get('/api/test', (req, res) => {
  res.json({
    message: 'Backend test API is running!',
    timestamp: new Date(),
    endpoints: ['/api/items', '/api/income', '/api/slips', '/api/analytics'],
    backend: 'Local Development',
  });
});

/* -----------------------------------------
   ✅ Import routes
------------------------------------------- */
app.use('/api/items', require('./routes/items'));
app.use('/api/income', require('./routes/income'));
app.use('/api/slips', require('./routes/slips'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/history', require('./routes/history'));
app.use('/api/customer-history', require('./routes/customerHistory'));

/* -----------------------------------------
   ✅ 404 Handler (MUST BE LAST)
------------------------------------------- */
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    requestedUrl: req.originalUrl,
  });
});

/* -----------------------------------------
   ✅ Start Server
------------------------------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
