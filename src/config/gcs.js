import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";

// Load .env file for local development
dotenv.config();

let credentials;
try {
  if (process.env.GCS_KEY_JSON) {
    credentials = JSON.parse(process.env.GCS_KEY_JSON);
  } else {
    throw new Error("GCS_KEY_JSON environment variable is not set");
  }
} catch (err) {
  console.error("Failed to load GCS credentials:", err.message);
  throw err;
}

const storage = new Storage({
  credentials,
  projectId: process.env.GCS_PROJECT_ID || "feedcdn-475706",
});

const bucketName = process.env.GCS_BUCKET_NAME || "feed-assets-2025-oct";
const bucket = storage.bucket(bucketName);

export { bucket };