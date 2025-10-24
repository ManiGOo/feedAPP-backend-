import jwt from "jsonwebtoken";
import * as messagesController from "./controllers/messagesController.js";
import db from "./config/db.js";

export default (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication error: No token"));

    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = user;
      next();
    } catch (err) {
      console.error("❌ Socket authentication failed:", err.message);
      next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    console.log(`⚡ User connected: ${socket.user.username} (id=${socket.user.id})`);

    socket.join(`user_${socket.user.id}`);
    try {
      const client = await db.connect();
      try {
        const { rows } = await client.query(
          `SELECT group_id FROM group_members WHERE user_id = $1`,
          [socket.user.id]
        );
        rows.forEach((row) => socket.join(`group_${row.group_id}`));
        console.log(`✅ ${socket.user.username} joined group rooms: ${rows.map((r) => `group_${r.group_id}`).join(", ")}`);
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("❌ Error joining group rooms on connect:", err.message);
    }

    socket.on("joinDM", async (otherUserId) => {
      if (!otherUserId || otherUserId === socket.user.id) {
        return socket.emit("errorMessage", { error: "Invalid or same user ID" });
      }
      try {
        const client = await db.connect();
        try {
          const { rows } = await client.query(`SELECT 1 FROM users WHERE id = $1`, [otherUserId]);
          if (rows.length === 0) {
            return socket.emit("errorMessage", { error: "Recipient does not exist" });
          }
          const room = makeDMRoom(socket.user.id, otherUserId);
          socket.join(room);
          console.log(`✅ ${socket.user.username} joined DM room: ${room}`);
        } finally {
          client.release();
        }
      } catch (err) {
        console.error("❌ Error joining DM:", err.message);
        socket.emit("errorMessage", { error: "Failed to join DM room" });
      }
    });

    socket.on("joinGroup", async (groupId) => {
      if (!groupId) {
        return socket.emit("errorMessage", { error: "Group ID required" });
      }
      try {
        const client = await db.connect();
        try {
          const { rows } = await client.query(
            `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
            [groupId, socket.user.id]
          );
          if (rows.length === 0) {
            return socket.emit("errorMessage", { error: "Group does not exist or you are not a member" });
          }
          const room = `group_${groupId}`;
          socket.join(room);
          console.log(`✅ ${socket.user.username} joined Group room: ${room}`);
        } finally {
          client.release();
        }
      } catch (err) {
        console.error("❌ Error joining group:", err.message);
        socket.emit("errorMessage", { error: "Failed to join group room" });
      }
    });

    socket.on("sendDM", async ({ to, content, tempId }) => {
      if (!to || !content?.trim() || to === socket.user.id) {
        return socket.emit("errorMessage", { error: "Recipient and content required, cannot send to self" });
      }
      try {
        const newMessage = await messagesController.saveMessage({
          sender_id: socket.user.id,
          recipient_id: to,
          content: content.trim(),
        });
        const room = makeDMRoom(socket.user.id, to);
        io.to(room).emit("dmMessage", { ...newMessage, tempId });
      } catch (err) {
        console.error("❌ Error sending DM:", err.message);
        socket.emit("errorMessage", { error: err.message || "Failed to send DM" });
      }
    });

    socket.on("sendGroupMessage", async ({ group_id, content, tempId }) => {
      if (!group_id || !content?.trim()) {
        return socket.emit("errorMessage", { error: "Group ID and content required" });
      }
      try {
        const newMessage = await messagesController.saveMessage({
          sender_id: socket.user.id,
          group_id,
          content: content.trim(),
        });
        io.to(`group_${group_id}`).emit("groupMessage", { ...newMessage, tempId });
      } catch (err) {
        console.error("❌ Error sending Group message:", err.message);
        socket.emit("errorMessage", { error: err.message || "Failed to send group message" });
      }
    });

    socket.on("deleteMessage", async ({ messageId }) => {
      if (!messageId) {
        return socket.emit("errorMessage", { error: "Message ID required" });
      }
      try {
        const deletedMessage = await messagesController.deleteMessageSocket(socket.user.id, messageId);

        if (!deletedMessage) {
          return socket.emit("errorMessage", { error: "Message not found or you are not the sender" });
        }

        if (deletedMessage.recipient_id) {
          const room = makeDMRoom(deletedMessage.sender_id, deletedMessage.recipient_id);
          io.to(room).emit("messageDeleted", { messageId: deletedMessage.id });
        } else if (deletedMessage.group_id) {
          io.to(`group_${deletedMessage.group_id}`).emit("messageDeleted", { messageId: deletedMessage.id });
        }
      } catch (err) {
        console.error("❌ Error deleting message:", err.message);
        socket.emit("errorMessage", { error: "Failed to delete message" });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`❌ User disconnected: ${socket.user.username} (${reason})`);
    });
  });

  io.on("error", (err) => {
    console.error("🔥 Socket.IO error:", err.message);
  });
};

function makeDMRoom(user1, user2) {
  return `dm_${[user1, user2].sort((a, b) => a - b).join("_")}`;
}