// src/controllers/passwordController.js
import pool from "../config/db.js";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendResetEmail } from "../utils/email.js";

const RESET_TOKEN_EXPIRE_MIN = 15; // minutes

// -------------------------------------------------
// 1. Request reset → create token + send email
// -------------------------------------------------
export const requestReset = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  try {
    // Find user (case-insensitive)
    const userRes = await pool.query(
      `SELECT id, username, email FROM users WHERE lower(email) = lower($1)`,
      [email]
    );
    const user = userRes.rows[0];

    if (!user) {
      // Do NOT reveal whether the email exists
      return res.json({ message: "If the email exists, a reset link has been sent." });
    }

    // Invalidate any previous token for this user
    await pool.query(`UPDATE password_resets SET used = TRUE WHERE user_id = $1`, [user.id]);

    // Generate a cryptographically strong token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const token = jwt.sign(
      { userId: user.id, raw: rawToken },
      process.env.JWT_RESET_SECRET,
      { expiresIn: `${RESET_TOKEN_EXPIRE_MIN}m` }
    );

    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRE_MIN * 60 * 1000);
    await pool.query(
      `INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt]
    );

    // -------------------------------------------------
    // Build clean reset URL (no double slash!)
    // -------------------------------------------------
    const baseUrl = process.env.FRONTEND_URL.replace(/\/+$/, ""); // Remove trailing slashes
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    // Send email with expire time
    await sendResetEmail(user.email, resetUrl, RESET_TOKEN_EXPIRE_MIN);

    res.json({ message: "If the email exists, a reset link has been sent." });
  } catch (err) {
    console.error("Password reset request error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
};

// -------------------------------------------------
// 2. Reset password with token
// -------------------------------------------------
export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword)
    return res.status(400).json({ error: "Token and new password required" });

  try {
    // Verify JWT (throws if invalid/expired)
    const payload = jwt.verify(token, process.env.JWT_RESET_SECRET);
    const { userId } = payload;

    // Find DB row
    const resetRes = await pool.query(
      `SELECT * FROM password_resets
       WHERE token = $1 AND user_id = $2 AND used = FALSE AND expires_at > NOW()`,
      [token, userId]
    );
    const resetRow = resetRes.rows[0];
    if (!resetRow) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    // Mark token as used
    await pool.query(`UPDATE password_resets SET used = TRUE WHERE id = $1`, [resetRow.id]);

    // Hash new password + update user
    const hashed = await argon2.hash(newPassword);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hashed, userId]);

    // OPTIONAL: delete all refresh tokens for this user (force re-login)
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Password reset error:", err);
    if (err.name === "TokenExpiredError" || err.name === "JsonWebTokenError") {
      return res.status(400).json({ error: "Invalid or expired token" });
    }
    res.status(500).json({ error: "Something went wrong" });
  }
};