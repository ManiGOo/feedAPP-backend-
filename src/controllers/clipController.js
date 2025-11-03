import pool from "../config/db.js";
import { bucket } from "../config/gcs.js";
import { v4 as uuidv4 } from "uuid";

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
  is_followed_author: clip.is_followed_author || false,
});

// -------------------------
// CREATE a new clip
// -------------------------
export const createClip = (io) => async (req, res) => {
  const { title } = req.body;
  const file = req.file; // Use req.file for upload.single("video")

  if (!title || !file) {
    console.log("Missing title or file:", { title, file, files: req.files, file: req.file });
    return res.status(400).json({ error: "Title and video file required" });
  }

  try {
    // Upload to GCS
    const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `clips/${uuidv4()}_${sanitizedFileName}`;
    console.log("Uploading to GCS:", fileName);
    const blob = bucket.file(fileName);
    const blobStream = blob.createWriteStream({
      metadata: { contentType: file.mimetype },
    });

    await new Promise((resolve, reject) => {
      blobStream.on("error", (err) => {
        console.error("GCS upload failed:", err.message);
        reject(err);
      });
      blobStream.on("finish", () => {
        console.log("GCS upload success:", fileName);
        resolve();
      });
      blobStream.end(file.buffer);
    });

    const videoUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    const client = await pool.connect();
    let newClip;
    try {
      const { rows } = await client.query(
        `INSERT INTO clips (user_id, title, video_url, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
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
    const client = await pool.connect();
    let clips;
    try {
      const { rows } = await client.query(
        `SELECT c.id, c.user_id, c.title, c.video_url, c.created_at,
                u.username, u.avatar_url,
                (SELECT COUNT(*) FROM clip_likes cl WHERE cl.clip_id = c.id) AS like_count,
                (SELECT COUNT(*) FROM clip_comments cc WHERE cc.clip_id = c.id) AS comments_count,
                EXISTS(SELECT 1 FROM clip_likes cl WHERE cl.clip_id = c.id AND cl.user_id = $1) AS liked_by_me,
                EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = c.user_id) AS is_followed_author
         FROM clips c
         JOIN users u ON u.id = c.user_id
         ORDER BY c.created_at DESC`,
        [req.user?.id || 0]
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
    const client = await pool.connect();
    let like_count;
    try {
      await client.query(
        `INSERT INTO clip_likes (user_id, clip_id, created_at)
         VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
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

    io.emit("clipLiked", { clipId, userId: req.user.id, like_count, liked: true });
    res.json({ clipId, like_count, liked_by_me: true });
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
    const client = await pool.connect();
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

    io.emit("clipLiked", { clipId, userId: req.user.id, like_count, liked: false });
    res.json({ clipId, like_count, liked_by_me: false });
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
    const client = await pool.connect();
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
        id: comment.id,
        clip_id: comment.clip_id,
        user_id: comment.user_id,
        username: userRows[0].username,
        avatar_url: userRows[0].avatar_url || "/default-avatar.png",
        content: comment.content,
        created_at: comment.created_at,
      };
    } finally {
      client.release();
    }

    io.emit("newClipComment", newComment);
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
    const client = await pool.connect();
    let comments;
    try {
      const { rows } = await client.query(
        `SELECT cc.id, cc.clip_id, cc.user_id, cc.content, cc.created_at,
                u.username, u.avatar_url
         FROM clip_comments cc
         JOIN users u ON u.id = cc.user_id
         WHERE cc.clip_id = $1
         ORDER BY cc.created_at ASC`,
        [clipId]
      );

      comments = rows.map((c) => ({
        id: c.id,
        clip_id: c.clip_id,
        user_id: c.user_id,
        username: c.username,
        avatar_url: c.avatar_url || "/default-avatar.png",
        content: c.content,
        created_at: c.created_at,
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

// -------------------------
// DELETE a clip
// -------------------------
export const deleteClip = (io) => async (req, res) => {
  const { clipId } = req.params;
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT user_id, video_url FROM clips WHERE id=$1`,
        [clipId]
      );
      if (!rows.length || rows[0].user_id !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized or clip not found" });
      }

      const videoUrl = rows[0].video_url;
      if (videoUrl) {
        try {
          const fileName = videoUrl.split(`https://storage.googleapis.com/${bucket.name}/`)[1];
          await bucket.file(fileName).delete();
          console.log(`Deleted GCS file: ${fileName}`);
        } catch (err) {
          console.warn("Failed to delete media from GCS:", err.message);
        }
      }

      await client.query("DELETE FROM clip_likes WHERE clip_id=$1", [clipId]);
      await client.query("DELETE FROM clip_comments WHERE clip_id=$1", [clipId]);
      await client.query("DELETE FROM clips WHERE id=$1", [clipId]);

      io.emit("clipDeleted", { clipId });
      res.json({ clipId });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("❌ Error deleting clip:", err.message);
    res.status(500).json({ error: "Failed to delete clip" });
  }
};

export const getClipById = async (req, res) => {
  const { clipId } = req.params;
  const viewerId = req.user?.id || 0;

  try {
    const { rows } = await pool.query(
      `SELECT 
         c.id, c.user_id, c.title, c.video_url, c.created_at,
         u.username, u.avatar_url,
         (SELECT COUNT(*) FROM clip_likes cl WHERE cl.clip_id = c.id) AS like_count,
         (SELECT COUNT(*) FROM clip_comments cc WHERE cc.clip_id = c.id) AS comments_count,
         EXISTS(SELECT 1 FROM clip_likes cl WHERE cl.clip_id = c.id AND cl.user_id = $1) AS liked_by_me,
         EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = c.user_id) AS is_followed_author
       FROM clips c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $2`,
      [viewerId, clipId]
    );

    if (rows.length === 0) return res.status(404).json({ error: "Clip not found" });

    const clip = rows[0];
    res.json({
      id: clip.id,
      title: clip.title,
      video_url: clip.video_url,
      created_at: clip.created_at,
      author_id: clip.user_id,
      author: clip.username,
      avatar_url: clip.avatar_url || "/default-avatar.png",
      like_count: parseInt(clip.like_count),
      comments_count: parseInt(clip.comments_count),
      liked_by_me: clip.liked_by_me,
      is_followed_author: clip.is_followed_author,
    });
  } catch (err) {
    console.error("getClipById error:", err);
    res.status(500).json({ error: "Failed to fetch clip" });
  }
};