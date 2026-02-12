const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Item = require('../models/items');

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

// GET /api/items - Get all items with filtering and pagination
router.get('/', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment',
        items: [],
        categories: []
      });
    }

    const { 
      page = 1, 
      limit = 50, 
      search = '',
      category = '',
      lowStock = false 
    } = req.query;

    const filter = { $or: [{ isActive: true }, { isActive: { $exists: false } }] };
    
    // Search filter
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Category filter
    if (category) {
      filter.category = category;
    }

    // Low stock filter
    if (lowStock === 'true') {
      filter.quantity = { $lte: 10 };
    }

    const items = await Item.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .maxTimeMS(15000)
      .lean();

    const total = await Item.countDocuments(filter).maxTimeMS(10000);

    // Get all categories for filter dropdown
    const categories = await Item.distinct('category', { $or: [{ isActive: true }, { isActive: { $exists: false } }] }).maxTimeMS(10000);

    res.json({
      items,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      totalItems: total,
      categories
    });
  } catch (error) {
    console.error('❌ Error fetching items:', error);
    res.status(500).json({ 
      error: 'Failed to fetch items', 
      details: error.message 
    });
  }
});

// DELETE /api/items/all - Permanently delete ALL products from database
router.delete('/all', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({
        error: 'Database connection unavailable',
        details: 'Please try again in a moment'
      });
    }
    const result = await Item.deleteMany({});
    console.log(`✅ Deleted all items: ${result.deletedCount} product(s).`);
    res.json({
      message: 'All products permanently deleted',
      deleted: { items: result.deletedCount }
    });
  } catch (err) {
    console.error('❌ Error deleting all items:', err);
    res.status(500).json({
      error: 'Failed to delete all products',
      details: err.message
    });
  }
});

// GET /api/items/low-stock - Get low stock items
router.get('/low-stock', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment',
        items: [],
        total: 0
      });
    }

    const lowStockItems = await Item.find({
      quantity: { $lte: 10 },
      isActive: true
    }).sort({ quantity: 1 });

    res.json({
      items: lowStockItems,
      total: lowStockItems.length
    });
  } catch (error) {
    console.error('❌ Error fetching low stock items:', error);
    res.status(500).json({ 
      error: 'Failed to fetch low stock items', 
      details: error.message 
    });
  }
});

// GET /api/items/out-of-stock - Get out of stock items
router.get('/out-of-stock', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment',
        items: [],
        total: 0
      });
    }

    const outOfStockItems = await Item.find({
      quantity: 0,
      isActive: true
    }).sort({ name: 1 });

    res.json({
      items: outOfStockItems,
      total: outOfStockItems.length
    });
  } catch (error) {
    console.error('❌ Error fetching out of stock items:', error);
    res.status(500).json({ 
      error: 'Failed to fetch out of stock items', 
      details: error.message 
    });
  }
});

// GET /api/items/:id - Get single item by ID
router.get('/:id', async (req, res) => {
  try {
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment' 
      });
    }

    const item = await Item.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (!item.isActive) {
      return res.status(404).json({ error: 'Item has been deleted' });
    }

    res.json(item);
  } catch (error) {
    console.error('❌ Error fetching item:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid item ID format' });
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch item', 
      details: error.message 
    });
  }
});

