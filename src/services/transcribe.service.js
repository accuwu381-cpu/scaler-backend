const FormData = require("form-data");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

class TranscribeService {
  async transcribeAudio(fileBuffer, originalName, mimetype) {
    if (!process.env.LEMONFOX_API_KEY) {
      throw new Error("Lemonfox API key is not configured.");
    }

    const formData = new FormData();
    formData.append("file", fileBuffer, {
      filename: originalName || "audio.aac",
      contentType: mimetype || "audio/aac",
    });
    formData.append("model", "whisper-1");

    console.log(`Sending file ${originalName} to Lemonfox API...`);

    const response = await fetch(
      "https://api.lemonfox.ai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.LEMONFOX_API_KEY}`,
          ...formData.getHeaders(),
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Lemonfox API error: ${response.status} - ${errorText}`);
      throw new Error(`Lemonfox API returned error HTTP ${response.status}`);
    }

    const data = await response.json();
    return data;
  }
}

module.exports = new TranscribeService();
