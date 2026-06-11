const mongoose = require("mongoose");

/**
 * SummaryCache — stores AI-generated lecture summaries in MongoDB.
 *
 * Shares its primary key (`lectureId`) with the Transcript model so a lecture's
 * transcript and summary can be looked up with the same identifier.
 *
 * Fields:
 *   lectureId   — Scaler classroom slug (same value stored as Transcript.lectureId).
 *   classId     — numeric class id from the session URL, stored as metadata.
 *   title       — raw lecture title for human readability / debugging.
 *   summary     — structured summary object (topics / notes / deadlines / announcements).
 *   model       — LLM model name that generated the summary (metadata).
 *   generatedBy — email of the user who generated the summary (metadata).
 *   createdAt   — auto-set timestamp.
 */
const summarySchema = new mongoose.Schema(
  {
    lectureId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    classId: {
      type: String,
      default: "",
    },
    title: {
      type: String,
      required: true,
    },
    summary: {
      topics: { type: [String], default: [] },
      notes: { type: [String], default: [] },
      deadlines: { type: [String], default: [] },
      announcements: { type: [String], default: [] },
    },
    model: {
      type: String,
      default: "",
    },
    generatedBy: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true, // adds createdAt + updatedAt
    collection: "summaries",
  },
);

module.exports = mongoose.model("Summary", summarySchema);
