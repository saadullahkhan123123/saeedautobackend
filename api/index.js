const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

const allowedOrigins = [
  'https://inventory-system-seven-alpha.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.indexOf(origin) !== -1 || origin.includes('localhost') || origin.includes('127.0.0.1')))
    return origin;
  return allowedOrigins[0];
}

// Set CORS on every response first (so even errors have the header – fixes "No Access-Control-Allow-Origin")
app.use((req, res, next) => {
  const origin = getCorsOrigin(req);
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With, Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  }
  next();
});

app.use(cors({
  origin: function (o, cb) { cb(null, true); },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'Origin'],
  optionsSuccessStatus: 204,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Backend is live', backend: 'Vercel Serverless', time: new Date().toISOString() });
});
app.get('/test', (req, res) => {
  res.json({ message: 'Backend test API is running!', timestamp: new Date(), backend: 'Vercel Serverless' });
});
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend test API is running!', timestamp: new Date(), backend: 'Vercel Serverless' });
});

// Load routes (same process – ensure Root Directory = folder containing api, routes, models)
try {
  const mongoose = require('mongoose');
  if (process.env.MONGO_URI && mongoose.connection.readyState !== 1) {
    mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 1,
    }).catch((err) => console.error('Mongo connect:', err.message));
  }
  const apiDir = path.join(__dirname, '..');
  app.use('/api/items', require(path.join(apiDir, 'routes', 'items')));
  app.use('/api/income', require(path.join(apiDir, 'routes', 'income')));
  app.use('/api/slips', require(path.join(apiDir, 'routes', 'slips')));
  app.use('/api/analytics', require(path.join(apiDir, 'routes', 'analytics')));
  app.use('/api/history', require(path.join(apiDir, 'routes', 'history')));
  app.use('/api/customer-history', require(path.join(apiDir, 'routes', 'customerHistory')));
  app.use('/api/reset', require(path.join(apiDir, 'routes', 'reset')));
} catch (e) {
  console.error('Route load failed:', e.message);
  app.use('/api/*', (req, res) => res.status(503).json({ error: 'Routes failed to load', hint: 'Set Root Directory to folder containing api, routes, models.' }));
}

app.use((req, res) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin && allowedOrigins.indexOf(origin) !== -1 ? origin : allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(404).json({ error: 'Route not found', requestedUrl: req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin && allowedOrigins.indexOf(origin) !== -1 ? origin : allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
