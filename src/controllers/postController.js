// controllers/postController.js
import pool from "../config/db.js";
import { bucket } from "../config/gcs.js";
import { v4 as uuidv4 } from "uuid";

/* ==============================================================
   HELPER: GET POSTS WITH FULL STATS (NO LIMIT)
   ============================================================== */
const getPostsWithStats = async (filterClause, orderClause, params) => {
  const viewerId = params[params.length - 1];
  const baseParamCount = params.length - 1;
  const viewerParam = `$${baseParamCount + 1}`;

  const query = `
    SELECT 
      p.id,
      p.content,
      p.media_url,
      p.media_type,
      p.created_at,
      p.repost_from,
      p.repost_at,
      u.id          AS author_id,
      u.username    AS author,
      u.avatar_url  AS author_avatar,

      COALESCE(lc.count, 0)      AS like_count,
      COALESCE(cc.count, 0)      AS comments_count,
      COALESCE(rc.count, 0)      AS repost_count,
      COALESCE(bc.count, 0)      AS bookmark_count,

      (l.user_id = ${viewerParam}) AS liked_by_me,
      (r.user_id = ${viewerParam}) AS reposted_by_me,
      (b.user_id = ${viewerParam}) AS bookmarked_by_me,

      ru.username                AS repost_from_user,
      ru.id                      AS repost_from_id
    FROM posts p
    JOIN users u               ON p.user_id = u.id
    LEFT JOIN likes l          ON l.post_id = COALESCE(p.repost_from, p.id) AND l.user_id = ${viewerParam}
    LEFT JOIN posts r          ON r.repost_from = COALESCE(p.repost_from, p.id) AND r.user_id = ${viewerParam}
    LEFT JOIN bookmarks b      ON b.post_id = COALESCE(p.repost_from, p.id) AND b.user_id = ${viewerParam}
    LEFT JOIN users ru         ON p.repost_from IS NOT NULL 
                                  AND ru.id = (SELECT user_id FROM posts WHERE id = p.repost_from)
    LEFT JOIN (SELECT post_id, COUNT(*) FROM likes GROUP BY post_id) lc 
           ON lc.post_id = COALESCE(p.repost_from, p.id)
    LEFT JOIN (SELECT post_id, COUNT(*) FROM comments GROUP BY post_id) cc 
           ON cc.post_id = COALESCE(p.repost_from, p.id)
    LEFT JOIN (SELECT repost_from, COUNT(*) FROM posts WHERE repost_from IS NOT NULL GROUP BY repost_from) rc 
           ON rc.repost_from = COALESCE(p.repost_from, p.id)
    LEFT JOIN (SELECT post_id, COUNT(*) FROM bookmarks GROUP BY post_id) bc 
           ON bc.post_id = COALESCE(p.repost_from, p.id)
    ${filterClause}
    GROUP BY 
      p.id, p.content, p.media_url, p.media_type, p.created_at, p.repost_from, p.repost_at,
      u.id, u.username, u.avatar_url,
      ru.id, ru.username,
      l.user_id, r.user_id, b.user_id,
      lc.count, cc.count, rc.count, bc.count
    ${orderClause}
  `;

  try {
    const result = await pool.query(query, params);
    return result.rows.map(p => ({
      ...p,
      image: p.media_type === "image" ? p.media_url : null,
      video: p.media_type === "video" ? p.media_url : null,
    }));
  } catch (err) {
    console.error("getPostsWithStats error:", err);
    throw err;
  }
};

/* ==============================================================
   GET GLOBAL FEED — ALL POSTS (NO LIMIT)
   ============================================================== */
