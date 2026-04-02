const {
  getCachedTranscript,
  saveTranscript,
} = require("../services/transcriptCache.service");

/**
 * GET /api/transcript?title=<lecture title>
 * Returns { text } if cached, or 404 if not found.
 */
const getTranscript = async (req, res) => {
  try {
    const { title } = req.query;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Query param 'title' is required." });
    }

    const cached = await getCachedTranscript(title.trim());
    if (!cached) {
      return res.status(404).json({ cached: false });
    }

    return res.status(200).json({ cached: true, text: cached.text });
  } catch (err) {
    console.error("getTranscript error:", err.message);
    return res.status(500).json({ error: "Cache lookup failed.", details: err.message });
  }
};

/**
 * POST /api/transcript/save
 * Body: { title: string, text: string }
 * Saves transcript to MongoDB + indexes in Supabase.
 */
const saveTranscriptHandler = async (req, res) => {
  try {
    const { title, text } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "'title' is required." });
    }
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "'text' is required." });
    }

    await saveTranscript(title.trim(), text.trim());
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("saveTranscript error:", err.message);
    return res.status(500).json({ error: "Failed to save transcript.", details: err.message });
  }
};

module.exports = { getTranscript, saveTranscriptHandler };
