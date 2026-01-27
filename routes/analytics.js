const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Item = require('../models/items');
const Slip = require('../models/slips');
const Income = require('../models/income');

// Helper function to ensure MongoDB connection
const ensureConnection = async () => {
  if (mongoose.connection.readyState === 1) {
    return true;
  }
  if (mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
      });
      return true;
    } catch (err) {
      console.error('❌ Failed to connect to MongoDB:', err.message);
      return false;
    }
  }
  return false;
};

router.get('/dashboard', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment' 
      });
    }

    console.log('📊 Fetching dashboard analytics...');
    
    // Basic counts with error handling
    const totalItems = await Item.countDocuments({ $or: [{ isActive: true }, { isActive: { $exists: false } }] }).maxTimeMS(10000);
    const totalSlips = await Slip.countDocuments().maxTimeMS(10000);
    const totalIncomeRecords = await Income.countDocuments({ $or: [{ isActive: true }, { isActive: { $exists: false } }] }).maxTimeMS(10000);
    
    // Revenue calculations - handle null/undefined totalAmount
    const totalRevenueResult = await Slip.aggregate([
      { 
        $match: { 
          status: { $ne: 'Cancelled' },
          totalAmount: { $exists: true, $ne: null }
        } 
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: { $ifNull: ['$totalAmount', 0] } } 
        } 
      }
    ]).maxTimeMS(15000);

    const totalRevenue = totalRevenueResult[0]?.total || 0;

    // Today's date calculation
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // Today's slips and revenue
    const todaySlips = await Slip.countDocuments({
      $or: [
        { createdAt: { $gte: today, $lt: tomorrow } },
        { date: { $gte: today, $lt: tomorrow } }
      ]
    }).maxTimeMS(10000);

    const todayRevenueResult = await Slip.aggregate([
      { 
        $match: { 
          $or: [
            { createdAt: { $gte: today, $lt: tomorrow } },
            { date: { $gte: today, $lt: tomorrow } }
          ],
          status: { $ne: 'Cancelled' },
          totalAmount: { $exists: true, $ne: null }
        } 
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: { $ifNull: ['$totalAmount', 0] } } 
        } 
      }
    ]).maxTimeMS(15000);

    const todayRevenue = todayRevenueResult[0]?.total || 0;

    // Low stock items
    const lowStockItems = await Item.countDocuments({ 
      quantity: { $lte: 10 },
      $or: [{ isActive: true }, { isActive: { $exists: false } }]
    }).maxTimeMS(10000);

    // Recent sales activity
    const recentSales = await Slip.find()
      .sort({ createdAt: -1, date: -1 })
      .limit(10)
      .select('slipNumber totalAmount customerName createdAt date status paymentMethod')
      .maxTimeMS(10000)
      .lean();

    // Payment method distribution - handle null paymentMethod and totalAmount
    const paymentMethods = await Slip.aggregate([
      { 
        $match: { 
          status: { $ne: 'Cancelled' },
          totalAmount: { $exists: true, $ne: null }
        } 
      },
      {
        $group: {
          _id: { $ifNull: ['$paymentMethod', 'Cash'] },
          count: { $sum: 1 },
          total: { $sum: { $ifNull: ['$totalAmount', 0] } }
        }
      }
    ]).maxTimeMS(15000);

    // Total unique customers
    const uniqueCustomers = await Slip.distinct('customerName').maxTimeMS(10000);
    const totalCustomers = uniqueCustomers.length;

    // Monthly revenue
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    const monthlyRevenueResult = await Slip.aggregate([
      { 
        $match: { 
          $or: [
            { createdAt: { $gte: currentMonth } },
            { date: { $gte: currentMonth } }
          ],
          status: { $ne: 'Cancelled' },
          totalAmount: { $exists: true, $ne: null }
        } 
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: { $ifNull: ['$totalAmount', 0] } } 
        } 
      }
    ]).maxTimeMS(15000);
    const monthlyRevenue = monthlyRevenueResult[0]?.total || 0;

    // Yearly revenue
    const currentYear = new Date();
    currentYear.setMonth(0, 1);
    currentYear.setHours(0, 0, 0, 0);
    const yearlyRevenueResult = await Slip.aggregate([
      { 
        $match: { 
          $or: [
            { createdAt: { $gte: currentYear } },
            { date: { $gte: currentYear } }
          ],
          status: { $ne: 'Cancelled' },
          totalAmount: { $exists: true, $ne: null }
        } 
      },
      { 
        $group: { 
          _id: null, 
          total: { $sum: { $ifNull: ['$totalAmount', 0] } } 
        } 
      }
    ]).maxTimeMS(15000);
    const yearlyRevenue = yearlyRevenueResult[0]?.total || 0;

    // Pending orders/slips
    const pendingOrders = await Slip.countDocuments({ status: 'Pending' }).maxTimeMS(10000);

    // Out of stock items
    const outOfStockItems = await Item.countDocuments({ 
      quantity: 0,
      $or: [{ isActive: true }, { isActive: { $exists: false } }]
    }).maxTimeMS(10000);

    // Calculate profit (revenue - cost, if cost data available)
    // For now, we'll use revenue as profit since cost tracking might not be available
    const profit = totalRevenue; // Can be enhanced later with cost tracking

    res.json({
      summary: {
        totalItems,
        totalSlips,
        totalIncomeRecords,
        totalRevenue,
        todaySlips,
        todayRevenue,
        monthlyRevenue,
        yearlyRevenue,
        lowStockItems,
        outOfStockItems,
        totalCustomers,
        pendingOrders,
        profit
      },
      recentSales,
      paymentMethods,
      message: 'Dashboard analytics fetched successfully'
    });
  } catch (error) {
    console.error('❌ Error fetching analytics:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch analytics', 
      details: error.message,
      summary: {
        totalItems: 0,
        totalSlips: 0,
        totalIncomeRecords: 0,
        totalRevenue: 0,
        todaySlips: 0,
        todayRevenue: 0,
        lowStockItems: 0
      },
      recentSales: [],
      paymentMethods: []
    });
  }
});

