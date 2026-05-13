const transcribeService = require("../services/transcribe.service");
const { createClient } = require("@supabase/supabase-js");

// Use SERVICE_ROLE_KEY if available for higher privileges, else fallback to ANON_KEY
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

const getUploadUrl = async (req, res) => {
  try {
    const fileName = `audio_${Date.now()}.aac`;
    
    // Generate a signed upload URL that is valid for 1 hour (3600 seconds)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("audio-uploads")
      .createSignedUploadUrl(fileName);

    if (uploadError) {
      throw uploadError;
    }

    return res.status(200).json({
      uploadUrl: uploadData.signedUrl,
      path: uploadData.path
    });
  } catch (error) {
    console.error("Error generating upload URL:", error.message);
    return res.status(500).json({ error: "Failed to generate upload URL", details: error.message });
  }
};

const getTranscriptHealth = async (req, res) => {
  try {
    if (!transcribeService.isEnabled()) {
      return res.status(503).json({ ok: false, reason: "transcription_disabled" });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Transcript health check failed:", error.message);
    return res.status(503).json({ ok: false, reason: "health_check_failed" });
  }
};

const transcribeAudio = async (req, res) => {
  const { path } = req.body;
  try {
    if (!path) {
      return res.status(400).json({ error: "No file path provided" });
    }

    // Now the file exists, we can generate a temporary download URL for Lemonfox
    const { data: downloadData, error: downloadError } = await supabase.storage
      .from("audio-uploads")
      .createSignedUrl(path, 3600);
      
    if (downloadError) {
        throw downloadError;
    }

    const audioUrl = downloadData.signedUrl;

    // Pass the URL directly to Lemonfox instead of file buffer
    const result = await transcribeService.transcribeUrl(audioUrl);

    // Asynchronous cleanup: delete the file from Supabase storage once transcribed
    if (path) {
      supabase.storage.from("audio-uploads").remove([path]).catch(err => {
        console.error("Failed to cleanup audio file:", err.message);
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Transcription Error:", error.message);
    return res
      .status(500)
      .json({ error: "Transcription failed", details: error.message });
  }
};

module.exports = {
  getUploadUrl,
  getTranscriptHealth,
  transcribeAudio,
};