// POST /api/items - Create new item
router.post('/', async (req, res) => {
  try {
    // Ensure MongoDB connection before proceeding
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment' 
      });
    }

    console.log('📦 Received item creation request:', JSON.stringify(req.body, null, 2));
    
    const { 
      name, 
      sku, 
      productType,
      coverType,
      plateCompany,
      bikeName,
      plateType,
      formCompany,
      formType,
      formVariant,
      formBikeName, // For Form products
      category, 
      subcategory,
      company,
      quantity, 
      price,
      basePrice,
      description,
      minStockLevel,
      maxStockLevel,
      supplier,
      costPrice,
      isActive
    } = req.body;

    // Simple/custom product: when name is provided, skip productType-specific validations
    const isSimpleProduct = !!(name && typeof name === 'string' && name.trim());

    // Validation
    // Name and SKU are OPTIONAL - auto-generate if not provided (unless simple product)
    const generatedName = isSimpleProduct
      ? name.trim()
      : ((name && name.trim()) 
          ? name.trim() 
          : `${productType || 'Cover'}${coverType ? ` - ${coverType}` : ''}${plateType ? ` - ${plateType}` : ''}${formVariant ? ` - ${formVariant}` : ''}`.trim());
    
    const productTypeForSku = productType || 'Cover';
    const generatedSku = (sku && sku.trim()) 
      ? sku.trim().toUpperCase() 
      : `${productTypeForSku}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`.toUpperCase();
    
    console.log('📝 Name and SKU generation:', { 
      providedName: name, 
      generatedName, 
      providedSku: sku, 
      generatedSku 
    });

    // Parse and validate numeric values
    const quantityValue = parseInt(quantity) || 0;
    // Handle price: allow 0, but not empty/undefined/null/NaN
    const priceValue = (price !== undefined && price !== null && price !== '') ? parseFloat(price) : null;
    const basePriceValue = (basePrice !== undefined && basePrice !== null && basePrice !== '') 
      ? parseFloat(basePrice) 
      : (priceValue !== null ? priceValue : 0);

    console.log('💰 Price validation:', { 
      originalPrice: price, 
      priceValue, 
      isNaN: isNaN(priceValue),
      basePriceValue 
    });

    // Validate that price is provided and valid (allow 0, but not empty/undefined/null/NaN)
    if (priceValue === null || isNaN(priceValue) || priceValue < 0) {
      console.error('❌ Price validation failed:', { price, priceValue, isNaN: isNaN(priceValue) });
      return res.status(400).json({ 
        error: 'Valid selling price is required',
        details: `Price must be a valid number >= 0. Received: ${price}`
      });
    }

    if (quantityValue < 0) {
      return res.status(400).json({ error: 'Quantity must be non-negative' });
    }

    // Check if SKU already exists (only if provided)
    let finalSku = generatedSku;
    if (sku && sku.trim()) {
      const existingItem = await Item.findOne({ 
        sku: sku.toUpperCase().trim(),
        isActive: true 
      });
      if (existingItem) {
        return res.status(400).json({ error: 'SKU already exists' });
      }
      finalSku = sku.toUpperCase().trim();
    } else {
      // Check if auto-generated SKU exists, generate new one if needed
      let attempts = 0;
      while (attempts < 5) {
        const existingItem = await Item.findOne({ 
          sku: finalSku.toUpperCase(),
          isActive: true 
        });
        if (!existingItem) break;
        finalSku = `${productTypeForSku}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`.toUpperCase();
        attempts++;
      }
    }

    // Validation: productType-specific only when NOT a simple/custom product (no custom name)
    if (!isSimpleProduct) {
      if (productType === 'Cover' && !coverType) {
        return res.status(400).json({ error: 'Cover Type is required when Product Type is Cover' });
      }
      if (productType === 'Plate') {
        if (bikeName === 'Plastic Plate') {
          // Plastic Plate is standalone
        } else {
          if (!bikeName) {
            return res.status(400).json({ error: 'Bike Name is required for Plate products (except Plastic Plate)' });
          }
          if (!plateType) {
            return res.status(400).json({ error: 'Plate Type is required for Plate products (except Plastic Plate)' });
          }
          if (bikeName === '70' && !plateCompany) {
            return res.status(400).json({ error: 'Company is required for Bike 70' });
          }
        }
      }
      if (productType === 'Form') {
        if (!formCompany) {
          return res.status(400).json({ error: 'Company is required for Form products' });
        }
        if (!formType) {
          return res.status(400).json({ error: 'Form Type is required for Form products' });
        }
        if (!formVariant) {
          return res.status(400).json({ error: 'Form Variant is required for Form products' });
        }
      }
    }

    console.log('✅ All validations passed, creating item...');

    // Build item object - only include fields relevant to productType (or minimal for simple product)
    const itemData = {
      name: generatedName || (name ? name.trim() : ''),
      sku: finalSku,
      productType: isSimpleProduct ? 'Cover' : (productType || 'Cover'),
      category: category || 'General',
      subcategory: subcategory || '',
      quantity: quantityValue,
      price: priceValue,
      basePrice: basePriceValue,
      costPrice: (costPrice !== undefined && costPrice !== null && costPrice !== '') ? parseFloat(costPrice) : 0,
      description: description || '',
      minStockLevel: minStockLevel || 10,
      maxStockLevel: maxStockLevel || 1000,
      supplier: supplier || '',
      isActive: isActive !== undefined && isActive !== null ? !!isActive : true
    };

    if (isSimpleProduct) {
      itemData.company = (company && typeof company === 'string') ? company.trim() : '';
      itemData.bikeName = (bikeName && typeof bikeName === 'string') ? bikeName.trim() : '';
    }
    if (!isSimpleProduct) {
      if (productType === 'Cover') {
        itemData.coverType = coverType || '';
      } else if (productType === 'Plate') {
        itemData.plateCompany = plateCompany || '';
        itemData.bikeName = bikeName || '';
        itemData.plateType = plateType || '';
      } else if (productType === 'Form') {
        itemData.formCompany = formCompany || '';
        itemData.formType = formType || '';
        itemData.formVariant = formVariant || '';
        itemData.bikeName = formBikeName || '';
      }
    }

    const newItem = new Item(itemData);
    
    await newItem.save();
    
    res.status(201).json({ 
      message: 'Item created successfully', 
      item: newItem 
    });
  } catch (error) {
    console.error('❌ Error creating item:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error message:', error.message);
    
    // Handle MongoDB connection errors
    if (error.name === 'MongooseError' && error.message.includes('initial connection')) {
      return res.status(503).json({ 
        error: 'Database connection error',
        details: 'Please wait a moment and try again. The database is connecting.',
        errorName: error.name
      });
    }
    
    if (error.code === 11000) {
      return res.status(400).json({ error: 'SKU already exists' });
    }
    
    // Handle validation errors from Mongoose
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message).join(', ');
      return res.status(400).json({ 
        error: 'Validation error', 
        details: validationErrors,
        fullError: error.message
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to create item', 
      details: error.message,
      errorName: error.name
    });
  }
});

