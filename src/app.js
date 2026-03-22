const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const transcribeRoutes = require("./routes/transcribe.routes");
const authRoutes = require("./routes/auth.routes");
const messagesRoutes = require("./routes/messages.routes");

const app = express();

// Middleware
app.use(
  cors({
    origin: ["http://localhost:3000", "https://scalerbackend-frontend.vercel.app"], // Add your production frontend URL here
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

// Routes
app.use("/api/transcribe", transcribeRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/auth", authRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({ message: "Scaler++ Backend is running!" });
});

app.post("/message", (req, res) => {
  console.log(req.body);
});

module.exports = app;
