// src/routes/passwordRoutes.js
import express from "express";
import {
  requestReset,
  resetPassword,
} from "../controllers/passwordController.js";
import { rateLimit } from "express-rate-limit";

const router = express.Router();

// 5 requests per 15 min per IP (adjust as you like)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/request", limiter, requestReset);
router.post("/reset", resetPassword);

export default router;