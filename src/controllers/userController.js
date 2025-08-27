// src/controllers/userController.js
import pool from "../config/db.js";
import argon2 from "argon2";

// Get logged-in user's profile with their posts and like info
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
    console.error("Error updating profile:", err.message);
    res.status(500).json({ error: "Failed to update profile" });
  }
};
