const { Router } = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../database/database");
const auth = require("../middleware/auth");

const router = Router();
module.exports = router;

// ── POST /auth/login ──────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Email and password are required" });

  try {
    const [rows] = await db
      .promise()
      .query("SELECT * FROM users WHERE email = ? AND is_active = 1", [email]);

    if (rows.length === 0)
      return res.status(401).json({ message: "Invalid credentials" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    await db
      .promise()
      .query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]);

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── POST /auth/register ───────────────────────────────────────
router.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password)
    return res
      .status(400)
      .json({ message: "name, email, password are required" });

  try {
    const [existing] = await db
      .promise()
      .query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0)
      return res.status(409).json({ message: "Email already in use" });

    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await db.promise().query(
      `INSERT INTO users (name, email, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [name, email, password_hash, role || "viewer"],
    );

    res.status(201).json({
      issuccess: 1,
      id: result.insertId,
      name,
      email,
      role: role || "viewer",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── GET /auth/me ──────────────────────────────────────────────
router.get("/me", auth, (req, res) => {
  res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
  });
});
