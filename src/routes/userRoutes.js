// src/routes/userRoutes.js
import express from "express";
import { getMe, updateMe, getUserProfile, getFollowableUsers } from "../controllers/userController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Async handler wrapper to catch errors automatically
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Apply authMiddleware to all routes in this router
router.use(authMiddleware);

// Routes for logged-in user
router.route("/me")
  .get(asyncHandler(getMe))
  .put(asyncHandler(updateMe));

// Fetch any user's profile by ID
router.get("/profile/:id", asyncHandler(getUserProfile));

// Fetch followable users for DMs
router.get("/following", asyncHandler(getFollowableUsers));


export default router;
