import express from "express";
import * as messagesController from "../controllers/messagesController.js";
import { authMiddleware } from "../middleware/auth.js";
import multer from "multer";

const router = express.Router();

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only images are allowed"));
    }
  },
});

export default (io) => {
  router.get("/dms", authMiddleware, messagesController.getDMs);
  router.get("/dm/:otherUserId", authMiddleware, messagesController.getDMConversation);
  router.post("/dm/start", authMiddleware, messagesController.startDMThread);
  router.post("/dm", authMiddleware, messagesController.sendDM(io));
  router.get("/groups", authMiddleware, messagesController.getGroups);
  router.get("/group/:groupId", authMiddleware, messagesController.getGroupMessages);
  router.post("/group", authMiddleware, messagesController.sendGroupMessage(io));
  router.post("/group/create", authMiddleware, upload.single("avatar"), messagesController.createGroup);
  router.put("/message/:messageId", authMiddleware, messagesController.updateMessage);
  router.delete("/message/:messageId", authMiddleware, messagesController.deleteMessage(io));

  return router;
};