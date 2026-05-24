const express = require("express");
const db = require("../database/database");
const auth = require("../middleware/auth");

const router = express.Router();
module.exports = router;

// ── Helper: format a product row to match Flutter Product.fromJson() ──────────
// Flutter expects camelCase: unitPrice, stockLevel, reorderPoint,
// lowStockThreshold, imageUrl, galleryImages[], supplierId, supplierName,
// technicalSpecs{}, createdAt, updatedAt
function formatProduct(row, images = [], specs = []) {
  return {
    id: String(row.id),
    name: row.name,
    sku: row.sku,
    barcode: row.barcode ?? null,
    category: row.category ?? "", // category name from JOIN
    categoryId: row.category_id,
    unitPrice: parseFloat(row.unit_price ?? 0),
    description: row.description ?? null,
    stockLevel: row.stock_level,
    capacity: row.capacity,
    reorderPoint: row.reorder_point,
    lowStockThreshold: row.low_stock_threshold,
    status: row.status,
    imageUrl: row.image_url ?? null,
    galleryImages: images.map((img) => img.image_url),
    supplierId: row.supplier_id ? String(row.supplier_id) : null,
    supplierName: row.supplier_name ?? null,
    location: row.location ?? null,
    condition: row.condition_state ?? null,
    technicalSpecs: specs.reduce((acc, s) => {
      acc[s.spec_key] = s.spec_value;
      return acc;
    }, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Helper: fetch images + specs for a product id ─────────────
async function getImagesAndSpecs(productId) {
  const [images] = await db
    .promise()
    .query(
      "SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC",
      [productId],
    );
  const [specs] = await db
    .promise()
    .query(
      "SELECT spec_key, spec_value FROM product_specs WHERE product_id = ? ORDER BY sort_order ASC",
      [productId],
    );
  return { images, specs };
}

// ── GET /products ─────────────────────────────────────────────
// Query: page, limit, search, category (slug), status, supplier_id
router.get("/", auth, async (req, res) => {
  try {
    // ADD THIS — test the connection directly
    const [test] = await db
      .promise()
      .query("SELECT COUNT(*) AS total FROM products");
    console.log("Direct count:", test[0].total);

    const [test2] = await db.promise().query(`
      SELECT COUNT(*) AS total
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = 1
    `);
    console.log("Join count:", test2[0].total);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const { search, category, status, supplier_id } = req.query;

    let where = "WHERE p.is_active = 1";
    const params = [];

    if (search) {
      where += " AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      where += " AND p.status = ?";
      params.push(status);
    }
    if (supplier_id) {
      where += " AND p.supplier_id = ?";
      params.push(supplier_id);
    }
    if (category) {
      where += " AND c.name = ?";
      params.push(category);
    }

    const countSql = `
      SELECT COUNT(*) AS total
      FROM products p
      JOIN categories c ON c.id = p.category_id
      ${where}
    `;
    const [countRows] = await db.promise().query(countSql, params);
    const total = countRows[0].total;

    const sql = `
      SELECT
        p.*,
        c.name AS category,
        s.name AS supplier_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      ${where}
      ORDER BY p.name ASC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db.promise().query(sql, [...params, limit, offset]);

    // For list view, skip gallery/specs to keep it fast
    const data = rows.map((row) => formatProduct(row));

    res.json({
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /products/critical ────────────────────────────────────
router.get("/critical", auth, async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT
        p.*,
        c.name AS category,
        s.name AS supplier_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.is_active = 1
        AND p.status IN ('critical', 'low_stock', 'out_of_stock')
      ORDER BY
        FIELD(p.status, 'out_of_stock', 'critical', 'low_stock'),
        p.stock_level ASC
    `);

    res.json(rows.map((row) => formatProduct(row)));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /products/:id ─────────────────────────────────────────
router.get("/:id", auth, async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `
      SELECT
        p.*,
        c.name AS category,
        s.name AS supplier_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ? AND p.is_active = 1
    `,
      [req.params.id],
    );

    if (rows.length === 0)
      return res.status(404).json({ message: "Product not found" });

    const { images, specs } = await getImagesAndSpecs(rows[0].id);
    res.json(formatProduct(rows[0], images, specs));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /products ────────────────────────────────────────────
// Body: { name, sku, barcode?, category_id, supplier_id?, unit_price,
//         description?, stock_level?, capacity?, reorder_point?,
//         low_stock_threshold?, image_url?, location?, condition_state?,
//         galleryImages?: string[], specs?: [{key, value}] }
router.post("/", auth, async (req, res) => {
  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();

    const {
      name,
      sku,
      barcode,
      category_id,
      supplier_id,
      unit_price,
      description,
      stock_level,
      capacity,
      reorder_point,
      low_stock_threshold,
      image_url,
      location,
      condition_state,
      galleryImages,
      specs,
    } = req.body;

    const [result] = await conn.query(
      `
      INSERT INTO products
        (name, sku, barcode, category_id, supplier_id, unit_price, description,
         stock_level, capacity, reorder_point, low_stock_threshold,
         image_url, location, condition_state, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `,
      [
        name,
        sku,
        barcode || null,
        category_id,
        supplier_id || null,
        unit_price || 0,
        description || null,
        stock_level || 0,
        capacity || 1000,
        reorder_point || 50,
        low_stock_threshold || 10,
        image_url || null,
        location || null,
        condition_state || null,
        req.user.id,
      ],
    );

    const productId = result.insertId;

    // Gallery images
    if (Array.isArray(galleryImages) && galleryImages.length) {
      const imageValues = galleryImages.map((url, i) => [productId, url, i]);
      await conn.query(
        "INSERT INTO product_images (product_id, image_url, sort_order) VALUES ?",
        [imageValues],
      );
    }

    // Specs
    if (Array.isArray(specs) && specs.length) {
      const specValues = specs.map((s, i) => [productId, s.key, s.value, i]);
      await conn.query(
        "INSERT INTO product_specs (product_id, spec_key, spec_value, sort_order) VALUES ?",
        [specValues],
      );
    }

    // Activity log
    await conn.query(
      `
      INSERT INTO activity_logs
        (type, title, description, product_id, product_name,
         user_id, user_name, stock_before, stock_after, quantity_changed, created_at)
      VALUES ('add', ?, ?, ?, ?, ?, ?, 0, ?, ?, NOW())
    `,
      [
        `Product Created: ${name}`,
        `New product added with SKU ${sku}`,
        productId,
        name,
        req.user.id,
        req.user.name,
        stock_level || 0,
        stock_level || 0,
      ],
    );

    await conn.commit();
    conn.release();

    // Return fresh product
    const [rows] = await db.promise().query(
      `
      SELECT p.*, c.name AS category, s.name AS supplier_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ?
    `,
      [productId],
    );

    const { images, specs: freshSpecs } = await getImagesAndSpecs(productId);
    res.status(201).json(formatProduct(rows[0], images, freshSpecs));
  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── PUT /products/:id ─────────────────────────────────────────
router.put("/:id", auth, async (req, res) => {
  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();

    const [check] = await conn.query(
      "SELECT id, name FROM products WHERE id = ? AND is_active = 1",
      [req.params.id],
    );
    if (check.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: "Product not found" });
    }

    const {
      name,
      sku,
      barcode,
      category_id,
      supplier_id,
      unit_price,
      description,
      capacity,
      reorder_point,
      low_stock_threshold,
      image_url,
      location,
      condition_state,
      galleryImages,
      specs,
    } = req.body;

    await conn.query(
      `
      UPDATE products SET
        name = ?, sku = ?, barcode = ?, category_id = ?, supplier_id = ?,
        unit_price = ?, description = ?, capacity = ?, reorder_point = ?,
        low_stock_threshold = ?, image_url = ?, location = ?,
        condition_state = ?, updated_at = NOW()
      WHERE id = ?
    `,
      [
        name,
        sku,
        barcode || null,
        category_id,
        supplier_id || null,
        unit_price,
        description || null,
        capacity,
        reorder_point,
        low_stock_threshold,
        image_url || null,
        location || null,
        condition_state || null,
        req.params.id,
      ],
    );

    // Replace gallery images if sent
    if (Array.isArray(galleryImages)) {
      await conn.query("DELETE FROM product_images WHERE product_id = ?", [
        req.params.id,
      ]);
      if (galleryImages.length) {
        const imageValues = galleryImages.map((url, i) => [
          req.params.id,
          url,
          i,
        ]);
        await conn.query(
          "INSERT INTO product_images (product_id, image_url, sort_order) VALUES ?",
          [imageValues],
        );
      }
    }

    // Replace specs if sent
    if (Array.isArray(specs)) {
      await conn.query("DELETE FROM product_specs WHERE product_id = ?", [
        req.params.id,
      ]);
      if (specs.length) {
        const specValues = specs.map((s, i) => [
          req.params.id,
          s.key,
          s.value,
          i,
        ]);
        await conn.query(
          "INSERT INTO product_specs (product_id, spec_key, spec_value, sort_order) VALUES ?",
          [specValues],
        );
      }
    }

    await conn.query(
      `
      INSERT INTO activity_logs
        (type, title, description, product_id, product_name, user_id, user_name, created_at)
      VALUES ('update', ?, 'Product details updated', ?, ?, ?, ?, NOW())
    `,
      [
        `Product Updated: ${name}`,
        req.params.id,
        name,
        req.user.id,
        req.user.name,
      ],
    );

    await conn.commit();
    conn.release();

    const [rows] = await db.promise().query(
      `
      SELECT p.*, c.name AS category, s.name AS supplier_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ?
    `,
      [req.params.id],
    );

    const { images, specs: freshSpecs } = await getImagesAndSpecs(
      req.params.id,
    );
    res.json(formatProduct(rows[0], images, freshSpecs));
  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── DELETE /products/:id  (soft delete) ───────────────────────
router.delete("/:id", auth, async (req, res) => {
  try {
    const [check] = await db
      .promise()
      .query("SELECT id, name FROM products WHERE id = ? AND is_active = 1", [
        req.params.id,
      ]);
    if (check.length === 0)
      return res.status(404).json({ message: "Product not found" });

    await db
      .promise()
      .query(
        "UPDATE products SET is_active = 0, updated_at = NOW() WHERE id = ?",
        [req.params.id],
      );

    await db.promise().query(
      `
      INSERT INTO activity_logs
        (type, title, description, product_id, product_name, user_id, user_name, created_at)
      VALUES ('delete', ?, 'Product soft-deleted from inventory', ?, ?, ?, ?, NOW())
    `,
      [
        `Product Deleted: ${check[0].name}`,
        req.params.id,
        check[0].name,
        req.user.id,
        req.user.name,
      ],
    );

    res.json({ issuccess: 1, message: "Product deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── PATCH /products/:id/stock ─────────────────────────────────
// Body: { quantity: number (+/-), type?: string, reason?: string, reference_id?: string }
router.patch("/:id/stock", auth, async (req, res) => {
  const conn = await db.promise().getConnection();
  try {
    await conn.beginTransaction();

    const { quantity, type, reason, reference_id } = req.body;
    if (quantity === undefined || quantity === null) {
      conn.release();
      return res.status(400).json({ message: "quantity is required" });
    }

    // Row-level lock to prevent race conditions
    const [rows] = await conn.query(
      "SELECT * FROM products WHERE id = ? AND is_active = 1 FOR UPDATE",
      [req.params.id],
    );
    if (rows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: "Product not found" });
    }

    const product = rows[0];
    const stockBefore = product.stock_level;
    const newStock = Math.max(0, stockBefore + parseInt(quantity));
    const actualChange = newStock - stockBefore;

    await conn.query(
      "UPDATE products SET stock_level = ?, updated_at = NOW() WHERE id = ?",
      [newStock, req.params.id],
    );

    const logType = type || (actualChange >= 0 ? "add" : "remove");

    await conn.query(
      `
      INSERT INTO activity_logs
        (type, title, description, product_id, product_name,
         user_id, user_name, quantity_changed, stock_before, stock_after, reference_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
      [
        logType,
        `Stock ${actualChange >= 0 ? "Added" : "Removed"}: ${product.name}`,
        reason ||
          `Stock adjusted by ${actualChange > 0 ? "+" : ""}${actualChange} units`,
        product.id,
        product.name,
        req.user.id,
        req.user.name,
        actualChange,
        stockBefore,
        newStock,
        reference_id || null,
      ],
    );

    await conn.commit();
    conn.release();

    // Reload so trigger-updated status is reflected
    const [fresh] = await db.promise().query(
      `
      SELECT p.*, c.name AS category, s.name AS supplier_name
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ?
    `,
      [req.params.id],
    );

    const { images, specs } = await getImagesAndSpecs(req.params.id);
    res.json(formatProduct(fresh[0], images, specs));
  } catch (error) {
    await conn.rollback();
    conn.release();
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});
