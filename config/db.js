const mysql = require('mysql2');

// Database Connection Pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',      //  MySQL Username
    password: '',      //  MySQL Password
    database: 'ecommerce_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool.promise();