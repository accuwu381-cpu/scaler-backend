const {
  getCachedTranscript,
  saveTranscript,
} = require("../services/transcriptCache.service");

/**
 * GET /api/transcript?slug=<lecture slug>
 * Also supports legacy: ?title=<lecture title>
 * Returns { text } if cached, or 404 if not found.
 */
const getTranscript = async (req, res) => {
  try {
    const slug = req.query.slug || req.query.title;
    if (!slug || !slug.trim()) {
      return res.status(400).json({ error: "Query param 'slug' (or 'title') is required." });
    }

    const cached = await getCachedTranscript(slug.trim());
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
 * Body: { slug: string, title: string, text: string }
 * Saves transcript to MongoDB + indexes in Supabase.
 * `slug` is the unique lecture identifier; `title` is the human-readable name.
 */
const saveTranscriptHandler = async (req, res) => {
  try {
    const { slug, title, text } = req.body;
    const lectureSlug = slug || title; // backward compat: old clients send title only

    if (!lectureSlug || !lectureSlug.trim()) {
      return res.status(400).json({ error: "'slug' (or 'title') is required." });
    }
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "'text' is required." });
    }

    await saveTranscript(lectureSlug.trim(), title?.trim() || lectureSlug.trim(), text.trim());
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("saveTranscript error:", err.message);
    return res.status(500).json({ error: "Failed to save transcript.", details: err.message });
  }
};

module.exports = { getTranscript, saveTranscriptHandler };
