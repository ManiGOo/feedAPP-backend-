// src/controllers/postController.js
import pool from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

// Get all posts (with author info, likes, comments count, follow status)
export const getPosts = async (req, res) => {
  const userId = req.user.id;

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
          u.avatar_url,
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

    const file = req.files?.image?.[0] || req.files?.video?.[0];

    if (file) {
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

      mediaUrl = result.secure_url;
      mediaType = file.mimetype.startsWith("video/") ? "video" : "image";
    }

    const dbRes = await pool.query(
      `INSERT INTO posts (user_id, content, media_url, media_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, content, media_url, media_type`,
      [userId, content, mediaUrl, mediaType]
    );

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
  const userId = req.user.id;

  try {
    const postResult = await pool.query(
      `
      SELECT p.id, p.content, p.media_url, p.media_type, p.created_at,
             u.id AS author_id, u.username AS author, u.avatar_url,
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
  const { id } = req.params; // post id
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

    // Delete media from Cloudinary if exists
    if (mediaUrl) {
      try {
        const publicId = mediaUrl.split("/").pop().split(".")[0]; // extract file name without extension
        await cloudinary.uploader.destroy(`posts/${publicId}`, { resource_type: "auto" });
      } catch (err) {
        console.warn("Failed to delete media from Cloudinary:", err.message);
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
