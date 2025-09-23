import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { createComment, getCommentsByPost } from "../controllers/commentController.js";

const router = express.Router({ mergeParams: true });

// Add a comment to a post (protected)
router.post("/", authMiddleware, createComment);

// Get all comments for a specific post (public)
router.get("/", getCommentsByPost);



export default router;
