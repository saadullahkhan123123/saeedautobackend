const express = require('express');
const router = express.Router();
const Slip = require('../models/slips');
const Income = require('../models/income');

// Test route to verify the router is working
router.get('/test', (req, res) => {
  res.json({ message: 'Customer History API is working!', timestamp: new Date() });
});

// GET /api/customer-history/search/suggestions - Get customer suggestions by name, phone, or ID
router.get('/search/suggestions', async (req, res) => {
  try {
    const { query = '', type = 'name' } = req.query; // type: 'name', 'phone', 'id', 'all'
    
    if (query.length < 2) {
      return res.json({ suggestions: [] });
    }

    let suggestions = [];

    if (type === 'name' || type === 'all') {
      const names = await Slip.distinct('customerName', {
        customerName: { $regex: query, $options: 'i' },
        status: { $ne: 'Cancelled' }
      }).limit(10);
      suggestions.push(...names.map(name => ({ type: 'name', value: name, label: name })));
    }

    if (type === 'phone' || type === 'all') {
      const phones = await Slip.distinct('customerPhone', {
        customerPhone: { $regex: query, $options: 'i' },
        customerPhone: { $ne: '', $exists: true },
        status: { $ne: 'Cancelled' }
      }).limit(10);
      suggestions.push(...phones.map(phone => ({ type: 'phone', value: phone, label: `📞 ${phone}` })));
    }

    if (type === 'id' || type === 'all') {
      const slips = await Slip.find({
        $or: [
          { slipNumber: { $regex: query, $options: 'i' } },
          { _id: { $regex: query, $options: 'i' } }
        ],
        status: { $ne: 'Cancelled' }
      })
      .select('slipNumber customerName _id')
      .limit(10)
      .lean();
      
      slips.forEach(slip => {
        if (slip.slipNumber) {
          suggestions.push({ 
            type: 'id', 
            value: slip.slipNumber, 
            label: `🆔 ${slip.slipNumber} - ${slip.customerName}`,
            customerName: slip.customerName
          });
        }
      });
    }

    // Remove duplicates and limit
    const uniqueSuggestions = suggestions
      .filter((s, index, self) => index === self.findIndex(t => t.value === s.value))
      .slice(0, 15);

    res.json({ suggestions: uniqueSuggestions });
  } catch (err) {
    console.error('❌ Error fetching customer suggestions:', err);
    res.status(500).json({ error: 'Failed to fetch suggestions', details: err.message });
  }
});

