const express = require("express");
const db = require("../database/database");
const auth = require("../middleware/auth");

const router = express.Router();
module.exports = router;

// GET /categories
router.get("/", auth, async (req, res) => {
  try {
    const [rows] = await db
      .promise()
      .query("SELECT id, name, slug FROM categories ORDER BY name ASC");
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});
