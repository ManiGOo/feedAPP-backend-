import express from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import * as clipController from "../controllers/clipController.js";

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    console.log("Multer fileFilter:", {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      encoding: file.encoding,
    });
    if (/video\/mp4|video\/quicktime/.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error("Only MP4 or MOV files are allowed"));
  },
});

const createClipsRouter = (io) => {
  const router = express.Router();

  const uploadMiddleware = (req, res, next) => {
    console.log("Upload middleware - Request headers:", {
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
      authorization: !!req.headers.authorization,
    });
    console.log("Upload middleware - Request body (pre-multer):", req.body);
    upload.single("video")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.log("Multer error:", err.message, err);
        return res.status(400).json({ error: `Multer error: ${err.message}` });
      } else if (err) {
        console.log("File filter error:", err.message, err);
        return res.status(400).json({ error: err.message });
      }
      console.log("Multer parsed file:", req.file);
      console.log("Multer parsed body:", req.body);
      if (!req.file) {
        console.log("No file parsed by multer");
        return res.status(400).json({ error: "No video file received" });
      }
      next();
    });
  };

  // GET all clips
  router.get("/", authMiddleware, clipController.getClips);

  // CREATE a new clip
  router.post("/", authMiddleware, uploadMiddleware, clipController.createClip(io));

  // LIKE a clip
  router.post("/:clipId/like", authMiddleware, clipController.likeClip(io));

  // UNLIKE a clip
  router.post("/:clipId/unlike", authMiddleware, clipController.unlikeClip(io));

  // COMMENT on a clip
  router.post("/:clipId/comment", authMiddleware, clipController.commentClip(io));

  // GET clip comments
  router.get("/:clipId/comments", authMiddleware, clipController.getClipComments);

  // DELETE a clip
  router.delete("/:clipId", authMiddleware, clipController.deleteClip(io));

  return router;
};

export default createClipsRouter;