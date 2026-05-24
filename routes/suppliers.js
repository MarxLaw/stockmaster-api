const { Router } = require("express");
const db = require("../database/database");
const auth = require("../middleware/auth");

const router = Router();
module.exports = router;

function formatSupplier(s) {
  return {
    id: s.id,
    name: s.name,
    contactPerson: s.contact_person ?? null,
    email: s.email ?? null,
    phone: s.phone ?? null,
    address: s.address ?? null,
    country: s.country ?? null,
    isActive: s.is_active,
    rating: s.rating ?? null,
    leadTimeDays: s.lead_time_days ?? null,
    notes: s.notes ?? null,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

// ── GET /suppliers ────────────────────────────────────────────
router.get("/", auth, async (req, res) => {
  try {
    const [rows] = await db
      .promise()
      .query("SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name ASC");
    res.json(rows.map(formatSupplier));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /suppliers/:id ────────────────────────────────────────
router.get("/:id", auth, async (req, res) => {
  try {
    const [rows] = await db
      .promise()
      .query("SELECT * FROM suppliers WHERE id = ?", [req.params.id]);
    if (rows.length === 0)
      return res.status(404).json({ message: "Supplier not found" });
    res.json(formatSupplier(rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /suppliers ───────────────────────────────────────────
router.post("/", auth, async (req, res) => {
  try {
    const {
      name,
      contact_person,
      email,
      phone,
      address,
      country,
      rating,
      lead_time_days,
      notes,
    } = req.body;
    if (!name)
      return res.status(400).json({ message: "Supplier name is required" });

    const [result] = await db.promise().query(
      `
      INSERT INTO suppliers
        (name, contact_person, email, phone, address, country, rating, lead_time_days, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `,
      [
        name,
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        country || null,
        rating || null,
        lead_time_days || null,
        notes || null,
      ],
    );

    const [rows] = await db
      .promise()
      .query("SELECT * FROM suppliers WHERE id = ?", [result.insertId]);
    res.status(201).json(formatSupplier(rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── PUT /suppliers/:id ────────────────────────────────────────
router.put("/:id", auth, async (req, res) => {
  try {
    const [check] = await db
      .promise()
      .query("SELECT id FROM suppliers WHERE id = ?", [req.params.id]);
    if (check.length === 0)
      return res.status(404).json({ message: "Supplier not found" });

    const {
      name,
      contact_person,
      email,
      phone,
      address,
      country,
      rating,
      lead_time_days,
      notes,
    } = req.body;

    await db.promise().query(
      `
      UPDATE suppliers SET
        name = ?, contact_person = ?, email = ?, phone = ?,
        address = ?, country = ?, rating = ?, lead_time_days = ?,
        notes = ?, updated_at = NOW()
      WHERE id = ?
    `,
      [
        name,
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        country || null,
        rating || null,
        lead_time_days || null,
        notes || null,
        req.params.id,
      ],
    );

    const [rows] = await db
      .promise()
      .query("SELECT * FROM suppliers WHERE id = ?", [req.params.id]);
    res.json(formatSupplier(rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── DELETE /suppliers/:id  (soft delete) ──────────────────────
router.delete("/:id", auth, async (req, res) => {
  try {
    const [check] = await db
      .promise()
      .query("SELECT id FROM suppliers WHERE id = ?", [req.params.id]);
    if (check.length === 0)
      return res.status(404).json({ message: "Supplier not found" });

    await db
      .promise()
      .query(
        "UPDATE suppliers SET is_active = 0, updated_at = NOW() WHERE id = ?",
        [req.params.id],
      );
    res.json({ issuccess: 1, message: "Supplier deactivated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});
