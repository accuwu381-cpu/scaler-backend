require("dotenv").config({ path: __dirname + "/.env" });
const fs = require("fs");
const path = require("path");
const { saveTranscript } = require("./src/services/transcriptCache.service");

async function uploadTranscripts() {
  const transcriptsDir = path.join(__dirname, "../transcripts");
  
  if (!fs.existsSync(transcriptsDir)) {
    console.error("Transcripts directory not found:", transcriptsDir);
    process.exit(1);
  }

  const files = fs.readdirSync(transcriptsDir);
  
  console.log(`Found ${files.length} transcripts. Uploading to cache...`);

  let count = 0;
  for (const file of files) {
    if (!file.endsWith(".txt")) continue;

    const filePath = path.join(transcriptsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    // Extract title by removing .txt and (1) if it exists
    // "Structural_Design_Patterns_I_-_Class_Scaler_Academy (1).txt"
    let title = file.replace(/\.txt$/, "");
    title = title.replace(/\s*\(\d+\)$/, ""); // Remove (1) copies if any

    if (!content || content.trim() === "") {
      console.warn(`Skipping ${file} - empty content.`);
      continue;
    }

    try {
      await saveTranscript(title, content);
      count++;
    } catch (err) {
      console.error(`Error uploading ${file}:`, err.message);
    }
  }

  console.log(`\n🎉 Successfully uploaded ${count} transcripts to cache!`);
  process.exit(0);
}

uploadTranscripts().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
