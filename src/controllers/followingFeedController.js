import pool from "../config/db.js";

export const getFollowingPosts = async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
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
        CASE WHEN follows.follower_id IS NULL THEN false ELSE true END AS is_followed_author
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
      LEFT JOIN follows ON follows.follower_id = $1 AND follows.following_id = p.user_id
      WHERE p.user_id IN (
        SELECT following_id 
        FROM follows 
        WHERE follower_id = $1
      )
      ORDER BY p.created_at DESC
      `,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching following posts:", err);
    res.status(500).json({ error: "Failed to fetch following posts" });
  }
};
