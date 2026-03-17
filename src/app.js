const express = require("express");
const cors = require("cors");
const transcribeRoutes = require("./routes/transcribe.routes");
const authRoutes = require("./routes/auth.routes");
const messagesRoutes = require("./routes/messages.routes");

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/transcribe", transcribeRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/auth", authRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({ message: "Scaler++ Backend is running!" });
});

module.exports = app;
