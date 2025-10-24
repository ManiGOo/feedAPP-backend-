import express from "express";
import multer from "multer";
import {
  getMe,
  updateMe,
  getUserProfile,
  searchUsers
} from "../controllers/userController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// -------------------- Async handler --------------------
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// -------------------- Multer setup --------------------
const upload = multer({ storage: multer.memoryStorage() });

// -------------------- Apply authentication --------------------
router.use(authMiddleware);

// -------------------- Logged-in user routes --------------------
router
  .route("/me")
  .get(asyncHandler(getMe))
  .put(upload.single("avatar"), asyncHandler(updateMe));

// -------------------- Get any user profile --------------------
router.get("/profile/:id", asyncHandler(getUserProfile));

// -------------------- Search users --------------------
router.get("/search", asyncHandler(searchUsers));

export default router;