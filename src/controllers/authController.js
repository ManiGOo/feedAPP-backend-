// src/controllers/authController.js
import pool from "../config/db.js";
import jwt from "jsonwebtoken";
import argon2 from "argon2";

// -------------------- TOKEN HELPERS --------------------
const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
};

const generateRefreshToken = async (user) => {
  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );

  // store refresh token in DB
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token) VALUES ($1, $2)`,
    [user.id, refreshToken]
  );

  return refreshToken;
};

// -------------------- CONTROLLERS --------------------

// Register
export const register = async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = await argon2.hash(password);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, email, hashedPassword]
    );

    const user = result.rows[0];
    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user);

    res.status(201).json({ accessToken, refreshToken, user });
  } catch (err) {
    console.error("Error registering user:", err.message);
    res.status(500).json({ error: "Registration failed" });
  }
};

// Login
export const login = async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE username = $1`,
      [username]
    );
    const user = result.rows[0];

    if (!user || !(await argon2.verify(user.password_hash, password))) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = await generateRefreshToken(user);

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (err) {
    console.error("Error logging in:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
};

// Refresh
export const refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken)
    return res.status(401).json({ error: "Refresh token missing" });

  try {
    // check if refresh token exists in DB
    const result = await pool.query(
      `SELECT * FROM refresh_tokens WHERE token = $1`,
      [refreshToken]
    );
    if (result.rows.length === 0)
      return res.status(403).json({ error: "Invalid refresh token" });

    jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, user) => {
      if (err) return res.status(403).json({ error: "Invalid refresh token" });

      const newAccessToken = generateAccessToken(user);
      res.json({ accessToken: newAccessToken });
    });
  } catch (err) {
    console.error("Error refreshing token:", err.message);
    res.status(500).json({ error: "Failed to refresh token" });
  }
};

// Logout (invalidate refresh token)
export const logout = async (req, res) => {
  const { refreshToken } = req.body;
  try {
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [refreshToken]);
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("Error logging out:", err.message);
    res.status(500).json({ error: "Logout failed" });
  }
};