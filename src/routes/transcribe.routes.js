const express = require("express");
const transcribeController = require("../controllers/transcribe.controller");

const router = express.Router();

router.get("/upload-url", transcribeController.getUploadUrl);
router.post("/", transcribeController.transcribeAudio);

module.exports = router;
