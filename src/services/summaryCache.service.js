const supabase = require("./supabase");
const { connectMongo } = require("./mongodb");
const Summary = require("../models/summary.model");

/**
 * Normalise an arbitrary parsed object into our fixed summary shape.
 * Guarantees four string arrays so the renderer never crashes.
 */
function normaliseSummary(raw) {
  const toStringArray = (val) => {
    if (!val) return [];
    if (!Array.isArray(val)) val = [val];
    return val
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .map((v) => v.trim())
      .filter(Boolean);
  };

  const obj = raw && typeof raw === "object" ? raw : {};
  return {
    topics: toStringArray(obj.topics),
    notes: toStringArray(obj.notes),
    deadlines: toStringArray(obj.deadlines),
    announcements: toStringArray(obj.announcements),
  };
}

/**
 * Look up a cached summary by lecture slug.
 *
 * Mirrors the transcript cache flow:
 *  1. Query Supabase `summaries` index for the lecture_id.
 *  2. If indexed, fetch the full summary document from MongoDB.
 *  3. Return the structured summary + metadata, or null if not cached.
 */
async function getCachedSummary(slug) {
  if (!slug) return null;

  const lectureId = slug;

  // 1. Check Supabase index
  const { data, error } = await supabase
    .from("summaries")
    .select("lecture_id")
    .eq("lecture_id", lectureId)
    .maybeSingle();

  if (error) {
    console.warn("Supabase summary lookup error:", error.message);
    return null;
  }

  if (!data) return null; // not in index → not cached

  // 2. Fetch full summary from MongoDB
  await connectMongo();
  const doc = await Summary.findOne({ lectureId }).lean();
  if (!doc) {
    console.warn(
      `Supabase has index for summary "${lectureId}" but MongoDB doc missing.`,
    );
    return null;
  }

  return {
    summary: normaliseSummary(doc.summary),
    classId: doc.classId || "",
    model: doc.model || "",
    generatedBy: doc.generatedBy || "",
    createdAt: doc.createdAt,
  };
}

/**
 * Save a newly generated summary to MongoDB and index it in Supabase.
 *
 * Policy: FIRST-WRITE-WINS. If a summary already exists for the lecture we keep
 * it untouched and report back that nothing was written.
 *
 * @param {object} args
 * @param {string} args.slug        - Unique lecture slug (used as lectureId)
 * @param {string} args.classId     - Numeric class id from the session URL (metadata)
 * @param {string} args.title       - Human-readable lecture title
 * @param {object} args.summary     - Structured summary (topics/notes/deadlines/announcements)
 * @param {string} args.model       - LLM model name (metadata)
 * @param {string} args.generatedBy - Email of the generating user (metadata)
 */
async function saveSummary({ slug, classId, title, summary, model, generatedBy }) {
  if (!slug || !summary) return { saved: false, reason: "missing slug or summary" };

  const lectureId = slug;
  const normalised = normaliseSummary(summary);

  await connectMongo();

  // First-write-wins: never overwrite an existing summary's content. But still
  // fall through to ensure the Supabase index row exists, so Mongo/Supabase
  // drift self-heals instead of leaving an orphaned Mongo doc forever.
  const existing = await Summary.findOne({ lectureId }).lean();
  const isNew = !existing;

  if (isNew) {
    await Summary.create({
      lectureId,
      classId: classId || "",
      title: title || lectureId,
      summary: normalised,
      model: model || "",
      generatedBy: generatedBy || "",
    });
  } else {
    console.log(
      `[Summary Save] Keeping existing summary for "${title}" (id: ${lectureId}).`,
    );
  }

  // ALWAYS ensure the Supabase index row exists (decoupled from first-write).
  // Only include metadata when present so a re-save never nulls stored values.
  const indexRow = { lecture_id: lectureId, title: title || lectureId };
  if (classId) indexRow.class_id = classId;
  if (model) indexRow.model = model;
  if (generatedBy) indexRow.generated_by = generatedBy;

  const { error } = await supabase
    .from("summaries")
    .upsert(indexRow, { onConflict: "lecture_id" });

  if (error) {
    console.warn("Supabase summary index upsert error:", error.message);
    // Non-fatal — the MongoDB document is already saved.
  }

  if (isNew) console.log(`✅ Summary cached for: "${title}" (id: ${lectureId})`);
  return { saved: isNew, reason: isNew ? undefined : "exists" };
}

module.exports = { getCachedSummary, saveSummary, normaliseSummary };
