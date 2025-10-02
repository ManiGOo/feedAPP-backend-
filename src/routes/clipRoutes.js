import express from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import {
  getClips,
  getClipById,
  createClip,
  toggleClipLike,
  deleteClip,
  getClipComments,
  createClipComment,
} from "../controllers/clipController.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Action logger
const logAction = (action) => (req, res, next) => {
  const user = req.user?.id || "Guest";
  console.log(`${typeof action === "function" ? action(req) : action} called by user: ${user}`);
  next();
};

// Clips
router.get("/", authMiddleware, logAction("GET /clips"), getClips);
router.get("/:id", authMiddleware, logAction((req) => `GET /clips/${req.params.id}`), getClipById);
router.post("/", authMiddleware, upload.single("video"), logAction("POST /clips"), createClip);
router.delete("/:id", authMiddleware, logAction((req) => `DELETE /clips/${req.params.id}`), deleteClip);
router.post("/:clipId/like", authMiddleware, logAction((req) => `POST /clips/${req.params.clipId}/like`), toggleClipLike);

// Comments
router.get("/:clipId/comments", authMiddleware, logAction((req) => `GET /clips/${req.params.clipId}/comments`), getClipComments);
router.post("/:clipId/comments", authMiddleware, logAction((req) => `POST /clips/${req.params.clipId}/comments`), createClipComment);

export default router;
