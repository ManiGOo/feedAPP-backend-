// src/routes/userRoutes.js
import express from "express";
import { getMe, updateMe, getUserProfile, getUserReplies } from "../controllers/userController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Async handler wrapper to catch errors automatically
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Routes for logged-in user
router.route("/me")
  .get(authMiddleware, asyncHandler(getMe))
  .put(authMiddleware, asyncHandler(updateMe));

// Fetch any user's profile by ID
router.get("/profile/:id", authMiddleware, asyncHandler(getUserProfile));

// Fetch replies for a specific user
router.get("/profile/:id/replies", authMiddleware, getUserReplies);


export default router;
