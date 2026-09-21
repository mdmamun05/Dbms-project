const express = require('express');
const router = express.Router();
// Apnar DB connection file context onujayi path set korun (e.g., '../db' ba '../config/db')
const db = require('../config/db'); 

// Flash Sales API
router.get('/flash-sales', async (req, res) => {
  try {
    const query = `
      SELECT fs.*, p.name, p.price, p.stock_quantity, c.category_name 
      FROM flash_sales fs
      JOIN products p ON fs.product_id = p.product_id
      LEFT JOIN categories c ON p.category_id = c.category_id
      WHERE fs.status = 'Active' AND fs.end_time > NOW()
    `;
    const [rows] = await db.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch flash sales' });
  }
});

// Top Selling Products API
router.get('/products/top-selling', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM view_top_selling_products LIMIT 4');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch top selling products' });
  }
});

// Product Reviews API
router.get('/products/:id/reviews', async (req, res) => {
  try {
    const productId = req.params.id;
    const query = `
      SELECT pr.*, u.name as user_name 
      FROM product_reviews pr
      JOIN users u ON pr.user_id = u.user_id
      WHERE pr.product_id = ?
      ORDER BY pr.created_at DESC
    `;
    const [reviews] = await db.query(query, [productId]);
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

module.exports = router;