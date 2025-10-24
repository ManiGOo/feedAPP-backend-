import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { getFollowingPosts, toggleFollow, getFollowers, getFollowing, searchFollowingByUsername } from "../controllers/followingFeedController.js";

const router = express.Router();

// Fixed/specific routes FIRST
router.get("/following/search", authMiddleware, searchFollowingByUsername);  // <-- Moved up

// Then dynamic ones
router.get("/followers/:userId", authMiddleware, getFollowers);
router.get("/following/:userId", authMiddleware, getFollowing);

// Other routes (unaffected)
router.get("/", authMiddleware, getFollowingPosts);
router.post("/toggle/:userId", authMiddleware, toggleFollow);

export default router;