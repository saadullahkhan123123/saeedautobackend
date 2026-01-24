const express = require('express');
const router = express.Router();
const Income = require('../models/income');

// POST /api/income - Create income record
router.post('/', async (req, res) => {
  try {
    const { totalIncome, productsSold, date, notes, customerName, paymentMethod, slipNumber } = req.body;

    if (!totalIncome || !productsSold || !Array.isArray(productsSold)) {
      return res.status(400).json({ error: 'Total income and products sold are required' });
    }

    // Validate products
    for (const product of productsSold) {
      if (!product.productName || !product.quantity || !product.unitPrice) {
        return res.status(400).json({ 
          error: 'Each product must include productName, quantity, and unitPrice' 
        });
      }
    }

    const newEntry = new Income({
      totalIncome,
      productsSold,
      date: date || new Date(),
      notes: notes || '',
      customerName: customerName || 'Walk-in Customer',
      paymentMethod: paymentMethod || 'Cash',
      slipNumber: slipNumber || ''
    });

    await newEntry.save();
    
    res.status(201).json({
      message: 'Income record created successfully',
      income: newEntry
    });
  } catch (err) {
    console.error('❌ Error creating income:', err);
    res.status(500).json({ 
      error: 'Failed to create income record', 
      details: err.message 
    });
  }
});

// GET /api/income - Get all income records with pagination & filtering
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      startDate, 
      endDate, 
      sortBy = 'date', 
      sortOrder = 'desc',
      customerName = ''
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
    console.error('❌ Error fetching income records:', err);
    res.status(500).json({ 
      error: 'Failed to fetch income records', 
      details: err.message 
    });
  }
});

// GET /api/income/summary/overview - Get income summary
router.get('/summary/overview', async (req, res) => {
  try {
    const totalIncome = await Income.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, total: { $sum: '$totalIncome' } } }
    ]);

    const totalProductsSold = await Income.aggregate([
      { $match: { isActive: true } },
      { $unwind: '$productsSold' },
      { $group: { _id: null, total: { $sum: '$productsSold.quantity' } } }
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const todayIncome = await Income.aggregate([
      { 
        $match: { 
          date: { $gte: today, $lt: tomorrow },
          isActive: true 
        } 
      },
      { $group: { _id: null, total: { $sum: '$totalIncome' } } }
    ]);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const monthIncome = await Income.aggregate([
      { 
        $match: { 
          date: { $gte: monthStart, $lte: monthEnd },
          isActive: true 
        } 
      },
      { $group: { _id: null, total: { $sum: '$totalIncome' } } }
    ]);

    // Payment method breakdown
    const paymentBreakdown = await Income.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$paymentMethod',
          total: { $sum: '$totalIncome' },
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      totalIncome: totalIncome[0]?.total || 0,
      totalProductsSold: totalProductsSold[0]?.total || 0,
      todayIncome: todayIncome[0]?.total || 0,
      monthIncome: monthIncome[0]?.total || 0,
      totalRecords: await Income.countDocuments({ isActive: true }),
      paymentBreakdown
    });
  } catch (err) {
    console.error('❌ Error fetching income summary:', err);
    res.status(500).json({ 
      error: 'Failed to fetch income summary', 
      details: err.message 
    });
  }
});

// GET /api/income/today - Get today's income
router.get('/today', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const records = await Income.find({
      date: { $gte: today, $lt: tomorrow },
      isActive: true
    }).sort({ date: -1 });

    const totalIncome = records.reduce((sum, r) => sum + r.totalIncome, 0);
    const totalProducts = records.reduce(
      (sum, r) => sum + r.productsSold.reduce((pSum, p) => pSum + p.quantity, 0),
      0
    );

    res.json({
      records,
      totalIncome,
      totalProducts,
      totalTransactions: records.length
    });
  } catch (err) {
    console.error('❌ Error fetching today income:', err);
    res.status(500).json({ 
      error: 'Failed to fetch today income', 
      details: err.message 
    });
  }
});

