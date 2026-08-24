const express = require("express");
const {
  getTranscript,
  saveTranscriptHandler,
  getVersions,
  getVersion,
  recordDownload,
  voteVersion,
  deleteVersion,
} = require("../controllers/transcriptCache.controller");
const { verifyToken } = require("../middlewares/auth.middleware");

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

// GET /api/transcript/versions?slug=  — version metadata, no transcript text
router.get("/versions", requireExtensionToken, getVersions);

// GET /api/transcript/version/:versionId  — one version including its text
router.get("/version/:versionId", requireExtensionToken, getVersion);

// POST /api/transcript/version/:versionId/download  — count a deliberate download
router.post("/version/:versionId/download", requireExtensionToken, recordDownload);

// POST /api/transcript/version/:versionId/vote  — thumbs up / down / withdraw
router.post("/version/:versionId/vote", requireExtensionToken, voteVersion);

// DELETE /api/transcript/version/:versionId  — admin only (cookie JWT, not the
// extension token) so a normal user can never destroy someone's contribution.
router.delete("/version/:versionId", verifyToken, deleteVersion);

// POST /api/transcript/save  — called by extension after generating a new transcript
router.post("/save", requireExtensionToken, saveTranscriptHandler);

module.exports = router;
