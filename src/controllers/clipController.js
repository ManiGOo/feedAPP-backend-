// src/controllers/clipController.js
import db from "../config/db.js";

import cloudinary from "../config/cloudinary.js";

// Helper to normalize clip object for frontend
const buildClip = (clip, user, like_count = 0, comments_count = 0) => ({
  id: clip.id,
  title: clip.title,
  video_url: clip.video_url || clip.url,
  created_at: clip.created_at,
  author_id: clip.user_id,
  author: user.username,
  avatar_url: user.avatar_url || "/default-avatar.png",
  like_count,
  comments_count,
  liked_by_me: clip.liked_by_me || false,
});

// -------------------------
// CREATE a new clip
// -------------------------
export const createClip = (io) => async (req, res) => {
  const { title } = req.body;
  const file = req.file; // from multer or other middleware

  if (!title || !file) {
    return res.status(400).json({ error: "Title and video file required" });
  }

  try {
    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "clips", resource_type: "video" },
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      );
      stream.end(file.buffer); // multer memory storage
    });

    const videoUrl = uploadResult.secure_url;

    const client = await db.connect();
    let newClip;
    try {
      const { rows } = await client.query(
        `INSERT INTO clips (user_id, title, video_url, created_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING *`,
        [req.user.id, title, videoUrl]
      );

      const clip = rows[0];

      const { rows: userRows } = await client.query(
        `SELECT username, avatar_url FROM users WHERE id=$1`,
        [req.user.id]
      );

      newClip = buildClip(clip, userRows[0]);
    } finally {
      client.release();
    }

    io.emit("newClip", newClip);
    res.status(201).json(newClip);
  } catch (err) {
    console.error("❌ Error creating clip:", err.message);
    res.status(500).json({ error: "Failed to create clip" });
  }
};

// -------------------------
// GET all clips
// -------------------------
export const getClips = async (req, res) => {
  try {
    const client = await db.connect();
    let clips;
    try {
      const { rows } = await client.query(
        `SELECT c.id, c.user_id, c.title, c.video_url, c.created_at,
                u.username, u.avatar_url,
                (SELECT COUNT(*) FROM clip_likes cl WHERE cl.clip_id = c.id) AS like_count,
                (SELECT COUNT(*) FROM clip_comments cc WHERE cc.clip_id = c.id) AS comments_count
         FROM clips c
         JOIN users u ON u.id = c.user_id
         ORDER BY c.created_at DESC`
      );

      clips = rows.map((row) =>
        buildClip(
          row,
          { username: row.username, avatar_url: row.avatar_url },
          parseInt(row.like_count, 10),
          parseInt(row.comments_count, 10)
        )
      );
    } finally {
      client.release();
    }

    res.json(clips);
  } catch (err) {
    console.error("❌ Error fetching clips:", err.message);
    res.status(500).json({ error: "Failed to fetch clips" });
  }
};

// -------------------------
// LIKE a clip
// -------------------------
export const likeClip = (io) => async (req, res) => {
  const { clipId } = req.params;
  try {
    const client = await db.connect();
    let like_count;
    try {
      await client.query(
        `INSERT INTO clip_likes (user_id, clip_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.user.id, clipId]
      );

      const { rows } = await client.query(
        `SELECT COUNT(*) AS like_count FROM clip_likes WHERE clip_id=$1`,
        [clipId]
      );
      like_count = parseInt(rows[0].like_count, 10);
    } finally {
      client.release();
    }

    io.emit("clipLiked", { clipId, userId: req.user.id, like_count });
    res.json({ clipId, like_count });
  } catch (err) {
    console.error("❌ Error liking clip:", err.message);
    res.status(500).json({ error: "Failed to like clip" });
  }
};

// -------------------------
// UNLIKE a clip
// -------------------------
export const unlikeClip = (io) => async (req, res) => {
  const { clipId } = req.params;
  if (!clipId) return res.status(400).json({ error: "Clip ID required" });

  try {
    const client = await db.connect();
    let like_count;
    try {
      await client.query(
        `DELETE FROM clip_likes WHERE user_id=$1 AND clip_id=$2`,
        [req.user.id, clipId]
      );

      const { rows } = await client.query(
        `SELECT COUNT(*) AS like_count FROM clip_likes WHERE clip_id=$1`,
        [clipId]
      );
      like_count = parseInt(rows[0].like_count, 10);
    } finally {
      client.release();
    }

    io.emit("clipLiked", { clipId, userId: req.user.id, like_count });
    res.json({ clipId, like_count });
  } catch (err) {
    console.error("❌ Error unliking clip:", err.message);
    res.status(500).json({ error: "Failed to unlike clip" });
  }
};

// -------------------------
// COMMENT on a clip
// -------------------------
export const commentClip = (io) => async (req, res) => {
  const { clipId } = req.params;
  const { content } = req.body;
  if (!clipId || !content?.trim()) return res.status(400).json({ error: "Clip ID and content required" });

  try {
    const client = await db.connect();
    let newComment;
    try {
      const { rows } = await client.query(
        `INSERT INTO clip_comments (clip_id, user_id, content, created_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, clip_id, user_id, content, created_at`,
        [clipId, req.user.id, content.trim()]
      );
      const comment = rows[0];

      const { rows: userRows } = await client.query(
        `SELECT username, avatar_url FROM users WHERE id=$1`,
        [req.user.id]
      );

      newComment = {
        ...comment,
        username: userRows[0].username,
        avatar_url: userRows[0].avatar_url || "/default-avatar.png",
      };
    } finally {
      client.release();
    }

    io.emit("newClipComment", { clipId, comment: newComment });
    res.status(201).json(newComment);
  } catch (err) {
    console.error("❌ Error commenting on clip:", err.message);
    res.status(500).json({ error: "Failed to comment on clip" });
  }
};

// -------------------------
// GET all comments for a clip
// -------------------------
export const getClipComments = async (req, res) => {
  const { clipId } = req.params;
  if (!clipId) return res.status(400).json({ error: "Clip ID required" });

  try {
    const client = await db.connect();
    let comments;
    try {
      const { rows } = await client.query(
        `SELECT cc.id, cc.content, cc.created_at,
                u.username, u.avatar_url
         FROM clip_comments cc
         JOIN users u ON u.id = cc.user_id
         WHERE cc.clip_id = $1
         ORDER BY cc.created_at ASC`,
        [clipId]
      );

      comments = rows.map((c) => ({
        ...c,
        avatar_url: c.avatar_url || "/default-avatar.png",
      }));
    } finally {
      client.release();
    }

    res.json(comments);
  } catch (err) {
    console.error("❌ Error fetching clip comments:", err.message);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
};
