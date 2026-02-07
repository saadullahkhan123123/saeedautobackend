const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

/* -----------------------------------------
   ✅ CORS CONFIG (Production + Local Development)
------------------------------------------- */
const allowedOrigins = [
  'https://inventory-system-seven-alpha.vercel.app', // Production
  'http://localhost:5173', // Vite default port
  'http://localhost:3000', // Alternative port
  'http://localhost:5174', // Alternative Vite port
  'http://127.0.0.1:5173', // Localhost alternative
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        // For development, allow any localhost origin
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
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

    // Check if MONGO_URI is available
    if (!process.env.MONGO_URI) {
      console.error('❌ MONGO_URI environment variable is not set');
      return;
    }

    const connectionOptions = {
      serverSelectionTimeoutMS: 20000, // Increased timeout
      socketTimeoutMS: 45000,
      connectTimeoutMS: 20000, // Increased timeout
      maxPoolSize: 10,
      retryWrites: true,
      w: 'majority'
      // Note: bufferCommands and bufferMaxEntries are Mongoose schema options, not connection options
    };

    await mongoose.connect(process.env.MONGO_URI, connectionOptions);
    console.log('✅ MongoDB Atlas connected');
    console.log('📊 Database:', mongoose.connection.db?.databaseName || 'Unknown');
    console.log('📊 Connection State:', mongoose.connection.readyState);
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error('❌ Connection error details:', err);
    // Don't throw - let the app continue and routes will handle connection errors
  }
};

// Connect to database
connectDB();

// Retry connection if it fails
let retryCount = 0;
const maxRetries = 5;
const retryConnection = async () => {
  if (mongoose.connection.readyState !== 1 && retryCount < maxRetries) {
    retryCount++;
    console.log(`🔄 Retrying MongoDB connection (attempt ${retryCount}/${maxRetries})...`);
    await new Promise(resolve => setTimeout(resolve, 5000 * retryCount)); // Exponential backoff
    await connectDB();
  } else if (retryCount >= maxRetries) {
    console.error('❌ Max retry attempts reached. Connection may be unavailable.');
  }
};

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
  retryCount = 0; // Reset retry count on error
  retryConnection();
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected - will retry connection...');
  retryCount = 0; // Reset retry count
  retryConnection();
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
  retryCount = 0; // Reset retry count on successful reconnection
});

mongoose.connection.on('connecting', () => {
  console.log('🔄 Connecting to MongoDB...');
});

mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connected successfully');
  retryCount = 0; // Reset retry count on successful connection
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
app.use('/api/reset', require('./routes/reset'));

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
