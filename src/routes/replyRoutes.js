// src/routes/replyRoutes.js
import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import { createReply, getRepliesByComment, getRepliesByUser } from "../controllers/replyController.js";

const router = express.Router();

router.post("/:commentId", authMiddleware, createReply); // create a reply on a comment
router.get("/comment/:commentId", authMiddleware, getRepliesByComment); // all replies on a comment
router.get("/user/:userId", authMiddleware, getRepliesByUser); // all replies by a user

export default router;
