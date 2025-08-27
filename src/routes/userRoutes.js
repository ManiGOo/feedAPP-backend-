import express from "express";
import { getMe, updateMe } from "../controllers/userController.js";
import { uploadAvatar, uploadAvatarMiddleware } from "../controllers/uploadController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// profile
router.get("/me", authMiddleware, getMe);
router.put("/me", authMiddleware, updateMe);

// avatar upload
router.post("/me/avatar", authMiddleware, uploadAvatarMiddleware, uploadAvatar);

export default router;
