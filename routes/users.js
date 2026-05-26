const { Router } = require("express");
const bcrypt = require("bcryptjs");
const db = require("../database/database");
const auth = require("../middleware/auth");

const router = Router();
module.exports = router;

// ── Role guard middleware ──────────────────────────────────────────────────────
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

function formatUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.is_active === 1,
    avatarUrl: u.avatar_url ?? null,
    lastLoginAt: u.last_login_at ?? null,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

// ── GET /users — list all users (admin only) ──────────────────────────────────
router.get("/", auth, adminOnly, async (req, res) => {
  try {
    const [rows] = await db
      .promise()
      .query("SELECT * FROM users ORDER BY created_at DESC");
    res.json(rows.map(formatUser));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /users — create a user (admin only) ──────────────────────────────────
router.post("/", auth, adminOnly, async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ message: "name, email, password are required" });
  }

  const validRoles = ["admin", "manager", "viewer"];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  try {
    const [existing] = await db
      .promise()
      .query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await db.promise().query(
      `INSERT INTO users (name, email, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NOW(), NOW())`,
      [name, email, password_hash, role || "viewer"],
    );

    const [rows] = await db
      .promise()
      .query("SELECT * FROM users WHERE id = ?", [result.insertId]);
    res.status(201).json(formatUser(rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── PUT /users/:id — update user (admin only) ─────────────────────────────────
router.put("/:id", auth, adminOnly, async (req, res) => {
  const { name, email, role, password } = req.body;

  try {
    const [check] = await db
      .promise()
      .query("SELECT id FROM users WHERE id = ?", [req.params.id]);
    if (check.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check email uniqueness if changing
    if (email) {
      const [emailCheck] = await db
        .promise()
        .query("SELECT id FROM users WHERE email = ? AND id != ?", [
          email,
          req.params.id,
        ]);
      if (emailCheck.length > 0) {
        return res.status(409).json({ message: "Email already in use" });
      }
    }

    // Build update fields dynamically
    const fields = [];
    const values = [];

    if (name) {
      fields.push("name = ?");
      values.push(name);
    }
    if (email) {
      fields.push("email = ?");
      values.push(email);
    }
    if (role) {
      fields.push("role = ?");
      values.push(role);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push("password_hash = ?");
      values.push(hash);
    }

    fields.push("updated_at = NOW()");
    values.push(req.params.id);

    await db
      .promise()
      .query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);

    const [rows] = await db
      .promise()
      .query("SELECT * FROM users WHERE id = ?", [req.params.id]);
    res.json(formatUser(rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── PATCH /users/:id/status — activate/deactivate (admin only) ────────────────
router.patch("/:id/status", auth, adminOnly, async (req, res) => {
  const { isActive } = req.body;

  // Prevent admin from deactivating themselves
  if (parseInt(req.params.id) === req.user.id && !isActive) {
    return res
      .status(400)
      .json({ message: "Cannot deactivate your own account" });
  }

  try {
    await db
      .promise()
      .query(
        "UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ?",
        [isActive ? 1 : 0, req.params.id],
      );
    res.json({ issuccess: 1, isActive });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── DELETE /users/:id — hard delete (admin only, can't delete self) ───────────
router.delete("/:id", auth, adminOnly, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ message: "Cannot delete your own account" });
  }
  try {
    await db.promise().query("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.json({ issuccess: 1, message: "User deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});
