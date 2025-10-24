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
      `SELECT c.id, c.content, c.created_at, c.user_id, u.username, u.avatar_url
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

// Fetch all comments made by the logged-in user
export const getMyComments = async (req, res) => {
  const userId = req.user.id;

  try {
    // Fetch comments with post info and user info
    const result = await pool.query(
      `
      SELECT c.id, c.content, c.created_at, c.post_id, c.user_id,
             u.username, u.avatar_url,
             p.content AS post_content
      FROM comments c
      JOIN posts p ON c.post_id = p.id
      JOIN users u ON c.user_id = u.id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC
      `,
      [userId]
    );

    const comments = result.rows.map((c) => ({
      id: c.id,
      content: c.content,
      created_at: c.created_at,
      post_id: c.post_id,
      user_id: c.user_id,
      username: c.username,
      avatar_url: c.avatar_url,
      post_content: c.post_content,
    }));

    res.json(comments);
  } catch (err) {
    console.error("Error fetching user comments:", err.message);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
};

// Update an existing comment
export const updateComment = async (req, res) => {
  const userId = req.user.id;
  const { commentId } = req.params;
  const { content } = req.body;

  if (!content) return res.status(400).json({ error: "Content is required" });

  try {
    const result = await pool.query(
      `
      UPDATE comments
      SET content = $1
      WHERE id = $2 AND user_id = $3
      RETURNING id, post_id, content, created_at
      `,
      [content, commentId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Comment not found or not yours" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating comment:", err.message);
    res.status(500).json({ error: "Failed to update comment" });
  }
};

// Delete a comment
export const deleteComment = async (req, res) => {
  const userId = req.user.id;
  const { commentId } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM comments WHERE id = $1 AND user_id = $2 RETURNING id`,
      [commentId, userId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "Comment not found or not yours" });

    res.json({ success: true, id: commentId });
  } catch (err) {
    console.error("Error deleting comment:", err.message);
    res.status(500).json({ error: "Failed to delete comment" });
  }
};