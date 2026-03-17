const express = require("express");
const multer = require("multer");
const { verifyApiKey } = require("../middlewares/auth.middleware");
const transcribeController = require("../controllers/transcribe.controller");

const router = express.Router();

// Setup multer to store file uploads in memory buffer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024, // 30 MB limit for chunks
  },
});

router.post(
  "/",
  verifyApiKey,
  upload.single("file"),
  transcribeController.transcribeAudio,
);

module.exports = router;
