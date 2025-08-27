// src/controllers/commentController.js
import pool from "../config/db.js";

// Create a new comment
export const createComment = async (req, res) => {
  const { content } = req.body;
  const { postId } = req.params; // from URL
  const userId = req.user.id;    // from auth middleware

  if (!content) {
    return res.status(400).json({ error: "Comment content is required" });
  }

  try {
    // Insert comment
    const result = await pool.query(
      `INSERT INTO comments (post_id, user_id, content) 
       VALUES ($1, $2, $3)
       RETURNING id, post_id, content, created_at, user_id`,
      [postId, userId, content]
    );

    const comment = result.rows[0];

    // Fetch user info
    const userResult = await pool.query(
      `SELECT username, avatar_url FROM users WHERE id=$1`,
      [userId]
    );

    const userData = userResult.rows[0];

    res.status(201).json({
      ...comment,
      username: userData.username,
      avatar_url: userData.avatar_url,
    });
  } catch (err) {
    console.error("Error creating comment:", err.message);
    res.status(500).json({ error: "Failed to create comment" });
  }
};

// Get all comments for a specific post
export const getCommentsByPost = async (req, res) => {
  const { postId } = req.params;

  try {
    const result = await pool.query(
      `SELECT c.id, c.content, c.created_at, u.username, u.avatar_url
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [postId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching comments:", err.message);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
};
