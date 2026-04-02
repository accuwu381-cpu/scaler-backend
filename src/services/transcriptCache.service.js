const supabase = require("./supabase");
const { connectMongo } = require("./mongodb");
const Transcript = require("../models/transcript.model");

/**
 * Build a deterministic lectureId from the lecture title.
 * Keeps it lowercase, replaces non-alphanumeric with hyphens, trims.
 */
function buildLectureId(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 120);
}

/**
 * Look up a cached transcript by lecture title.
 *
 * Flow:
 *  1. Derive lectureId from title.
 *  2. Query Supabase `transcripts` table for a row with that lecture_id.
 *  3. If found, fetch the full text from MongoDB by lectureId.
 *  4. Return { text } or null if not cached.
 */
async function getCachedTranscript(title) {
  if (!title) return null;

  const lectureId = buildLectureId(title);

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
    console.warn(`Supabase has index for "${lectureId}" but MongoDB doc missing.`);
    return null;
  }

  return { text: doc.text };
}

/**
 * Save a newly generated transcript to MongoDB and index it in Supabase.
 *
 * @param {string} title   - Raw lecture title from the page
 * @param {string} text    - Full transcript text
 */
async function saveTranscript(title, text) {
  if (!title || !text) return;

  const lectureId = buildLectureId(title);

  // 1. Upsert into MongoDB
  await connectMongo();
  await Transcript.findOneAndUpdate(
    { lectureId },
    { lectureId, title, text },
    { upsert: true, new: true },
  );

  // 2. Upsert into Supabase index
  const { error } = await supabase.from("transcripts").upsert(
    { lecture_id: lectureId, title },
    { onConflict: "lecture_id" },
  );

  if (error) {
    console.warn("Supabase transcript index upsert error:", error.message);
    // Non-fatal — the MongoDB document is already saved.
  }

  console.log(`✅ Transcript cached for: "${title}" (id: ${lectureId})`);
}

module.exports = { getCachedTranscript, saveTranscript, buildLectureId };
