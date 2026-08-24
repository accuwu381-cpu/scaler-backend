const crypto = require("crypto");
const supabase = require("./supabase");
const { connectMongo } = require("./mongodb");
const Transcript = require("../models/transcript.model");
const TranscriptVersion = require("../models/transcriptVersion.model");

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
 * Content-addressed version id, scoped to the lecture.
 *
 * Hashing the text alone looked tidy but was wrong: the legacy data has the
 * same lecture stored under several slug formats (a UUID slug, a kebab slug and
 * the raw title), so identical transcripts under different lectureIds collapsed
 * into ONE document owned by whichever lecture got there first — the others
 * silently ended up with no version at all. Mixing the lectureId in keeps
 * dedup where it matters (re-running the same model on the same lecture) while
 * letting two lectures hold identical text.
 */
function buildVersionId(lectureId, text) {
  return crypto
    .createHash("sha256")
    .update(`${lectureId || ""}\u0000${(text || "").trim()}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * Tally up/down votes for every version of a lecture in one query.
 * Votes are authoritative rows rather than counter columns, so a concurrent
 * vote can never lose a race against another.
 *
 * Returns { [versionId]: { upvotes, downvotes } } — empty on any failure,
 * because votes are decoration and must never break a transcript fetch.
 */
async function fetchVoteTallies(lectureId) {
  const tallies = {};
  try {
    const { data, error } = await supabase
      .from("transcript_version_votes")
      .select("version_id, vote")
      .eq("lecture_id", lectureId);

    if (error) {
      console.warn("Supabase vote tally error:", error.message);
      return tallies;
    }

    for (const row of data || []) {
      const tally = (tallies[row.version_id] ||= { upvotes: 0, downvotes: 0 });
      if (row.vote === "up") tally.upvotes += 1;
      else if (row.vote === "down") tally.downvotes += 1;
    }
  } catch (err) {
    console.warn("Vote tally failed:", err.message);
  }
  return tallies;
}

/**
 * Rank versions best-first.
 *
 * Net votes lead, because that is the only signal that directly encodes "this
 * transcript is garbage". Downloads break ties (weak but real evidence), then
 * recency. This ordering is what old single-transcript clients receive, so a
 * downvoted version stops being served without anyone deleting anything.
 */
function rankVersions(versions) {
  return [...versions].sort((a, b) => {
    const scoreA = (a.upvotes || 0) - (a.downvotes || 0);
    const scoreB = (b.upvotes || 0) - (b.downvotes || 0);
    if (scoreA !== scoreB) return scoreB - scoreA;

    const downloadsA = a.downloadCount || 0;
    const downloadsB = b.downloadCount || 0;
    if (downloadsA !== downloadsB) return downloadsB - downloadsA;

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/** Shape a Mongo version doc for the API — never includes `text`. */
function toVersionMeta(doc, tally = {}) {
  return {
    versionId: doc.versionId,
    lectureId: doc.lectureId,
    title: doc.title || "",
    provider: doc.provider || "",
    model: doc.model || "",
    generatedBy: doc.generatedBy || "",
    charCount: doc.charCount || 0,
    downloadCount: doc.downloadCount || 0,
    upvotes: tally.upvotes || 0,
    downvotes: tally.downvotes || 0,
    createdAt: doc.createdAt,
  };
}

/**
 * List every version of a lecture, newest first, WITHOUT the transcript text.
 *
 * Transcripts routinely exceed 50 KB, so the versions page renders from this
 * and fetches text only when a row is expanded or downloaded.
 */
async function listTranscriptVersions(slug) {
  if (!slug) return [];

  await connectMongo();
  const docs = await TranscriptVersion.find({ lectureId: slug })
    .select("-text")
    .sort({ createdAt: -1 })
    .lean();

  if (!docs.length) return [];

  const tallies = await fetchVoteTallies(slug);
  return docs.map((doc) => toVersionMeta(doc, tallies[doc.versionId]));
}

/** Fetch one version including its text. */
async function getTranscriptVersion(versionId) {
  if (!versionId) return null;

  await connectMongo();
  const doc = await TranscriptVersion.findOne({ versionId }).lean();
  if (!doc) return null;

  const tallies = await fetchVoteTallies(doc.lectureId);
  return { ...toVersionMeta(doc, tallies[doc.versionId]), text: doc.text };
}

/**
 * Look up the best cached transcript for a lecture.
 *
 * Response shape is unchanged from the single-transcript era so extension
 * builds that predate versioning keep working — they simply receive whichever
 * version currently ranks highest.
 *
 * Falls back to the legacy `transcripts` collection for lectures that have not
 * been backfilled into versions yet.
 */
async function getCachedTranscript(slug) {
  if (!slug) return null;

  await connectMongo();

  const docs = await TranscriptVersion.find({ lectureId: slug }).lean();
  if (docs.length) {
    const tallies = await fetchVoteTallies(slug);
    const ranked = rankVersions(
      docs.map((doc) => ({ ...doc, ...(tallies[doc.versionId] || {}) })),
    );
    const best = ranked[0];
    return {
      text: best.text,
      generatedBy: best.generatedBy || "",
      provider: best.provider || "",
      model: best.model || "",
      versionId: best.versionId,
      versionCount: docs.length,
    };
  }

  // ── Legacy path: lectures not yet backfilled into versions ────────────
  const legacy = await Transcript.findOne({ lectureId: slug }).lean();
  if (!legacy || !legacy.text) return null;

  return {
    text: legacy.text,
    generatedBy: legacy.generatedBy || "",
    provider: legacy.provider || "",
    model: legacy.model || "",
    versionId: "",
    versionCount: 1,
  };
}

/**
 * Save a generated transcript as a new version of the lecture.
 *
 * Never overwrites and never rejects. Identical text collapses onto the
 * existing version (content-addressed id) and only backfills missing metadata.
 *
 * @param {string} slug    - Unique lecture slug from Scaler's API (used as lectureId)
 * @param {string} title   - Human-readable lecture title
 * @param {string} text    - Full transcript text
 * @param {object} [meta]  - Optional metadata; older extension builds omit it
 * @param {string} [meta.classId]     - Numeric class id from the session URL
 * @param {string} [meta.generatedBy] - Email of the generating user
 * @param {string} [meta.provider]    - Transcription provider used
 * @param {string} [meta.model]       - Model id used
 * @param {boolean} [meta.countDownload] - The caller also handed the user the
 *        file (the processor page downloads as soon as it finishes), so this
 *        save counts as a download of the version too.
 * @returns {Promise<{versionId: string, created: boolean}|null>}
 */
async function saveTranscript(slug, title, text, meta = {}) {
  if (!slug || !text) return null;

  const lectureId = slug;
  const trimmed = text.trim();
  const versionId = buildVersionId(lectureId, trimmed);
  const classId = meta.classId || "";
  const generatedBy = meta.generatedBy || "";
  const provider = meta.provider || "";
  const model = meta.model || "";
  const countDownload = meta.countDownload === true;

  await connectMongo();

  const existing = await TranscriptVersion.findOne({ versionId }).lean();
  let created = false;
  let downloadCount = existing?.downloadCount || 0;

  if (existing) {
    // Same text already stored. Only fill in metadata we did not have — an
    // older extension build re-uploading must never blank out what a newer
    // one recorded.
    const patch = {};
    const metaFields = { classId, generatedBy, provider, model, title };
    for (const [key, value] of Object.entries(metaFields)) {
      if (value && !existing[key]) patch[key] = value;
    }
    const update = {};
    if (Object.keys(patch).length) update.$set = patch;
    if (countDownload) update.$inc = { downloadCount: 1 };
    if (Object.keys(update).length) {
      const updated = await TranscriptVersion.findOneAndUpdate(
        { versionId },
        update,
        { new: true },
      ).lean();
      downloadCount = updated?.downloadCount ?? downloadCount;
    }
    console.log(
      `[Cache Save] Version ${versionId} already exists for "${title}" (${lectureId}) — metadata merged.`,
    );
  } else {
    await TranscriptVersion.create({
      versionId,
      lectureId,
      title: title || lectureId,
      classId,
      text: trimmed,
      provider,
      model,
      generatedBy,
      charCount: [...trimmed].length,
      // Generating a transcript hands the user the file immediately, so that
      // first download is real and should show up on the counter.
      downloadCount: countDownload ? 1 : 0,
    });
    created = true;
    downloadCount = countDownload ? 1 : 0;
    console.log(
      `✅ New transcript version ${versionId} stored for "${title}" (${lectureId}).`,
    );
  }

  // ── Mirror metadata into Supabase (no text) ───────────────────────────
  // Index rows are best-effort: MongoDB is already durable at this point, so a
  // Supabase hiccup must not fail the save.
  const versionRow = {
    id: versionId,
    lecture_id: lectureId,
    title: title || lectureId,
  };
  if (classId) versionRow.class_id = classId;
  if (generatedBy) versionRow.generated_by = generatedBy;
  if (provider) versionRow.provider = provider;
  if (model) versionRow.model = model;
  if (created) versionRow.char_count = [...trimmed].length;
  if (created || countDownload) versionRow.download_count = downloadCount;

  const { error: versionError } = await supabase
    .from("transcript_versions")
    .upsert(versionRow, { onConflict: "id" });
  if (versionError) {
    console.warn("Supabase version upsert error:", versionError.message);
  }

  // Lecture-level index row — kept so "does this lecture have transcripts?"
  // stays a single cheap lookup, and for admin browsing.
  const { error: lectureError } = await supabase
    .from("transcripts")
    .upsert(
      { lecture_id: lectureId, title: title || lectureId },
      { onConflict: "lecture_id" },
    );
  if (lectureError) {
    console.warn("Supabase transcript index upsert error:", lectureError.message);
  }

  return { versionId, created, downloadCount };
}

/**
 * Count an explicit download of one version.
 *
 * Only called when someone presses Download on a specific version — opening or
 * previewing must not inflate the number, or the counter stops meaning
 * "people deliberately chose this one".
 */
async function recordVersionDownload(versionId) {
  if (!versionId) return null;

  await connectMongo();
  const updated = await TranscriptVersion.findOneAndUpdate(
    { versionId },
    { $inc: { downloadCount: 1 } },
    { new: true },
  ).lean();

  if (!updated) return null;

  // Mirror the authoritative Mongo value, so the two stores converge even if a
  // previous mirror write was lost.
  const { error } = await supabase
    .from("transcript_versions")
    .update({ download_count: updated.downloadCount })
    .eq("id", versionId);
  if (error) {
    console.warn("Supabase download_count mirror error:", error.message);
  }

  return { versionId, downloadCount: updated.downloadCount };
}

/**
 * Count a download for a lecture when the caller could not say WHICH version
 * it took.
 *
 * Extension builds that predate versioning fetch `GET /api/transcript`, which
 * hands back the best-ranked version, and then report the download without a
 * versionId. Counting the plain GET itself is not an option — the summary panel
 * hits the same endpoint just to ask "does a transcript exist?", and that probe
 * fires every time the panel opens — so the download report is the only
 * trustworthy signal that a file actually reached someone.
 *
 * Resolves the same version the GET would have served and bumps it.
 */
async function recordDownloadForLecture(slug) {
  if (!slug) return null;

  await connectMongo();
  const docs = await TranscriptVersion.find({ lectureId: slug })
    .select("-text")
    .lean();
  if (!docs.length) return null; // legacy-only lecture: nothing to count against

  const tallies = await fetchVoteTallies(slug);
  const ranked = rankVersions(
    docs.map((doc) => ({ ...doc, ...(tallies[doc.versionId] || {}) })),
  );
  return recordVersionDownload(ranked[0].versionId);
}

/**
 * Record (or change, or clear) one user's vote on a version.
 *
 * One row per (version, email) — voting again replaces the previous vote, and
 * `vote: null` withdraws it. Returns the fresh tally for that version.
 */
async function voteOnVersion(versionId, email, vote) {
  if (!versionId || !email) return null;

  await connectMongo();
  const version = await TranscriptVersion.findOne({ versionId })
    .select("versionId lectureId")
    .lean();
  if (!version) return null;

  if (vote === null) {
    const { error } = await supabase
      .from("transcript_version_votes")
      .delete()
      .eq("version_id", versionId)
      .eq("email", email);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("transcript_version_votes").upsert(
      {
        version_id: versionId,
        lecture_id: version.lectureId,
        email,
        vote,
      },
      { onConflict: "version_id,email" },
    );
    if (error) throw new Error(error.message);
  }

  const tallies = await fetchVoteTallies(version.lectureId);
  const tally = tallies[versionId] || { upvotes: 0, downvotes: 0 };
  return { versionId, ...tally, myVote: vote };
}

/** Which versions of a lecture has this user voted on? */
async function getUserVotes(lectureId, email) {
  if (!lectureId || !email) return {};

  const votes = {};
  try {
    const { data, error } = await supabase
      .from("transcript_version_votes")
      .select("version_id, vote")
      .eq("lecture_id", lectureId)
      .eq("email", email);
    if (error) {
      console.warn("Supabase user vote lookup error:", error.message);
      return votes;
    }
    for (const row of data || []) votes[row.version_id] = row.vote;
  } catch (err) {
    console.warn("User vote lookup failed:", err.message);
  }
  return votes;
}

/**
 * Permanently delete one version. Admin-only — wrong-language and hallucinated
 * transcripts are noise worth removing, but a normal user must never be able to
 * destroy someone else's contribution.
 */
async function deleteTranscriptVersion(versionId) {
  if (!versionId) return null;

  await connectMongo();
  const deleted = await TranscriptVersion.findOneAndDelete({ versionId }).lean();
  if (!deleted) return null;

  const { error: voteError } = await supabase
    .from("transcript_version_votes")
    .delete()
    .eq("version_id", versionId);
  if (voteError) console.warn("Supabase vote cleanup error:", voteError.message);

  const { error } = await supabase
    .from("transcript_versions")
    .delete()
    .eq("id", versionId);
  if (error) console.warn("Supabase version delete error:", error.message);

  return { versionId, lectureId: deleted.lectureId };
}

module.exports = {
  getCachedTranscript,
  saveTranscript,
  buildLectureId,
  buildVersionId,
  listTranscriptVersions,
  getTranscriptVersion,
  recordVersionDownload,
  recordDownloadForLecture,
  voteOnVersion,
  getUserVotes,
  deleteTranscriptVersion,
  rankVersions,
};
