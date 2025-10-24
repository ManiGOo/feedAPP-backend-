// gcs.js
import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";

dotenv.config();

let credentials;
try {
  if (!process.env.GCS_KEY_JSON) {
    throw new Error("GCS_KEY_JSON environment variable is not set");
  }
  console.log("Raw GCS_KEY_JSON:", process.env.GCS_KEY_JSON);
  credentials = JSON.parse(process.env.GCS_KEY_JSON);
  console.log("Parsed GCS credentials:", {
    project_id: credentials.project_id,
    client_email: credentials.client_email,
    private_key_id: credentials.private_key_id,
  });
} catch (err) {
  console.error("Failed to parse GCS credentials:", err.message);
  throw err;
}

const storage = new Storage({
  credentials,
  projectId: process.env.GCS_PROJECT_ID || "feedcdn-475706",
});

const bucketName = process.env.GCS_BUCKET_NAME || "feed-assets-2025-oct";
const bucket = storage.bucket(bucketName);

export { bucket };