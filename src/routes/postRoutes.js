// routes/postRouter.js
import express from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import commentRoutes from "./commentRoutes.js";
import {
  getPosts,
  getFollowingPosts,
  createPost,
  getPostById,
  updatePost,
  deletePost,
  toggleLike,
  repost,
  undoRepost,
  bookmark,
  unbookmark,
  trackView,
} from "../controllers/postController.js";

const router = express.Router();

// === MULTER CONFIG ===
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = /image\/|video\/(mp4|quicktime|webm|x-matroska)/;
    cb(null, allowed.test(file.mimetype));
  },
});

const uploadMedia = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "video", maxCount: 1 },
]);

// === MULTER ERROR HANDLER ===
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Max 50MB." });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

// === ROUTES ===

// 1. GET FEED: /api/posts?feed=following or /api/posts
router.get(
  "/",
  authMiddleware,
  (req, res) => {
    if (req.query.feed === "following") {
      return getFollowingPosts(req, res);
    }
    return getPosts(req, res);
  }
);

// 2. GET SINGLE POST: /api/posts/:id
router.get("/:id", authMiddleware, getPostById);

// 3. CREATE POST: /api/posts (multipart/form-data)
router.post(
  "/",
  authMiddleware,
  uploadMedia,
  handleMulterError,
  createPost
);

// 4. UPDATE POST: /api/posts/:id
router.put(
  "/:id",
  authMiddleware,
  uploadMedia,
  handleMulterError,
  updatePost
);

// 5. DELETE POST: /api/posts/:id
router.delete("/:id", authMiddleware, deletePost);

// === INTERACTIONS ===

// Like
router.post("/:postId/like", authMiddleware, toggleLike);

// Repost
router.post("/:postId/repost", authMiddleware, repost);
router.delete("/:postId/repost", authMiddleware, undoRepost);

// Bookmark
router.post("/:postId/bookmark", authMiddleware, bookmark);
router.delete("/:postId/bookmark", authMiddleware, unbookmark);

// View (optional analytics)
router.post("/:postId/view", authMiddleware, trackView);

// === COMMENTS SUB-ROUTE ===
router.use("/:postId/comments", commentRoutes);

export default router;