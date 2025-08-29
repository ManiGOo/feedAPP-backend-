import pool from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

// Get all posts (with author info)
export const getPosts = async (req, res) => {
  const userId = req.user.id;
  try {
    const postsResult = await pool.query(
      `
      SELECT p.id, p.content, p.media_url, p.media_type, p.created_at,
             u.id AS author_id, u.username AS author, u.avatar_url
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
      `
    );
    console.log("Fetched posts:", postsResult.rows.length); // log number of posts
    res.json(postsResult.rows);
  } catch (err) {
    console.error("Error fetching posts:", err);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
};

// Create a post with optional image/video
export const createPost = async (req, res) => {
  try {
    const userId = req.user.id;
    const content = req.body.content || "";

    console.log("Request body content:", content);
    console.log("Request files:", req.files); // log files object

    let mediaUrl = null;
    let mediaType = null;

    const file = req.files?.image?.[0] || req.files?.video?.[0];

    if (file) {
      console.log("Uploading file:", file.originalname, file.mimetype, file.size);

      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "posts", resource_type: "auto" },
          (err, uploadResult) => {
            if (err) return reject(err);
            resolve(uploadResult);
          }
        );
        stream.end(file.buffer);
      });

      console.log("Cloudinary upload result:", result);

      mediaUrl = result.secure_url;
      mediaType = file.mimetype.startsWith("video/") ? "video" : "image";
    } else {
      console.log("No file uploaded with the request.");
    }

    const dbRes = await pool.query(
      `INSERT INTO posts (user_id, content, media_url, media_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, content, media_url, media_type`,
      [userId, content, mediaUrl, mediaType]
    );

    console.log("Post saved to DB:", dbRes.rows[0]);
    res.status(201).json(dbRes.rows[0]);
  } catch (err) {
    console.error("Error creating post:", err);
    res.status(500).json({ error: "Failed to create post" });
  }
};

// Toggle like/unlike
export const toggleLike = async (req, res) => {
  const userId = req.user.id;
  const { postId } = req.params;

  try {
    console.log("Toggling like for user:", userId, "post:", postId);

    const existing = await pool.query(
      `SELECT * FROM likes WHERE user_id=$1 AND post_id=$2`,
      [userId, postId]
    );

    let liked = false;

    if (existing.rows.length > 0) {
      await pool.query(`DELETE FROM likes WHERE user_id=$1 AND post_id=$2`, [userId, postId]);
      console.log("Post unliked.");
    } else {
      await pool.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [userId, postId]);
      liked = true;
      console.log("Post liked.");
    }

    const countRes = await pool.query(
      "SELECT COUNT(*) FROM likes WHERE post_id = $1",
      [postId]
    );

    console.log("Total likes:", countRes.rows[0].count);
    res.json({ liked, like_count: parseInt(countRes.rows[0].count) });
  } catch (err) {
    console.error("Error toggling like:", err);
    res.status(500).json({ error: "Failed to toggle like" });
  }
};
