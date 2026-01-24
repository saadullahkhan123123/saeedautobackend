const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Slip = require('../models/slips');
const Item = require('../models/items');
const Income = require('../models/income');

// Helper function to ensure MongoDB connection
const ensureConnection = async () => {
  if (mongoose.connection.readyState === 1) {
    return true; // Already connected
  }
  
  if (mongoose.connection.readyState === 0) {
    // Not connected, try to connect
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        bufferMaxEntries: 0,
        bufferCommands: false,
      });
      console.log('✅ MongoDB connected in route handler');
      return true;
    } catch (err) {
      console.error('❌ Failed to connect to MongoDB:', err.message);
      return false;
    }
  }
  
  return false; // Connecting or disconnecting
};

// GET all slips
router.get('/', async (req, res) => {
  try {
    // Ensure MongoDB connection before query
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment' 
      });
    }

    const { page = 1, limit = 20, startDate, endDate, status = '' } = req.query;

    const filter = {};

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    if (status) {
      filter.status = status;
    }

    // Use lean() for better performance and add timeout
    const slips = await Slip.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit) || 1000)
      .skip((parseInt(page) - 1) * (parseInt(limit) || 1000))
      .lean()
      .maxTimeMS(30000); // 30 second timeout for the query

    const total = await Slip.countDocuments(filter).maxTimeMS(10000);

    res.json({
      slips,
      totalPages: Math.ceil(total / (parseInt(limit) || 1000)),
      currentPage: parseInt(page),
      totalSlips: total
    });

  } catch (err) {
    console.error('❌ Error fetching slips:', err);
    console.error('❌ Error name:', err.name);
    console.error('❌ Error message:', err.message);
    
    // Provide more helpful error messages
    let errorMessage = 'Failed to fetch slips';
    if (err.name === 'MongoServerSelectionError' || err.message.includes('buffering timed out')) {
      errorMessage = 'Database connection timeout. Please try again.';
    } else if (err.name === 'MongoNetworkError') {
      errorMessage = 'Database network error. Please check your connection.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: err.message,
      errorType: err.name
    });
  }
});

// PATCH /api/slips/cancel/:id - Dedicated cancel endpoint (using /cancel/:id to avoid route conflicts)
router.patch('/cancel/:id', async (req, res) => {
  const session = await Slip.startSession();
  session.startTransaction();

  try {
    const existingSlip = await Slip.findById(req.params.id).session(session);
    if (!existingSlip) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Slip not found' });
    }

    // Prevent duplicate cancellation
    if (existingSlip.status === 'Cancelled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ 
        error: 'Slip is already cancelled',
        details: `This slip was cancelled on ${new Date(existingSlip.cancelledAt).toLocaleString()}`,
        cancelledAt: existingSlip.cancelledAt
      });
    }

    // Mark slip as cancelled
    existingSlip.status = 'Cancelled';
    existingSlip.cancelledAt = new Date();
    if (req.body.reason) {
      existingSlip.notes = `${existingSlip.notes || ''}\n[CANCELLED: ${req.body.reason}]`.trim();
    }

    // Mark related income records as inactive
    const incomeUpdateResult = await Income.updateMany(
      { 
        $or: [
          { slipId: existingSlip._id },
          { slipNumber: existingSlip.slipNumber }
        ],
        isActive: true
      },
      { 
        $set: {
          isActive: false,
          notes: `Cancelled on ${new Date().toISOString()} - Slip: ${existingSlip.slipNumber || existingSlip._id}${req.body.reason ? ` - Reason: ${req.body.reason}` : ''}`
        }
      },
      { session }
    );

    console.log(`✅ Marked ${incomeUpdateResult.modifiedCount} income record(s) as inactive for cancelled slip ${existingSlip.slipNumber || existingSlip._id}`);

    // Restore inventory quantities for cancelled slip
    let restoredCount = 0;
    if (existingSlip.products && existingSlip.products.length > 0) {
      for (const product of existingSlip.products) {
        const productName = product.productName;
        const quantity = product.quantity || 0;

        if (!productName || quantity <= 0) continue;

        const inventoryItem = await Item.findOne({
          $or: [
            { name: { $regex: new RegExp(`^${productName}$`, 'i') } },
            { sku: { $regex: new RegExp(`^${productName}$`, 'i') } }
          ],
          isActive: { $ne: false }
        }).session(session);

        if (inventoryItem) {
          // Restore the quantity back to inventory
          await Item.findByIdAndUpdate(
            inventoryItem._id,
            { 
              $inc: { quantity: quantity }, 
              lastUpdated: new Date() 
            },
            { session }
          );
          restoredCount++;
          console.log(`✅ Restored ${quantity} units of ${productName} to inventory`);
        } else {
          console.warn(`⚠️ Product '${productName}' not found in inventory to restore`);
        }
      }
    }

    await existingSlip.save({ session });
    await session.commitTransaction();
    session.endSession();

    console.log(`✅ Successfully cancelled slip ${existingSlip.slipNumber || existingSlip._id}. Restored ${restoredCount} product(s) to inventory.`);

    res.json({ 
      message: 'Slip cancelled successfully',
      slip: existingSlip,
      details: {
        incomeRecordsUpdated: incomeUpdateResult.modifiedCount,
        inventoryItemsRestored: restoredCount
      }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Error cancelling slip:', err);
    res.status(500).json({ error: 'Failed to cancel slip', details: err.message });
  }
});

