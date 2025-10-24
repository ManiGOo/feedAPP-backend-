// test-gcs.js
const { Storage } = require("@google-cloud/storage");
require("dotenv").config();

async function testUpload() {
  try {
    if (!process.env.GCS_KEY_JSON) {
      throw new Error("GCS_KEY_JSON is not set");
    }
    console.log("Raw GCS_KEY_JSON:", process.env.GCS_KEY_JSON);
    const credentials = JSON.parse(process.env.GCS_KEY_JSON);
    console.log("Parsed GCS credentials:", {
      project_id: credentials.project_id,
      client_email: credentials.client_email,
      private_key_id: credentials.private_key_id,
    });

    const storage = new Storage({
      credentials,
      projectId: process.env.GCS_PROJECT_ID || "feedcdn-475706",
    });
    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME || "feed-assets-2025-oct");
    const fileName = `test/test-${Date.now()}.txt`;
    const blob = bucket.file(fileName);
    await blob.save("Test content", { contentType: "text/plain" });
    console.log("File uploaded successfully to GCS:", fileName);
  } catch (err) {
    console.error("GCS test upload failed:", err.message);
    if (err.response) {
      console.error("Error details:", err.response.data);
    }
  }
}

testUpload();