// GET /api/income/weekly - Get last 7 days income
router.get('/weekly', async (req, res) => {
  try {
    const from = new Date();
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);

    const records = await Income.find({
      date: { $gte: from },
      isActive: true
    }).sort({ date: -1 });

    const totalIncome = records.reduce((sum, r) => sum + r.totalIncome, 0);
    const totalProducts = records.reduce(
      (sum, r) => sum + r.productsSold.reduce((pSum, p) => pSum + p.quantity, 0),
      0
    );

    const dailyIncome = await Income.aggregate([
      { 
        $match: { 
          date: { $gte: from },
          isActive: true 
        } 
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          totalIncome: { $sum: '$totalIncome' },
          totalProducts: { $sum: { $sum: '$productsSold.quantity' } },
          transactions: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      records,
      totalIncome,
      totalProducts,
      totalTransactions: records.length,
      dailyBreakdown: dailyIncome
    });
  } catch (err) {
    console.error('❌ Error fetching weekly income:', err);
    res.status(500).json({ 
      error: 'Failed to fetch weekly income', 
      details: err.message 
    });
  }
});

// GET /api/income/monthly - Get this month's income
router.get('/monthly', async (req, res) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const records = await Income.find({
      date: { $gte: start, $lt: end },
      isActive: true
    }).sort({ date: -1 });

    const totalIncome = records.reduce((sum, r) => sum + r.totalIncome, 0);
    const totalProducts = records.reduce(
      (sum, r) => sum + r.productsSold.reduce((pSum, p) => pSum + p.quantity, 0),
      0
    );

    const dailyIncome = await Income.aggregate([
      { 
        $match: { 
          date: { $gte: start, $lt: end },
          isActive: true 
        } 
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          totalIncome: { $sum: '$totalIncome' },
          totalProducts: { $sum: { $sum: '$productsSold.quantity' } },
          transactions: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      records,
      totalIncome,
      totalProducts,
      totalTransactions: records.length,
      dailyBreakdown: dailyIncome
    });
  } catch (err) {
    console.error('❌ Error fetching monthly income:', err);
    res.status(500).json({ 
      error: 'Failed to fetch monthly income', 
      details: err.message 
    });
  }
});

// GET /api/income/top-products - Get top selling products
router.get('/top-products', async (req, res) => {
  try {
    const { limit = 10, startDate, endDate } = req.query;

    const matchStage = { isActive: true };
    if (startDate && endDate) {
      matchStage.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const topProducts = await Income.aggregate([
      { $match: matchStage },
      { $unwind: '$productsSold' },
      {
        $group: {
          _id: '$productsSold.productName',
          totalQuantity: { $sum: '$productsSold.quantity' },
          totalRevenue: { $sum: '$productsSold.totalPrice' },
          averagePrice: { $avg: '$productsSold.unitPrice' },
          transactions: { $sum: 1 }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.json({
      topProducts,
      period: startDate && endDate ? `${startDate} to ${endDate}` : 'All time'
    });
  } catch (err) {
    console.error('❌ Error fetching top products:', err);
    res.status(500).json({ 
      error: 'Failed to fetch top products', 
      details: err.message 
    });
  }
});

// GET /api/income/:id - Get income by ID
router.get('/:id', async (req, res) => {
  try {
    const record = await Income.findById(req.params.id);
    
    if (!record) {
      return res.status(404).json({ error: 'Income record not found' });
    }

    if (!record.isActive) {
      return res.status(404).json({ error: 'Income record has been deleted' });
    }

    res.json(record);
  } catch (err) {
    console.error('❌ Error fetching income record:', err);
    
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid income record ID format' });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch income record', 
      details: err.message 
    });
  }
});

// PUT /api/income/:id - Update income record
router.put('/:id', async (req, res) => {
  try {
    const { totalIncome, productsSold, date, notes, customerName, paymentMethod } = req.body;

    const updatedRecord = await Income.findByIdAndUpdate(
      req.params.id,
      { 
        totalIncome, 
        productsSold, 
        date, 
        notes, 
        customerName, 
        paymentMethod,
        lastUpdated: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!updatedRecord) {
      return res.status(404).json({ error: 'Income record not found' });
    }

    res.json({
      message: 'Income record updated successfully',
      record: updatedRecord
    });
  } catch (err) {
    console.error('❌ Error updating income:', err);
    res.status(500).json({ 
      error: 'Failed to update income record', 
      details: err.message 
    });
  }
});

// DELETE /api/income/:id - Soft delete income record
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Income.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    if (!deleted) {
      return res.status(404).json({ error: 'Income record not found' });
    }

    res.json({ 
      message: 'Income record deleted successfully' 
    });
  } catch (err) {
    console.error('❌ Error deleting income:', err);
    res.status(500).json({ 
      error: 'Failed to delete income record', 
      details: err.message 
    });
  }
});

module.exports = router;