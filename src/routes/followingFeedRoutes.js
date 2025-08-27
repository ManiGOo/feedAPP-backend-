// src/routes/followingFeedRoutes.js
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { getFollowingPosts } from "../controllers/followingFeedController.js";

const router = express.Router();

router.get("/", authMiddleware, getFollowingPosts);

export default router;
