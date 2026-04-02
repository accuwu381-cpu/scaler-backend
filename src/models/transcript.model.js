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
  },
  {
    timestamps: true, // adds createdAt + updatedAt
    collection: "transcripts",
  },
);

module.exports = mongoose.model("Transcript", transcriptSchema);
