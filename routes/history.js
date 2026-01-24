const express = require('express');
const router = express.Router();
const Slip = require('../models/slips');
const Income = require('../models/income');

// GET /api/history/slips - Get slip history with filters
router.get('/slips', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50,
      startDate,
      endDate,
      status = '',
      customerName = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};

    // Date filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Customer name filter
    if (customerName) {
      filter.customerName = { $regex: customerName, $options: 'i' };
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const slips = await Slip.find(filter)
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Slip.countDocuments(filter);

    res.json({
      slips,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      totalSlips: total
    });
  } catch (err) {
    console.error('❌ Error fetching slip history:', err);
    res.status(500).json({ 
      error: 'Failed to fetch slip history', 
      details: err.message 
    });
  }
});

// GET /api/history/income - Get income history with filters
router.get('/income', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50,
      startDate,
      endDate,
      customerName = '',
      paymentMethod = '',
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    const filter = { isActive: true };

    // Date filter
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    // Customer name filter
    if (customerName) {
      filter.customerName = { $regex: customerName, $options: 'i' };
    }

    // Payment method filter
    if (paymentMethod) {
      filter.paymentMethod = paymentMethod;
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const records = await Income.find(filter)
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Income.countDocuments(filter);

    res.json({
      records,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      totalRecords: total
    });
  } catch (err) {
    console.error('❌ Error fetching income history:', err);
    res.status(500).json({ 
      error: 'Failed to fetch income history', 
      details: err.message 
    });
  }
});

// GET /api/history/combined - Get combined history of slips and income
router.get('/combined', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50,
      startDate,
      endDate
    } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.$gte = startDate ? new Date(startDate) : new Date(0);
      dateFilter.$lte = endDate ? new Date(endDate) : new Date();
    }

    const [slips, income] = await Promise.all([
      Slip.find(dateFilter ? { createdAt: dateFilter } : {})
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit),
      Income.find(dateFilter ? { date: dateFilter, isActive: true } : { isActive: true })
        .sort({ date: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
    ]);

    // Combine and sort by date
    const combined = [
      ...slips.map(slip => ({
        type: 'slip',
        id: slip._id,
        date: slip.createdAt,
        customerName: slip.customerName,
        amount: slip.totalAmount,
        status: slip.status,
        slipNumber: slip.slipNumber,
        paymentMethod: slip.paymentMethod
      })),
      ...income.map(inc => ({
        type: 'income',
        id: inc._id,
        date: inc.date,
        customerName: inc.customerName,
        amount: inc.totalIncome,
        status: 'Paid',
        slipNumber: inc.slipNumber,
        paymentMethod: inc.paymentMethod
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      history: combined.slice(0, limit),
      totalPages: Math.ceil(combined.length / limit),
      currentPage: parseInt(page),
      totalRecords: combined.length
    });
  } catch (err) {
    console.error('❌ Error fetching combined history:', err);
    res.status(500).json({ 
      error: 'Failed to fetch combined history', 
      details: err.message 
    });
  }
});

module.exports = router;

