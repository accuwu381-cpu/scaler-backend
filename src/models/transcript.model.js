const mongoose = require("mongoose");

/**
 * TranscriptCache — stores full lecture transcripts in MongoDB.
 *
 * Fields:
 *   lectureId  — deterministic ID derived from the lecture title (slug).
 *                Used as the lookup key stored in Supabase.
 *   title      — raw lecture title for human readability / debugging.
 *   text       — full transcript text.
 *   createdAt  — auto-set timestamp.
 */
const transcriptSchema = new mongoose.Schema(
  {
    lectureId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    // Numeric class id from the session URL, stored as metadata (added going forward).
    classId: {
      type: String,
      default: "",
    },
    // Email of the user who generated the transcript (added going forward).
    generatedBy: {
      type: String,
      default: "",
    },
    // Transcription provider used to generate the text (e.g. "groq", "openai").
    provider: {
      type: String,
      default: "",
    },
    // Model id used to generate the text (e.g. "whisper-large-v3").
    // Matches summaries.model; reads go through .lean() so the Mongoose
    // `model` reserved-path warning has no practical effect here.
    model: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true, // adds createdAt + updatedAt
    collection: "transcripts",
  },
);

module.exports = mongoose.model("Transcript", transcriptSchema);
