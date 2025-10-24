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
  updatePost,
} from "../controllers/postController.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    console.log("Multer fileFilter:", {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      encoding: file.encoding,
    });
    if (/image\/|video\/mp4|video\/quicktime/.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error("Only images, MP4, or MOV files are allowed"));
  },
});

const uploadMiddleware = (req, res, next) => {
  console.log("Upload middleware - Request headers:", {
    contentType: req.headers["content-type"],
    contentLength: req.headers["content-length"],
    authorization: req.headers.authorization,
  });
  console.log("Upload middleware - Request body (pre-multer):", req.body);
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ])(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.log("Multer error:", err.message, err);
      return res.status(400).json({ error: `Multer error: ${err.message}` });
    } else if (err) {
      console.log("File filter error:", err.message, err);
      return res.status(400).json({ error: err.message });
    }
    console.log("Multer parsed files:", req.files);
    console.log("Multer parsed body:", req.body);
    if (!req.files || (!req.files.image && !req.files.video)) {
      console.log("No files parsed by multer");
    }
    next();
  });
};

// Middleware to log user actions
const logAction = (action) => (req, res, next) => {
  console.log(`${action} called by user:`, req.user?.id || "unauthenticated");
  next();
};

// GET all posts
router.get("/", authMiddleware, logAction("GET /posts"), getPosts);

// GET a single post (with comments, no auth required)
router.get("/:id", logAction((req) => `GET /posts/${req.params.id}`), getPostById);

// POST a new post (image/video optional)
router.post(
  "/",
  authMiddleware,
  uploadMiddleware,
  logAction("POST /posts"),
  createPost
);

// DELETE a post (only owner)
router.delete("/:id", authMiddleware, logAction((req) => `DELETE /posts/${req.params.id}`), deletePost);

// Toggle like
router.post("/:postId/like", authMiddleware, logAction((req) => `POST /posts/${req.params.postId}/like`), toggleLike);

// Mount comment routes under /:postId/comments
router.use("/:postId/comments", commentRoutes);

// PUT update post (only owner)
router.put(
  "/:id",
  authMiddleware,
  uploadMiddleware,
  logAction((req) => `PUT /posts/${req.params.id}`),
  updatePost
);

export default router;