const jwt = require("jsonwebtoken");
const db = require("../database/database");

module.exports = async function auth(req, res, next) {
  if (process.env.BYPASS_AUTH === "true") {
    req.user = { id: 1, name: "Test User", role: "admin" };
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [rows] = await db
      .promise()
      .query(
        "SELECT id, name, email, role FROM users WHERE id = ? AND is_active = 1",
        [decoded.id],
      );

    if (rows.length === 0) {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
