// src/server.js
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
import groupRouter from "./routes/groupRouters.js"
import followingFeedRoutes from "./routes/followingFeedRoutes.js";
import createMessagesRouter from "./routes/messagesRoutes.js"; // Socket-enabled
import createClipsRouter from "./routes/clipRoutes.js";         // Socket-enabled

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
app.use(morgan("dev"));

// ---------------------- SOCKET.IO ----------------------
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization"],
    credentials: true,
  },
  maxHttpBufferSize: 1e6, // 1MB
  pingTimeout: 60000,
  pingInterval: 25000,
});



// Initialize socket.io logic
socketHandler(io);

// ---------------------- ROUTES ----------------------
// Public routes
app.use("/api/auth", authRoutes);

// Protected routes
app.use("/api/posts", authMiddleware, postRoutes);
app.use("/api/posts/:postId/comments", authMiddleware, commentRoutes);
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api/follow", authMiddleware, followingFeedRoutes);

app.use("/api/comments", commentRoutes);  // mount for general comment operations


// Clips routes (requires socket)
app.use("/api/clips", authMiddleware, createClipsRouter(io));

// Messages routes (requires socket)
app.use("/api/messages", authMiddleware, createMessagesRouter(io));
app.use("/api/groups", groupRouter); // Add this to mount group routes

// ---------------------- TEST ROUTES ----------------------
app.get("/api/me", authMiddleware, (req, res) => res.json({ user: req.user }));
app.get("/", (req, res) => res.send("API is running"));

// ---------------------- ERROR HANDLING ----------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack || err);
  res.status(500).json({ error: "Internal server error" });
});

// ---------------------- START SERVER ----------------------
const PORT = process.env.PORT ;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
