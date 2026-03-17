const transcribeService = require("../services/transcribe.service");

const transcribeAudio = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const result = await transcribeService.transcribeAudio(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("Transcription Error:", error.message);
    return res
      .status(500)
      .json({ error: "Transcription failed", details: error.message });
  }
};

module.exports = {
  transcribeAudio,
};
