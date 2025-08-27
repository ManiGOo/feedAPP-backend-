// src/controllers/followingFeedController.js
import pool from "../config/db.js";

export const getFollowingPosts = async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `
      SELECT 
        p.id,
        p.content,
        p.created_at,
        u.id AS author_id,
        u.username AS author,
        u.avatar_url,
        COUNT(l.id) AS like_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN likes l ON p.id = l.post_id
      WHERE p.user_id IN (
          SELECT following_id 
          FROM follows 
          WHERE follower_id = $1
      )
      GROUP BY p.id, u.id, u.username, u.avatar_url
      ORDER BY p.created_at DESC
      `,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch following posts" });
  }
};
