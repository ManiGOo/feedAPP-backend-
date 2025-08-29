import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// routes
import authRoutes from "./routes/authRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import commentRoutes from "./routes/commentRoutes.js";
import userRoutes from "./routes/userRoutes.js"; // ✅ import user routes

// middleware
import { authMiddleware } from "./middleware/auth.js";

dotenv.config();
const app = express();

// middleware
app.use(cors());
app.use(express.json());

// public routes
app.use("/api/auth", authRoutes);

// protected routes
app.use("/api/posts", authMiddleware, postRoutes);
app.use("/api/posts/:id/comments", authMiddleware, commentRoutes);
app.use("/api/users", authMiddleware, userRoutes); // ✅ mount user routes

// test route
app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
