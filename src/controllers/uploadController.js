import multer from "multer";
import cloudinary from "../config/cloudinary.js";
import pool from "../config/db.js";

// Memory storage
const storage = multer.memoryStorage();
export const uploadAvatarMiddleware = multer({ storage }).single("avatar");

// Controller
export const uploadAvatar = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Upload to Cloudinary directly from buffer
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "avatars", resource_type: "auto" },
        (error, uploadResult) => {
          if (error) return reject(error);
          resolve(uploadResult);
        }
      );
      stream.end(req.file.buffer); // push file buffer to Cloudinary
    });

    console.log("Cloudinary upload result:", result); // ✅ now it's safe

    // Save URL to database
    const updateResult = await pool.query(
      `UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING id, username, email, bio, avatar_url`,
      [result.secure_url, userId]
    );

    res.json({ user: updateResult.rows[0] });
  } catch (err) {
    console.error("Error uploading avatar:", err.message);
    res.status(500).json({ error: "Failed to upload avatar" });
  }
};
