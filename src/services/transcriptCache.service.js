const supabase = require("./supabase");
const { connectMongo } = require("./mongodb");
const Transcript = require("../models/transcript.model");

/**
 * Build a deterministic lectureId from the lecture identifier.
 *
 * The extension now sends the unique Scaler API slug (e.g. "intro-to-trees-batch-42-xyz")
 * instead of the page title. If the input is already a clean slug (no spaces,
 * only alphanumeric + hyphens) we use it directly. Otherwise we fall back to the
 * old title-based derivation for backward compatibility.
 */
function buildLectureId(titleOrSlug) {
  if (!titleOrSlug) return "";

  // If it looks like a pre-built slug (no spaces, only lowercase alphanumeric + hyphens)
  // use it as-is — this is the slug from Scaler's classroom meta API.
  const isSlug = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(titleOrSlug);
  if (isSlug) {
    return titleOrSlug.substring(0, 120);
  }

  // Legacy fallback: derive slug from a human-readable title
  return titleOrSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 120);
}

/**
 * Look up a cached transcript by lecture slug.
 *
 * Flow:
 *  1. Use slug directly as lectureId (or derive from title for legacy).
 *  2. Query Supabase `transcripts` table for a row with that lecture_id.
 *  3. If found, fetch the full text from MongoDB by lectureId.
 *  4. Return { text } or null if not cached.
 */
async function getCachedTranscript(slug) {
  if (!slug) return null;

  const lectureId = slug;

  // 1. Check Supabase index
  const { data, error } = await supabase
    .from("transcripts")
    .select("lecture_id")
    .eq("lecture_id", lectureId)
    .maybeSingle();

  if (error) {
    console.warn("Supabase transcript lookup error:", error.message);
    return null;
  }

  if (!data) return null; // not in index → not cached

  // 2. Fetch full text from MongoDB
  await connectMongo();
  const doc = await Transcript.findOne({ lectureId }).lean();
  if (!doc) {
    console.warn(
      `Supabase has index for "${lectureId}" but MongoDB doc missing.`,
    );
    return null;
  }

  return {
    text: doc.text,
    generatedBy: doc.generatedBy || "",
    provider: doc.provider || "",
    model: doc.model || "",
  };
}

/**
 * Save a newly generated transcript to MongoDB and index it in Supabase.
 *
 * @param {string} slug    - Unique lecture slug from Scaler's API (used as lectureId)
 * @param {string} title   - Human-readable lecture title
 * @param {string} text    - Full transcript text
 * @param {object} [meta]  - Optional metadata added going forward
 * @param {string} [meta.classId]     - Numeric class id from the session URL
 * @param {string} [meta.generatedBy] - Email of the generating user
 * @param {string} [meta.provider]    - Transcription provider used
 * @param {string} [meta.model]       - Model id used
 */
async function saveTranscript(slug, title, text, meta = {}) {
  if (!slug || !text) return;

  const lectureId = slug;
  const classId = meta.classId || "";
  const generatedBy = meta.generatedBy || "";
  const provider = meta.provider || "";
  const model = meta.model || "";

  // 1. Decide whether to overwrite the stored transcript text.
  await connectMongo();
  const existing = await Transcript.findOne({ lectureId }).lean();
  const keepExisting =
    existing &&
    existing.text &&
    Buffer.byteLength(existing.text, "utf8") >=
      Buffer.byteLength(text, "utf8");

  // Metadata is only ever written when we actually have a value. Older
  // extension builds POST without classId/generatedBy/provider/model, and a
  // blind write would blank out metadata a newer client already stored.
  const metaFields = { classId, generatedBy, provider, model };

  if (keepExisting) {
    console.log(
      `[Cache Save] Keeping existing transcript for "${title}" (id: ${lectureId}) because it is larger or equal.`,
    );
    // Backfill metadata onto the existing Mongo doc if it's missing.
    const patch = {};
    for (const [key, value] of Object.entries(metaFields)) {
      if (value && !existing[key]) patch[key] = value;
    }
    if (Object.keys(patch).length) {
      await Transcript.updateOne({ lectureId }, { $set: patch });
    }
  } else {
    // Overwrite Mongo with the new (larger) transcript, but merge metadata:
    // supplied values win, absent ones keep whatever is already stored.
    const doc = { lectureId, title, text };
    for (const [key, value] of Object.entries(metaFields)) {
      const resolved = value || (existing && existing[key]) || "";
      if (resolved) doc[key] = resolved;
    }
    await Transcript.findOneAndUpdate(
      { lectureId },
      doc,
      { upsert: true, new: true },
    );
  }

  // 2. ALWAYS ensure the Supabase index row exists — decoupled from the
  //    keep-vs-overwrite decision above so Mongo/Supabase drift self-heals.
  //    Only include metadata columns when we have values, so a re-save from an
  //    older extension build never nulls out previously-stored metadata.
  const indexRow = { lecture_id: lectureId, title };
  const indexMeta = {
    class_id: classId || existing?.classId,
    generated_by: generatedBy || existing?.generatedBy,
    provider: provider || existing?.provider,
    model: model || existing?.model,
  };
  for (const [column, value] of Object.entries(indexMeta)) {
    if (value) indexRow[column] = value;
  }

  const { error } = await supabase
    .from("transcripts")
    .upsert(indexRow, { onConflict: "lecture_id" });

  if (error) {
    console.warn("Supabase transcript index upsert error:", error.message);
    // Non-fatal — the MongoDB document is already saved.
  }

  console.log(`✅ Transcript cached for: "${title}" (id: ${lectureId})`);
}

module.exports = { getCachedTranscript, saveTranscript, buildLectureId };
