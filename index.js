require("dotenv").config();
console.log("JWT_SECRET:", process.env.JWT_SECRET);
const express = require("express");
const cors = require("cors");
const http = require("http");

const db = require("./database/database");

const app = express();
const server = http.createServer(app);

// ── Middlewares ───────────────────────────────────────────────
app.use(express.json());
app.use(cors());

// ── Routes ────────────────────────────────────────────────────
app.use("/auth", require("./routes/auth"));

app.use("/products", require("./routes/products"));
app.use("/dashboard", require("./routes/dashboard"));
app.use("/activity", require("./routes/activity"));
app.use("/suppliers", require("./routes/suppliers"));
app.use("/purchase-orders", require("./routes/purchaseOrders"));
app.use("/categories", require("./routes/categories"));
app.use("/users", require("./routes/users"));
app.use("/reports", require("./routes/reports"));

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("StockMaster API running on port", PORT);
});
