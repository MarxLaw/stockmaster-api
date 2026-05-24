const { Router } = require("express");
const db = require("../database/database");
const auth = require("../middleware/auth");

const router = Router();
module.exports = router;

// ── GET /dashboard/stats ──────────────────────────────────────
router.get("/stats", auth, async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT
        COALESCE(SUM(p.stock_level * p.unit_price), 0) AS totalValue,
        COUNT(*)                                        AS activeSkus,
        SUM(p.stock_level = 0)                         AS outOfStockCount,
        SUM(p.status IN ('low_stock', 'critical'))      AS lowStockCount,
        SUM(p.status = 'critical')                     AS criticalCount
      FROM products p
      WHERE p.is_active = 1
    `);

    // Incoming shipments — gracefully handle missing purchase_orders table
    let incomingShipments = 0;
    try {
      const [poRows] = await db.promise().query(`
        SELECT COUNT(*) AS cnt FROM purchase_orders
        WHERE status IN ('confirmed', 'in_transit')
      `);
      incomingShipments = parseInt(poRows[0].cnt) || 0;
    } catch (_) {
      // purchase_orders table may not exist yet
    }

    const row = rows[0];
    res.json({
      totalValue: parseFloat(row.totalValue) || 0,
      totalValueGrowth: 0, // placeholder — add real calc when you have historical data
      activeSkus: parseInt(row.activeSkus) || 0,
      outOfStockCount: parseInt(row.outOfStockCount) || 0,
      lowStockCount: parseInt(row.lowStockCount) || 0,
      criticalCount: parseInt(row.criticalCount) || 0,
      lowStockActionRequired: parseInt(row.criticalCount) || 0,
      incomingShipments,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});
