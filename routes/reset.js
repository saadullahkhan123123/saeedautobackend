const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Slip = require('../models/slips');
const Income = require('../models/income');
const Item = require('../models/items');

// Helper: ensure DB connection
const ensureConnection = async () => {
  if (mongoose.connection.readyState === 1) return true;
  if (mongoose.connection.readyState === 2) {
    const maxWait = 15000;
    const start = Date.now();
    while (mongoose.connection.readyState === 2 && Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 200));
      if (mongoose.connection.readyState === 1) return true;
    }
  }
  if ((mongoose.connection.readyState === 0 || mongoose.connection.readyState === 3) && process.env.MONGO_URI) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 30000,
        connectTimeoutMS: 10000,
      });
      await new Promise(r => setTimeout(r, 500));
      return mongoose.connection.readyState === 1;
    } catch (e) {
      return false;
    }
  }
  return false;
}

/**
 * POST /api/reset
 * Body: { secret: "your_RESET_SECRET", confirm: "RESET_ALL" }
 * Clears: Slips, Income, Items (full system reset).
 * Set RESET_SECRET in .env to enable. If not set, use RESET_SECRET=reset123 for dev.
 */
router.post('/', async (req, res) => {
  try {
    const expectedSecret = process.env.RESET_SECRET || 'reset123';
    const { secret, confirm } = req.body || {};

    if (confirm !== 'RESET_ALL' || secret !== expectedSecret) {
      return res.status(403).json({
        error: 'Invalid or missing secret / confirmation',
        hint: 'Send body: { secret: "your_RESET_SECRET", confirm: "RESET_ALL" }',
      });
    }

    const connected = await ensureConnection();
    if (!connected) {
      return res.status(503).json({
        error: 'Database connection unavailable',
        details: 'Please try again in a moment',
      });
    }

    const results = { slips: 0, income: 0, items: 0 };

    const slipRes = await Slip.deleteMany({});
    results.slips = slipRes.deletedCount;

    const incomeRes = await Income.deleteMany({});
    results.income = incomeRes.deletedCount;

    const itemRes = await Item.deleteMany({});
    results.items = itemRes.deletedCount;

    console.log('✅ Database reset completed:', results);

    res.json({
      message: 'Database reset successfully. Slips, Income, and Items cleared.',
      deleted: results,
    });
  } catch (err) {
    console.error('❌ Reset error:', err);
    res.status(500).json({
      error: 'Failed to reset database',
      details: err.message,
    });
  }
});

module.exports = router;
