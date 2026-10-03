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

// Real multi-step checkout transaction. The client-supplied total/price is never
// trusted. Product prices, stock and active flash-sale prices are read while
// rows are locked, then the order, order items, stock and loyalty data are
// committed together. Any failure rolls the entire operation back.
app.post('/api/orders', async (req, res) => {
    const { cartItems, userId } = req.body;
    const customerId = Number(userId);

    if (!Number.isInteger(customerId) || customerId <= 0) {
        return res.status(401).json({ success: false, message: 'Please log in before checkout.' });
    }
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
        return res.status(400).json({ success: false, message: 'Your cart is empty.' });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Confirm the customer exists inside the transaction.
        const [users] = await connection.query(
            'SELECT user_id FROM users WHERE user_id = ? FOR UPDATE',
            [customerId]
        );
        if (users.length === 0) {
            throw new Error('Customer account was not found.');
        }

        // Merge duplicate product lines and validate quantities.
        const quantities = new Map();
        for (const item of cartItems) {
            const productId = Number(item.product_id);
            const quantity = Number(item.quantity);
            if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
                throw new Error('Invalid product or quantity in the cart.');
            }
            quantities.set(productId, (quantities.get(productId) || 0) + quantity);
        }

        const orderLines = [];
        let calculatedTotal = 0;

        for (const [productId, quantity] of quantities.entries()) {
            // FOR UPDATE prevents two simultaneous checkouts from selling the same stock.
            const [products] = await connection.query(
                `SELECT product_id, name, price, stock_quantity
                 FROM products
                 WHERE product_id = ?
                 FOR UPDATE`,
                [productId]
            );

            if (products.length === 0) {
                throw new Error(`Product #${productId} was not found.`);
            }

            const product = products[0];
            if (Number(product.stock_quantity) < quantity) {
                throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock_quantity}.`);
            }

            // Use the current active flash-sale price if one exists.
            const [sales] = await connection.query(
                `SELECT sale_id, discount_percentage, flash_stock
                 FROM flash_sales
                 WHERE product_id = ?
                   AND start_time <= NOW()
                   AND end_time >= NOW()
                   AND status = 'Active'
                 ORDER BY discount_percentage DESC, sale_id DESC
                 LIMIT 1
                 FOR UPDATE`,
                [productId]
            );

            let unitPrice = Number(product.price);
            let saleId = null;
            let saleStock = null;

            if (sales.length > 0) {
                saleId = sales[0].sale_id;
                saleStock = Number(sales[0].flash_stock);
                if (saleStock < quantity) {
                    throw new Error(`Flash-sale stock for ${product.name} is no longer available for this quantity.`);
                }
                unitPrice = unitPrice * (1 - Number(sales[0].discount_percentage) / 100);
            }

            calculatedTotal += unitPrice * quantity;
            orderLines.push({ productId, quantity, unitPrice, saleId, saleStock });
        }

        calculatedTotal = Number(calculatedTotal.toFixed(2));

        // Create the order first. It becomes Completed only after all lines and
        // inventory updates succeed.
        const [orderResult] = await connection.query(
            `INSERT INTO orders (user_id, total_amount, status)
             VALUES (?, ?, 'Completed')`,
            [customerId, calculatedTotal]
        );
        const orderId = orderResult.insertId;

        for (const line of orderLines) {
            await connection.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price_per_unit)
                 VALUES (?, ?, ?, ?)`,
                [orderId, line.productId, line.quantity, Number(line.unitPrice.toFixed(2))]
            );

            const [stockUpdate] = await connection.query(
                `UPDATE products
                 SET stock_quantity = stock_quantity - ?
                 WHERE product_id = ? AND stock_quantity >= ?`,
                [line.quantity, line.productId, line.quantity]
            );

            if (stockUpdate.affectedRows !== 1) {
                throw new Error('Stock changed while processing the order. Please try again.');
            }

            if (line.saleId !== null) {
                const [saleUpdate] = await connection.query(
                    `UPDATE flash_sales
                     SET flash_stock = flash_stock - ?
                     WHERE sale_id = ? AND flash_stock >= ?`,
                    [line.quantity, line.saleId, line.quantity]
                );
                if (saleUpdate.affectedRows !== 1) {
                    throw new Error('Flash-sale stock changed while processing the order. Please try again.');
                }
            }
        }

        // Synchronize the customer's loyalty record inside the same transaction.
        const [loyaltyTotals] = await connection.query(
            `SELECT COALESCE(SUM(total_amount), 0) AS total_spent
             FROM orders
             WHERE user_id = ? AND status = 'Completed'`,
            [customerId]
        );
        const totalSpent = Number(loyaltyTotals[0].total_spent || 0);
        const eligible = totalSpent >= 5000;
        const points = eligible ? Math.floor(totalSpent / 100) : 0;
        let tier = 'Bronze';
        if (totalSpent >= 100000) tier = 'Gold';
        else if (totalSpent >= 20000) tier = 'Silver';

        await connection.query(
            `INSERT INTO user_loyalty (user_id, total_spent, loyalty_points, tier_level)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                total_spent = VALUES(total_spent),
                loyalty_points = VALUES(loyalty_points),
                tier_level = VALUES(tier_level)`,
            [customerId, totalSpent, points, tier]
        );

        await connection.commit();

        res.status(201).json({
            success: true,
            orderId,
            totalAmount: calculatedTotal,
            loyaltyPoints: points,
            tier,
            message: 'Order completed successfully. Inventory and loyalty points were updated.'
        });
    } catch (error) {
        try {
            await connection.rollback();
        } catch (rollbackError) {
            console.error('Rollback error:', rollbackError);
        }
        console.error('Checkout transaction rolled back:', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Order could not be completed. No changes were saved.'
        });
    } finally {
        connection.release();
    }
});

