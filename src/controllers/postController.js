import { bucket } from "../config/gcs.js";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../config/db.js";

// Get all posts (with author info, likes, comments count, follow status)
export const getPosts = async (req, res) => {
  const userId = req.user?.id || 0; // Allow unauthenticated access

  try {
    const postsResult = await pool.query(
      `
      SELECT 
          p.id,
          p.content,
          p.media_url,
          p.media_type,
          p.created_at,
          u.id AS author_id,
          u.username AS author,
          u.avatar_url AS author_avatar,
          COALESCE(likes_count.count, 0) AS like_count,
          CASE WHEN user_likes.user_id IS NULL THEN false ELSE true END AS liked_by_me,
          COALESCE(comments_count.count, 0) AS comments_count,
          CASE WHEN f.follower_id IS NULL THEN false ELSE true END AS is_followed_author
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN (
        SELECT post_id, COUNT(*) AS count
        FROM likes
        GROUP BY post_id
      ) AS likes_count ON likes_count.post_id = p.id
      LEFT JOIN (
        SELECT post_id, user_id
        FROM likes
        WHERE user_id = $1
      ) AS user_likes ON user_likes.post_id = p.id
      LEFT JOIN (
        SELECT post_id, COUNT(*) AS count
        FROM comments
        GROUP BY post_id
      ) AS comments_count ON comments_count.post_id = p.id
      LEFT JOIN follows f
        ON f.follower_id = $1 AND f.followee_id = p.user_id
      ORDER BY p.created_at DESC
      `,
      [userId]
    );

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

    let mediaUrl = null;
    let mediaType = null;

    // Pick the uploaded file (image or video)
    const file = req.files?.image?.[0] || req.files?.video?.[0];

    if (file) {
      const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
      const fileName = `posts/${uuidv4()}_${sanitizedFileName}`;
      console.log("Uploading to GCS:", fileName);
      const blob = bucket.file(fileName);
      const blobStream = blob.createWriteStream({
        metadata: { contentType: file.mimetype },
      });

      await new Promise((resolve, reject) => {
        blobStream.on("error", (err) => {
          console.error("GCS upload failed:", err.message);
          reject(err);
        });
        blobStream.on("finish", () => {
          console.log("GCS upload success:", fileName);
          resolve();
        });
        blobStream.end(file.buffer);
      });

      mediaUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      mediaType = file.mimetype.startsWith("video/") ? "video" : "image";
    }

    // Insert post into DB
    const dbRes = await pool.query(
      `INSERT INTO posts (user_id, content, media_url, media_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, content, media_url, media_type, created_at`,
      [userId, content, mediaUrl, mediaType]
    );

    // Fetch author info for response
    const userRes = await pool.query(
      `SELECT username, avatar_url AS author_avatar FROM users WHERE id = $1`,
      [userId]
    );

    res.status(201).json({
      ...dbRes.rows[0],
      author: userRes.rows[0].username,
      author_avatar: userRes.rows[0].author_avatar,
    });
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
    const existing = await pool.query(
      `SELECT * FROM likes WHERE user_id=$1 AND post_id=$2`,
      [userId, postId]
    );

    let liked = false;

    if (existing.rows.length > 0) {
      await pool.query(`DELETE FROM likes WHERE user_id=$1 AND post_id=$2`, [userId, postId]);
    } else {
      await pool.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [userId, postId]);
      liked = true;
    }

    const countRes = await pool.query(
      "SELECT COUNT(*) FROM likes WHERE post_id = $1",
      [postId]
    );

    res.json({ liked, like_count: parseInt(countRes.rows[0].count) });
  } catch (err) {
    console.error("Error toggling like:", err);
    res.status(500).json({ error: "Failed to toggle like" });
  }
};

