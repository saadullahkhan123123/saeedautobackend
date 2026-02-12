const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Item = require('../models/items');
const Slip = require('../models/slips');
const Income = require('../models/income');

// Helper function to ensure MongoDB connection
// This function actively tries to reconnect if disconnected
const ensureConnection = async () => {
  // If already connected, return true immediately
  if (mongoose.connection.readyState === 1) {
    return true;
  }
  
  // If connecting, wait for it to complete (up to 20 seconds)
  if (mongoose.connection.readyState === 2) {
    const maxWait = 20000;
    const startTime = Date.now();
    const checkInterval = 200; // Check every 200ms
    
    while (mongoose.connection.readyState === 2 && (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      
      // Check if connection succeeded
      if (mongoose.connection.readyState === 1) {
        return true;
      }
    }
    
    // If we're still connecting after maxWait, check one more time
    if (mongoose.connection.readyState === 1) {
      return true;
    }
  }
  
  // If disconnected (readyState 0 or 3), try to reconnect
  if (mongoose.connection.readyState === 0 || mongoose.connection.readyState === 3) {
    try {
      // Only try to reconnect if MONGO_URI is available
      if (process.env.MONGO_URI) {
        // Try to reconnect with a shorter timeout for serverless environments
        const connectionOptions = {
          serverSelectionTimeoutMS: 10000,
          socketTimeoutMS: 30000,
          connectTimeoutMS: 10000,
          maxPoolSize: 5,
          retryWrites: true,
          w: 'majority'
        };
        
        await mongoose.connect(process.env.MONGO_URI, connectionOptions);
        
        // Wait a bit to ensure connection is established
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (mongoose.connection.readyState === 1) {
          return true;
        }
      }
    } catch (err) {
      // Connection attempt failed, return false
      console.error('⚠️ Reconnection attempt failed:', err.message);
      return false;
    }
  }
  
  return false;
};

const fallbackDashboard = {
  summary: {
    totalItems: 0, totalSlips: 0, totalIncomeRecords: 0, totalRevenue: 0,
    todaySlips: 0, todayRevenue: 0, monthlyRevenue: 0, yearlyRevenue: 0,
    lowStockItems: 0, outOfStockItems: 0, totalCustomers: 0, pendingOrders: 0, profit: 0
  },
  recentSales: [],
  paymentMethods: [],
  message: 'Dashboard data unavailable'
};

router.get('/dashboard', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      console.warn('⚠️ Database connection not available, returning fallback data');
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment',
        summary: {
          totalItems: 0,
          totalSlips: 0,
          totalIncomeRecords: 0,
          totalRevenue: 0,
          todaySlips: 0,
          todayRevenue: 0,
          monthlyRevenue: 0,
          yearlyRevenue: 0,
          lowStockItems: 0,
          outOfStockItems: 0,
          totalCustomers: 0,
          pendingOrders: 0,
          profit: 0
        },
        recentSales: [],
        paymentMethods: [],
        message: 'Dashboard data unavailable - database connection issue'
      });
    }

    console.log('📊 Fetching dashboard analytics...');
    
    // Basic counts with error handling
    const totalItems = await Item.countDocuments({ $or: [{ isActive: true }, { isActive: { $exists: false } }] }).maxTimeMS(10000);
    const totalSlips = await Slip.countDocuments().maxTimeMS(10000);
    const totalIncomeRecords = await Income.countDocuments({ $or: [{ isActive: true }, { isActive: { $exists: false } }] }).maxTimeMS(10000);
    
    // Revenue calculations - handle null/undefined totalAmount
    let totalRevenue = 0;
    try {
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
      ]).maxTimeMS(15000).allowDiskUse(true);
      totalRevenue = totalRevenueResult[0]?.total || 0;
    } catch (aggError) {
      console.error('❌ Error calculating total revenue:', aggError);
      totalRevenue = 0;
    }

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

    let todayRevenue = 0;
    try {
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
      ]).maxTimeMS(15000).allowDiskUse(true);
      todayRevenue = todayRevenueResult[0]?.total || 0;
    } catch (aggError) {
      console.error('❌ Error calculating today revenue:', aggError);
      todayRevenue = 0;
    }

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
    let paymentMethods = [];
    try {
      paymentMethods = await Slip.aggregate([
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
      ]).maxTimeMS(15000).allowDiskUse(true);
    } catch (aggError) {
      console.error('❌ Error calculating payment methods:', aggError);
      paymentMethods = [];
    }

    // Total unique customers
    const uniqueCustomers = await Slip.distinct('customerName').maxTimeMS(10000);
    const totalCustomers = uniqueCustomers.length;

    // Monthly revenue
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    let monthlyRevenue = 0;
    try {
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
      ]).maxTimeMS(15000).allowDiskUse(true);
      monthlyRevenue = monthlyRevenueResult[0]?.total || 0;
    } catch (aggError) {
      console.error('❌ Error calculating monthly revenue:', aggError);
      monthlyRevenue = 0;
    }

    // Yearly revenue
    const currentYear = new Date();
    currentYear.setMonth(0, 1);
    currentYear.setHours(0, 0, 0, 0);
    let yearlyRevenue = 0;
    try {
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
      ]).maxTimeMS(15000).allowDiskUse(true);
      yearlyRevenue = yearlyRevenueResult[0]?.total || 0;
    } catch (aggError) {
      console.error('❌ Error calculating yearly revenue:', aggError);
      yearlyRevenue = 0;
    }

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
      const { period = 'week' } = req.query;
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment',
        period,
        salesTrends: [],
        message: 'Sales trends unavailable - database connection issue'
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

    let salesTrends = [];
    try {
      salesTrends = await Slip.aggregate([
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
      ]).maxTimeMS(20000).allowDiskUse(true);
    } catch (aggError) {
      console.error('❌ Aggregation error in sales-trends:', aggError);
      console.error('Aggregation error details:', aggError.message);
      // Return empty array instead of failing
      salesTrends = [];
    }

    res.json({
      period,
      salesTrends,
      message: 'Sales trends fetched successfully'
    });
  } catch (error) {
    console.error('❌ Error fetching sales trends:', error);
    return res.status(200).json({ period: req.query.period || 'week', salesTrends: [], error: error.message });
  }
});

