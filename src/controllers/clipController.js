import pool from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

// -------------------------
// GET all clips
// -------------------------
export const getClips = async (req, res) => {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT 
        c.id, c.title, c.video_url, c.created_at,
        u.id AS author_id, u.username AS author, u.avatar_url,
        COALESCE(like_counts.count, 0) AS like_count,
        COALESCE(comment_counts.count, 0) AS comments_count,
        CASE WHEN ul.user_id IS NOT NULL THEN true ELSE false END AS liked_by_me,
        CASE WHEN f.follower_id IS NOT NULL THEN true ELSE false END AS is_followed_author
      FROM clips c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN (
        SELECT clip_id, COUNT(*) AS count
        FROM clip_likes
        GROUP BY clip_id
      ) AS like_counts ON like_counts.clip_id = c.id
      LEFT JOIN (
        SELECT clip_id, COUNT(*) AS count
        FROM clip_comments
        GROUP BY clip_id
      ) AS comment_counts ON comment_counts.clip_id = c.id
      LEFT JOIN (
        SELECT clip_id, user_id
        FROM clip_likes
        WHERE user_id = $1
      ) AS ul ON ul.clip_id = c.id
      LEFT JOIN follows f
        ON f.follower_id = $1 AND f.followee_id = c.user_id
      ORDER BY c.created_at DESC
      `,
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch clips:", err);
    res.status(500).json({ error: "Failed to fetch clips" });
  }
};

// -------------------------
// GET single clip
// -------------------------
export const getClipById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT 
        c.id, c.title, c.video_url, c.created_at,
        u.id AS author_id, u.username AS author, u.avatar_url,
        COALESCE(like_counts.count, 0) AS like_count,
        CASE WHEN ul.user_id IS NOT NULL THEN true ELSE false END AS liked_by_me,
        CASE WHEN f.follower_id IS NOT NULL THEN true ELSE false END AS is_followed_author
      FROM clips c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN (
        SELECT clip_id, COUNT(*) AS count
        FROM clip_likes
        GROUP BY clip_id
      ) AS like_counts ON like_counts.clip_id = c.id
      LEFT JOIN (
        SELECT clip_id, user_id
        FROM clip_likes
        WHERE user_id = $2
      ) AS ul ON ul.clip_id = c.id
      LEFT JOIN follows f
        ON f.follower_id = $2 AND f.followee_id = c.user_id
      WHERE c.id = $1
      `,
      [id, userId]
    );

    if (!rows.length) return res.status(404).json({ error: "Clip not found" });

    const comments = await pool.query(
      `
      SELECT cc.id, cc.content, cc.created_at,
             u.id AS user_id, u.username, u.avatar_url
      FROM clip_comments cc
      JOIN users u ON cc.user_id = u.id
      WHERE cc.clip_id = $1
      ORDER BY cc.created_at ASC
      `,
      [id]
    );

    res.json({ ...rows[0], comments: comments.rows });
  } catch (err) {
    console.error("Failed to fetch clip:", err);
    res.status(500).json({ error: "Failed to fetch clip" });
  }
};

// -------------------------
// CREATE new clip
// -------------------------
export const createClip = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "Video file is required" });

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "clips", resource_type: "video" },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(file.buffer);
    });

    const { rows } = await pool.query(
      `INSERT INTO clips (user_id, title, video_url)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, title, video_url, created_at`,
      [userId, title || null, uploadResult.secure_url]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Failed to create clip:", err);
    res.status(500).json({ error: "Failed to create clip" });
  }
};

// -------------------------
// LIKE/UNLIKE clip
// -------------------------
export const toggleClipLike = async (req, res) => {
  const { clipId } = req.params;
  const userId = req.user.id;

  try {
    const { rows: existing } = await pool.query(
      `SELECT * FROM clip_likes WHERE user_id=$1 AND clip_id=$2`,
      [userId, clipId]
    );

    let liked = false;

    if (existing.length) {
      await pool.query(`DELETE FROM clip_likes WHERE user_id=$1 AND clip_id=$2`, [userId, clipId]);
    } else {
      await pool.query(`INSERT INTO clip_likes (user_id, clip_id) VALUES ($1, $2)`, [userId, clipId]);
      liked = true;
    }

    const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM clip_likes WHERE clip_id=$1`, [clipId]);

    res.json({ liked, like_count: parseInt(rows[0].count) });
  } catch (err) {
    console.error("Failed to toggle like:", err);
    res.status(500).json({ error: "Failed to toggle like" });
  }
};

// -------------------------
// DELETE clip
// -------------------------
export const deleteClip = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(`SELECT video_url FROM clips WHERE id=$1 AND user_id=$2`, [id, userId]);

    if (!rows.length) return res.status(404).json({ error: "Clip not found or unauthorized" });

    const videoUrl = rows[0].video_url;

    // Remove from Cloudinary
    if (videoUrl) {
      try {
        const publicId = videoUrl.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(`clips/${publicId}`, { resource_type: "video" });
      } catch (err) {
        console.warn("Cloudinary deletion failed:", err.message);
      }
    }

    await pool.query("DELETE FROM clip_likes WHERE clip_id=$1", [id]);
    await pool.query("DELETE FROM clip_comments WHERE clip_id=$1", [id]);
    await pool.query("DELETE FROM clips WHERE id=$1", [id]);

    res.json({ message: "Clip deleted successfully", clipId: id });
  } catch (err) {
    console.error("Failed to delete clip:", err);
    res.status(500).json({ error: "Failed to delete clip" });
  }
};

// -------------------------
// GET comments for a clip
// -------------------------
export const getClipComments = async (req, res) => {
  const { clipId } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT cc.id, cc.content, cc.created_at,
             u.id AS user_id, u.username, u.avatar_url
      FROM clip_comments cc
      JOIN users u ON cc.user_id = u.id
      WHERE cc.clip_id = $1
      ORDER BY cc.created_at ASC
      `,
      [clipId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch comments:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
};

// -------------------------
// CREATE comment
// -------------------------
export const createClipComment = async (req, res) => {
  const userId = req.user.id;
  const { clipId } = req.params;
  const { content } = req.body;

  if (!content?.trim()) return res.status(400).json({ error: "Comment content is required" });

  try {
    const { rows: clipRows } = await pool.query(`SELECT id FROM clips WHERE id=$1`, [clipId]);
    if (!clipRows.length) return res.status(404).json({ error: "Clip not found" });

    const { rows } = await pool.query(
      `INSERT INTO clip_comments (clip_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, clip_id, user_id, content, created_at`,
      [clipId, userId, content.trim()]
    );

    const { rows: userRows } = await pool.query(`SELECT username, avatar_url FROM users WHERE id=$1`, [userId]);
    const comment = { ...rows[0], username: userRows[0].username, avatar_url: userRows[0].avatar_url };

    res.status(201).json(comment);
  } catch (err) {
    console.error("Failed to create comment:", err);
    res.status(500).json({ error: "Failed to create comment" });
  }
};