/* DASHBOARD & ANALYTICS ROUTES */

// Loyalty statistics.
// Business rule: customers with completed purchases of at least BDT 5,000
// earn loyalty points. Points are calculated at 1 point per BDT 100 spent.
// The eligible-customer subquery intentionally uses HAVING so this business
// rule is also demonstrated through a real application feature.
app.get('/api/loyalty-stats', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                u.user_id,
                u.name,
                COALESCE(sp.total_spent, 0) AS total_spent,
                CASE
                    WHEN eligible.user_id IS NOT NULL THEN FLOOR(COALESCE(sp.total_spent, 0) / 100)
                    ELSE 0
                END AS loyalty_points,
                CASE
                    WHEN eligible.user_id IS NULL THEN 'Bronze'
                    WHEN FLOOR(COALESCE(sp.total_spent, 0) / 100) >= 1000 THEN 'Gold'
                    WHEN FLOOR(COALESCE(sp.total_spent, 0) / 100) >= 200 THEN 'Silver'
                    ELSE 'Bronze'
                END AS tier_level,
                CASE WHEN eligible.user_id IS NOT NULL THEN 1 ELSE 0 END AS loyalty_eligible
            FROM users u
            LEFT JOIN (
                SELECT user_id, SUM(total_amount) AS total_spent
                FROM orders
                WHERE status = 'Completed'
                GROUP BY user_id
            ) sp ON sp.user_id = u.user_id
            LEFT JOIN (
                SELECT user_id
                FROM orders
                WHERE status = 'Completed'
                GROUP BY user_id
                HAVING SUM(total_amount) >= 5000
            ) eligible ON eligible.user_id = u.user_id
            ORDER BY total_spent DESC, u.user_id ASC
        `);

        // Keep the User_Loyalty table synchronized with completed orders.
        for (const row of rows) {
            await db.query(`
                INSERT INTO user_loyalty (user_id, total_spent, loyalty_points, tier_level)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    total_spent = VALUES(total_spent),
                    loyalty_points = VALUES(loyalty_points),
                    tier_level = VALUES(tier_level)
            `, [row.user_id, row.total_spent, row.loyalty_points, row.tier_level]);
        }

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Loyalty statistics error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get loyalty information for the currently logged-in customer.
app.get('/api/users/:id/loyalty', async (req, res) => {
    try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid user ID.' });
        }

        const [rows] = await db.query(`
            SELECT
                u.user_id,
                u.name,
                COALESCE(SUM(CASE WHEN o.status = 'Completed' THEN o.total_amount ELSE 0 END), 0) AS total_spent,
                CASE
                    WHEN COALESCE(SUM(CASE WHEN o.status = 'Completed' THEN o.total_amount ELSE 0 END), 0) >= 5000
                    THEN FLOOR(COALESCE(SUM(CASE WHEN o.status = 'Completed' THEN o.total_amount ELSE 0 END), 0) / 100)
                    ELSE 0
                END AS loyalty_points,
                CASE
                    WHEN COALESCE(SUM(CASE WHEN o.status = 'Completed' THEN o.total_amount ELSE 0 END), 0) >= 100000 THEN 'Gold'
                    WHEN COALESCE(SUM(CASE WHEN o.status = 'Completed' THEN o.total_amount ELSE 0 END), 0) >= 20000 THEN 'Silver'
                    ELSE 'Bronze'
                END AS tier_level
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.user_id
            WHERE u.user_id = ?
            GROUP BY u.user_id, u.name
        `, [userId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const loyalty = rows[0];
        await db.query(`
            INSERT INTO user_loyalty (user_id, total_spent, loyalty_points, tier_level)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                total_spent = VALUES(total_spent),
                loyalty_points = VALUES(loyalty_points),
                tier_level = VALUES(tier_level)
        `, [loyalty.user_id, loyalty.total_spent, loyalty.loyalty_points, loyalty.tier_level]);

        res.json(loyalty);
    } catch (error) {
        console.error('User loyalty error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(5000, () => {
    console.log('Server running on http://localhost:5000');
});