// PUT /api/items/:id - Update item
router.put('/:id', async (req, res) => {
  try {
    // Ensure MongoDB connection before proceeding
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment' 
      });
    }

    const { 
      name, 
      productType,
      coverType,
      plateCompany,
      bikeName,
      plateType,
      formCompany,
      formType,
      formVariant,
      category, 
      subcategory,
      company,
      quantity, 
      price,
      basePrice,
      description,
      minStockLevel,
      maxStockLevel,
      supplier,
      costPrice
    } = req.body;

    // Get existing item to preserve values if not provided
    const existingItem = await Item.findById(req.params.id);
    if (!existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Validation
    if (quantity !== undefined && quantity < 0) {
      return res.status(400).json({ error: 'Quantity must be non-negative' });
    }
    if (price !== undefined && price < 0) {
      return res.status(400).json({ error: 'Price must be non-negative' });
    }
    if (costPrice !== undefined && costPrice < 0) {
      return res.status(400).json({ error: 'Cost price must be non-negative' });
    }

    // Use existing values if not provided (for partial updates like quantity/price only)
    const finalProductType = productType !== undefined ? productType : existingItem.productType;
    const finalCoverType = coverType !== undefined ? coverType : existingItem.coverType;
    const finalPlateCompany = plateCompany !== undefined ? plateCompany : existingItem.plateCompany;
    const finalBikeName = bikeName !== undefined ? bikeName : existingItem.bikeName;
    const finalPlateType = plateType !== undefined ? plateType : existingItem.plateType;
    const finalFormCompany = formCompany !== undefined ? formCompany : existingItem.formCompany;
    const finalFormType = formType !== undefined ? formType : existingItem.formType;
    const finalFormVariant = formVariant !== undefined ? formVariant : existingItem.formVariant;

    // Validation: If productType is Cover, coverType is required (only validate if productType is being changed)
    if (finalProductType === 'Cover' && !finalCoverType && productType !== undefined) {
      return res.status(400).json({ error: 'Cover Type is required when Product Type is Cover' });
    }

    // Validation: If productType is Plate, validate required fields (only if productType is being changed)
    if (finalProductType === 'Plate' && productType !== undefined) {
      if (finalBikeName === 'Plastic Plate') {
        // Plastic Plate is standalone
      } else {
        if (!finalBikeName) {
          return res.status(400).json({ error: 'Bike Name is required for Plate products (except Plastic Plate)' });
        }
        if (!finalPlateType) {
          return res.status(400).json({ error: 'Plate Type is required for Plate products (except Plastic Plate)' });
        }
        if (finalBikeName === '70' && !finalPlateCompany) {
          return res.status(400).json({ error: 'Company is required for Bike 70' });
        }
      }
    }

    // Validation: If productType is Form, validate required fields (only if productType is being changed)
    if (finalProductType === 'Form' && productType !== undefined) {
      if (!finalFormCompany) {
        return res.status(400).json({ error: 'Company is required for Form products' });
      }
      if (!finalFormType) {
        return res.status(400).json({ error: 'Form Type is required for Form products' });
      }
      if (!finalFormVariant) {
        return res.status(400).json({ error: 'Form Variant is required for Form products' });
      }
    }

    // Build update object - only update fields that are provided
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (productType !== undefined) updateData.productType = productType;
    if (quantity !== undefined) updateData.quantity = quantity;
    if (price !== undefined) updateData.price = price;
    if (basePrice !== undefined) updateData.basePrice = basePrice;
    if (costPrice !== undefined) updateData.costPrice = costPrice;
    if (category !== undefined) updateData.category = category;
    if (subcategory !== undefined) updateData.subcategory = subcategory;
    if (company !== undefined) updateData.company = company;
    if (description !== undefined) updateData.description = description;
    if (minStockLevel !== undefined) updateData.minStockLevel = minStockLevel;
    if (maxStockLevel !== undefined) updateData.maxStockLevel = maxStockLevel;
    if (supplier !== undefined) updateData.supplier = supplier;
    updateData.lastUpdated = new Date();

    // Product type specific fields - preserve existing if not provided
    if (finalProductType === 'Cover') {
      updateData.coverType = finalCoverType || '';
      // Clear other product type fields
      updateData.plateCompany = '';
      updateData.bikeName = '';
      updateData.plateType = '';
      updateData.formCompany = '';
      updateData.formType = '';
      updateData.formVariant = '';
    } else if (finalProductType === 'Plate') {
      updateData.plateCompany = finalPlateCompany || '';
      updateData.bikeName = finalBikeName || '';
      updateData.plateType = finalPlateType || '';
      // Clear other product type fields
      updateData.coverType = '';
      updateData.formCompany = '';
      updateData.formType = '';
      updateData.formVariant = '';
    } else if (finalProductType === 'Form') {
      updateData.formCompany = finalFormCompany || '';
      updateData.formType = finalFormType || '';
      updateData.formVariant = finalFormVariant || '';
      // Clear other product type fields
      updateData.coverType = '';
      updateData.plateCompany = '';
      updateData.bikeName = '';
      updateData.plateType = '';
    }

    const updatedItem = await Item.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ 
      message: 'Item updated successfully', 
      item: updatedItem 
    });
  } catch (error) {
    console.error('❌ Error updating item:', error);
    res.status(500).json({ 
      error: 'Failed to update item', 
      details: error.message 
    });
  }
});

