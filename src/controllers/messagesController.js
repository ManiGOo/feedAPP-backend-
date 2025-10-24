import db from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

async function withClient(fn) {
  const client = await db.connect();
  try {
    return await fn(client);
  } catch (err) {
    console.error("Database error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

function normalizeMessage(row, currentUserId = null) {
  if (!row) return null;
  return {
    id: row.id,
    sender_id: row.sender_id,
    recipient_id: row.recipient_id,
    group_id: row.group_id,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at || null,
    isOwn: currentUserId ? row.sender_id === currentUserId : undefined,
    sender_username: row.sender_username || "Unknown",
    sender_avatar_url: row.sender_avatar_url || null,
  };
}

export const saveMessage = async ({ sender_id, recipient_id = null, group_id = null, content }) => {
  if (!content?.trim()) {
    throw new Error("Message content cannot be empty");
  }
  if (recipient_id && recipient_id === sender_id) {
    throw new Error("Cannot send message to self");
  }
  return withClient(async (client) => {
    if (recipient_id) {
      const { rows: userCheck } = await client.query(`SELECT 1 FROM users WHERE id = $1`, [recipient_id]);
      if (userCheck.length === 0) {
        throw new Error("Recipient does not exist");
      }
    }
    if (group_id) {
      const { rows: groupCheck } = await client.query(
        `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [group_id, sender_id]
      );
      if (groupCheck.length === 0) {
        throw new Error("Group does not exist or user is not a member");
      }
    }
    const { rows } = await client.query(
      `INSERT INTO messages (sender_id, recipient_id, group_id, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [sender_id, recipient_id, group_id, content]
    );
    const { rows: user } = await client.query(
      `SELECT username, avatar_url FROM users WHERE id = $1`,
      [sender_id]
    );
    return normalizeMessage({ ...rows[0], sender_username: user[0]?.username, sender_avatar_url: user[0]?.avatar_url }, sender_id);
  });
};

export const updateMessage = async (req, res) => {
  const userId = req.user.id;
  const { messageId } = req.params;
  const { content } = req.body;

  if (!content?.trim()) {
    return res.status(400).json({ error: "Message content cannot be empty" });
  }

  try {
    const updatedMessage = await withClient(async (client) => {
      const { rows } = await client.query(
        `UPDATE messages 
         SET content=$1, updated_at=NOW()
         WHERE id=$2 AND sender_id=$3
         RETURNING *`,
        [content, messageId, userId]
      );
      if (rows.length === 0) return null;
      const { rows: user } = await client.query(
        `SELECT username, avatar_url FROM users WHERE id = $1`,
        [userId]
      );
      return normalizeMessage({ ...rows[0], sender_username: user[0]?.username, sender_avatar_url: user[0]?.avatar_url }, userId);
    });

    if (!updatedMessage) {
      return res.status(404).json({ error: "Message not found or you are not the sender" });
    }

    res.json(updatedMessage);
  } catch (err) {
    console.error("Failed to update message:", err.message);
    res.status(500).json({ error: "Failed to update message" });
  }
};

export const deleteMessageSocket = async (userId, messageId) => {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM messages WHERE id=$1 AND sender_id=$2`,
      [messageId, userId]
    );
    if (rows.length === 0) return null;

    const { rows: deletedRows } = await client.query(
      `DELETE FROM messages WHERE id=$1 RETURNING *`,
      [messageId]
    );
    const { rows: user } = await client.query(
      `SELECT username, avatar_url FROM users WHERE id = $1`,
      [userId]
    );
    return normalizeMessage({ ...deletedRows[0], sender_username: user[0]?.username, sender_avatar_url: user[0]?.avatar_url }, userId);
  });
};

export const deleteMessage = (io) => async (req, res) => {
  const userId = req.user.id;
  const { messageId } = req.params;

  try {
    const deletedMessage = await deleteMessageSocket(userId, messageId);

    if (!deletedMessage) {
      return res.status(404).json({ error: "Message not found or you are not the sender" });
    }

    if (io) {
      if (deletedMessage.recipient_id) {
        const room = `dm_${[deletedMessage.sender_id, deletedMessage.recipient_id].sort().join("_")}`;
        io.to(room).emit("messageDeleted", { messageId: deletedMessage.id });
      } else if (deletedMessage.group_id) {
        io.to(`group_${deletedMessage.group_id}`).emit("messageDeleted", { messageId: deletedMessage.id });
      }
    }

    res.json({ success: true, deletedMessage });
  } catch (err) {
    console.error("Failed to delete message:", err.message);
    res.status(500).json({ error: "Failed to delete message" });
  }
};

export const sendDM = (io) => async (req, res) => {
  const senderId = req.user.id;
  const { recipient_id, content } = req.body;

  if (!recipient_id || !content?.trim() || recipient_id === senderId) {
    return res.status(400).json({ error: "Recipient and content required, cannot send to self" });
  }

  try {
    const message = await saveMessage({ sender_id: senderId, recipient_id, content });
    if (io) {
      const room = `dm_${[senderId, recipient_id].sort().join("_")}`;
      io.to(room).emit("dmMessage", message);
    }
    res.json(message);
  } catch (err) {
    console.error("Failed to send DM:", err.message);
    res.status(500).json({ error: err.message || "Failed to send DM" });
  }
};

export const sendGroupMessage = (io) => async (req, res) => {
  const senderId = req.user.id;
  const { group_id, content } = req.body;

  if (!group_id || !content?.trim()) {
    return res.status(400).json({ error: "Group ID and content required" });
  }

  try {
    const message = await saveMessage({ sender_id: senderId, group_id, content });
    if (io) {
      io.to(`group_${group_id}`).emit("groupMessage", message);
    }
    res.json(message);
  } catch (err) {
    console.error("Failed to send group message:", err.message);
    res.status(500).json({ error: err.message || "Failed to send group message" });
  }
};

export const getDMs = async (req, res) => {
  const userId = req.user.id;

  try {
    const rows = await withClient(async (client) => {
      const { rows } = await client.query(
        `
        WITH ranked AS (
          SELECT 
            CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS otherUserId,
            m.content,
            m.created_at,
            ROW_NUMBER() OVER (
              PARTITION BY CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END
              ORDER BY m.created_at DESC
            ) as rn
          FROM messages m
          WHERE (m.sender_id = $1 OR m.recipient_id = $1)
            AND m.group_id IS NULL
        )
        SELECT 
          u.id AS "otherUserId",
          u.username,
          u.avatar_url,
          r.content AS "lastMessage",
          r.created_at AS "lastMessageAt"
        FROM ranked r
        JOIN users u ON u.id = r.otherUserId
        WHERE r.rn = 1
        ORDER BY r.created_at DESC NULLS LAST
        `,
        [userId]
      );
      return rows;
    });

    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch DMs:", err.message);
    res.status(500).json({ error: "Failed to fetch DMs" });
  }
};

export const getDMConversation = async (req, res) => {
  const userId = req.user.id;
  const otherUserId = parseInt(req.params.otherUserId, 10);

  if (isNaN(otherUserId)) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  try {
    const rows = await withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT m.*, u.username AS sender_username, u.avatar_url AS sender_avatar_url
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE ((m.sender_id=$1 AND m.recipient_id=$2)
             OR (m.sender_id=$2 AND m.recipient_id=$1))
           AND m.group_id IS NULL
         ORDER BY m.created_at ASC`,
        [userId, otherUserId]
      );
      return rows.map((r) => normalizeMessage(r, userId));
    });

    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch DM conversation:", err.message);
    res.status(500).json({ error: "Failed to fetch DM conversation" });
  }
};

export const getGroups = async (req, res) => {
  const userId = req.user.id;

  try {
    const rows = await withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT g.*, gm.role
         FROM groups g
         JOIN group_members gm ON g.id = gm.group_id
         WHERE gm.user_id = $1`,
        [userId]
      );
      return rows;
    });

    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch groups:", err.message);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
};

export const getGroupMessages = async (req, res) => {
  const groupId = parseInt(req.params.groupId, 10);
  const userId = req.user.id;

  try {
    const rows = await withClient(async (client) => {
      const membership = await client.query(
        `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2`,
        [groupId, userId]
      );
      if (membership.rowCount === 0) return null;

      const { rows } = await client.query(
        `SELECT m.*, u.username AS sender_username, u.avatar_url AS sender_avatar_url
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.group_id=$1
         ORDER BY m.created_at ASC`,
        [groupId]
      );
      return rows.map((r) => normalizeMessage(r, userId));
    });

    if (!rows) {
      return res.status(403).json({ error: "You are not a member of this group" });
    }

    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch group messages:", err.message);
    res.status(500).json({ error: "Failed to fetch group messages" });
  }
};

export const startDMThread = async (req, res) => {
  const senderId = req.user.id;
  const { recipient_id } = req.body;

  if (!recipient_id || recipient_id === senderId) {
    return res.status(400).json({ error: "Valid recipient required, cannot be self" });
  }

  try {
    const threadExists = await withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM messages
         WHERE ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1))
           AND group_id IS NULL
         LIMIT 1`,
        [senderId, recipient_id]
      );
      return rows.length > 0;
    });

    res.json({ threadStarted: true, new: !threadExists });
  } catch (err) {
    console.error("Failed to start DM thread:", err.message);
    res.status(500).json({ error: "Failed to start DM thread" });
  }
};

