const { Router } = require("express");
const db = require("../database/database");
const auth = require("../middleware/auth");

const router = Router();
module.exports = router;

function formatLog(log) {
  return {
    id: log.id,
    type: log.type,
    title: log.title,
    description: log.description,
    productId: log.product_id ? String(log.product_id) : null,
    productName: log.product_name ?? null,
    userId: log.user_id ? String(log.user_id) : null,
    userName: log.user_name ?? null,
    quantityChanged: log.quantity_changed ?? null,
    stockBefore: log.stock_before ?? null,
    stockAfter: log.stock_after ?? null,
    referenceId: log.reference_id ?? null,
    createdAt: log.created_at,
  };
}

// ── GET /activity ─────────────────────────────────────────────
// Query: page, limit, type, product_id, from (YYYY-MM-DD), to (YYYY-MM-DD)
router.get("/", auth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const offset = (page - 1) * limit;
    const { type, product_id, from, to } = req.query;

    let where = "WHERE 1=1";
    const params = [];

    if (type) {
      where += " AND type = ?";
      params.push(type);
    }
    if (product_id) {
      where += " AND product_id = ?";
      params.push(product_id);
    }
    if (from) {
      where += " AND created_at >= ?";
      params.push(from);
    }
    if (to) {
      where += " AND created_at <= ?";
      params.push(to + " 23:59:59");
    }

    const [[{ total }]] = await db
      .promise()
      .query(`SELECT COUNT(*) AS total FROM activity_logs ${where}`, params);

    const [rows] = await db
      .promise()
      .query(
        `SELECT * FROM activity_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

    res.json({
      data: rows.map(formatLog),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /activity/product/:id  (R-8 — product stock timeline) ─
router.get("/product/:id", auth, async (req, res) => {
  try {
    const [rows] = await db
      .promise()
      .query(
        `SELECT * FROM activity_logs WHERE product_id = ? ORDER BY created_at DESC LIMIT 50`,
        [req.params.id],
      );
    res.json(rows.map(formatLog));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});
