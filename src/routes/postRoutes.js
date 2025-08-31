import express from "express";
import { getPosts, createPost, toggleLike, getPostById } from "../controllers/postController.js";
import { authMiddleware } from "../middleware/auth.js";
import commentRoutes from "./commentRoutes.js";
import multer from "multer";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// GET all posts
router.get("/", authMiddleware, async (req, res, next) => {
  console.log("GET /posts called by user:", req.user?.id);
  next();
}, getPosts);

// GET a single post (with comments)
router.get("/:id", authMiddleware, (req, res, next) => {
  console.log(`GET /posts/${req.params.id} called by user:`, req.user?.id);
  next();
}, getPostById);

// POST a new post (image/video optional)
router.post(
  "/",
  authMiddleware,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  async (req, res, next) => {
    console.log("POST /posts called by user:", req.user?.id);
    console.log("Request body:", req.body);
    console.log("Request files:", req.files);
    next();
  },
  createPost
);

// Toggle like
router.post("/:postId/like", authMiddleware, (req, res, next) => {
  console.log(`POST /posts/${req.params.postId}/like called by user:`, req.user?.id);
  next();
}, toggleLike);

// Mount comment routes under /:postId/comments
router.use("/:postId/comments", commentRoutes);

export default router;
