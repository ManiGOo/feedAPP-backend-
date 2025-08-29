// src/socket.js
export default function initSocket(io) {
  io.on("connection", (socket) => {
    console.log("⚡ User connected:", socket.id);

    // Just an example global chat/message handler
    socket.on("sendMessage", (msg) => {
      io.emit("receiveMessage", msg);
    });

    socket.on("disconnect", () => {
      console.log("❌ User disconnected:", socket.id);
    });
  });
}