// GET slip by ID (must come after /cancel route)
router.get('/:id', async (req, res) => {
  try {
    const slip = await Slip.findById(req.params.id);
    if (!slip) return res.status(404).json({ error: 'Slip not found' });

    res.json(slip);

  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid slip ID format' });
    }

    res.status(500).json({ error: 'Failed to fetch slip', details: err.message });
  }
});

// CREATE slip + update inventory
router.post('/', async (req, res) => {
  const session = await Slip.startSession();
  session.startTransaction();

  try {
    // Ensure MongoDB connection
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment' 
      });
    }

    const { customerName, customerPhone, paymentMethod, subtotal, totalAmount, products } = req.body;

    if (!products || products.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Products cannot be empty' });
    }

    if (subtotal == null || totalAmount == null) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Subtotal and totalAmount required' });
    }

    // Validate subtotal and totalAmount are numbers
    const validSubtotal = parseFloat(subtotal);
    const validTotalAmount = parseFloat(totalAmount);
    
    if (isNaN(validSubtotal) || isNaN(validTotalAmount)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Subtotal and totalAmount must be valid numbers' });
    }
    
    if (validSubtotal < 0 || validTotalAmount < 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Subtotal and totalAmount cannot be negative' });
    }

    const productUpdates = [];

    for (const p of products) {
      const productName = p.productName || p.itemName;
      const quantity = p.quantity;
      const unitPrice = p.unitPrice ?? p.price;

      // Build query to find product by attributes (like addItems)
      const query = {
        productType: p.productType || 'Cover',
        $or: [{ isActive: true }, { isActive: { $exists: false } }]
      };

      // Add productType-specific fields
      if (p.productType === 'Cover' && p.coverType) {
        query.coverType = p.coverType;
      } else if (p.productType === 'Plate') {
        if (p.bikeName) query.bikeName = p.bikeName;
        if (p.plateCompany) query.plateCompany = p.plateCompany;
        if (p.plateType) query.plateType = p.plateType;
      } else if (p.productType === 'Form') {
        if (p.formCompany) query.formCompany = p.formCompany;
        if (p.formType) query.formType = p.formType;
        if (p.formVariant) query.formVariant = p.formVariant;
        if (p.bikeName) query.bikeName = p.bikeName; // Form uses bikeName field
      }

      // Try to find by attributes first
      let inventoryItem = await Item.findOne(query).session(session);
      
      // If not found by attributes, try by name/SKU as fallback
      if (!inventoryItem && productName) {
        inventoryItem = await Item.findOne({
          $and: [
            {
              $or: [
                { name: { $regex: new RegExp(`^${productName}$`, 'i') } },
                { sku: { $regex: new RegExp(`^${productName}$`, 'i') } }
              ]
            },
            {
              $or: [{ isActive: true }, { isActive: { $exists: false } }]
            }
          ]
        }).session(session);
      }

      if (!inventoryItem) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          error: `Product not found in inventory`,
          details: `No matching product found for: ${productName || JSON.stringify(query)}`
        });
      }

      if (inventoryItem.quantity < quantity) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: `Insufficient stock for '${productName}'. Available: ${inventoryItem.quantity}`
        });
      }

      productUpdates.push({
        itemId: inventoryItem._id,
        quantity
      });
    }

    // Helper function to calculate bulk discount
    const calculateBulkDiscount = (coverType, quantity, basePrice) => {
      // Bulk discount applies only to these cover types
      const bulkDiscountTypes = [
        'Aster Cover',
        'Without Aster Cover',
        'Calendar Cover'
      ];
      
      if (bulkDiscountTypes.includes(coverType) && quantity >= 10) {
        return 10; // 10 rupees discount per item
      }
      return 0;
    };

    // Process products with pricing logic
    const processedProducts = products.map((p, index) => {
      try {
        const productName = p.productName || p.itemName;
        const quantity = parseInt(p.quantity) || 0;
        const basePrice = parseFloat(p.basePrice) || parseFloat(p.unitPrice) || parseFloat(p.price) || 0;
        const coverType = p.coverType || '';
        const productType = p.productType || 'Cover';
        
        // Validate required fields
        if (quantity <= 0) {
          throw new Error(`Product ${index + 1}: Quantity must be greater than 0`);
        }
        if (basePrice < 0) {
          throw new Error(`Product ${index + 1}: Base price cannot be negative`);
        }
        
        // Calculate bulk discount if applicable
        let discountAmount = 0;
        let discountType = 'none';
        
        if (productType === 'Cover' && coverType) {
          const bulkDiscount = calculateBulkDiscount(coverType, quantity, basePrice);
          if (bulkDiscount > 0) {
            discountAmount = bulkDiscount;
            discountType = 'bulk';
          }
        }
        
        // Manual discount/override (if admin manually adjusted price)
        const finalUnitPrice = p.unitPrice !== undefined ? parseFloat(p.unitPrice) : (basePrice - discountAmount);
        
        // If unitPrice was manually set, it's a manual override
        if (p.unitPrice !== undefined && Math.abs(p.unitPrice - (basePrice - discountAmount)) > 0.01) {
          discountType = 'manual';
          discountAmount = Math.max(0, basePrice - finalUnitPrice);
        }
        
        // Ensure finalUnitPrice is not negative
        const safeUnitPrice = Math.max(0, finalUnitPrice);
        const totalDiscount = discountAmount * quantity;
        const totalPrice = quantity * safeUnitPrice;
        
        // Generate productName if not provided (from productType and other fields)
        let finalProductName = productName;
        if (!finalProductName || finalProductName.trim() === '') {
          if (productType === 'Cover' && coverType) {
            finalProductName = `${productType} - ${coverType}`;
          } else if (productType === 'Plate' && p.plateType) {
            finalProductName = `${productType} - ${p.plateType}${p.bikeName ? ` (${p.bikeName})` : ''}`;
          } else if (productType === 'Form' && p.formVariant) {
            finalProductName = `${productType} - ${p.formVariant}${p.formCompany ? ` (${p.formCompany})` : ''}`;
          } else {
            finalProductName = productType || 'Product';
          }
        }
        
        return {
          productName: finalProductName,
          productType,
          coverType: coverType || '',
          plateCompany: p.plateCompany || '',
          bikeName: p.bikeName || '',
          plateType: p.plateType || '',
          formCompany: p.formCompany || '',
          formType: p.formType || '',
          formVariant: p.formVariant || '',
          quantity,
          basePrice: Math.max(0, basePrice),
          unitPrice: safeUnitPrice,
          discountAmount: totalDiscount,
          discountType,
          totalPrice,
          category: p.category || '',
          subcategory: p.subcategory || '',
          company: p.company || ''
        };
      } catch (err) {
        throw new Error(`Error processing product ${index + 1}: ${err.message}`);
      }
    });

    // create slip
    const newSlip = new Slip({
      customerName: customerName || 'Walk-in Customer',
      customerPhone: customerPhone || '',
      paymentMethod: paymentMethod || 'Cash',
      products: processedProducts,
      subtotal: validSubtotal,
      totalAmount: validTotalAmount,
      status: 'Paid'
    });

    // reduce stock
    for (const update of productUpdates) {
      await Item.findByIdAndUpdate(
        update.itemId,
        { $inc: { quantity: -update.quantity }, lastUpdated: new Date() },
        { session }
      );
    }

    await newSlip.save({ session });

    // Save slip first to get slipNumber
    // income record with slipId reference
    const incomeRecord = new Income({
      date: new Date(),
      totalIncome: validTotalAmount,
      productsSold: processedProducts.map(p => {
        return {
          productName: p.productName,
          sku: p.sku || '',
          productType: p.productType || 'Cover',
          coverType: p.coverType || '',
          plateCompany: p.plateCompany || '',
          bikeName: p.bikeName || '',
          plateType: p.plateType || '',
          formCompany: p.formCompany || '',
          formType: p.formType || '',
          formVariant: p.formVariant || '',
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          totalPrice: p.totalPrice,
          category: p.category || '',
          subcategory: p.subcategory || '',
          company: p.company || ''
        };
      }),
      customerName: newSlip.customerName,
      customerPhone: newSlip.customerPhone || '',
      paymentMethod: newSlip.paymentMethod || 'Cash',
      slipNumber: newSlip.slipNumber || newSlip._id.toString(),
      slipId: newSlip._id,
      notes: `Sale from slip ${newSlip.slipNumber || newSlip._id}`
    });

    await incomeRecord.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'Slip created successfully',
      slip: newSlip
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('❌ Error creating slip:', err);
    console.error('❌ Error stack:', err.stack);
    console.error('❌ Request body:', JSON.stringify(req.body, null, 2));
    
    // Provide more detailed error message
    let errorMessage = 'Failed to create slip';
    if (err.name === 'ValidationError') {
      errorMessage = `Validation error: ${err.message}`;
    } else if (err.name === 'MongoServerSelectionError') {
      errorMessage = 'Database connection error. Please try again.';
    } else if (err.message) {
      errorMessage = err.message;
    }

    res.status(500).json({ 
      error: errorMessage, 
      details: err.message,
      errorType: err.name,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// UPDATE slip with inventory adjustment
router.put('/:id', async (req, res) => {
  const session = await Slip.startSession();
  session.startTransaction();

  try {
    const existingSlip = await Slip.findById(req.params.id).session(session);
    if (!existingSlip) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Slip not found' });
    }

    const { 
      customerName, 
      customerPhone,
      paymentMethod,
      notes,
      products,
      subtotal, 
      totalAmount, 
      tax,
      discount,
      status 
    } = req.body;

    // If products are being updated, adjust inventory
    if (products && Array.isArray(products)) {
      // First, restore original quantities to inventory
      if (existingSlip.products && existingSlip.products.length > 0) {
        for (const oldProduct of existingSlip.products) {
          const productName = oldProduct.productName;
          const oldQuantity = oldProduct.quantity;

          const inventoryItem = await Item.findOne({
            $or: [
              { name: { $regex: new RegExp(productName, 'i') } },
              { sku: { $regex: new RegExp(productName, 'i') } }
            ],
            isActive: true
          }).session(session);

          if (inventoryItem) {
            // Restore the old quantity
            await Item.findByIdAndUpdate(
              inventoryItem._id,
              { $inc: { quantity: oldQuantity }, lastUpdated: new Date() },
              { session }
            );
          }
        }
      }

      // Now, validate and reduce inventory for new quantities
      const productUpdates = [];
      for (const p of products) {
        const productName = p.productName || p.itemName;
        const quantity = p.quantity;

        if (!productName || !quantity || quantity <= 0) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: 'Invalid product data' });
        }

        const inventoryItem = await Item.findOne({
          $or: [
            { name: { $regex: new RegExp(productName, 'i') } },
            { sku: { $regex: new RegExp(productName, 'i') } }
          ],
          isActive: true
        }).session(session);

        if (!inventoryItem) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: `Product '${productName}' not found in inventory` });
        }

        // Check if we have enough stock (considering we already restored old quantity)
        const currentStock = inventoryItem.quantity;
        if (currentStock < quantity) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            error: `Insufficient stock for '${productName}'. Available: ${currentStock}`
          });
        }

        productUpdates.push({
          itemId: inventoryItem._id,
          quantity
        });
      }

      // Reduce stock for new quantities
      for (const update of productUpdates) {
        await Item.findByIdAndUpdate(
          update.itemId,
          { $inc: { quantity: -update.quantity }, lastUpdated: new Date() },
          { session }
        );
      }
    }

    // Update slip with all fields
    const updateData = {};
    if (customerName !== undefined) updateData.customerName = customerName;
    if (customerPhone !== undefined) updateData.customerPhone = customerPhone;
    if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
    if (notes !== undefined) updateData.notes = notes;
    if (subtotal !== undefined) updateData.subtotal = subtotal;
    if (totalAmount !== undefined) updateData.totalAmount = totalAmount;
    if (tax !== undefined) updateData.tax = tax;
    if (discount !== undefined) updateData.discount = discount;
    if (status !== undefined) updateData.status = status;
    // Helper function for bulk discount (same as in POST)
    const calculateBulkDiscount = (coverType, quantity, basePrice) => {
      const bulkDiscountTypes = [
        'Aster Cover',
        'Without Aster Cover',
        'Calendar Cover'
      ];
      
      if (bulkDiscountTypes.includes(coverType) && quantity >= 10) {
        return 10;
      }
      return 0;
    };

    if (products !== undefined) {
      updateData.products = products.map(p => {
        // Generate productName if not provided
        let productName = p.productName || p.itemName;
        if (!productName || productName.trim() === '') {
          const productType = p.productType || 'Cover';
          if (productType === 'Cover' && p.coverType) {
            productName = `${productType} - ${p.coverType}`;
          } else if (productType === 'Plate' && p.plateType) {
            productName = `${productType} - ${p.plateType}${p.bikeName ? ` (${p.bikeName})` : ''}`;
          } else if (productType === 'Form' && p.formVariant) {
            productName = `${productType} - ${p.formVariant}${p.formCompany ? ` (${p.formCompany})` : ''}`;
          } else {
            productName = productType || 'Product';
          }
        }
        
        const quantity = p.quantity;
        const basePrice = p.basePrice || p.unitPrice || p.price || 0;
        const coverType = p.coverType || '';
        const productType = p.productType || 'Cover';
        
        // Calculate bulk discount if applicable
        let discountAmount = 0;
        let discountType = 'none';
        
        if (productType === 'Cover' && coverType) {
          const bulkDiscount = calculateBulkDiscount(coverType, quantity, basePrice);
          if (bulkDiscount > 0) {
            discountAmount = bulkDiscount;
            discountType = 'bulk';
          }
        }
        
        // Manual discount/override
        const finalUnitPrice = p.unitPrice !== undefined ? p.unitPrice : (basePrice - discountAmount);
        
        if (p.unitPrice !== undefined && p.unitPrice !== (basePrice - discountAmount)) {
          discountType = 'manual';
          discountAmount = basePrice - finalUnitPrice;
        }
        
        return {
          productName,
          productType,
          coverType,
          plateCompany: p.plateCompany || '',
          bikeName: p.bikeName || '',
          plateType: p.plateType || '',
          quantity,
          basePrice,
          unitPrice: finalUnitPrice,
          discountAmount: discountAmount * quantity,
          discountType,
          totalPrice: quantity * finalUnitPrice,
          category: p.category || '',
          subcategory: p.subcategory || '',
          company: p.company || ''
        };
      });
    }
    // Handle cancellation with full synchronization
    if (status === 'Cancelled') {
      // Prevent duplicate cancellation
      if (existingSlip.status === 'Cancelled' && existingSlip.cancelledAt) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ 
          error: 'Slip is already cancelled',
          details: `This slip was cancelled on ${new Date(existingSlip.cancelledAt).toLocaleString()}`
        });
      }

      // Only process cancellation if slip is not already cancelled
      if (existingSlip.status !== 'Cancelled') {
        updateData.cancelledAt = new Date();
        
        // Mark related income records as inactive
        const incomeUpdateResult = await Income.updateMany(
          { 
            $or: [
              { slipId: existingSlip._id },
              { slipNumber: existingSlip.slipNumber }
            ],
            isActive: true
          },
          { 
            $set: {
              isActive: false,
              notes: `Cancelled on ${new Date().toISOString()} - Slip: ${existingSlip.slipNumber || existingSlip._id}`
            }
          },
          { session }
        );

        console.log(`✅ Marked ${incomeUpdateResult.modifiedCount} income record(s) as inactive for cancelled slip ${existingSlip.slipNumber || existingSlip._id}`);

        // Restore inventory quantities for cancelled slip
        if (existingSlip.products && existingSlip.products.length > 0) {
          let restoredCount = 0;
          for (const product of existingSlip.products) {
            const productName = product.productName;
            const quantity = product.quantity || 0;

            if (!productName || quantity <= 0) continue;

            const inventoryItem = await Item.findOne({
              $or: [
                { name: { $regex: new RegExp(`^${productName}$`, 'i') } },
                { sku: { $regex: new RegExp(`^${productName}$`, 'i') } }
              ],
              isActive: { $ne: false }
            }).session(session);

            if (inventoryItem) {
              // Restore the quantity back to inventory
              await Item.findByIdAndUpdate(
                inventoryItem._id,
                { 
                  $inc: { quantity: quantity }, 
                  lastUpdated: new Date() 
                },
                { session }
              );
              restoredCount++;
              console.log(`✅ Restored ${quantity} units of ${productName} to inventory`);
            } else {
              console.warn(`⚠️ Product '${productName}' not found in inventory to restore`);
            }
          }
          console.log(`✅ Restored inventory for ${restoredCount} product(s) from cancelled slip`);
        }
      }
    }

    const updatedSlip = await Slip.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true, session }
    );

    // If products changed and slip is not cancelled, update income record
    if (products && Array.isArray(products) && status !== 'Cancelled' && existingSlip.status !== 'Cancelled') {
      const finalProducts = updateData.products || products.map(p => ({
        productName: p.productName || p.itemName,
        sku: p.sku || '',
        productType: p.productType || 'Cover',
        coverType: p.coverType || '',
        plateCompany: p.plateCompany || '',
        bikeName: p.bikeName || '',
        plateType: p.plateType || '',
        formCompany: p.formCompany || '',
        formType: p.formType || '',
        formVariant: p.formVariant || '',
        quantity: p.quantity,
        unitPrice: p.unitPrice ?? p.price,
        totalPrice: p.totalPrice || (p.quantity * (p.unitPrice ?? p.price)),
        category: p.category || '',
        subcategory: p.subcategory || '',
        company: p.company || ''
      }));

      const incomeUpdate = {
        $set: {
          totalIncome: totalAmount || updatedSlip.totalAmount,
          productsSold: finalProducts,
          customerName: customerName || updatedSlip.customerName,
          paymentMethod: paymentMethod || updatedSlip.paymentMethod,
          notes: notes !== undefined ? notes : existingSlip.notes || ''
        }
      };

      const incomeUpdateResult = await Income.updateMany(
        { 
          $or: [
            { slipId: existingSlip._id },
            { slipNumber: existingSlip.slipNumber }
          ],
          isActive: true
        },
        incomeUpdate,
        { session }
      );

      console.log(`✅ Updated ${incomeUpdateResult.modifiedCount} income record(s) for slip ${existingSlip.slipNumber || existingSlip._id}`);
    }

    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Slip updated successfully', slip: updatedSlip });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Error updating slip:', err);
    res.status(500).json({ error: 'Failed to update slip', details: err.message });
  }
});

