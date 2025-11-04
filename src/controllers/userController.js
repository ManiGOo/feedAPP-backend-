// controllers/userController.js
import pool from "../config/db.js";
import argon2 from "argon2";
import { bucket } from "../config/gcs.js";
import { v4 as uuidv4 } from "uuid";
import { getClipsByUser } from "./clipController.js";

// Helper: Get posts with full metadata
export const getPostsByUser = async (targetUserId, viewerId = 0) => {
  try {
    const result = await pool.query(
      `
      SELECT
        p.id,
        p.content,
        p.media_url,
        p.media_type,
        p.created_at,
        p.repost_from,
        p.repost_at,
        u.id AS author_id,
        u.username AS author,
        u.avatar_url AS author_avatar,
        COALESCE(lc.count, 0) AS like_count,
        COALESCE(cc.count, 0) AS comments_count,
        COALESCE(rc.count, 0) AS repost_count,
        (l.user_id = $2) AS liked_by_me,
        (r.user_id = $2) AS reposted_by_me,
        (f.follower_id = $2) AS is_followed_author,
        ru.username AS repost_from_user,
        ru.id AS repost_from_id
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN likes l ON l.post_id = p.id AND l.user_id = $2
      LEFT JOIN posts r ON r.repost_from = p.id AND r.user_id = $2
      LEFT JOIN follows f ON f.follower_id = $2 AND f.followee_id = p.user_id
      LEFT JOIN users ru ON p.repost_from IS NOT NULL
        AND ru.id = (SELECT user_id FROM posts WHERE id = p.repost_from)
      LEFT JOIN (SELECT post_id, COUNT(*) FROM likes GROUP BY post_id) lc ON lc.post_id = p.id
      LEFT JOIN (SELECT post_id, COUNT(*) FROM comments GROUP BY post_id) cc ON cc.post_id = p.id
      LEFT JOIN (SELECT repost_from, COUNT(*) FROM posts WHERE repost_from IS NOT NULL GROUP BY repost_from) rc ON rc.repost_from = p.id
      WHERE p.user_id = $1
      GROUP BY p.id, u.id, ru.id, l.user_id, r.user_id, f.follower_id, lc.count, cc.count, rc.count
      ORDER BY p.created_at DESC
      `,
      [targetUserId, viewerId]
    );

    return result.rows.map(p => ({
      ...p,
      image: p.media_type === "image" ? p.media_url : null,
      video: p.media_type === "video" ? p.media_url : null,
      bookmark_count: 0,
      bookmarked_by_me: false,
    }));
  } catch (err) {
    console.error("getPostsByUser error:", err);
    return [];
  }
};

// Get Bookmarks (only for own profile)
export const getBookmarksByUser = async (targetUserId, viewerId = 0) => {
  try {
    const result = await pool.query(
      `
      SELECT
        p.id,
        p.content,
        p.media_url,
        p.media_type,
        p.created_at,
        p.repost_from,
        p.repost_at,
        u.id AS author_id,
        u.username AS author,
        u.avatar_url AS author_avatar,
        COALESCE(lc.count, 0) AS like_count,
        COALESCE(cc.count, 0) AS comments_count,
        COALESCE(rc.count, 0) AS repost_count,
        (l.user_id = $2) AS liked_by_me,
        (r.user_id = $2) AS reposted_by_me,
        (f.follower_id = $2) AS is_followed_author,
        ru.username AS repost_from_user,
        ru.id AS repost_from_id,
        TRUE AS bookmarked_by_me,
        b.created_at AS bookmark_created_at
      FROM bookmarks b
      JOIN posts p ON b.post_id = p.id
      JOIN users u ON p.user_id = u.id
      LEFT JOIN likes l ON l.post_id = p.id AND l.user_id = $2
      LEFT JOIN posts r ON r.repost_from = p.id AND r.user_id = $2
      LEFT JOIN follows f ON f.follower_id = $2 AND f.followee_id = p.user_id
      LEFT JOIN users ru ON p.repost_from IS NOT NULL
        AND ru.id = (SELECT user_id FROM posts WHERE id = p.repost_from)
      LEFT JOIN (SELECT post_id, COUNT(*) FROM likes GROUP BY post_id) lc ON lc.post_id = p.id
      LEFT JOIN (SELECT post_id, COUNT(*) FROM comments GROUP BY post_id) cc ON cc.post_id = p.id
      LEFT JOIN (SELECT repost_from, COUNT(*) FROM posts WHERE repost_from IS NOT NULL GROUP BY repost_from) rc ON rc.repost_from = p.id
      WHERE b.user_id = $1
      GROUP BY 
        p.id, u.id, ru.id, l.user_id, r.user_id, f.follower_id, 
        lc.count, cc.count, rc.count, b.created_at
      ORDER BY b.created_at DESC
      `,
      [targetUserId, viewerId]
    );

    return result.rows.map(p => ({
      ...p,
      image: p.media_type === "image" ? p.media_url : null,
      video: p.media_type === "video" ? p.media_url : null,
      bookmark_count: 0,
      bookmarked_by_me: true,
    }));
  } catch (err) {
    console.error("getBookmarksByUser error:", err);
    return [];
  }
};

