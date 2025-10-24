import pool from "../config/db.js";
import argon2 from "argon2";
import { bucket } from "../config/gcs.js"; // Import GCS bucket configuration
import { v4 as uuidv4 } from "uuid";

// Helper to fetch posts by a user with likes and comments
const getPostsByUser = async (userId, currentUserId) => {
  const postsResult = await pool.query(
    `
    SELECT 
      p.id,
      p.user_id AS author_id,
      u.username AS author,
      u.avatar_url AS author_avatar,
      p.content,
      p.created_at,
      p.media_type,
      p.media_url,
      COUNT(l.user_id) AS like_count,
      BOOL_OR(l.user_id = $1) AS liked_by_me
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN likes l ON l.post_id = p.id
    WHERE p.user_id = $2
    GROUP BY p.id, u.id, u.username, u.avatar_url, p.media_type, p.media_url
    ORDER BY p.created_at DESC
    `,
    [currentUserId || 0, userId]
  );

  const posts = postsResult.rows;

  if (posts.length === 0) return posts;

  const postIds = posts.map((p) => p.id);
  const commentsRes = await pool.query(
    `
    SELECT c.id, c.content, c.created_at, c.post_id,
           u.id AS user_id, u.username, u.avatar_url
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ANY($1)
    ORDER BY c.created_at ASC
    `,
    [postIds]
  );

  const commentsByPost = {};
  commentsRes.rows.forEach((c) => {
    if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = [];
    commentsByPost[c.post_id].push({
      id: c.id,
      content: c.content,
      created_at: c.created_at,
      user_id: c.user_id,
      username: c.username,
      avatar_url: c.avatar_url,
    });
  });

  return posts.map((p) => ({
    ...p,
    comments: commentsByPost[p.id] || [],
  }));
};

