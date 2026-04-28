// Email sender — nodemailer with SMTP config from env.
// If SMTP_HOST is not set, all email-sending becomes a no-op and `isEmailEnabled()`
// returns false so callers can skip verification flows entirely.

import nodemailer from 'nodemailer';

let _transport = null;

// Public flag: is real email sending wired up?
export function isEmailEnabled() {
  return !!process.env.SMTP_HOST;
}

function getTransport() {
  if (_transport) return _transport;

  if (process.env.SMTP_HOST) {
    _transport = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    });
  } else {
    // No SMTP configured: silent no-op (avoid console spam in production).
    // Set DEBUG_MAIL=1 in env to log would-be emails for local dev.
    _transport = {
      sendMail: async (opts) => {
        if (process.env.DEBUG_MAIL === '1') {
          console.log('\n📧 ─── [DEV MAIL - not sent] ───────────────────────────');
          console.log(`   To:      ${opts.to}`);
          console.log(`   Subject: ${opts.subject}`);
          console.log('────────────────────────────────────────────────────────\n');
        }
        return { messageId: 'noop-' + Date.now(), skipped: true };
      },
    };
  }
  return _transport;
}

const FROM = () => process.env.SMTP_FROM || '"Lesson Plan Generator" <noreply@example.com>';
const APP_URL = () => process.env.APP_ORIGIN || 'http://localhost:3000';

// ─── Send verification email ────────────────────────────
export async function sendVerificationEmail(email, token) {
  const link = `${APP_URL()}/?verify=${token}`;
  await getTransport().sendMail({
    from: FROM(),
    to: email,
    subject: 'ยืนยันอีเมลของคุณ — Lesson Plan Generator',
    text: `สวัสดี!\n\nกรุณาคลิกลิงก์ด้านล่างเพื่อยืนยันอีเมล (ลิงก์หมดอายุใน 24 ชั่วโมง)\n\n${link}\n\nหากคุณไม่ได้สมัครใช้งาน ไม่ต้องดำเนินการใดๆ`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
        <h2 style="color:#1e293b">ยืนยันอีเมลของคุณ</h2>
        <p style="color:#475569">กรุณาคลิกปุ่มด้านล่างเพื่อยืนยันที่อยู่อีเมล ลิงก์หมดอายุใน 24 ชั่วโมง</p>
        <a href="${link}"
           style="display:inline-block;margin:20px 0;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
          ✓ ยืนยันอีเมล
        </a>
        <p style="color:#94a3b8;font-size:13px;margin-top:24px;">
          หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br>
          <a href="${link}" style="color:#7c3aed">${link}</a>
        </p>
        <p style="color:#94a3b8;font-size:12px;">หากคุณไม่ได้สมัครใช้งาน ไม่ต้องดำเนินการใดๆ</p>
      </div>
    `,
  });
}

// ─── Send password reset email ──────────────────────────
export async function sendPasswordResetEmail(email, token) {
  const link = `${APP_URL()}/?reset=${token}`;
  await getTransport().sendMail({
    from: FROM(),
    to: email,
    subject: 'รีเซ็ตรหัสผ่าน — Lesson Plan Generator',
    text: `สวัสดี!\n\nมีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีนี้\n\nคลิกลิงก์ด้านล่าง (หมดอายุใน 1 ชั่วโมง)\n\n${link}\n\nหากคุณไม่ได้ขอรีเซ็ต ไม่ต้องดำเนินการใดๆ`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
        <h2 style="color:#1e293b">รีเซ็ตรหัสผ่าน</h2>
        <p style="color:#475569">มีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีนี้ คลิกปุ่มด้านล่าง (ลิงก์หมดอายุใน 1 ชั่วโมง)</p>
        <a href="${link}"
           style="display:inline-block;margin:20px 0;padding:12px 28px;background:#dc2626;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
          🔑 รีเซ็ตรหัสผ่าน
        </a>
        <p style="color:#94a3b8;font-size:13px;margin-top:24px;">
          หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้:<br>
          <a href="${link}" style="color:#dc2626">${link}</a>
        </p>
        <p style="color:#94a3b8;font-size:12px;">หากคุณไม่ได้ขอรีเซ็ต ไม่ต้องดำเนินการใดๆ และรหัสผ่านของคุณยังคงเดิม</p>
      </div>
    `,
  });
}
