import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Routes
import authRoutes from "./routes/authRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import commentRoutes from "./routes/commentRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import followingFeedRoutes from "./routes/followingFeedRoutes.js"; // ✅ follow routes

// Middleware
import { authMiddleware } from "./middleware/auth.js";

dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Public routes
app.use("/api/auth", authRoutes);

// Protected routes
app.use("/api/posts", authMiddleware, postRoutes);
app.use("/api/posts/:postId/comments", authMiddleware, commentRoutes);
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api/follow", authMiddleware, followingFeedRoutes); // ✅ mount follow/following routes

// Test route
app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
