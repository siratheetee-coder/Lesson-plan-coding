// Email sender — supports two backends:
//
//   1. Resend HTTP API  (RESEND_API_KEY set)  ← recommended on Render (SMTP blocked)
//   2. Generic SMTP     (SMTP_HOST set)       ← local dev / own mail server
//
// If neither is set → no-op (isEmailEnabled() returns false).

const APP_URL = () => process.env.APP_ORIGIN || 'http://localhost:3000';
const FROM    = () => process.env.SMTP_FROM   || '"Lesson Plan Generator" <noreply@example.com>';

// ─── Public flag ────────────────────────────────────────
export function isEmailEnabled() {
  return !!(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
}

// ─── Resend HTTP API sender ─────────────────────────────
async function sendViaResend({ to, subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM(), to, subject, text, html }),
    signal: AbortSignal.timeout(15_000), // 15s max
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API ${res.status}: ${body}`);
  }
  return res.json();
}

// ─── SMTP sender (nodemailer) ──────────────────────────
let _smtpTransport = null;
async function sendViaSmtp({ to, subject, text, html }) {
  if (!_smtpTransport) {
    const nodemailer = (await import('nodemailer')).default;
    _smtpTransport = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls:    { rejectUnauthorized: process.env.NODE_ENV === 'production' },
      connectionTimeout: 10_000,
      greetingTimeout:   10_000,
      socketTimeout:     20_000,
    });
  }
  return _smtpTransport.sendMail({ from: FROM(), to, subject, text, html });
}

// ─── Unified send ───────────────────────────────────────
async function sendMail(opts) {
  if (process.env.RESEND_API_KEY) {
    return sendViaResend(opts);
  }
  if (process.env.SMTP_HOST) {
    return sendViaSmtp(opts);
  }
  // No email configured — dev no-op
  if (process.env.DEBUG_MAIL === '1') {
    console.log('\n📧 [DEV MAIL - not sent]', opts.subject, '→', opts.to);
  }
  return { skipped: true };
}

// ─── Send verification email ────────────────────────────
export async function sendVerificationEmail(email, token) {
  const link = `${APP_URL()}/?verify=${token}`;
  await sendMail({
    to: email,
    subject: 'ยืนยันอีเมลของคุณ — Lesson Plan Generator',
    text: `สวัสดี!\n\nกรุณาคลิกลิงก์ด้านล่างเพื่อยืนยันอีเมล (หมดอายุใน 24 ชั่วโมง)\n\n${link}\n\nหากคุณไม่ได้สมัคร ไม่ต้องดำเนินการใดๆ`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
        <h2 style="color:#1e293b">ยืนยันอีเมลของคุณ</h2>
        <p style="color:#475569">กรุณาคลิกปุ่มด้านล่างเพื่อยืนยันที่อยู่อีเมล ลิงก์หมดอายุใน 24 ชั่วโมง</p>
        <a href="${link}" style="display:inline-block;margin:20px 0;padding:12px 28px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
          ✓ ยืนยันอีเมล
        </a>
        <p style="color:#94a3b8;font-size:13px;margin-top:24px;">
          หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้:<br>
          <a href="${link}" style="color:#7c3aed">${link}</a>
        </p>
      </div>`,
  });
}

// ─── Send password reset email ──────────────────────────
export async function sendPasswordResetEmail(email, token) {
  const link = `${APP_URL()}/?reset=${token}`;
  await sendMail({
    to: email,
    subject: 'รีเซ็ตรหัสผ่าน — Lesson Plan Generator',
    text: `สวัสดี!\n\nมีคำขอรีเซ็ตรหัสผ่าน คลิกลิงก์ด้านล่าง (หมดอายุใน 1 ชั่วโมง)\n\n${link}\n\nหากไม่ได้ขอรีเซ็ต ไม่ต้องดำเนินการใดๆ`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
        <h2 style="color:#1e293b">รีเซ็ตรหัสผ่าน</h2>
        <p style="color:#475569">มีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีนี้ คลิกปุ่มด้านล่าง (หมดอายุใน 1 ชั่วโมง)</p>
        <a href="${link}" style="display:inline-block;margin:20px 0;padding:12px 28px;background:#dc2626;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
          🔑 รีเซ็ตรหัสผ่าน
        </a>
        <p style="color:#94a3b8;font-size:13px;margin-top:24px;">
          หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้:<br>
          <a href="${link}" style="color:#dc2626">${link}</a>
        </p>
        <p style="color:#94a3b8;font-size:12px;">หากไม่ได้ขอรีเซ็ต รหัสผ่านของคุณยังคงเดิม</p>
      </div>`,
  });
}