// GET /api/analytics/top-products - Get top selling products
router.get('/top-products', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      const { limit = 10, period = 'all' } = req.query;
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment',
        period,
        topProducts: [],
        message: 'Top products unavailable - database connection issue'
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

    let topProducts = [];
    try {
      topProducts = await Slip.aggregate([
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
      ]).maxTimeMS(20000).allowDiskUse(true);
    } catch (aggError) {
      console.error('❌ Aggregation error in top-products:', aggError);
      console.error('Aggregation error details:', aggError.message);
      // Return empty array instead of failing
      topProducts = [];
    }

    res.json({
      period,
      topProducts,
      message: 'Top products fetched successfully'
    });
  } catch (error) {
    console.error('❌ Error fetching top products:', error);
    return res.status(200).json({ period: req.query.period || 'all', topProducts: [], error: error.message });
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
        ordersByStatus: [],
        message: 'Orders by status unavailable - database connection issue'
      });
    }

    let ordersByStatus = [];
    try {
      ordersByStatus = await Slip.aggregate([
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
      ]).maxTimeMS(15000).allowDiskUse(true);
    } catch (aggError) {
      console.error('❌ Aggregation error in orders-by-status:', aggError);
      console.error('Aggregation error details:', aggError.message);
      // Return empty array instead of failing
      ordersByStatus = [];
    }

    res.json({
      ordersByStatus,
      message: 'Orders by status fetched successfully'
    });
  } catch (error) {
    console.error('❌ Error fetching orders by status:', error);
    return res.status(200).json({ ordersByStatus: [], error: error.message });
  }
});

module.exports = router;