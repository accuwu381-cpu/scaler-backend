const express = require("express");
const {
  getSummary,
  saveSummaryHandler,
} = require("../controllers/summaryCache.controller");

const router = express.Router();

// Simple Bearer token guard — same secret the extension sends to /api/transcript
const EXTENSION_TOKEN =
  "Ritesh-Prajapati-created-started-this-extension-super-secret-key-12345";

function requireExtensionToken(req, res, next) {
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${EXTENSION_TOKEN}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// GET /api/summary?slug=<lecture slug>  — cache lookup (extension calls this first)
router.get("/", requireExtensionToken, getSummary);

// POST /api/summary/save  — called by extension after generating a new summary
router.post("/save", requireExtensionToken, saveSummaryHandler);

module.exports = router;
