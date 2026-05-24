const { Router } = require("express");
const db = require("../database/database");
const auth = require("../middleware/auth");

const router = Router();
module.exports = router;

async function getFullPO(id) {
  const [poRows] = await db.promise().query(
    `
    SELECT po.*, s.name AS supplier_name, u.name AS ordered_by_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN users u ON u.id = po.ordered_by
    WHERE po.id = ?
  `,
    [id],
  );

  if (poRows.length === 0) return null;
  const po = poRows[0];

  const [items] = await db.promise().query(
    `
    SELECT poi.*, p.name AS product_name, p.sku AS product_sku
    FROM purchase_order_items poi
    JOIN products p ON p.id = poi.product_id
    WHERE poi.purchase_order_id = ?
  `,
    [id],
  );

  return {
    id: po.id,
    poNumber: po.po_number,
    supplierId: po.supplier_id,
    supplierName: po.supplier_name,
    status: po.status,
    orderedBy: po.ordered_by_name ?? null,
    expectedAt: po.expected_at,
    receivedAt: po.received_at,
    notes: po.notes,
    createdAt: po.created_at,
    updatedAt: po.updated_at,
    items: items.map((item) => ({
      id: item.id,
      productId: String(item.product_id),
      productName: item.product_name,
      productSku: item.product_sku,
      quantityOrdered: item.quantity_ordered,
      quantityReceived: item.quantity_received,
      unitCost: parseFloat(item.unit_cost),
      lineTotal: item.quantity_ordered * parseFloat(item.unit_cost),
    })),
  };
}

// ── GET /purchase-orders ──────────────────────────────────────
router.get("/", auth, async (req, res) => {
  try {
    const { status } = req.query;
    let where = "WHERE 1=1";
    const params = [];

    if (status) {
      where += " AND po.status = ?";
      params.push(status);
    }

    const [rows] = await db.promise().query(
      `
      SELECT po.*, s.name AS supplier_name,
             COUNT(poi.id) AS line_items
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
      ${where}
      GROUP BY po.id
      ORDER BY po.created_at DESC
    `,
      params,
    );

    res.json(
      rows.map((po) => ({
        id: po.id,
        poNumber: po.po_number,
        supplierName: po.supplier_name,
        status: po.status,
        lineItems: parseInt(po.line_items) || 0,
        expectedAt: po.expected_at,
        receivedAt: po.received_at,
        createdAt: po.created_at,
      })),
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /purchase-orders/:id ──────────────────────────────────
router.get("/:id", auth, async (req, res) => {
  try {
    const po = await getFullPO(req.params.id);
    if (!po)
      return res.status(404).json({ message: "Purchase order not found" });
    res.json(po);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /purchase-orders ─────────────────────────────────────
// Body: { supplier_id, expected_at?, notes?, items: [{product_id, quantity_ordered, unit_cost}] }
router.post("/", auth, async (req, res) => {
  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();

    const { supplier_id, expected_at, notes, items } = req.body;
    if (!supplier_id)
      return res.status(400).json({ message: "supplier_id is required" });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ message: "At least one item is required" });

    // Auto-generate PO number: PO-YYYYMMDD-XXXX
    const [[{ cnt }]] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM purchase_orders",
    );
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const poNumber = `PO-${dateStr}-${String(cnt + 1).padStart(4, "0")}`;

    const [result] = await conn.query(
      `
      INSERT INTO purchase_orders
        (po_number, supplier_id, expected_at, notes, ordered_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    `,
      [poNumber, supplier_id, expected_at || null, notes || null, req.user.id],
    );

    const poId = result.insertId;

    const itemValues = items.map((item) => [
      poId,
      item.product_id,
      item.quantity_ordered,
      0,
      item.unit_cost,
    ]);
    await conn.query(
      "INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost) VALUES ?",
      [itemValues],
    );

    await conn.commit();
    conn.release();

    const po = await getFullPO(poId);
    res.status(201).json(po);
  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── PATCH /purchase-orders/:id/status ────────────────────────
// Body: { status: 'confirmed'|'in_transit'|'cancelled' }
router.patch("/:id/status", auth, async (req, res) => {
  try {
    const allowed = ["confirmed", "in_transit", "cancelled"];
    const { status } = req.body;
    if (!allowed.includes(status))
      return res
        .status(400)
        .json({ message: `status must be one of: ${allowed.join(", ")}` });

    const [check] = await db
      .promise()
      .query("SELECT id, status FROM purchase_orders WHERE id = ?", [
        req.params.id,
      ]);
    if (check.length === 0)
      return res.status(404).json({ message: "Purchase order not found" });
    if (check[0].status === "received")
      return res
        .status(400)
        .json({ message: "Cannot change status of a received order" });

    await db
      .promise()
      .query(
        "UPDATE purchase_orders SET status = ?, updated_at = NOW() WHERE id = ?",
        [status, req.params.id],
      );

    const po = await getFullPO(req.params.id);
    res.json(po);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── PATCH /purchase-orders/:id/receive ───────────────────────
// Body: { items: [{ id: poItemId, quantity_received }] }
router.patch("/:id/receive", auth, async (req, res) => {
  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();

    const [poRows] = await conn.query(
      "SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE",
      [req.params.id],
    );
    if (poRows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: "Purchase order not found" });
    }
    if (poRows[0].status === "received") {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: "Already received" });
    }

    const po = poRows[0];
    const { items } = req.body;

    for (const recv of items) {
      const [itemRows] = await conn.query(
        "SELECT * FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?",
        [recv.id, po.id],
      );
      if (!itemRows.length) continue;

      const poItem = itemRows[0];
      const qtyReceived = Math.min(
        recv.quantity_received,
        poItem.quantity_ordered,
      );

      await conn.query(
        "UPDATE purchase_order_items SET quantity_received = ? WHERE id = ?",
        [qtyReceived, poItem.id],
      );

      // Lock product and add stock
      const [prodRows] = await conn.query(
        "SELECT * FROM products WHERE id = ? FOR UPDATE",
        [poItem.product_id],
      );
      if (!prodRows.length) continue;

      const product = prodRows[0];
      const stockAfter = product.stock_level + qtyReceived;

      await conn.query(
        "UPDATE products SET stock_level = ?, updated_at = NOW() WHERE id = ?",
        [stockAfter, product.id],
      );

      await conn.query(
        `
        INSERT INTO activity_logs
          (type, title, description, product_id, product_name,
           user_id, user_name, quantity_changed, stock_before, stock_after, reference_id, created_at)
        VALUES ('add', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
        [
          `Stock Received: ${product.name}`,
          `${qtyReceived} units received from PO ${po.po_number}`,
          product.id,
          product.name,
          req.user.id,
          req.user.name,
          qtyReceived,
          product.stock_level,
          stockAfter,
          po.po_number,
        ],
      );
    }

    await conn.query(
      "UPDATE purchase_orders SET status = 'received', received_at = NOW(), updated_at = NOW() WHERE id = ?",
      [po.id],
    );

    await conn.commit();
    conn.release();

    const fullPO = await getFullPO(po.id);
    res.json(fullPO);
  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});