// Get logged-in user's profile with posts and follow info
export const getMe = async (req, res) => {
  try {
    const userId = req.user.id;

    const commentsRes = await pool.query(
      `
      SELECT c.id, c.content, c.created_at, c.post_id,
            u.id AS user_id, u.username, u.avatar_url,
            p.content AS post_content
      FROM comments c
      JOIN users u ON c.user_id = u.id
      JOIN posts p ON c.post_id = p.id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC
      `,
      [userId]
    );

    const userResult = await pool.query(
      `SELECT id, username, email, bio, avatar_url FROM users WHERE id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = userResult.rows[0];

    const [followerRes, followingRes] = await Promise.all([
      pool.query("SELECT COUNT(*) AS followers_count FROM follows WHERE followee_id = $1", [userId]),
      pool.query("SELECT COUNT(*) AS following_count FROM follows WHERE follower_id = $1", [userId])
    ]);
    user.followersCount = parseInt(followerRes.rows[0].followers_count, 10);
    user.followingCount = parseInt(followingRes.rows[0].following_count, 10);

    const posts = await getPostsByUser(userId, userId);
    const comments = commentsRes.rows.map(c => ({
      id: c.id,
      content: c.content,
      created_at: c.created_at,
      post_id: c.post_id,
      user_id: c.user_id,
      username: c.username,
      avatar_url: c.avatar_url,
      post_content: c.post_content
    }));

    res.json({ user, posts, comments });
  } catch (err) {
    console.error("Error fetching profile:", err.message);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

// Update logged-in user's profile
export const updateMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const { username, email, bio, password, removeAvatar } = req.body;

    // Validate text fields
    if (username && (username.length < 3 || username.length > 30)) {
      return res.status(400).json({ error: "Username must be 3-30 characters" });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Hash password if provided
    let passwordHash;
    if (password) passwordHash = await argon2.hash(password);

    // Handle avatar upload or removal
    let avatar_url;
    if (req.file) {
      // Upload new avatar to GCS
      const sanitizedFileName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
      const fileName = `avatars/${uuidv4()}_${sanitizedFileName}`;
      console.log("Uploading to GCS:", fileName);
      const blob = bucket.file(fileName);
      const blobStream = blob.createWriteStream({
        metadata: { contentType: req.file.mimetype },
      });

      try {
        await new Promise((resolve, reject) => {
          blobStream.on("error", (err) => {
            console.error("GCS upload failed:", err.message);
            reject(err);
          });
          blobStream.on("finish", () => {
            console.log("GCS upload success:", fileName);
            resolve();
          });
          blobStream.end(req.file.buffer);
        });
        avatar_url = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      } catch (err) {
        console.error("GCS upload error:", err.message);
        return res.status(500).json({ error: `Failed to upload avatar to GCS: ${err.message}` });
      }
    } else if (removeAvatar === "true") {
      // Delete existing avatar from GCS if it exists
      const currentUser = await pool.query(
        "SELECT avatar_url FROM users WHERE id = $1",
        [userId]
      );
      if (currentUser.rows[0]?.avatar_url) {
        const fileName = currentUser.rows[0].avatar_url.split(`${bucket.name}/`)[1];
        try {
          await bucket.file(fileName).delete();
          console.log("Deleted GCS avatar:", fileName);
        } catch (err) {
          console.error("Failed to delete GCS avatar:", err.message);
        }
      }
      avatar_url = null;
    }

    // Build update query dynamically
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

    values.push(userId);

    const result = await pool.query(
      `UPDATE users 
       SET ${fields.join(", ")} 
       WHERE id = $${index} 
       RETURNING id, username, email, bio, avatar_url`,
      values
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Error updating profile:", err.stack);
    if (err.code === "23505") {
      return res.status(400).json({ error: "Username or email already taken" });
    }
    res.status(500).json({ error: `Failed to update profile: ${err.message}` });
  }
};

// Fetch any user's profile by ID
export const getUserProfile = async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const profileId = req.params.id;

    const userResult = await pool.query(
      "SELECT id, username, bio, avatar_url FROM users WHERE id = $1",
      [profileId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = userResult.rows[0];

    const [followerRes, followingRes] = await Promise.all([
      pool.query("SELECT COUNT(*) AS followers_count FROM follows WHERE followee_id = $1", [profileId]),
      pool.query("SELECT COUNT(*) AS following_count FROM follows WHERE follower_id = $1", [profileId])
    ]);
    const followersCount = parseInt(followerRes.rows[0].followers_count, 10);
    const followingCount = parseInt(followingRes.rows[0].following_count, 10);

    let isFollowedByMe = false;
    if (currentUserId) {
      const followRes = await pool.query(
        "SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2",
        [currentUserId, profileId]
      );
      isFollowedByMe = followRes.rows.length > 0;
    }

    const posts = await getPostsByUser(profileId, currentUserId);

    const commentsRes = await pool.query(
      `
      SELECT c.id, c.content, c.created_at, c.post_id,
             u.id AS user_id, u.username, u.avatar_url,
             p.content AS post_content
      FROM comments c
      JOIN users u ON c.user_id = u.id
      JOIN posts p ON c.post_id = p.id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC
      `,
      [profileId]
    );

    const comments = commentsRes.rows.map(c => ({
      id: c.id,
      content: c.content,
      created_at: c.created_at,
      post_id: c.post_id,
      user_id: c.user_id,
      username: c.username,
      avatar_url: c.avatar_url,
      post_content: c.post_content
    }));

    res.json({
      user: { ...user, followersCount, followingCount, isFollowedByMe },
      posts,
      comments
    });
  } catch (err) {
    console.error("Error fetching user profile:", err.stack);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

// Search users by username
export const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q?.trim()) return res.json([]);

    const currentUserId = req.user?.id;
    const { rows } = await pool.query(
      `
      SELECT id, username, avatar_url, bio,
             (SELECT COUNT(*) FROM follows WHERE followee_id = u.id) AS followers_count,
             (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) AS following_count,
             EXISTS (
               SELECT 1 FROM follows 
               WHERE follower_id = $2 AND followee_id = u.id
             ) AS is_followed_by_me
      FROM users u
      WHERE username ILIKE $1 AND id != $2
      ORDER BY username ASC
      LIMIT 20
      `,
      [`%${q}%`, currentUserId || 0]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error searching users:", err.stack);
    res.status(500).json({ error: "Failed to search users" });
  }
};