// GET /api/analytics/sales-trends - Get sales trends for charts
router.get('/sales-trends', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment' 
      });
    }

    const { period = 'week' } = req.query; // week, month, year
    
    let days = 7;
    let groupFormat = '%Y-%m-%d';
    
    switch (period) {
      case 'month':
        days = 30;
        break;
      case 'year':
        days = 365;
        groupFormat = '%Y-%m';
        break;
      default:
        days = 7;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const salesTrends = await Slip.aggregate([
      {
        $match: {
          $or: [
            { createdAt: { $gte: startDate, $exists: true } },
            { date: { $gte: startDate, $exists: true } }
          ],
          status: { $ne: 'Cancelled' },
          totalAmount: { $exists: true, $ne: null }
        }
      },
      {
        $addFields: {
          dateField: { $ifNull: ['$createdAt', { $ifNull: ['$date', new Date()] }] }
        }
      },
      {
        $group: {
          _id: {
            date: { 
              $dateToString: { 
                format: groupFormat, 
                date: '$dateField',
                timezone: 'UTC'
              } 
            }
          },
          totalSales: { $sum: { $ifNull: ['$totalAmount', 0] } },
          totalTransactions: { $sum: 1 },
          averageSale: { $avg: { $ifNull: ['$totalAmount', 0] } }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]).maxTimeMS(20000);

    res.json({
      period,
      salesTrends,
      message: 'Sales trends fetched successfully'
    });
  } catch (error) {
    console.error('❌ Error fetching sales trends:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch sales trends', 
      details: error.message,
      period,
      salesTrends: []
    });
  }
});

