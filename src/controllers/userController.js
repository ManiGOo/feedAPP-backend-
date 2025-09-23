// src/controllers/userController.js
import pool from "../config/db.js";
import argon2 from "argon2";

// Helper to fetch posts by a user with like counts and liked_by_me info
const getPostsByUser = async (userId, currentUserId) => {
  const postsResult = await pool.query(
    `
    SELECT 
      p.id,
      p.user_id AS author_id,
      u.username AS author,
      p.content,
      p.created_at,
      COUNT(l.user_id) AS like_count,
      BOOL_OR(l.user_id = $1) AS liked_by_me
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN likes l ON l.post_id = p.id
    WHERE p.user_id = $2
    GROUP BY p.id, u.id, u.username
    ORDER BY p.created_at DESC
    `,
    [currentUserId || 0, userId]
  );
  return postsResult.rows;
};

// Get logged-in user's profile with their posts, likes, and follow counts
export const getMe = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch user info
    const userResult = await pool.query(
      `SELECT id, username, email, bio, avatar_url FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];

    // Fetch follower and following counts
    const followerRes = await pool.query(
      `SELECT COUNT(*) AS followers_count FROM follows WHERE followee_id = $1`,
      [userId]
    );
    const followingRes = await pool.query(
      `SELECT COUNT(*) AS following_count FROM follows WHERE follower_id = $1`,
      [userId]
    );

    user.followersCount = parseInt(followerRes.rows[0].followers_count, 10);
    user.followingCount = parseInt(followingRes.rows[0].following_count, 10);

    // Fetch user's posts with like counts and whether current user liked
    const postsResult = await pool.query(
      `
      SELECT 
        p.id,
        p.user_id AS author_id,
        u.username AS author,
        p.content,
        p.created_at,
        COUNT(l.user_id) AS like_count,
        BOOL_OR(l.user_id = $1) AS liked_by_me
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN likes l ON l.post_id = p.id
      WHERE p.user_id = $1
      GROUP BY p.id, u.id, u.username
      ORDER BY p.created_at DESC
      `,
      [userId]
    );

    const posts = postsResult.rows;

    res.json({ user, posts });
  } catch (err) {
    console.error("Error fetching profile:", err.message);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};


// Update logged-in user's profile
export const updateMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const { username, email, bio, avatar_url, password } = req.body;

    // Validation
    if (username && (username.length < 3 || username.length > 30)) {
      return res.status(400).json({ error: "Username must be 3-30 characters" });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Hash new password if provided
    let passwordHash;
    if (password) {
      passwordHash = await argon2.hash(password);
    }

    // Build dynamic update query
    const fields = [];
    const values = [];
    let index = 1;

    if (username) {
      fields.push(`username = $${index++}`);
      values.push(username);
    }
    if (email) {
      fields.push(`email = $${index++}`);
      values.push(email);
    }
    if (bio !== undefined) {
      fields.push(`bio = $${index++}`);
      values.push(bio);
    }
    if (avatar_url !== undefined) {
      fields.push(`avatar_url = $${index++}`);
      values.push(avatar_url);
    }
    if (passwordHash) {
      fields.push(`password_hash = $${index++}`);
      values.push(passwordHash);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(userId); // WHERE clause

    const result = await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${index} RETURNING id, username, email, bio, avatar_url`,
      values
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Error updating profile:", err.stack);
    res.status(500).json({ error: "Failed to update profile" });
  }
};

// Fetch any user's profile by ID
export const getUserProfile = async (req, res) => {
  try {
    const profileId = req.params.id;
    const currentUserId = req.user?.id;

    const userResult = await pool.query(
      "SELECT id, username, bio, avatar_url FROM users WHERE id = $1",
      [profileId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];

    // Count followers and following
    const [followerRes, followingRes] = await Promise.all([
      pool.query("SELECT COUNT(*) AS followers_count FROM follows WHERE followee_id = $1", [profileId]),
      pool.query("SELECT COUNT(*) AS following_count FROM follows WHERE follower_id = $1", [profileId])
    ]);

    const followersCount = parseInt(followerRes.rows[0].followers_count, 10);
    const followingCount = parseInt(followingRes.rows[0].following_count, 10);

    // Check if current user follows this profile
    let isFollowedByMe = false;
    if (currentUserId) {
      const followRes = await pool.query(
        "SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2",
        [currentUserId, profileId]
      );
      isFollowedByMe = followRes.rows.length > 0;
    }

    const posts = await getPostsByUser(profileId, currentUserId);

    res.json({
      user: { ...user, followersCount, followingCount, isFollowedByMe },
      posts
    });
  } catch (err) {
    console.error("Error fetching user profile:", err.stack);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

// Get replies made by a specific user
// Get replies made by a user along with the post info
export const getUserReplies = async (req, res) => {
  try {
    const userId = req.params.id;

    // Fetch replies with optional post info
    const repliesRes = await pool.query(
      `
      SELECT 
        r.id AS reply_id,
        r.content AS reply_content,
        r.created_at AS reply_created_at,
        r.post_id,
        p.content AS post_content,
        p.user_id AS post_author_id,
        u.username AS post_author
      FROM replies r
      LEFT JOIN posts p ON r.post_id = p.id
      LEFT JOIN users u ON p.user_id = u.id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
      `,
      [userId]
    );

    res.json({ replies: repliesRes.rows });
  } catch (err) {
    console.error("Error fetching user replies:", err.message);
    res.status(500).json({ error: "Failed to fetch replies" });
  }
};
