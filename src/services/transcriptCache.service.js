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

  return { text: doc.text };
}

/**
 * Save a newly generated transcript to MongoDB and index it in Supabase.
 *
 * @param {string} slug    - Unique lecture slug from Scaler's API (used as lectureId)
 * @param {string} title   - Human-readable lecture title
 * @param {string} text    - Full transcript text
 */
async function saveTranscript(slug, title, text) {
  if (!slug || !text) return;

  const lectureId = slug;

  // 1. Upsert into MongoDB
  await connectMongo();
  await Transcript.findOneAndUpdate(
    { lectureId },
    { lectureId, title, text },
    { upsert: true, new: true },
  );

  // 2. Upsert into Supabase index
  const { error } = await supabase
    .from("transcripts")
    .upsert({ lecture_id: lectureId, title }, { onConflict: "lecture_id" });

  if (error) {
    console.warn("Supabase transcript index upsert error:", error.message);
    // Non-fatal — the MongoDB document is already saved.
  }

  console.log(`✅ Transcript cached for: "${title}" (id: ${lectureId})`);
}

module.exports = { getCachedTranscript, saveTranscript, buildLectureId };
