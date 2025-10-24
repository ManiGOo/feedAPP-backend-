import pool from "./config/db.js";

export default (socket, io) => {
  // -------------------------
  // Like / Unlike Clip
  // -------------------------
  socket.on("toggleClipLike", async ({ clipId }, callback) => {
    if (!clipId) return callback({ error: "Clip ID required" });

    try {
      const client = await pool.connect();
      let like_count;
      try {
        const { rows: existing } = await client.query(
          `SELECT * FROM clip_likes WHERE user_id=$1 AND clip_id=$2`,
          [socket.user.id, clipId]
        );

        let liked = false;
        if (existing.length) {
          await client.query(`DELETE FROM clip_likes WHERE user_id=$1 AND clip_id=$2`, [socket.user.id, clipId]);
        } else {
          await client.query(
            `INSERT INTO clip_likes (user_id, clip_id, created_at) VALUES ($1, $2, NOW())`,
            [socket.user.id, clipId]
          );
          liked = true;
        }

        const { rows } = await client.query(
          `SELECT COUNT(*) AS count FROM clip_likes WHERE clip_id=$1`,
          [clipId]
        );
        like_count = parseInt(rows[0].count, 10);
      } finally {
        client.release();
      }

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
      const client = await pool.connect();
      let comment;
      try {
        const { rows: clipRows } = await client.query(`SELECT id FROM clips WHERE id=$1`, [clipId]);
        if (!clipRows.length) return callback({ error: "Clip not found" });

        const { rows } = await client.query(
          `INSERT INTO clip_comments (clip_id, user_id, content, created_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, clip_id, user_id, content, created_at`,
          [clipId, socket.user.id, content.trim()]
        );

        const { rows: userRows } = await client.query(
          `SELECT username, avatar_url FROM users WHERE id=$1`,
          [socket.user.id]
        );

        comment = { ...rows[0], username: userRows[0].username, avatar_url: userRows[0].avatar_url || "/default-avatar.png" };
      } finally {
        client.release();
      }

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
      const client = await pool.connect();
      try {
        const { rows } = await client.query(`SELECT user_id, video_url FROM clips WHERE id=$1`, [clipId]);
        if (!rows.length || rows[0].user_id !== socket.user.id) {
          return callback({ error: "Clip not found or unauthorized" });
        }

        const videoUrl = rows[0].video_url;
        if (videoUrl) {
          try {
            const fileName = videoUrl.split(`https://storage.googleapis.com/feed-assets-2025-oct/`)[1];
            const { bucket } = await import("./config/gcs.js");
            await bucket.file(fileName).delete();
            console.log(`Deleted GCS file: ${fileName}`);
          } catch (err) {
            console.warn("Failed to delete media from GCS:", err.message);
          }
        }

        await client.query("DELETE FROM clip_likes WHERE clip_id=$1", [clipId]);
        await client.query("DELETE FROM clip_comments WHERE clip_id=$1", [clipId]);
        await client.query("DELETE FROM clips WHERE id=$1", [clipId]);
      } finally {
        client.release();
      }

      io.emit("clipDeleted", { clipId });
      callback({ clipId });
    } catch (err) {
      console.error("❌ Socket deleteClip error:", err.message);
      callback({ error: "Failed to delete clip" });
    }
  });
};