// GET /api/analytics/top-products - Get top selling products
router.get('/top-products', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment' 
      });
    }

    const { limit = 10, period = 'all' } = req.query;
    
    let matchStage = { 
      status: { $ne: 'Cancelled' },
      products: { $exists: true, $ne: [], $type: 'array' }
    };
    
    if (period !== 'all') {
      const days = period === 'week' ? 7 : period === 'month' ? 30 : 365;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      matchStage.$or = [
        { createdAt: { $gte: startDate, $exists: true } },
        { date: { $gte: startDate, $exists: true } }
      ];
    }

    const topProducts = await Slip.aggregate([
      { 
        $match: matchStage
      },
      { $unwind: '$products' },
      {
        $match: {
          'products.productName': { $exists: true, $ne: null, $ne: '' },
          'products.quantity': { $exists: true, $type: 'number', $gt: 0 }
        }
      },
      {
        $group: {
          _id: { $ifNull: ['$products.productName', 'Unknown Product'] },
          totalQuantity: { $sum: { $ifNull: ['$products.quantity', 0] } },
          totalRevenue: { $sum: { $ifNull: ['$products.totalPrice', 0] } },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: parseInt(limit) || 10 }
    ]).maxTimeMS(20000);

    res.json({
      period,
      topProducts,
      message: 'Top products fetched successfully'
    });
  } catch (error) {
    console.error('❌ Error fetching top products:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch top products', 
      details: error.message,
      period,
      topProducts: []
    });
  }
});

// GET /api/analytics/inventory-levels - Get inventory stock levels
router.get('/inventory-levels', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment',
        stockLevels: {
          outOfStock: [],
          lowStock: [],
          inStock: []
        },
        totalItems: 0
      });
    }

    console.log('📦 Fetching inventory levels...');
    
    // Find items - handle both with and without isActive field, and ensure quantity exists
    const items = await Item.find({ 
      $or: [
        { isActive: { $exists: false } },
        { isActive: true },
        { isActive: { $ne: false } }
      ],
      quantity: { $exists: true } // Ensure quantity field exists
    })
      .select('name quantity price category')
      .sort({ quantity: 1 })
      .limit(50)
      .maxTimeMS(15000)
      .lean(); // Use lean() for better performance

    // Ensure quantity is a number, default to 0 if null/undefined/NaN
    const processedItems = items.map(item => {
      const qty = typeof item.quantity === 'number' && !isNaN(item.quantity) 
        ? item.quantity 
        : 0;
      return {
        _id: item._id,
        name: item.name || 'Unnamed Item',
        quantity: qty,
        price: typeof item.price === 'number' ? item.price : 0,
        category: item.category || 'General'
      };
    });

    const stockLevels = {
      outOfStock: processedItems.filter(i => i.quantity === 0),
      lowStock: processedItems.filter(i => i.quantity > 0 && i.quantity <= 10),
      inStock: processedItems.filter(i => i.quantity > 10)
    };

    console.log(`✅ Inventory levels fetched: ${processedItems.length} items`);

    res.json({
      stockLevels,
      totalItems: processedItems.length,
      message: 'Inventory levels fetched successfully'
    });
  } catch (error) {
    console.error('❌ Error fetching inventory levels:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    if (error.stack) {
      console.error('Error stack:', error.stack);
    }
    
    // Return a safe response even on error
    res.status(500).json({ 
      error: 'Failed to fetch inventory levels', 
      details: error.message || 'Unknown error occurred',
      stockLevels: {
        outOfStock: [],
        lowStock: [],
        inStock: []
      },
      totalItems: 0
    });
  }
});

// GET /api/analytics/orders-by-status - Get orders grouped by status
router.get('/orders-by-status', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment',
        ordersByStatus: []
      });
    }

    const ordersByStatus = await Slip.aggregate([
      {
        $match: {
          status: { $exists: true }
        }
      },
      {
        $group: {
          _id: { $ifNull: ['$status', 'Paid'] },
          count: { $sum: 1 },
          totalRevenue: { 
            $sum: { 
              $cond: [
                { $and: [
                  { $ne: ['$totalAmount', null] },
                  { $ne: ['$status', 'Cancelled'] }
                ]},
                { $ifNull: ['$totalAmount', 0] },
                0
              ]
            }
          }
        }
      },
      { $sort: { count: -1 } }
    ]).maxTimeMS(15000);

    res.json({
      ordersByStatus,
      message: 'Orders by status fetched successfully'
    });
  } catch (error) {
    console.error('❌ Error fetching orders by status:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch orders by status', 
      details: error.message,
      ordersByStatus: []
    });
  }
});

module.exports = router;