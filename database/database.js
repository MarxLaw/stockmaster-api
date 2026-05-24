const mysql = require("mysql2");

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "p@ssw0rd",
  database: "stockmaster",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

db.query("SELECT @@hostname, @@port, DATABASE() AS db", (err, rows) => {
  console.log("API is connected to:", rows[0]);
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