// GET /me
export const getMe = async (req, res) => {
  const userId = req.user.id;
  try {
    const [userRes, followerRes, followingRes, commentsRes] = await Promise.all([
      pool.query(`SELECT id, username, email, bio, avatar_url FROM users WHERE id = $1`, [userId]),
      pool.query("SELECT COUNT(*) FROM follows WHERE followee_id = $1", [userId]),
      pool.query("SELECT COUNT(*) FROM follows WHERE follower_id = $1", [userId]),
      pool.query(
        `SELECT c.id, c.content, c.created_at, c.post_id,
                u.username, u.avatar_url,
                p.content AS post_content
         FROM comments c
         JOIN users u ON c.user_id = u.id
         JOIN posts p ON c.post_id = p.id
         WHERE c.user_id = $1
         ORDER BY c.created_at DESC`,
        [userId]
      ),
    ]);

    if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const user = {
      ...userRes.rows[0],
      followersCount: parseInt(followerRes.rows[0].count),
      followingCount: parseInt(followingRes.rows[0].count),
    };

    const [posts, clips, bookmarks] = await Promise.all([
      getPostsByUser(userId, userId),
      getClipsByUser(userId, userId),
      getBookmarksByUser(userId, userId),
    ]);

    const comments = commentsRes.rows;

    res.json({ user, posts, clips, comments, bookmarks });
  } catch (err) {
    console.error("getMe error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

// UPDATE /me
export const updateMe = async (req, res) => {
  const userId = req.user.id;
  const { username, email, bio, password, removeAvatar } = req.body;

  try {
    if (username && (username.length < 3 || username.length > 30))
      return res.status(400).json({ error: "Username must be 3-30 characters" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: "Invalid email" });

    let avatar_url = undefined;
    if (req.files?.avatar?.[0]) {
      const file = req.files.avatar[0];
      const ext = file.originalname.split(".").pop().toLowerCase();
      const fileName = `avatars/${uuidv4()}_${Date.now()}.${ext}`;
      const blob = bucket.file(fileName);
      await new Promise((resolve, reject) => {
        blob.createWriteStream({ metadata: { contentType: file.mimetype } })
          .on("error", reject)
          .on("finish", resolve)
          .end(file.buffer);
      });
      avatar_url = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    } else if (removeAvatar === "true") {
      const current = await pool.query("SELECT avatar_url FROM users WHERE id = $1", [userId]);
      if (current.rows[0]?.avatar_url) {
        const fileName = current.rows[0].avatar_url.split(`/${bucket.name}/`)[1];
        if (fileName) await bucket.file(fileName).delete().catch(() => {});
      }
      avatar_url = null;
    }

    const fields = [];
    const values = [];
    let i = 1;
    if (username) { fields.push(`username = $${i++}`); values.push(username); }
    if (email) { fields.push(`email = $${i++}`); values.push(email); }
    if (bio !== undefined) { fields.push(`bio = $${i++}`); values.push(bio); }
    if (avatar_url !== undefined) { fields.push(`avatar_url = $${i++}`); values.push(avatar_url); }
    if (password) {
      const hash = await argon2.hash(password);
      fields.push(`password_hash = $${i++}`);
      values.push(hash);
    }

    if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });

    values.push(userId);
    const result = await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${i} RETURNING id, username, email, bio, avatar_url`,
      values
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("updateMe error:", err);
    if (err.code === "23505") return res.status(400).json({ error: "Username or email already taken" });
    res.status(500).json({ error: "Failed to update profile" });
  }
};

// Repost
export const repost = async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    const original = await pool.query("SELECT * FROM posts WHERE id = $1", [postId]);
    if (original.rows.length === 0) return res.status(404).json({ error: "Post not found" });
    if (original.rows[0].user_id === userId)
      return res.status(400).json({ error: "Cannot repost your own post" });

    const exists = await pool.query(
      "SELECT 1 FROM posts WHERE user_id = $1 AND repost_from = $2",
      [userId, postId]
    );
    if (exists.rows.length > 0) return res.status(400).json({ error: "Already reposted" });

    const result = await pool.query(
      `INSERT INTO posts (user_id, content, media_url, media_type, repost_from, repost_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, created_at`,
      [
        userId,
        original.rows[0].content,
        original.rows[0].media_url,
        original.rows[0].media_type,
        postId,
      ]
    );

    res.json({ repost: result.rows[0] });
  } catch (err) {
    console.error("Repost error:", err);
    res.status(500).json({ error: "Failed to repost" });
  }
};

export const undoRepost = async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    const repost = await pool.query(
      "SELECT id FROM posts WHERE user_id = $1 AND repost_from = $2",
      [userId, postId]
    );
    if (repost.rows.length === 0) return res.status(404).json({ error: "Repost not found" });

    await pool.query("DELETE FROM posts WHERE id = $1", [repost.rows[0].id]);
    res.json({ message: "Repost removed" });
  } catch (err) {
    console.error("Undo repost error:", err);
    res.status(500).json({ error: "Failed to undo repost" });
  }
};

// GET /profile/:id
export const getUserProfile = async (req, res) => {
  const profileId = req.params.id;
  const viewerId = req.user?.id || 0;

  try {
    const [userRes, followerRes, followingRes, followCheck, commentsRes] = await Promise.all([
      pool.query(`SELECT id, username, bio, avatar_url FROM users WHERE id = $1`, [profileId]),
      pool.query("SELECT COUNT(*) FROM follows WHERE followee_id = $1", [profileId]),
      pool.query("SELECT COUNT(*) FROM follows WHERE follower_id = $1", [profileId]),
      viewerId ? pool.query("SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2", [viewerId, profileId]) : Promise.resolve({ rows: [] }),
      pool.query(
        `SELECT c.id, c.content, c.created_at, c.post_id,
                u.username, u.avatar_url,
                p.content AS post_content
         FROM comments c
         JOIN users u ON c.user_id = u.id
         JOIN posts p ON c.post_id = p.id
         WHERE c.user_id = $1
         ORDER BY c.created_at DESC`,
        [profileId]
      ),
    ]);

    if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const user = {
      ...userRes.rows[0],
      followersCount: parseInt(followerRes.rows[0].count),
      followingCount: parseInt(followingRes.rows[0].count),
      isFollowedByMe: followCheck.rows.length > 0,
    };

    const [posts, clips] = await Promise.all([
      getPostsByUser(profileId, viewerId),
      getClipsByUser(profileId, viewerId),
    ]);

    const comments = commentsRes.rows;

    res.json({ user, posts, clips, comments });
  } catch (err) {
    console.error("getUserProfile error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

// SEARCH USERS
export const searchUsers = async (req, res) => {
  const { q } = req.query;
  const viewerId = req.user?.id || 0;

  if (!q?.trim()) return res.json([]);

  try {
    const { rows } = await pool.query(
      `
      SELECT
        u.id, u.username, u.avatar_url, u.bio,
        (SELECT COUNT(*) FROM follows WHERE followee_id = u.id) AS followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) AS following_count,
        EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = u.id) AS is_followed_by_me
      FROM users u
      WHERE u.username ILIKE $1 AND u.id != $2
      ORDER BY u.username ASC
      LIMIT 20
      `,
      [`%${q}%`, viewerId]
    );
    res.json(rows);
  } catch (err) {
    console.error("searchUsers error:", err);
    res.status(500).json({ error: "Failed to search" });
  }
};