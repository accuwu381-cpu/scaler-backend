require("dotenv").config({ path: __dirname + "/.env" });
const { connectMongo } = require("./src/services/mongodb");
const Transcript = require("./src/models/transcript.model");
const supabase = require("./src/services/supabase");
const {
  buildVersionId,
} = require("./src/services/transcriptCache.service");
const TranscriptVersion = require("./src/models/transcriptVersion.model");

/**
 * One-off: promote every legacy single-transcript document into a version.
 *
 * Idempotent — version ids are content-addressed, so re-running skips anything
 * already promoted. Legacy documents are left in place; getCachedTranscript
 * still falls back to them for anything this misses.
 *
 * download_count is seeded from download_history so lectures that were popular
 * before versioning do not start at zero and get outranked by a brand-new
 * upload on the tie-break.
 *
 * Pass --dry-run to report what would happen without writing anything.
 */
const DRY_RUN = process.argv.includes("--dry-run");

async function backfill() {
  await connectMongo();

  if (DRY_RUN) {
    console.log("DRY RUN — no documents or rows will be written.\n");
  }

  const legacyDocs = await Transcript.find({}).lean();
  console.log(`Found ${legacyDocs.length} legacy transcript documents.`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of legacyDocs) {
    if (!doc.text || !doc.text.trim()) {
      skipped++;
      continue;
    }

    const trimmed = doc.text.trim();
    const versionId = buildVersionId(doc.lectureId, trimmed);

    try {
      const exists = await TranscriptVersion.findOne({ versionId })
        .select("versionId")
        .lean();
      if (exists) {
        skipped++;
        continue;
      }

      // Seed the counter from historical downloads of this lecture.
      let downloadCount = 0;
      const { count, error } = await supabase
        .from("download_history")
        .select("id", { count: "exact", head: true })
        .eq("lecture_slug", doc.lectureId)
        .eq("type", "transcript");
      if (error) {
        console.warn(`  download_history count failed for ${doc.lectureId}: ${error.message}`);
      } else {
        downloadCount = count || 0;
      }

      if (DRY_RUN) {
        created++;
        console.log(
          `  would promote ${doc.lectureId} -> ${versionId} ` +
            `(${[...trimmed].length} chars, ${downloadCount} prior downloads, ` +
            `provider=${doc.provider || "-"}, model=${doc.model || "-"})`,
        );
        continue;
      }

      await TranscriptVersion.create({
        versionId,
        lectureId: doc.lectureId,
        title: doc.title || doc.lectureId,
        classId: doc.classId || "",
        text: trimmed,
        provider: doc.provider || "",
        model: doc.model || "",
        generatedBy: doc.generatedBy || "",
        charCount: [...trimmed].length,
        downloadCount,
        createdAt: doc.createdAt,
      });

      const row = {
        id: versionId,
        lecture_id: doc.lectureId,
        title: doc.title || doc.lectureId,
        char_count: [...trimmed].length,
        download_count: downloadCount,
      };
      if (doc.classId) row.class_id = doc.classId;
      if (doc.generatedBy) row.generated_by = doc.generatedBy;
      if (doc.provider) row.provider = doc.provider;
      if (doc.model) row.model = doc.model;
      if (doc.createdAt) row.created_at = new Date(doc.createdAt).toISOString();

      const { error: upsertError } = await supabase
        .from("transcript_versions")
        .upsert(row, { onConflict: "id" });
      if (upsertError) {
        console.warn(`  Supabase mirror failed for ${versionId}: ${upsertError.message}`);
      }

      created++;
      console.log(`  ✅ ${doc.lectureId} -> ${versionId} (${downloadCount} prior downloads)`);
    } catch (err) {
      failed++;
      console.error(`  ❌ ${doc.lectureId}: ${err.message}`);
    }
  }

  console.log(
    `\n${DRY_RUN ? "Dry run complete." : "Done."} ${created} ${DRY_RUN ? "would be promoted" : "promoted"}, ` +
      `${skipped} already present or empty, ${failed} failed.`,
  );
  process.exit(failed ? 1 : 0);
}

backfill().catch((err) => {
  console.error("Backfill crashed:", err);
  process.exit(1);
});
