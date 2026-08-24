const {
  getCachedTranscript,
  saveTranscript,
  listTranscriptVersions,
  getTranscriptVersion,
  recordVersionDownload,
  voteOnVersion,
  getUserVotes,
  deleteTranscriptVersion,
} = require("../services/transcriptCache.service");

/**
 * GET /api/transcript?slug=<lecture slug>
 * Also supports legacy: ?title=<lecture title>
 *
 * Returns the best-ranked version. The response shape is unchanged from the
 * single-transcript era so older extension builds keep working; `versionId`
 * and `versionCount` are additive.
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

    return res.status(200).json({
      cached: true,
      text: cached.text,
      generatedBy: cached.generatedBy || "",
      provider: cached.provider || "",
      model: cached.model || "",
      // Legacy alias so extension builds that read `modelName` keep working.
      modelName: cached.model || "",
      versionId: cached.versionId || "",
      versionCount: cached.versionCount || 1,
    });
  } catch (err) {
    console.error("getTranscript error:", err.message);
    return res.status(500).json({ error: "Cache lookup failed.", details: err.message });
  }
};

/**
 * GET /api/transcript/versions?slug=<lecture slug>&email=<viewer email>
 *
 * Metadata for every version, newest first, WITHOUT transcript text — the
 * versions page renders from this and fetches text only on demand.
 * `email` is optional and only used to mark which rows the viewer has voted on.
 */
const getVersions = async (req, res) => {
  try {
    const slug = req.query.slug;
    if (!slug || !slug.trim()) {
      return res.status(400).json({ error: "Query param 'slug' is required." });
    }

    const lectureId = slug.trim();
    const versions = await listTranscriptVersions(lectureId);
    const email = (req.query.email || "").trim();
    const myVotes = email ? await getUserVotes(lectureId, email) : {};

    return res.status(200).json({
      lectureId,
      count: versions.length,
      versions: versions.map((v) => ({ ...v, myVote: myVotes[v.versionId] || null })),
    });
  } catch (err) {
    console.error("getVersions error:", err.message);
    return res.status(500).json({ error: "Version lookup failed.", details: err.message });
  }
};

/**
 * GET /api/transcript/version/:versionId
 * Full text of one version. Called when a row is expanded or downloaded.
 */
const getVersion = async (req, res) => {
  try {
    const { versionId } = req.params;
    const version = await getTranscriptVersion((versionId || "").trim());
    if (!version) {
      return res.status(404).json({ error: "Version not found." });
    }
    return res.status(200).json(version);
  } catch (err) {
    console.error("getVersion error:", err.message);
    return res.status(500).json({ error: "Version fetch failed.", details: err.message });
  }
};

/**
 * POST /api/transcript/version/:versionId/download
 *
 * Counts a deliberate download of this version. Deliberately NOT called when
 * the page opens or a preview expands — the counter has to mean "someone chose
 * this one" for it to be worth showing.
 */
const recordDownload = async (req, res) => {
  try {
    const { versionId } = req.params;
    const result = await recordVersionDownload((versionId || "").trim());
    if (!result) {
      return res.status(404).json({ error: "Version not found." });
    }
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("recordDownload error:", err.message);
    return res.status(500).json({ error: "Failed to record download.", details: err.message });
  }
};

/**
 * POST /api/transcript/version/:versionId/vote
 * Body: { email, vote }  — vote is "up", "down", or null to withdraw.
 *
 * One vote per user per version; voting again replaces the previous one.
 */
const voteVersion = async (req, res) => {
  try {
    const { versionId } = req.params;
    const { email } = req.body;
    const rawVote = req.body.vote;

    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: "'email' is required to vote." });
    }
    if (rawVote !== "up" && rawVote !== "down" && rawVote !== null) {
      return res.status(400).json({ error: "'vote' must be \"up\", \"down\", or null." });
    }

    const result = await voteOnVersion(
      (versionId || "").trim(),
      String(email).trim(),
      rawVote,
    );
    if (!result) {
      return res.status(404).json({ error: "Version not found." });
    }
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("voteVersion error:", err.message);
    return res.status(500).json({ error: "Failed to record vote.", details: err.message });
  }
};

/**
 * DELETE /api/transcript/version/:versionId  — admin only.
 * For clearing out wrong-language or hallucinated transcripts.
 */
const deleteVersion = async (req, res) => {
  try {
    const { versionId } = req.params;
    const result = await deleteTranscriptVersion((versionId || "").trim());
    if (!result) {
      return res.status(404).json({ error: "Version not found." });
    }
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error("deleteVersion error:", err.message);
    return res.status(500).json({ error: "Failed to delete version.", details: err.message });
  }
};

/**
 * POST /api/transcript/save
 * Body: { slug, title, text, classId?, generatedBy?, provider?, model? }
 * `modelName` is accepted as a legacy alias for `model`.
 *
 * Always stores a new version — nothing is ever overwritten. Identical text
 * collapses onto the existing version and only backfills missing metadata, so
 * older extension builds can never blank out what a newer one recorded.
 */
const saveTranscriptHandler = async (req, res) => {
  try {
    const { slug, title, text, classId, generatedBy, provider, countDownload } = req.body;
    const model = req.body.model || req.body.modelName;
    const lectureSlug = slug || title; // backward compat: old clients send title only

    if (!lectureSlug || !lectureSlug.trim()) {
      return res.status(400).json({ error: "'slug' (or 'title') is required." });
    }
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "'text' is required." });
    }

    const result = await saveTranscript(
      lectureSlug.trim(),
      title?.trim() || lectureSlug.trim(),
      text.trim(),
      {
        classId: classId ? String(classId).trim() : "",
        generatedBy: generatedBy?.trim() || "",
        provider: provider?.trim() || "",
        model: model?.trim() || "",
        countDownload: countDownload === true,
      },
    );
    return res.status(200).json({ success: true, ...(result || {}) });
  } catch (err) {
    console.error("saveTranscript error:", err.message);
    return res.status(500).json({ error: "Failed to save transcript.", details: err.message });
  }
};

module.exports = {
  getTranscript,
  saveTranscriptHandler,
  getVersions,
  getVersion,
  recordDownload,
  voteVersion,
  deleteVersion,
};
