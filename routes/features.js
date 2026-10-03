const express = require('express');
const router = express.Router();
// Apnar DB connection file context onujayi path set korun (e.g., '../db' ba '../config/db')
const db = require('../config/db'); 

// Update Product - Admin Inventory
router.put('/products/:id', async (req, res) => {
  try {
    const productId = Number(req.params.id);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Invalid product ID.' });
    }

    const {
      name,
      description,
      category_id,
      price,
      stock_quantity,
      image_url
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Product name is required.' });
    }

    const numericPrice = Number(price);
    const numericStock = Number(stock_quantity);

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      return res.status(400).json({ error: 'Invalid product price.' });
    }

    if (!Number.isInteger(numericStock) || numericStock < 0) {
      return res.status(400).json({ error: 'Invalid stock quantity.' });
    }

    const categoryId =
      category_id === null ||
      category_id === undefined ||
      category_id === ''
        ? null
        : Number(category_id);

    if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0)) {
      return res.status(400).json({ error: 'Invalid category.' });
    }

    const [result] = await db.query(
      `UPDATE products
       SET
         name = ?,
         description = ?,
         category_id = ?,
         price = ?,
         stock_quantity = ?,
         image_url = ?
       WHERE product_id = ?`,
      [
        name.trim(),
        description || '',
        categoryId,
        numericPrice,
        numericStock,
        image_url || null,
        productId
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const [rows] = await db.query(
      `SELECT
         p.product_id,
         p.name,
         p.description,
         p.category_id,
         p.price,
         p.stock_quantity,
         p.image_url,
         c.category_name
       FROM products p
       LEFT JOIN categories c
         ON p.category_id = c.category_id
       WHERE p.product_id = ?`,
      [productId]
    );

    res.json({
      success: true,
      message: 'Product updated successfully.',
      product: rows[0]
    });

  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({
      error: 'Failed to update product.',
      details: err.message
    });
  }
});

// Flash Sales API
router.get('/flash-sales', async (req, res) => {
  try {
    const query = `
      SELECT fs.*, p.name, p.price, p.stock_quantity, c.category_name 
      FROM flash_sales fs
      JOIN products p ON fs.product_id = p.product_id
      LEFT JOIN categories c ON p.category_id = c.category_id
      WHERE fs.status <> 'Ended'
        AND fs.start_time <= NOW()
        AND fs.end_time >= NOW()
    `;
    const [rows] = await db.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch flash sales' });
  }
});


// Get all flash sales for admin, with product/category details.
// Status is calculated from the scheduled time so the UI always reflects the current state.
router.get('/admin/flash-sales', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        fs.sale_id AS id,
        fs.product_id,
        fs.discount_percentage,
        fs.discount_percentage AS discount_percent,
        fs.flash_stock,
        fs.start_time,
        fs.end_time,
        CASE
          WHEN NOW() < fs.start_time THEN 'Scheduled'
          WHEN NOW() >= fs.start_time AND NOW() <= fs.end_time THEN 'Active'
          ELSE 'Ended'
        END AS status,
        p.name,
        p.price,
        p.stock_quantity,
        c.category_name
      FROM flash_sales fs
      INNER JOIN products p ON fs.product_id = p.product_id
      LEFT JOIN categories c ON p.category_id = c.category_id
      ORDER BY fs.start_time ASC, fs.sale_id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Admin flash sales error:', err);
    res.status(500).json({ error: 'Failed to fetch flash sales' });
  }
});