// Get a single post by ID (with author + comments + likes + follow status)
export const getPostById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id || 0; // Allow unauthenticated access

  try {
    const postResult = await pool.query(
      `
      SELECT p.id, p.content, p.media_url, p.media_type, p.created_at,
             u.id AS author_id, u.username AS author, u.avatar_url AS author_avatar,
             COALESCE(likes_count.count, 0) AS like_count,
             CASE WHEN user_likes.user_id IS NULL THEN false ELSE true END AS liked_by_me,
             CASE WHEN f.follower_id IS NULL THEN false ELSE true END AS is_followed_author
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN (
        SELECT post_id, COUNT(*) AS count
        FROM likes
        GROUP BY post_id
      ) AS likes_count ON likes_count.post_id = p.id
      LEFT JOIN (
        SELECT post_id, user_id
        FROM likes
        WHERE user_id = $2
      ) AS user_likes ON user_likes.post_id = p.id
      LEFT JOIN follows f 
        ON f.follower_id = $2 AND f.followee_id = p.user_id
      WHERE p.id = $1
      `,
      [id, userId]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    const post = postResult.rows[0];

    const commentsResult = await pool.query(
      `SELECT c.id, c.content, c.created_at,
              u.id AS user_id, u.username, u.avatar_url
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [id]
    );

    res.json({
      ...post,
      comments: commentsResult.rows,
    });
  } catch (err) {
    console.error("Error fetching post by ID:", err);
    res.status(500).json({ error: "Failed to fetch post" });
  }
};

// Delete a post (only by owner)
export const deletePost = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    // Check if post exists and belongs to user
    const postRes = await pool.query(
      `SELECT media_url FROM posts WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (postRes.rows.length === 0) {
      return res.status(404).json({ error: "Post not found or not authorized" });
    }

    const mediaUrl = postRes.rows[0].media_url;

    // Delete media from GCS if exists
    if (mediaUrl) {
      try {
        const fileName = mediaUrl.split(`https://storage.googleapis.com/${bucket.name}/`)[1];
        await bucket.file(fileName).delete();
        console.log(`Deleted GCS file: ${fileName}`);
      } catch (err) {
        console.warn("Failed to delete media from GCS:", err.message);
      }
    }

    // Delete likes, comments, then post
    await pool.query("DELETE FROM likes WHERE post_id = $1", [id]);
    await pool.query("DELETE FROM comments WHERE post_id = $1", [id]);
    await pool.query("DELETE FROM posts WHERE id = $1", [id]);

    res.json({ message: "Post deleted successfully", postId: id });
  } catch (err) {
    console.error("Error deleting post:", err);
    res.status(500).json({ error: "Failed to delete post" });
  }
};

// Update a post (only owner can edit)
export const updatePost = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { content, removeMedia } = req.body;

  try {
    // Check if post exists and belongs to the user
    const postRes = await pool.query(
      `SELECT media_url, media_type FROM posts WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (postRes.rows.length === 0) {
      return res.status(404).json({ error: "Post not found or not authorized" });
    }

    let mediaUrl = postRes.rows[0].media_url;
    let mediaType = postRes.rows[0].media_type;

    // If user removed existing media
    if (removeMedia === "true" && mediaUrl) {
      try {
        const fileName = mediaUrl.split(`https://storage.googleapis.com/${bucket.name}/`)[1];
        await bucket.file(fileName).delete();
        console.log(`Deleted GCS file: ${fileName}`);
      } catch (err) {
        console.warn("Failed to remove existing media from GCS:", err.message);
      }
      mediaUrl = null;
      mediaType = null;
    }

    // If new file uploaded
    const file = req.files?.image?.[0] || req.files?.video?.[0];
    if (file) {
      const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
      const fileName = `posts/${uuidv4()}_${sanitizedFileName}`;
      console.log("Uploading to GCS:", fileName);
      const blob = bucket.file(fileName);
      const blobStream = blob.createWriteStream({
        metadata: { contentType: file.mimetype },
      });

      await new Promise((resolve, reject) => {
        blobStream.on("error", (err) => {
          console.error("GCS upload failed:", err.message);
          reject(err);
        });
        blobStream.on("finish", () => {
          console.log("GCS upload success:", fileName);
          resolve();
        });
        blobStream.end(file.buffer);
      });

      mediaUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      mediaType = file.mimetype.startsWith("video/") ? "video" : "image";
    }

    // Update DB
    const updateRes = await pool.query(
      `UPDATE posts
       SET content = $1, media_url = $2, media_type = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, content, media_url, media_type, created_at, updated_at`,
      [content || "", mediaUrl, mediaType, id]
    );

    // Fetch author info for response
    const userRes = await pool.query(
      `SELECT username, avatar_url AS author_avatar FROM users WHERE id = $1`,
      [userId]
    );

    res.json({
      message: "Post updated successfully",
      post: {
        ...updateRes.rows[0],
        author: userRes.rows[0].username,
        author_avatar: userRes.rows[0].author_avatar,
      },
    });
  } catch (err) {
    console.error("Error updating post:", err);
    res.status(500).json({ error: "Failed to update post" });
  }
};