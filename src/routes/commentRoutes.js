import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  createComment,
  getCommentsByPost,
  getMyComments,
  updateComment,
  deleteComment,
} from "../controllers/commentController.js";

const router = express.Router({ mergeParams: true });

// Add a comment to a post (protected)
router.post("/", authMiddleware, createComment);

// Get all comments for a specific post (public)
router.get("/", getCommentsByPost);

// Get all comments made by logged-in user
router.get("/me", authMiddleware, getMyComments);

// Update a comment
router.put("/:commentId", authMiddleware, updateComment);

// Delete a comment
router.delete("/:commentId", authMiddleware, deleteComment);

export default router;
