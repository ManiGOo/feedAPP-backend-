// src/utils/email.js
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,  // ← CHANGED: Use 587 (STARTTLS) instead of 465 (SSL) – better for cloud
  secure: false,  // ← true for 465, false for other ports
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,  // Your App Password
  },
  // ← ADDED: Increase timeouts for Render's slow network
  connectionTimeout: 60000,  // 60 seconds (default: 10s)
  greetingTimeout: 30000,    // 30 seconds
  socketTimeout: 60000,      // 60 seconds
  // ← ADDED: Ignore TLS cert errors (helps on some clouds)
  tls: {
    rejectUnauthorized: false,
  },
});

export const sendResetEmail = async (to, resetUrl, expireMin = 15) => {
  try {
    console.log('Sending email to:', to);
    console.log('Reset URL:', resetUrl);

    const mailOptions = {
      from: `"Your App" <${process.env.GMAIL_USER}>`,
      to,
      subject: 'Password Reset – Your App',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;">
          <h2>Reset Your Password</h2>
          <p>Click below to set a new password (expires in <strong>${expireMin} minutes</strong>).</p>
          <a href="${resetUrl}"
             style="background:#007bff;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;">
            Reset Password
          </a>
          <p style="margin-top:20px;font-size:0.9em;color:#555;">
            Or copy: <code style="background:#f4f4f4;padding:2px 6px;">${resetUrl}</code>
          </p>
          <p>If you didn't request this, ignore it.</p>
        </div>
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Gmail sent! Message ID:', result.messageId);
  } catch (error) {
    console.error('Gmail error:', error.message);
    console.error('Full error:', error);  // ← ADDED: More debug info
    throw error;
  }
};