export const createGroup = async (req, res) => {
  const userId = req.user.id;
  const { name, memberIds } = req.body;
  const avatar = req.file;

  if (!name?.trim()) {
    return res.status(400).json({ error: "Group name is required" });
  }
  if (!memberIds) {
    return res.status(400).json({ error: "memberIds is required" });
  }

  let parsedMemberIds;
  try {
    console.log("Received memberIds:", memberIds, typeof memberIds);
    parsedMemberIds = JSON.parse(memberIds);
    if (!Array.isArray(parsedMemberIds) || parsedMemberIds.length === 0) {
      return res.status(400).json({ error: "At least one member is required" });
    }
    if (parsedMemberIds.includes(userId)) {
      return res.status(400).json({ error: "Cannot add yourself as a member (creator is automatically included)" });
    }
  } catch (err) {
    console.error("Failed to parse memberIds:", err.message, memberIds);
    return res.status(400).json({ error: "Invalid memberIds format" });
  }

  try {
    const group = await withClient(async (client) => {
      const { rows: validUsers } = await client.query(
        `SELECT id FROM users WHERE id = ANY($1)`,
        [parsedMemberIds]
      );
      const validMemberIds = validUsers.map((u) => u.id);
      if (validMemberIds.length !== parsedMemberIds.length) {
        throw new Error("One or more member IDs are invalid");
      }

      let avatarUrl = null;
      if (avatar) {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "group-avatars",
              resource_type: "image",
            },
            (error, result) => {
              if (error) reject(new Error("Failed to upload avatar to Cloudinary"));
              resolve(result);
            }
          );
          stream.end(avatar.buffer);
        });
        avatarUrl = result.secure_url;
      }

      const { rows: groupRows } = await client.query(
        `INSERT INTO groups (name, created_by, avatar_url) VALUES ($1, $2, $3) RETURNING id, name, avatar_url`,
        [name.trim(), userId, avatarUrl]
      );
      const group = groupRows[0];

      await client.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)`,
        [group.id, userId, "admin"]
      );

      for (const memberId of parsedMemberIds) {
        await client.query(
          `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)`,
          [group.id, memberId, "member"]
        );
      }

      return {
        id: group.id,
        name: group.name,
        avatar_url: group.avatar_url || null,
        role: "admin",
        members: [userId, ...parsedMemberIds],
      };
    });

    const io = req.app.get("io");
    if (io) {
      for (const memberId of [userId, ...parsedMemberIds]) {
        io.to(`user_${memberId}`).emit("groupCreated", group);
      }
    }

    res.json(group);
  } catch (err) {
    console.error("Failed to create group:", err.message);
    res.status(500).json({ error: err.message || "Failed to create group" });
  }
};