// PATCH /api/items/:id/stock - Update stock quantity only
router.patch('/:id/stock', async (req, res) => {
  try {
    const { quantity, operation = 'set' } = req.body; // operation: 'set', 'add', 'subtract'

    if (quantity === undefined || quantity < 0) {
      return res.status(400).json({ error: 'Valid quantity is required' });
    }

    const item = await Item.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    let newQuantity = quantity;
    
    if (operation === 'add') {
      newQuantity = item.quantity + quantity;
    } else if (operation === 'subtract') {
      newQuantity = item.quantity - quantity;
      if (newQuantity < 0) {
        return res.status(400).json({ error: 'Insufficient stock' });
      }
    }

    item.quantity = newQuantity;
    item.lastUpdated = new Date();
    await item.save();

    res.json({ 
      message: 'Stock updated successfully', 
      item: item 
    });
  } catch (error) {
    console.error('❌ Error updating stock:', error);
    res.status(500).json({ 
      error: 'Failed to update stock', 
      details: error.message 
    });
  }
});

// DELETE /api/items/:id - Soft delete item
router.delete('/:id', async (req, res) => {
  try {
    // Ensure MongoDB connection before proceeding
    const isConnected = await ensureConnection();
    if (!isConnected) {
      return res.status(503).json({ 
        error: 'Database connection unavailable', 
        details: 'Please try again in a moment' 
      });
    }

    const deletedItem = await Item.findByIdAndUpdate(
      req.params.id,
      { isActive: false, lastUpdated: new Date() },
      { new: true }
    );

    if (!deletedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ 
      message: 'Item deleted successfully' 
    });
  } catch (error) {
    console.error('❌ Error deleting item:', error);
    res.status(500).json({ 
      error: 'Failed to delete item', 
      details: error.message 
    });
  }
});

module.exports = router;