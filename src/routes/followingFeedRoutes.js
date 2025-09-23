// src/routes/followingFeedRoutes.js
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { getFollowingPosts, toggleFollow, getFollowers, getFollowing } from "../controllers/followingFeedController.js";

const router = express.Router();

// Get posts from users the current user follows
router.get("/", authMiddleware, getFollowingPosts);

// Toggle follow/unfollow a user
router.post("/toggle/:userId", authMiddleware, toggleFollow);

router.get("/followers/:userId", authMiddleware, getFollowers);
router.get("/following/:userId", authMiddleware, getFollowing);


export default router;
