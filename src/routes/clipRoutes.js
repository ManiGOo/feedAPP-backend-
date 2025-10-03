import express from "express";
import multer from "multer";
import * as clipController from "../controllers/clipController.js";

const upload = multer({ storage: multer.memoryStorage() }); // memory storage for Cloudinary

const createClipsRouter = (io) => {
  const router = express.Router();

  // GET all clips
  router.get("/", clipController.getClips);

  // CREATE a new clip
  router.post("/", upload.single("video"), clipController.createClip(io));

  // LIKE a clip
  router.post("/:clipId/like", clipController.likeClip(io));

  // UNLIKE a clip
  router.post("/:clipId/unlike", clipController.unlikeClip(io));

  // COMMENT on a clip
  router.post("/:clipId/comment", clipController.commentClip(io));
  router.get("/:clipId/comments", clipController.getClipComments);

  return router;
};

export default createClipsRouter;
