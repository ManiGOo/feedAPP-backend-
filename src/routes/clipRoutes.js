// src/routes/clipRoutes.js
import express from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import * as clipController from "../controllers/clipController.js";

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const allowed = /video\/mp4|video\/quicktime/.test(file.mimetype);
    cb(null, allowed);
  },
});

/**
 * Factory that receives the socket.io instance and returns an Express router.
 */
const createClipsRouter = (io) => {
  const router = express.Router();

  // ---------- MULTER MIDDLEWARE ----------
  const uploadVideo = (req, res, next) => {
    upload.single("video")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      }
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: "No video file received" });
      }
      next();
    });
  };

  // ---------- ROUTES ----------
  router.get("/", authMiddleware, clipController.getClips);
  router.get("/:clipId", authMiddleware, clipController.getClipById);

  router.post(
    "/",
    authMiddleware,
    uploadVideo,
    clipController.createClip(io)
  );

  router.post("/:clipId/like", authMiddleware, clipController.likeClip(io));
  router.post("/:clipId/unlike", authMiddleware, clipController.unlikeClip(io));

  router.post("/:clipId/comment", authMiddleware, clipController.commentClip(io));
  router.get("/:clipId/comments", authMiddleware, clipController.getClipComments);

  router.delete("/:clipId", authMiddleware, clipController.deleteClip(io));

  return router;
};

export default createClipsRouter;