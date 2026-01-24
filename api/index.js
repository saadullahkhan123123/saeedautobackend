const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

/* -----------------------------------------
   ✅ CORS CONFIG (Production Frontend Only)
------------------------------------------- */
app.use(
  cors({
    origin: 'https://inventory-system-seven-alpha.vercel.app',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  })
);

// Parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -----------------------------------------
   ✅ Connect MongoDB Atlas with optimized settings for Vercel
------------------------------------------- */
const connectDB = async () => {
  try {
    // Check if already connected
    if (mongoose.connection.readyState === 1) {
      console.log('✅ MongoDB already connected');
      return;
    }

    const connectionOptions = {
      serverSelectionTimeoutMS: 10000, // 10 seconds to select server
      socketTimeoutMS: 45000, // 45 seconds socket timeout
      connectTimeoutMS: 10000, // 10 seconds to establish connection
      maxPoolSize: 10, // Maximum number of connections in the pool
      minPoolSize: 1, // Minimum number of connections
      bufferMaxEntries: 0, // Disable mongoose buffering
      bufferCommands: false, // Disable mongoose buffering
    };

    await mongoose.connect(process.env.MONGO_URI, connectionOptions);
    console.log('✅ MongoDB Atlas connected');
    console.log('📊 Database:', mongoose.connection.db?.databaseName || 'Unknown');
    console.log('📊 Connection State:', mongoose.connection.readyState);
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error('❌ Connection error details:', err);
    // Don't throw - let the app continue, connections will retry
  }
};

// Connect to MongoDB
connectDB();

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected - attempting reconnect...');
  // Auto-reconnect
  setTimeout(() => {
    if (mongoose.connection.readyState === 0) {
      connectDB();
    }
  }, 5000);
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

mongoose.connection.on('connecting', () => {
  console.log('🔄 Connecting to MongoDB...');
});

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connected successfully');
});

/* -----------------------------------------
   ✅ Root route
------------------------------------------- */
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Backend is live and working!',
    time: new Date(),
    health: 'All systems functional',
    backend: 'Vercel Serverless',
  });
});

/* -----------------------------------------
   ✅ Test route (without /api prefix for Vercel)
------------------------------------------- */
app.get('/test', (req, res) => {
  res.json({
    message: 'Backend test API is running!',
    timestamp: new Date(),
    endpoints: ['/api/items', '/api/income', '/api/slips', '/api/analytics'],
    backend: 'Vercel Serverless',
  });
});

/* -----------------------------------------
   ✅ Test route with /api prefix (for compatibility)
------------------------------------------- */
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Backend test API is running!',
    timestamp: new Date(),
    endpoints: ['/api/items', '/api/income', '/api/slips', '/api/analytics'],
    backend: 'Vercel Serverless',
  });
});

/* -----------------------------------------
   ✅ Import routes
------------------------------------------- */
app.use('/api/items', require('../routes/items'));
app.use('/api/income', require('../routes/income'));
app.use('/api/slips', require('../routes/slips'));
app.use('/api/analytics', require('../routes/analytics'));
app.use('/api/history', require('../routes/history'));
app.use('/api/customer-history', require('../routes/customerHistory'));

/* -----------------------------------------
   ✅ 404 Handler (MUST BE LAST)
------------------------------------------- */
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    requestedUrl: req.originalUrl,
  });
});

// Export the Express app for Vercel
// Vercel automatically handles Express apps
module.exports = app;

