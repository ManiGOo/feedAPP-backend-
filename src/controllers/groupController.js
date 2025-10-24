import pool from "../config/db.js";

export const getGroupMembers = async (req, res) => {
  const { groupId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT 
        gm.user_id AS id,
        u.username,
        u.avatar_url AS author_avatar,
        gm.role,
        gm.joined_at
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
      ORDER BY gm.joined_at ASC
      `,
      [groupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No members found for this group" });
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching group members:", err.message);
    res.status(500).json({ error: "Failed to fetch group members" });
  }
};