// test-db.js
// import dotenv from "dotenv";
// import pg from "pg";

// dotenv.config();

// const { Pool } = pg;

// const pool = new Pool({
//   connectionString: process.env.DATABASE_URL,
// });

// (async () => {
//   try {
//     const res = await pool.query("SELECT NOW()");
//     console.log("✅ Postgres connected:", res.rows[0].now);
//   } catch (err) {
//     console.error("❌ DB connection error:", err.message || err);
//   } finally {
//     await pool.end();
//     process.exit(0);
//   }
// })();

import pool from "../friendfeed-backend/src/config/db.js";
import argon2 from "argon2";

async function testDB() {
  try {
    // Test connection
    const res = await pool.query("SELECT NOW()");
    console.log("✅ Connected to DB:", res.rows[0]);

    // Test insert into users table
    const username = "testuser";
    const email = "testuser@example.com";
    const password = "testpassword";

    const hashedPassword = await argon2.hash(password);

    const insertRes = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email`,
      [username, email, hashedPassword]
    );

    console.log("✅ User inserted:", insertRes.rows[0]);

    // Test select
    const selectRes = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    console.log("✅ User fetched:", selectRes.rows[0]);
  } catch (err) {
    console.error("❌ DB test failed:", err.message);
  } finally {
    pool.end();
  }
}

testDB();