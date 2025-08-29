import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http"; 
import { Server } from "socket.io";

import authRoutes from "./routes/authRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import commentRoutes from "./routes/commentRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import { authMiddleware } from "./middleware/auth.js";
import initSocket from "./socket.js"; // ✅ import socket logic

dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Public routes
app.use("/api/auth", authRoutes);

// Protected routes
app.use("/api/posts", authMiddleware, postRoutes);
app.use("/api/posts/:id/comments", authMiddleware, commentRoutes);
app.use("/api/users", authMiddleware, userRoutes);

// Test route
app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ---------- SOCKET.IO SETUP ----------
const server = http.createServer(app);
export const io = new Server(server, {
  cors: { origin: "*" }, // change to your frontend URL later
});

// Init socket events
initSocket(io);

// ---------- START SERVER ----------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
