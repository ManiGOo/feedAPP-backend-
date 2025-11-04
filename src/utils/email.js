// src/utils/email.js
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
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
    throw error;
  }
};