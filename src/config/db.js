// config/db.js
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Neon SSL
  },
  max: 20, // Maximum number of connections in pool (default is 10, increased for concurrency)
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 2000, // Timeout connection attempts after 2 seconds
  maxUses: 7500, // Close connections after 7500 uses to prevent leaks
});

export default pool;