const mysql = require("mysql2");
require("dotenv").config();

const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
});

db.query("SELECT @@hostname, @@port, DATABASE() AS db", (err, rows) => {
  if (!err) console.log("API is connected to:", rows[0]);
});
db.query("SELECT id, name FROM products LIMIT 5", (err, rows) => {
  console.log("Error:", err?.message);
  console.log("Rows:", rows);
});
db.query(
  "SELECT @@datadir AS datadir, @@port AS port, COUNT(*) AS total FROM products",
  (err, rows) => {
    console.log("Node DB info:", rows[0]);
  },
);

db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Database connected");
    connection.release();
  }
});

module.exports = db;
