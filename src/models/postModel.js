//src/models/postModels.js

import pool from "../db/index.js";

export const getAllPosts = async () => {
  const res = await pool.query(`
    SELECT posts.id, posts.content, posts.created_at AS "createdAt", users.username AS "user"
    FROM posts
    JOIN users ON posts.user_id = users.id
    ORDER BY posts.created_at DESC
  `);
  return res.rows;
};

export const getPostById = async (id) => {
  const res = await pool.query(`
    SELECT posts.id, posts.content, posts.created_at AS "createdAt", users.username AS "user"
    FROM posts
    JOIN users ON posts.user_id = users.id
    WHERE posts.id=$1
  `, [id]);
  return res.rows[0];
};
