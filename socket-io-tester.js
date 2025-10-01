const io = require("socket.io-client");
const socket = io("http://localhost:3000", {
  auth: { token: "your-valid-jwt-token" },
});
socket.on("connect", () => {
  socket.emit("joinDM", 2); // Valid otherUserId
  socket.emit("sendDM", { to: 2, content: "Hello!" });
});
socket.on("dmMessage", console.log);
socket.on("errorMessage", console.error);