import express from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import commentRoutes from "./commentRoutes.js";
import {
  getPosts,
  createPost,
  toggleLike,
  getPostById,
  deletePost,
} from "../controllers/postController.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// -------------------
// Middleware to log user actions
const logAction = (action) => (req, res, next) => {
  console.log(`${action} called by user:`, req.user?.id);
  next();
};

// GET all posts
router.get("/", authMiddleware, logAction("GET /posts"), getPosts);

// GET a single post (with comments)
router.get("/:id", authMiddleware, logAction((req) => `GET /posts/${req.params.id}`), getPostById);

// POST a new post (image/video optional)
router.post(
  "/",
  authMiddleware,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  logAction("POST /posts"),
  createPost
);

// DELETE a post (only owner)
router.delete("/:id", authMiddleware, logAction((req) => `DELETE /posts/${req.params.id}`), deletePost);

// Toggle like
router.post("/:postId/like", authMiddleware, logAction((req) => `POST /posts/${req.params.postId}/like`), toggleLike);

// Mount comment routes under /:postId/comments
router.use("/:postId/comments", commentRoutes);

export default router;