// GET /api/customer-history/:customerName - Get all history for a customer
// NOTE: This route must come AFTER /search/suggestions to avoid route conflicts
// Supports search by name, phone, or slip ID
router.get('/:customerName', async (req, res) => {
  try {
    // Skip if this is the suggestions route
    if (req.params.customerName === 'search') {
      return res.status(404).json({ error: 'Route not found' });
    }

    const { customerName } = req.params;
    const { startDate, endDate, month, year, searchType = 'name' } = req.query;

    if (!customerName || customerName.trim() === '') {
      return res.status(400).json({ error: 'Customer identifier is required' });
    }

    // Build filter based on search type
    const filter = {
      status: { $ne: 'Cancelled' } // Exclude cancelled slips
    };

    // Determine search type and build filter accordingly
    if (searchType === 'phone') {
      filter.customerPhone = { $regex: customerName.trim(), $options: 'i' };
    } else if (searchType === 'id') {
      filter.$or = [
        { slipNumber: customerName.trim() },
        { _id: customerName.trim() }
      ];
    } else {
      // Default: search by name
      filter.customerName = { $regex: customerName.trim(), $options: 'i' };
    }

    // Add date filter if provided
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Add month/year filter if provided
    if (month && year) {
      const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endOfMonth = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
      filter.createdAt = {
        ...(filter.createdAt || {}),
        $gte: startOfMonth,
        $lte: endOfMonth
      };
    }

    // Fetch all slips for the customer
    const slips = await Slip.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    if (slips.length === 0) {
      return res.json({
        customerName: customerName.trim(),
        customerPhone: '',
        summary: {
          totalSlips: 0,
          totalAmount: 0,
          totalProducts: 0,
          averageBillValue: 0,
          firstVisitDate: null,
          lastVisitDate: null,
          customerType: 'New Customer'
        },
        monthly: [],
        weekly: [],
        daily: [],
        products: [],
        topProducts: [],
        allSlips: []
      });
    }

    // Get customer name and phone from first slip
    const firstSlip = slips[0];
    const actualCustomerName = firstSlip.customerName || customerName.trim();
    const customerPhone = firstSlip.customerPhone || '';

    // Calculate statistics
    const totalSlips = slips.length;
    const totalAmount = slips.reduce((sum, slip) => sum + (slip.totalAmount || 0), 0);
    const totalProducts = slips.reduce((sum, slip) => {
      return sum + (slip.products?.reduce((pSum, p) => pSum + (p.quantity || 0), 0) || 0);
    }, 0);
    const averageBillValue = totalSlips > 0 ? totalAmount / totalSlips : 0;

    // First and last visit dates
    const sortedByDate = [...slips].sort((a, b) => {
      const dateA = new Date(a.createdAt || a.date);
      const dateB = new Date(b.createdAt || b.date);
      return dateA - dateB;
    });
    const firstVisitDate = sortedByDate[0]?.createdAt || sortedByDate[0]?.date;
    const lastVisitDate = sortedByDate[sortedByDate.length - 1]?.createdAt || sortedByDate[sortedByDate.length - 1]?.date;

    // Determine customer type
    let customerType = 'New Customer';
    if (totalSlips >= 10) {
      customerType = 'Frequent Customer';
    } else if (totalSlips >= 2) {
      customerType = 'Returning Customer';
    }

    // Group by month
    const monthlyData = {};
    slips.forEach(slip => {
      const date = new Date(slip.createdAt || slip.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthName = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: monthName,
          slips: [],
          totalAmount: 0,
          totalProducts: 0,
          slipCount: 0
        };
      }
      
      monthlyData[monthKey].slips.push(slip);
      monthlyData[monthKey].totalAmount += slip.totalAmount || 0;
      monthlyData[monthKey].totalProducts += slip.products?.reduce((sum, p) => sum + (p.quantity || 0), 0) || 0;
      monthlyData[monthKey].slipCount += 1;
    });

    // Group by week
    const weeklyData = {};
    slips.forEach(slip => {
      const date = new Date(slip.createdAt || slip.date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
      const weekKey = `${weekStart.getFullYear()}-W${getWeekNumber(weekStart)}`;
      const weekLabel = `Week ${getWeekNumber(weekStart)}, ${weekStart.getFullYear()}`;
      
      if (!weeklyData[weekKey]) {
        weeklyData[weekKey] = {
          week: weekLabel,
          slips: [],
          totalAmount: 0,
          totalProducts: 0,
          slipCount: 0
        };
      }
      
      weeklyData[weekKey].slips.push(slip);
      weeklyData[weekKey].totalAmount += slip.totalAmount || 0;
      weeklyData[weekKey].totalProducts += slip.products?.reduce((sum, p) => sum + (p.quantity || 0), 0) || 0;
      weeklyData[weekKey].slipCount += 1;
    });

    // Get unique products purchased
    const productsMap = new Map();
    slips.forEach(slip => {
      slip.products?.forEach(product => {
        const key = product.productName || 'Unknown';
        if (productsMap.has(key)) {
          const existing = productsMap.get(key);
          existing.quantity += product.quantity || 0;
          existing.totalAmount += product.totalPrice || 0;
          existing.slipCount += 1;
        } else {
          productsMap.set(key, {
            productName: key,
            quantity: product.quantity || 0,
            totalAmount: product.totalPrice || 0,
            slipCount: 1,
            productType: product.productType || 'Cover',
            coverType: product.coverType || '',
            plateCompany: product.plateCompany || '',
            bikeName: product.bikeName || '',
            plateType: product.plateType || '',
            formCompany: product.formCompany || '',
            formType: product.formType || '',
            formVariant: product.formVariant || ''
          });
        }
      });
    });

    const products = Array.from(productsMap.values()).sort((a, b) => b.quantity - a.quantity);
    const topProducts = products.slice(0, 5);

    // Group by day (daily breakdown)
    const dailyData = {};
    slips.forEach(slip => {
      const date = new Date(slip.createdAt || slip.date);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD format
      const dateLabel = date.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      if (!dailyData[dateKey]) {
        dailyData[dateKey] = {
          date: dateKey,
          dateLabel: dateLabel,
          visits: [],
          totalAmount: 0,
          totalProducts: 0,
          visitCount: 0
        };
      }
      
      dailyData[dateKey].visits.push(slip);
      dailyData[dateKey].totalAmount += slip.totalAmount || 0;
      dailyData[dateKey].totalProducts += slip.products?.reduce((sum, p) => sum + (p.quantity || 0), 0) || 0;
      dailyData[dateKey].visitCount += 1;
    });

    // Sort daily data by date (newest first)
    const dailyArray = Object.values(dailyData).sort((a, b) => {
      return new Date(b.date) - new Date(a.date);
    });

    res.json({
      customerName: actualCustomerName,
      customerPhone: customerPhone,
      summary: {
        totalSlips,
        totalAmount,
        totalProducts,
        averageBillValue: Math.round(averageBillValue * 100) / 100,
        firstVisitDate,
        lastVisitDate,
        customerType,
        dateRange: {
          startDate: startDate || null,
          endDate: endDate || null
        }
      },
      monthly: Object.values(monthlyData).sort((a, b) => {
        // Sort by month key descending
        const aKey = Object.keys(monthlyData).find(key => monthlyData[key] === a);
        const bKey = Object.keys(monthlyData).find(key => monthlyData[key] === b);
        return bKey.localeCompare(aKey);
      }),
      weekly: Object.values(weeklyData).sort((a, b) => {
        // Sort by week key descending
        const aKey = Object.keys(weeklyData).find(key => weeklyData[key] === a);
        const bKey = Object.keys(weeklyData).find(key => weeklyData[key] === b);
        return bKey.localeCompare(aKey);
      }),
      daily: dailyArray,
      products,
      topProducts,
      allSlips: slips
    });

  } catch (err) {
    console.error('❌ Error fetching customer history:', err);
    res.status(500).json({ error: 'Failed to fetch customer history', details: err.message });
  }
});

// Helper function to get week number
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

module.exports = router;

