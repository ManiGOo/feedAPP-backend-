import cron from "node-cron";
import pool from "../config/db.js";

cron.schedule("0 * * * *", async () => {
  await pool.query(
    `DELETE FROM password_resets WHERE expires_at < NOW() OR used = TRUE`
  );
});