import express from "express";
import multer from "multer";
import { getMe, updateMe, getUserProfile, getUserReplies } from "../controllers/userController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Multer setup (memory storage so we can send buffer to Cloudinary)
const upload = multer({ storage: multer.memoryStorage() });

// Apply authMiddleware
router.use(authMiddleware);

// Routes for logged-in user
router.route("/me")
  .get(asyncHandler(getMe))
  .put(upload.single("avatar"), asyncHandler(updateMe)); // <— handle avatar file

// Other routes
router.get("/profile/:id", asyncHandler(getUserProfile));
router.get("/profile/:id/replies", asyncHandler(getUserReplies));

export default router;
