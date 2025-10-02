import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import morgan from "morgan";

// Routes
import authRoutes from "./routes/authRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import commentRoutes from "./routes/commentRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import followingFeedRoutes from "./routes/followingFeedRoutes.js";
import replyRoutes from "./routes/replyRoutes.js";
import createMessagesRouter from "./routes/messagesRoutes.js"; // UPDATED
import clipRoutes from "./routes/clipRoutes.js";

// Middleware
import { authMiddleware } from "./middleware/auth.js";

// Socket handler
import socketHandler from "./socket.js";

dotenv.config();
const app = express();

// ---------------------- CONFIG ----------------------
const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

// ---------------------- MIDDLEWARE ----------------------
app.use(cors({
  origin: FRONTEND_URL,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  credentials: true
}));
app.use(express.json());
app.use(morgan("dev")); // request logging

// ---------------------- ROUTES ----------------------
// Public
app.use("/api/auth", authRoutes);

// Protected
app.use("/api/posts", authMiddleware, postRoutes);
app.use("/api/posts/:postId/comments", authMiddleware, commentRoutes);
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api/follow", authMiddleware, followingFeedRoutes);
app.use("/api/replies", authMiddleware, replyRoutes);
app.use("/api/clips", authMiddleware, clipRoutes); // <--- added here

// ---------------------- SOCKET.IO ----------------------
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization"],
    credentials: true
  },
});

// Initialize Socket.IO handler
socketHandler(io);

// Messages routes need io for socket emits
app.use("/api/messages", authMiddleware, createMessagesRouter(io));

// Test route
app.get("/api/me", authMiddleware, (req, res) => res.json({ user: req.user }));

// Health check
app.get("/", (req, res) => res.send("API is running"));

// ---------------------- ERROR HANDLING ----------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack || err);
  res.status(500).json({ error: "Internal server error" });
});

// ---------------------- START SERVER ----------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
