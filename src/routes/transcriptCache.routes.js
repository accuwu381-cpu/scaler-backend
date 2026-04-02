const express = require("express");
const {
  getTranscript,
  saveTranscriptHandler,
} = require("../controllers/transcriptCache.controller");

const router = express.Router();

// Simple Bearer token guard — same secret the extension sends to /api/transcribe
const EXTENSION_TOKEN =
  "Ritesh-Prajapati-created-started-this-extension-super-secret-key-12345";

function requireExtensionToken(req, res, next) {
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${EXTENSION_TOKEN}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// GET /api/transcript?title=<lecture title>  — cache lookup (extension calls this first)
router.get("/", requireExtensionToken, getTranscript);

// POST /api/transcript/save  — called by extension after generating a new transcript
router.post("/save", requireExtensionToken, saveTranscriptHandler);

module.exports = router;
