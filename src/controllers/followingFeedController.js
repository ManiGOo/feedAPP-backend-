// src/controllers/followingFeedController.js
import pool from "../config/db.js";

// Get posts from users the current user follows
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
      WHERE p.user_id IN (
        SELECT followee_id
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

// Toggle follow/unfollow a user
export const toggleFollow = async (req, res) => {
  const followerId = req.user.id;
  const followeeId = parseInt(req.params.userId);

  if (followerId === followeeId) {
    return res.status(400).json({ error: "You cannot follow yourself." });
  }

  try {
    // Check if already following
    const existing = await pool.query(
      `SELECT * FROM follows WHERE follower_id = $1 AND followee_id = $2`,
      [followerId, followeeId]
    );

    let isFollowing = false;

    if (existing.rows.length > 0) {
      // Unfollow
      await pool.query(
        `DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`,
        [followerId, followeeId]
      );
    } else {
      // Follow
      await pool.query(
        `INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)`,
        [followerId, followeeId]
      );
      isFollowing = true;
    }

    res.json({ success: true, isFollowing });
  } catch (err) {
    console.error("Error toggling follow:", err);
    res.status(500).json({ error: "Failed to toggle follow" });
  }
};

export const getFollowers = async (req, res) => {
  const viewerId = req.user.id;  // Current viewer for followed_by_me
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  try {
    const result = await pool.query(
      `
      SELECT u.id, u.username, u.avatar_url,
        CASE WHEN f2.follower_id IS NOT NULL THEN true ELSE false END AS followed_by_me
      FROM follows f
      JOIN users u ON f.follower_id = u.id
      LEFT JOIN follows f2
        ON f2.follower_id = $1 AND f2.followee_id = u.id
      WHERE f.followee_id = $2
      `,
      [viewerId, userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching followers:", err);
    res.status(500).json({ error: "Failed to fetch followers" });
  }
};

// Get list of following for a user
export const getFollowing = async (req, res) => {
  const viewerId = req.user.id;  // Current viewer for followed_by_me
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  try {
    const result = await pool.query(
      `
      SELECT u.id, u.username, u.avatar_url,
        CASE WHEN f2.follower_id IS NOT NULL THEN true ELSE false END AS followed_by_me
      FROM follows f
      JOIN users u ON f.followee_id = u.id
      LEFT JOIN follows f2
        ON f2.follower_id = $1 AND f2.followee_id = u.id
      WHERE f.follower_id = $2
      `,
      [viewerId, userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching following:", err);
    res.status(500).json({ error: "Failed to fetch following" });
  }
};

// Search among users the current user follows by exact or partial username
export const searchFollowingByUsername = async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const followerId = parseInt(req.user.id, 10);  // Ensure int
  if (isNaN(followerId) || followerId <= 0) {
    return res.status(400).json({ error: "Invalid authenticated user ID" });
  }
  const { q } = req.query;
  if (!q || typeof q !== 'string' || q.trim().length < 1) {
    return res.json([]);  // Or 400 if strict
  }

  try {
    const result = await pool.query(
      `
      SELECT u.id, u.username, u.avatar_url
      FROM follows f
      JOIN users u ON f.followee_id = u.id
      WHERE f.follower_id = $1
        AND u.username ILIKE $2
      LIMIT 20
      `,
      [followerId, `%${q.trim()}%`]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error searching following users:", err);
    res.status(500).json({ error: "Failed to search following users" });
  }
};