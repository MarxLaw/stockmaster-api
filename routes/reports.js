// routes/reports.js
// StockMaster — Reports API
// Endpoints used by the Flutter ReportsView

const { Router } = require("express");
const db = require("../database/database");
const auth = require("../middleware/auth");

const router = Router();
module.exports = router;

// ── GET /reports/inventory-summary ───────────────────────────
// Full product list with category + supplier info
router.get("/inventory-summary", auth, async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT
        p.id, p.name, p.sku, p.barcode,
        c.name AS category,
        s.name AS supplier,
        p.stock_level, p.low_stock_threshold, p.reorder_point,
        p.unit_price, p.status,
        p.created_at, p.updated_at
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ORDER BY p.name ASC
    `);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /reports/low-stock ────────────────────────────────────
// Only critical / low_stock / out_of_stock items
router.get("/low-stock", auth, async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT
        p.id, p.name, p.sku,
        c.name AS category,
        p.stock_level, p.low_stock_threshold, p.reorder_point,
        p.status,
        s.name AS supplier,
        s.email AS supplier_email,
        s.phone AS supplier_phone
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.status IN ('critical', 'low_stock', 'out_of_stock')
      ORDER BY p.stock_level ASC
    `);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /reports/stock-valuation ──────────────────────────────
// Each product × unit_price × stock_level
router.get("/stock-valuation", auth, async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT
        p.id, p.name, p.sku,
        c.name AS category,
        p.stock_level,
        p.unit_price,
        (p.stock_level * p.unit_price) AS total_value,
        p.status
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY total_value DESC
    `);

    const totalValue = rows.reduce(
      (sum, r) => sum + Number(r.total_value || 0),
      0,
    );
    res.json({ data: rows, total: rows.length, totalValue });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /reports/activity ─────────────────────────────────────
// Audit log with optional date range filter
router.get("/activity", auth, async (req, res) => {
  const { from, to, type, limit = 500 } = req.query;

  let whereClauses = [];
  const params = [];

  if (from) {
    whereClauses.push("al.created_at >= ?");
    params.push(from);
  }
  if (to) {
    whereClauses.push("al.created_at <= ?");
    params.push(to + " 23:59:59");
  }
  if (type) {
    whereClauses.push("al.action = ?");
    params.push(type);
  }

  const where = whereClauses.length
    ? "WHERE " + whereClauses.join(" AND ")
    : "";

  try {
    const [rows] = await db.promise().query(
      `SELECT
        al.id,
        al.action,
        al.description,
        al.created_at,
        u.name AS user_name,
        u.email AS user_email,
        u.role AS user_role
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${where}
      ORDER BY al.created_at DESC
      LIMIT ?`,
      [...params, Number(limit)],
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /reports/suppliers ────────────────────────────────────
// Supplier report with product count
router.get("/suppliers", auth, async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT
        s.id, s.name,
        s.contact_person,
        s.email, s.phone, s.address,
        s.rating, s.lead_time_days,
        s.is_active,
        COUNT(p.id) AS product_count,
        SUM(p.stock_level * p.unit_price) AS total_stock_value
      FROM suppliers s
      LEFT JOIN products p ON p.supplier_id = s.id
      GROUP BY s.id
      ORDER BY s.name ASC
    `);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});
