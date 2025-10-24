import express from "express";
import { getGroupMembers } from "../controllers/groupController.js";

const router = express.Router();

// GET group members
router.get("/:groupId/members", getGroupMembers);

export default router;