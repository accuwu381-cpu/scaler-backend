const {
  getCachedSummary,
  saveSummary,
} = require("../services/summaryCache.service");

/**
 * GET /api/summary?slug=<lecture slug>
 * Returns { cached: true, summary, classId, model, generatedBy } if found,
 * or 404 { cached: false } if not.
 */
const getSummary = async (req, res) => {
  try {
    const slug = req.query.slug || req.query.title;
    if (!slug || !slug.trim()) {
      return res
        .status(400)
        .json({ error: "Query param 'slug' (or 'title') is required." });
    }

    const cached = await getCachedSummary(slug.trim());
    if (!cached) {
      return res.status(404).json({ cached: false });
    }

    return res.status(200).json({ cached: true, ...cached });
  } catch (err) {
    console.error("getSummary error:", err.message);
    return res
      .status(500)
      .json({ error: "Summary lookup failed.", details: err.message });
  }
};

/**
 * POST /api/summary/save
 * Body: { slug, classId, title, summary, model, generatedBy }
 * Saves the structured summary to MongoDB + indexes it in Supabase.
 * First-write-wins — an existing summary is never overwritten.
 */
const saveSummaryHandler = async (req, res) => {
  try {
    const { slug, classId, title, summary, model, generatedBy } = req.body;
    const lectureSlug = slug || title;

    if (!lectureSlug || !lectureSlug.trim()) {
      return res.status(400).json({ error: "'slug' (or 'title') is required." });
    }
    if (!summary || typeof summary !== "object") {
      return res.status(400).json({ error: "'summary' object is required." });
    }

    const result = await saveSummary({
      slug: lectureSlug.trim(),
      classId: classId ? String(classId).trim() : "",
      title: title?.trim() || lectureSlug.trim(),
      summary,
      model: model?.trim() || "",
      generatedBy: generatedBy?.trim() || "",
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("saveSummary error:", err.message);
    return res
      .status(500)
      .json({ error: "Failed to save summary.", details: err.message });
  }
};

module.exports = { getSummary, saveSummaryHandler };
