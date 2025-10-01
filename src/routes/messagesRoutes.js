// router.js
import express from "express";
import * as messagesController from "../controllers/messagesController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

export default (io) => {
  // DM Routes
  router.get("/dms", authMiddleware, messagesController.getDMs);
  router.get("/dm/:otherUserId", authMiddleware, messagesController.getDMConversation);
  router.post("/dm/start", authMiddleware, messagesController.startDMThread);
  router.post("/dm", authMiddleware, messagesController.sendDM(io));

  // Group Routes
  router.get("/groups", authMiddleware, messagesController.getGroups);
  router.get("/group/:groupId", authMiddleware, messagesController.getGroupMessages);
  router.post("/group", authMiddleware, messagesController.sendGroupMessage(io));
  router.post("/group/create", authMiddleware, messagesController.createGroup); // New endpoint

  // Message Routes
  router.put("/message/:messageId", authMiddleware, messagesController.updateMessage);
  router.delete("/message/:messageId", authMiddleware, messagesController.deleteMessage(io));

  return router;
};