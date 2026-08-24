const mongoose = require("mongoose");

/**
 * TranscriptVersion — one generated transcript for a lecture.
 *
 * A lecture can have many versions: different users, providers and models all
 * produce different text for the same recording, and quality varies wildly.
 * Nothing is ever overwritten — the old cache kept whichever transcript had
 * the most *bytes*, which systematically preferred hallucination loops and
 * wrong-language output (UTF-8 makes non-Latin scripts ~3x heavier than
 * ASCII). Versions plus votes let people pick instead of guessing.
 *
 * `versionId` is a hash of the text, so re-generating byte-identical output
 * lands on the same document instead of creating a duplicate row.
 */
const transcriptVersionSchema = new mongoose.Schema(
  {
    versionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Lecture slug — the same key the old single-transcript cache used.
    lectureId: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: "",
    },
    // Numeric class id from the session URL, stored as metadata.
    classId: {
      type: String,
      default: "",
    },
    text: {
      type: String,
      required: true,
    },
    // Transcription provider (e.g. "groq", "openai").
    provider: {
      type: String,
      default: "",
    },
    // Model id (e.g. "whisper-large-v3"). Matches summaries.model naming.
    model: {
      type: String,
      default: "",
    },
    // Email of the user who generated this version.
    generatedBy: {
      type: String,
      default: "",
    },
    // Character count, not byte count — shown in the UI as a size hint.
    charCount: {
      type: Number,
      default: 0,
    },
    // Incremented only when someone explicitly downloads this version from
    // the versions page. Atomic via $inc; mirrored to Supabase for admin use.
    downloadCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true, // adds createdAt + updatedAt
    collection: "transcript_versions",
  },
);

// Versions are always listed newest-first for one lecture.
transcriptVersionSchema.index({ lectureId: 1, createdAt: -1 });

module.exports = mongoose.model("TranscriptVersion", transcriptVersionSchema);
