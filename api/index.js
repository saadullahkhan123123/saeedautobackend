const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

/* -----------------------------------------
   ✅ CORS CONFIG – allow frontend origin so browser does not block
------------------------------------------- */
const allowedOrigins = [
  'https://inventory-system-seven-alpha.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
      if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    optionsSuccessStatus: 204,
  })
);

// Explicit OPTIONS handler for preflight (belt and suspenders)
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.indexOf(origin) !== -1 || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

// Parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -----------------------------------------
   ✅ Connect MongoDB Atlas with optimized settings for Vercel
   Only connect if MONGO_URI is set in Vercel Environment Variables.
------------------------------------------- */
const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.warn('⚠️ MONGO_URI not set in Vercel – add it in Project Settings → Environment Variables. API will respond but DB routes will fail.');
    return;
  }
  try {
    if (mongoose.connection.readyState === 1) {
      console.log('✅ MongoDB already connected');
      return;
    }
    const connectionOptions = {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 1,
    };
    await mongoose.connect(process.env.MONGO_URI, connectionOptions);
    console.log('✅ MongoDB Atlas connected');
    console.log('📊 Database:', mongoose.connection.db?.databaseName || 'Unknown');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    // Don't throw – app still responds, routes will retry or return errors
  }
};

// Do NOT connect DB at cold start – routes use ensureConnection() on first use.
// This avoids timeouts/crashes during Vercel serverless cold start.
if (process.env.MONGO_URI) {
  mongoose.connection.on('error', (err) => console.error('❌ MongoDB connection error:', err));
  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected');
    setTimeout(() => { if (mongoose.connection.readyState === 0) connectDB(); }, 5000);
  });
}

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
   ✅ Import routes (wrap so one failing require doesn't crash the whole function)
------------------------------------------- */
const routeLoadError = [];
function useRoute(path, loader) {
  try {
    app.use(path, loader());
  } catch (e) {
    console.error('Route load failed:', path, e.message || e);
    routeLoadError.push({ path, error: (e.message || String(e)) });
    app.use(path, (req, res) => res.status(503).json({ error: 'Route unavailable', path, loadError: e.message }));
  }
}
useRoute('/api/items', () => require('../routes/items'));
useRoute('/api/income', () => require('../routes/income'));
useRoute('/api/slips', () => require('../routes/slips'));
useRoute('/api/analytics', () => require('../routes/analytics'));
useRoute('/api/history', () => require('../routes/history'));
useRoute('/api/customer-history', () => require('../routes/customerHistory'));
useRoute('/api/reset', () => require('../routes/reset'));

/* -----------------------------------------
   ✅ 404 Handler (with CORS so browser sees headers)
------------------------------------------- */
app.use((req, res) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.indexOf(origin) !== -1 || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(404).json({
    error: 'Route not found',
    requestedUrl: req.originalUrl,
  });
});

/* -----------------------------------------
   ✅ Global error handler – ensure CORS headers on errors
------------------------------------------- */
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.indexOf(origin) !== -1 || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Export for Vercel: wrap so uncaught errors return 500 instead of crashing the function
const handler = (req, res) => {
  try {
    app(req, res);
  } catch (err) {
    console.error('Uncaught error in handler:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal server error', message: err.message }));
  }
};
module.exports = handler;

