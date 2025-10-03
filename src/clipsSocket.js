// src/sockets/clipsSocket.js
import pool from "./config/db.js";

export default (socket, io) => {
  // -------------------------
  // Create Clip
  // -------------------------
  socket.on("createClip", async ({ title, video_url }, callback) => {
    if (!video_url) return callback({ error: "Video URL is required" });

    try {
      const { rows } = await pool.query(
        `INSERT INTO clips (user_id, title, video_url)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, title, video_url, created_at`,
        [socket.user.id, title || null, video_url]
      );

      const newClip = rows[0];

      // Emit to all users (or filter per feed)
      io.emit("newClip", newClip);
      callback(newClip);
    } catch (err) {
      console.error("❌ Socket createClip error:", err.message);
      callback({ error: "Failed to create clip" });
    }
  });

  // -------------------------
  // Like / Unlike Clip
  // -------------------------
  socket.on("toggleClipLike", async ({ clipId }, callback) => {
    if (!clipId) return callback({ error: "Clip ID required" });

    try {
      const { rows: existing } = await pool.query(
        `SELECT * FROM clip_likes WHERE user_id=$1 AND clip_id=$2`,
        [socket.user.id, clipId]
      );

      let liked = false;
      if (existing.length) {
        await pool.query(`DELETE FROM clip_likes WHERE user_id=$1 AND clip_id=$2`, [socket.user.id, clipId]);
      } else {
        await pool.query(`INSERT INTO clip_likes (user_id, clip_id) VALUES ($1, $2)`, [socket.user.id, clipId]);
        liked = true;
      }

      const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM clip_likes WHERE clip_id=$1`, [clipId]);
      const like_count = parseInt(rows[0].count, 10);

      // Broadcast to all clients
      io.emit("clipLiked", { clipId, liked, like_count, userId: socket.user.id });
      callback({ clipId, liked, like_count });
    } catch (err) {
      console.error("❌ Socket toggleClipLike error:", err.message);
      callback({ error: "Failed to toggle like" });
    }
  });

  // -------------------------
  // Comment on Clip
  // -------------------------
  socket.on("createClipComment", async ({ clipId, content }, callback) => {
    if (!clipId || !content?.trim()) return callback({ error: "Clip ID and content required" });

    try {
      const { rows: clipRows } = await pool.query(`SELECT id FROM clips WHERE id=$1`, [clipId]);
      if (!clipRows.length) return callback({ error: "Clip not found" });

      const { rows } = await pool.query(
        `INSERT INTO clip_comments (clip_id, user_id, content, created_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, clip_id, user_id, content, created_at`,
        [clipId, socket.user.id, content.trim()]
      );

      const { rows: userRows } = await pool.query(`SELECT username, avatar_url FROM users WHERE id=$1`, [socket.user.id]);
      const comment = { ...rows[0], username: userRows[0].username, avatar_url: userRows[0].avatar_url };

      io.emit("newClipComment", comment);
      callback(comment);
    } catch (err) {
      console.error("❌ Socket createClipComment error:", err.message);
      callback({ error: "Failed to create comment" });
    }
  });

  // -------------------------
  // Delete Clip
  // -------------------------
  socket.on("deleteClip", async ({ clipId }, callback) => {
    if (!clipId) return callback({ error: "Clip ID required" });

    try {
      const { rows } = await pool.query(`SELECT user_id FROM clips WHERE id=$1`, [clipId]);
      if (!rows.length || rows[0].user_id !== socket.user.id)
        return callback({ error: "Clip not found or unauthorized" });

      await pool.query("DELETE FROM clip_likes WHERE clip_id=$1", [clipId]);
      await pool.query("DELETE FROM clip_comments WHERE clip_id=$1", [clipId]);
      await pool.query("DELETE FROM clips WHERE id=$1", [clipId]);

      io.emit("clipDeleted", { clipId });
      callback({ clipId });
    } catch (err) {
      console.error("❌ Socket deleteClip error:", err.message);
      callback({ error: "Failed to delete clip" });
    }
  });
};
