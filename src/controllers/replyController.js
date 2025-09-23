// src/controllers/replyController.js
import pool from "../config/db.js";

// Create a new reply
export const createReply = async (req, res) => {
  const { content } = req.body;
  const { commentId } = req.params;
  const userId = req.user.id; // from auth middleware

  if (!content) {
    return res.status(400).json({ error: "Reply content is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO replies (comment_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, comment_id, content, created_at, user_id`,
      [commentId, userId, content]
    );

    const reply = result.rows[0];

    // Fetch user info
    const userResult = await pool.query(
      `SELECT username, avatar_url FROM users WHERE id = $1`,
      [userId]
    );

    const userData = userResult.rows[0];

    res.status(201).json({
      ...reply,
      username: userData.username,
      avatar_url: userData.avatar_url,
    });
  } catch (err) {
    console.error("Error creating reply:", err.message);
    res.status(500).json({ error: "Failed to create reply" });
  }
};

// Get all replies for a specific comment
export const getRepliesByComment = async (req, res) => {
  const { commentId } = req.params;

  try {
    const result = await pool.query(
      `SELECT r.id AS reply_id, r.content AS reply_content, r.created_at,
              u.username AS reply_author, u.avatar_url
       FROM replies r
       JOIN users u ON r.user_id = u.id
       WHERE r.comment_id = $1
       ORDER BY r.created_at ASC`,
      [commentId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching replies:", err.message);
    res.status(500).json({ error: "Failed to fetch replies" });
  }
};

// Get all replies made by a specific user (for profile page)
export const getRepliesByUser = async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `SELECT r.id AS reply_id, r.content AS reply_content, r.created_at,
              c.id AS comment_id, c.content AS comment_content,
              p.id AS post_id, p.content AS post_content,
              pu.username AS post_author
       FROM replies r
       JOIN comments c ON r.comment_id = c.id
       JOIN posts p ON c.post_id = p.id
       JOIN users pu ON p.user_id = pu.id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );

    res.json({ replies: result.rows });
  } catch (err) {
    console.error("Error fetching user replies:", err.message);
    res.status(500).json({ error: "Failed to fetch user replies" });
  }
};