// DELETE slip - restore inventory and update income
router.delete('/:id', async (req, res) => {
  const session = await Slip.startSession();
  session.startTransaction();

  try {
    const slip = await Slip.findById(req.params.id).session(session);
    if (!slip) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: 'Slip not found' });
    }

    // Restore inventory quantities
    let restoredCount = 0;
    if (slip.products && slip.products.length > 0) {
      for (const product of slip.products) {
        const productName = product.productName;
        const quantity = product.quantity || 0;

        if (!productName || quantity <= 0) continue;

        // Try to find product by name or attributes
        let inventoryItem = await Item.findOne({
          $or: [
            { name: { $regex: new RegExp(`^${productName}$`, 'i') } },
            { sku: { $regex: new RegExp(`^${productName}$`, 'i') } }
          ],
          isActive: { $ne: false }
        }).session(session);

        // If not found by name, try by attributes
        if (!inventoryItem && product.productType) {
          const query = {
            productType: product.productType || 'Cover',
            isActive: { $ne: false }
          };

          if (product.productType === 'Cover' && product.coverType) {
            query.coverType = product.coverType;
          } else if (product.productType === 'Plate') {
            if (product.bikeName) query.bikeName = product.bikeName;
            if (product.plateCompany) query.plateCompany = product.plateCompany;
            if (product.plateType) query.plateType = product.plateType;
          } else if (product.productType === 'Form') {
            if (product.formCompany) query.formCompany = product.formCompany;
            if (product.formType) query.formType = product.formType;
            if (product.formVariant) query.formVariant = product.formVariant;
            if (product.bikeName) query.bikeName = product.bikeName;
          }

          inventoryItem = await Item.findOne(query).session(session);
        }

        if (inventoryItem) {
          // Restore the quantity back to inventory
          await Item.findByIdAndUpdate(
            inventoryItem._id,
            { 
              $inc: { quantity: quantity }, 
              lastUpdated: new Date() 
            },
            { session }
          );
          restoredCount++;
          console.log(`✅ Restored ${quantity} units of ${productName} to inventory`);
        } else {
          console.warn(`⚠️ Product '${productName}' not found in inventory to restore`);
        }
      }
    }

    // Mark related income records as inactive
    const incomeUpdateResult = await Income.updateMany(
      { 
        $or: [
          { slipId: slip._id },
          { slipNumber: slip.slipNumber }
        ],
        isActive: true
      },
      { 
        $set: {
          isActive: false,
          notes: `Deleted on ${new Date().toISOString()} - Slip: ${slip.slipNumber || slip._id}`
        }
      },
      { session }
    );

    console.log(`✅ Marked ${incomeUpdateResult.modifiedCount} income record(s) as inactive for deleted slip ${slip.slipNumber || slip._id}`);

    // Delete the slip
    await Slip.findByIdAndDelete(req.params.id).session(session);

    await session.commitTransaction();
    session.endSession();

    res.json({ 
      message: 'Slip deleted successfully',
      details: {
        inventoryItemsRestored: restoredCount,
        incomeRecordsUpdated: incomeUpdateResult.modifiedCount
      }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Error deleting slip:', err);
    res.status(500).json({ error: 'Failed to delete slip', details: err.message });
  }
});

module.exports = router;
