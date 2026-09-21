const express = require('express');
const cors = require('cors');
const db = require('./config/db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

/* AUTHENTICATION ROUTES */

// User Login Endpoint
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [users] = await db.query(
            'SELECT * FROM Users WHERE email = ? AND password = ?', 
            [email, password]
        );

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        const user = users[0];

        // Send user payload with database role
        res.json({
            success: true,
            token: "fake-jwt-token-" + user.user_id, 
            user: {
                id: user.user_id,
                name: user.name,
                email: user.email,
                role: user.role || 'customer'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// User Registration Endpoint
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    try {
        // Check if user already exists
        const [existing] = await db.query('SELECT user_id FROM Users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Email is already registered!' });
        }

        // Insert new customer record
        const [result] = await db.query(
            'INSERT INTO Users (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name, email, password, 'customer']
        );

        res.json({ success: true, userId: result.insertId, message: 'Registration successful' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* PRODUCT & CATEGORY ROUTES */
        // feature api
const featureRoutes = require('./routes/features');
app.use('/api', featureRoutes);

// Fetch all products
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM Products');
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Add new product
app.post('/api/products', async (req, res) => {
    const { name, description, price, stock_quantity } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO Products (name, description, price, stock_quantity) VALUES (?, ?, ?, ?)',
            [name, description, price, stock_quantity]
        );
        res.json({ success: true, productId: result.insertId });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* ORDER PROCESSING ROUTE */

// Submit Order Endpoint
app.post('/api/orders', async (req, res) => {
    const { cartItems, totalAmount } = req.body;
    try {
        // Basic response for checkout workflow
        res.json({ 
            success: true, 
            orderId: Math.floor(100000 + Math.random() * 900000), 
            message: 'Order created successfully' 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/* DASHBOARD & ANALYTICS ROUTES */

// Get loyalty statistics
app.get('/api/loyalty-stats', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT u.user_id, u.name, l.total_spent, l.loyalty_points, l.tier_level 
            FROM User_Loyalty l 
            JOIN Users u ON l.user_id = u.user_id
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(5000, () => {
    console.log('Server running on http://localhost:5000');
});