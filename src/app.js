const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const transcribeRoutes = require("./routes/transcribe.routes");
const transcriptCacheRoutes = require("./routes/transcriptCache.routes");
const summaryCacheRoutes = require("./routes/summaryCache.routes");
const authRoutes = require("./routes/auth.routes");
const messagesRoutes = require("./routes/messages.routes");
const usersRoutes = require("./routes/users.routes");
const classroomRoutes = require("./routes/classroom.routes");
const { connectMongo } = require("./services/mongodb");

// Connect to MongoDB immediately (cached — safe to call multiple times)
connectMongo().catch((err) =>
  console.error("MongoDB initial connect failed:", err.message),
);

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      
      const allowedOrigins = [
        "http://localhost:3000",
        "https://scalerfrontend.vercel.app",
      ];
      
      const isAllowed = 
        allowedOrigins.includes(origin) ||
        origin.startsWith("chrome-extension://") ||
        origin.endsWith("scaler.com") ||
        origin.includes(".scaler.com");

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Routes
app.use("/api/transcribe", transcribeRoutes);
app.use("/api/transcript", transcriptCacheRoutes);
app.use("/api/summary", summaryCacheRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/classroom", classroomRoutes);
app.use("/api/auth", authRoutes);

// Health check.
// Answers on every path the root can arrive as: "/" locally, and "/api" or
// "/api/health" on Vercel, where the root rewrite may deliver either.
app.get(["/", "/api", "/api/health"], (req, res) => {
  res.json({
    message: "Scaler++ Backend is running!",
    routes: ["/api/transcribe", "/api/transcript", "/api/summary", "/api/messages", "/api/users", "/api/classroom"],
  });
});

app.post("/message", (req, res) => {
  console.log(req.body);
});

module.exports = app;