// Create a flash sale in the real database.
router.post('/flash-sales', async (req, res) => {
  try {
    const productId = Number(req.body.product_id);
    const discount = Number(req.body.discount_percentage ?? req.body.discount_percent);
    const flashStock = Number(req.body.flash_stock);
    const startTime = req.body.start_time;
    const endTime = req.body.end_time;

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Invalid product.' });
    }
    if (!Number.isFinite(discount) || discount <= 0 || discount > 100) {
      return res.status(400).json({ error: 'Discount must be between 1 and 100 percent.' });
    }
    if (!Number.isInteger(flashStock) || flashStock <= 0) {
      return res.status(400).json({ error: 'Flash stock must be greater than zero.' });
    }
    if (!startTime || !endTime || new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ error: 'End time must be after the start time.' });
    }

    const [products] = await db.query(
      'SELECT product_id, stock_quantity FROM products WHERE product_id = ?',
      [productId]
    );
    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    if (flashStock > products[0].stock_quantity) {
      return res.status(400).json({ error: `Flash stock cannot exceed available stock (${products[0].stock_quantity}).` });
    }

    // Prevent overlapping campaigns for the same product.
    const [overlap] = await db.query(`
      SELECT sale_id
      FROM flash_sales
      WHERE product_id = ?
        AND status <> 'Ended'
        AND start_time < ?
        AND end_time > ?
      LIMIT 1
    `, [productId, endTime, startTime]);

    if (overlap.length) {
      return res.status(409).json({ error: 'This product already has an overlapping flash sale.' });
    }

    const initialStatus = new Date() < new Date(startTime) ? 'Scheduled' : 'Active';

    const [result] = await db.query(`
      INSERT INTO flash_sales
        (product_id, discount_percentage, flash_stock, start_time, end_time, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [productId, discount, flashStock, startTime, endTime, initialStatus]);

    const [rows] = await db.query(`
      SELECT fs.sale_id AS id, fs.product_id,
             fs.discount_percentage, fs.discount_percentage AS discount_percent,
             fs.flash_stock, fs.start_time, fs.end_time, fs.status,
             p.name, p.price, p.stock_quantity
      FROM flash_sales fs
      INNER JOIN products p ON fs.product_id = p.product_id
      WHERE fs.sale_id = ?
    `, [result.insertId]);

    res.status(201).json({ success: true, sale: rows[0] });
  } catch (err) {
    console.error('Create flash sale error:', err);
    res.status(500).json({ error: 'Failed to create flash sale.' });
  }
});

// End a flash sale without deleting its history.
router.patch('/flash-sales/:id/cancel', async (req, res) => {
  try {
    const saleId = Number(req.params.id);
    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: 'Invalid flash sale ID.' });
    }

    const [result] = await db.query(
      `UPDATE flash_sales
       SET status = 'Ended', end_time = LEAST(end_time, NOW())
       WHERE sale_id = ? AND status <> 'Ended'`,
      [saleId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Flash sale not found or already ended.' });
    }

    res.json({ success: true, message: 'Flash sale ended successfully.' });
  } catch (err) {
    console.error('Cancel flash sale error:', err);
    res.status(500).json({ error: 'Failed to cancel flash sale.' });
  }
});

// Admin recommendations: products with no completed purchase in the longest time.
// Products that have never been purchased appear first.
router.get('/flash-sales/recommendations', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        p.product_id,
        p.name,
        p.price,
        p.stock_quantity,
        MAX(o.order_date) AS last_purchased_at,
        COALESCE(SUM(CASE WHEN o.status = 'Completed' THEN oi.quantity ELSE 0 END), 0) AS units_sold
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.product_id
      LEFT JOIN orders o ON o.order_id = oi.order_id AND o.status = 'Completed'
      WHERE p.stock_quantity > 0
      GROUP BY p.product_id, p.name, p.price, p.stock_quantity
      ORDER BY last_purchased_at IS NOT NULL, last_purchased_at ASC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    console.error('Flash sale recommendations error:', err);
    res.status(500).json({ error: 'Failed to load flash sale recommendations.' });
  }
});

// Top Selling Products API
// Top Selling Products API
router.get('/products/top-selling', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        p.product_id,
        p.name,
        p.price,
        p.stock_quantity,
        p.category_id,
        c.category_name,
        SUM(oi.quantity) AS total_units_sold,
        SUM(oi.quantity * oi.price_per_unit) AS total_revenue
      FROM order_items oi
      INNER JOIN orders o
        ON o.order_id = oi.order_id
      INNER JOIN products p
        ON p.product_id = oi.product_id
      LEFT JOIN categories c
        ON c.category_id = p.category_id
      WHERE o.status = 'Completed'
      GROUP BY
        p.product_id,
        p.name,
        p.price,
        p.stock_quantity,
        p.category_id,
        c.category_name
      ORDER BY total_units_sold DESC, p.product_id ASC
      LIMIT 4
    `);

    res.json(rows);
  } catch (err) {
    console.error('Top selling products error:', err);
    res.status(500).json({
      error: 'Failed to fetch top selling products'
    });
  }
});

// Add a product review
router.post('/products/:id/reviews', async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const userId = Number(req.body.userId);
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || '').trim();

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Please log in before submitting a review.' });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }
    if (!comment) {
      return res.status(400).json({ error: 'Please write a review comment.' });
    }
    if (comment.length > 1000) {
      return res.status(400).json({ error: 'Review comment must be 1000 characters or less.' });
    }

    const [products] = await db.query(
      'SELECT product_id FROM products WHERE product_id = ?',
      [productId]
    );
    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const [users] = await db.query(
      'SELECT user_id FROM users WHERE user_id = ?',
      [userId]
    );
    if (users.length === 0) {
      return res.status(401).json({ error: 'User account not found.' });
    }

    const [result] = await db.query(
      `INSERT INTO product_reviews (product_id, user_id, rating, comment)
       VALUES (?, ?, ?, ?)`,
      [productId, userId, rating, comment]
    );

    const [rows] = await db.query(
      `SELECT pr.review_id, pr.product_id, pr.user_id, pr.rating, pr.comment, pr.created_at,
              u.name AS user_name
       FROM product_reviews pr
       INNER JOIN users u ON pr.user_id = u.user_id
       WHERE pr.review_id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      review: rows[0],
      message: 'Review submitted successfully.'
    });
  } catch (err) {
    console.error('Create review error:', err);
    res.status(500).json({ error: 'Failed to submit review.' });
  }
});

module.exports = router;