export const getPosts = async (req, res) => {
  const viewerId = req.user?.id || 0;

  try {
    const posts = await getPostsWithStats(
      `WHERE 1=1`,
      `ORDER BY GREATEST(p.created_at, COALESCE(p.repost_at, p.created_at)) DESC`, // NO LIMIT
      [viewerId]
    );
    res.json(posts);
  } catch (err) {
    console.error("getPosts error:", err);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
};

/* ==============================================================
   GET FOLLOWING FEED — ALL POSTS (NO LIMIT)
   ============================================================== */
export const getFollowingPosts = async (req, res) => {
  const viewerId = req.user?.id || 0;

  try {
    const posts = await getPostsWithStats(
      `JOIN follows f ON f.followee_id = p.user_id AND f.follower_id = $1`,
      `ORDER BY GREATEST(p.created_at, COALESCE(p.repost_at, p.created_at)) DESC`, // NO LIMIT
      [viewerId, viewerId]
    );
    res.json(posts);
  } catch (err) {
    console.error("getFollowingPosts error:", err);
    res.status(500).json({ error: "Failed to fetch following feed" });
  }
};

/* ==============================================================
   CREATE POST
   ============================================================== */
export const createPost = async (req, res) => {
  const userId = req.user.id;
  const { content = "" } = req.body;

  if (!content.trim() && !req.files?.image?.[0] && !req.files?.video?.[0]) {
    return res.status(400).json({ error: "Content or media is required" });
  }

  let mediaUrl = null;
  let mediaType = null;

  try {
    const file = req.files?.image?.[0] || req.files?.video?.[0];
    if (file) {
      const ext = file.originalname.split(".").pop().toLowerCase();
      const fileName = `posts/${uuidv4()}_${Date.now()}.${ext}`;
      const blob = bucket.file(fileName);

      await new Promise((resolve, reject) => {
        const stream = blob.createWriteStream({
          metadata: { contentType: file.mimetype },
          resumable: false,
        });
        stream.on("error", reject);
        stream.on("finish", resolve);
        stream.end(file.buffer);
      });

      mediaUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      mediaType = file.mimetype.startsWith("video/") ? "video" : "image";
    }

    const post = await pool.query(
      `INSERT INTO posts (user_id, content, media_url, media_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id, content, media_url, media_type, created_at`,
      [userId, content, mediaUrl, mediaType]
    );

    const user = await pool.query(`SELECT username, avatar_url FROM users WHERE id = $1`, [userId]);

    res.status(201).json({
      ...post.rows[0],
      author: user.rows[0].username,
      author_avatar: user.rows[0].avatar_url,
      author_id: userId,
      like_count: 0,
      liked_by_me: false,
      comments_count: 0,
      repost_count: 0,
      reposted_by_me: false,
      bookmark_count: 0,
      bookmarked_by_me: false,
    });
  } catch (err) {
    console.error("createPost error:", err);
    res.status(500).json({ error: "Failed to create post" });
  }
};

/* ==============================================================
   GET SINGLE POST
   ============================================================== */
export const getPostById = async (req, res) => {
  const { id } = req.params;
  const viewerId = req.user?.id || 0;

  try {
    const posts = await getPostsWithStats(
      `WHERE p.id = $1`,
      ``,
      [id, viewerId]
    );
    if (posts.length === 0) return res.status(404).json({ error: "Post not found" });

    const comments = await pool.query(
      `SELECT c.*, u.username, u.avatar_url 
       FROM comments c 
       JOIN users u ON c.user_id = u.id 
       WHERE c.post_id = $1 
       ORDER BY c.created_at ASC`,
      [id]
    );

    res.json({ ...posts[0], comments: comments.rows });
  } catch (err) {
    console.error("getPostById error:", err);
    res.status(500).json({ error: "Failed to fetch post" });
  }
};

/* ==============================================================
   UPDATE POST
   ============================================================== */
export const updatePost = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { content, removeMedia } = req.body;

  try {
    const post = await pool.query(
      `SELECT media_url, media_type FROM posts WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (post.rows.length === 0) return res.status(404).json({ error: "Post not found" });

    let { media_url: mediaUrl, media_type: mediaType } = post.rows[0];

    if (removeMedia === "true" && mediaUrl) {
      try {
        const fileName = mediaUrl.split(`/${bucket.name}/`)[1];
        await bucket.file(fileName).delete();
      } catch (err) {
        console.warn("GCS delete failed:", err);
      }
      mediaUrl = null;
      mediaType = null;
    }

    const file = req.files?.image?.[0] || req.files?.video?.[0];
    if (file) {
      if (mediaUrl) {
        try {
          const oldFile = mediaUrl.split(`/${bucket.name}/`)[1];
          await bucket.file(oldFile).delete();
        } catch (err) {
          console.warn("GCS delete failed:", err);
        }
      }

      const ext = file.originalname.split(".").pop().toLowerCase();
      const fileName = `posts/${uuidv4()}_${Date.now()}.${ext}`;
      const blob = bucket.file(fileName);

      await new Promise((resolve, reject) => {
        blob.createWriteStream({ metadata: { contentType: file.mimetype } })
          .on("error", reject)
          .on("finish", resolve)
          .end(file.buffer);
      });

      mediaUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      mediaType = file.mimetype.startsWith("video/") ? "video" : "image";
    }

    const updated = await pool.query(
      `UPDATE posts SET content = $1, media_url = $2, media_type = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, content, media_url, media_type, created_at`,
      [content ?? "", mediaUrl, mediaType, id]
    );

    const user = await pool.query(`SELECT username, avatar_url FROM users WHERE id = $1`, [userId]);

    res.json({
      message: "Post updated",
      post: {
        ...updated.rows[0],
        author: user.rows[0].username,
        author_avatar: user.rows[0].avatar_url,
        author_id: userId,
      },
    });
  } catch (err) {
    console.error("updatePost error:", err);
    res.status(500).json({ error: "Failed to update post" });
  }
};

/* ==============================================================
   DELETE POST
   ============================================================== */
export const deletePost = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const post = await pool.query(`SELECT media_url FROM posts WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (post.rows.length === 0) return res.status(404).json({ error: "Post not found" });

    const mediaUrl = post.rows[0].media_url;
    if (mediaUrl) {
      try {
        const fileName = mediaUrl.split(`/${bucket.name}/`)[1];
        await bucket.file(fileName).delete();
      } catch (err) {
        console.warn("GCS delete failed:", err);
      }
    }

    await pool.query("BEGIN");
    await pool.query("DELETE FROM likes WHERE post_id = $1", [id]);
    await pool.query("DELETE FROM comments WHERE post_id = $1", [id]);
    await pool.query("DELETE FROM posts WHERE id = $1", [id]);
    await pool.query("COMMIT");

    res.json({ message: "Post deleted", postId: id });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("deletePost error:", err);
    res.status(500).json({ error: "Failed to delete post" });
  }
};

/* ==============================================================
   INTERACTIONS
   ============================================================== */
export const toggleLike = async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    const exists = await pool.query(`SELECT 1 FROM likes WHERE user_id = $1 AND post_id = $2`, [userId, postId]);
    let liked = false;

    if (exists.rows.length > 0) {
      await pool.query(`DELETE FROM likes WHERE user_id = $1 AND post_id = $2`, [userId, postId]);
    } else {
      await pool.query(`INSERT INTO likes (user_id, post_id) VALUES ($1, $2)`, [userId, postId]);
      liked = true;
    }

    const count = await pool.query(`SELECT COUNT(*) FROM likes WHERE post_id = $1`, [postId]);
    res.json({ liked, like_count: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error("toggleLike error:", err);
    res.status(500).json({ error: "Failed to toggle like" });
  }
};

export const repost = async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    const original = await pool.query(`SELECT id, user_id FROM posts WHERE id = $1 AND repost_from IS NULL`, [postId]);
    if (original.rows.length === 0) return res.status(404).json({ error: "Post not found" });
    if (original.rows[0].user_id === userId) return res.status(400).json({ error: "Cannot repost your own post" });

    const exists = await pool.query(`SELECT 1 FROM posts WHERE user_id = $1 AND repost_from = $2`, [userId, postId]);
    if (exists.rows.length > 0) return res.status(400).json({ error: "Already reposted" });

    const result = await pool.query(
      `INSERT INTO posts (user_id, content, media_url, media_type, repost_from, repost_at)
       SELECT $1, content, media_url, media_type, id, NOW()
       FROM posts WHERE id = $2
       RETURNING id, repost_from, repost_at`,
      [userId, postId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("repost error:", err);
    res.status(500).json({ error: "Failed to repost" });
  }
};

export const undoRepost = async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    const repost = await pool.query(`SELECT id FROM posts WHERE user_id = $1 AND repost_from = $2`, [userId, postId]);
    if (repost.rows.length === 0) return res.status(404).json({ error: "Repost not found" });

    await pool.query(`DELETE FROM posts WHERE id = $1`, [repost.rows[0].id]);
    res.json({ message: "Repost removed" });
  } catch (err) {
    console.error("undoRepost error:", err);
    res.status(500).json({ error: "Failed to undo repost" });
  }
};

export const bookmark = async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    await pool.query(`INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, postId]);
    const count = await pool.query(`SELECT COUNT(*) FROM bookmarks WHERE post_id = $1`, [postId]);
    res.json({ bookmarked: true, bookmark_count: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error("bookmark error:", err);
    res.status(500).json({ error: "Failed to bookmark" });
  }
};

export const unbookmark = async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    await pool.query(`DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2`, [userId, postId]);
    const count = await pool.query(`SELECT COUNT(*) FROM bookmarks WHERE post_id = $1`, [postId]);
    res.json({ bookmarked: false, bookmark_count: parseInt(count.rows[0].count) });
  } catch (err) {
    console.error("unbookmark error:", err);
    res.status(500).json({ error: "Failed to unbookmark" });
  }
};

export const trackView = async (req, res) => {
  const { postId } = req.params;
  try {
    await pool.query(`INSERT INTO post_views (post_id) VALUES ($1)`, [postId]);
    const views = await pool.query(`SELECT COUNT(*) FROM post_views WHERE post_id = $1`, [postId]);
    res.json({ view_count: parseInt(views.rows[0].count) });
  } catch (err) {
    console.error("trackView error:", err);
    res.status(500).json({ error: "Failed to track view" });
  }
};