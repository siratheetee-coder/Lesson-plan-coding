import express from 'express';
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { db, now } from '../db.js';
import {
  hashPassword, verifyPassword, validatePasswordPolicy, validateEmail,
} from '../utils/password.js';
import {
  signAccessToken, signRefreshToken, verifyRefreshToken, hashToken, ttlToMs, TTL,
} from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { FREE_CREDITS_ON_REGISTER } from '../config/packages.js';
import { sendVerificationEmail, sendPasswordResetEmail, isEmailEnabled } from '../utils/mailer.js';
import { limiters } from '../utils/limiters.js';
import { audit, ACTIONS } from '../utils/audit.js';

const router = express.Router();

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// ─── Email token helpers ─────────────────────────────────
function makeRawToken() { return crypto.randomBytes(32).toString('hex'); }
function hashRawToken(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }

async function createAndSendVerification(user) {
  // Email not configured → auto-verify the user instead of sending a token they can never receive.
  if (!isEmailEnabled()) {
    if (!user.email_verified) {
      await db.updateUser(user.id, { email_verified: 1, updated_at: now() });
    }
    return;
  }
  const raw = makeRawToken();
  const hash = hashRawToken(raw);
  const expiresAt = now() + 24 * 60 * 60 * 1000; // 24h
  await db.createEmailToken(user.id, 'verify_email', hash, expiresAt);
  await sendVerificationEmail(user.email, raw).catch(err =>
    console.error('[mailer] sendVerificationEmail failed:', err.message)
  );
}

function setRefreshCookie(res, token, remember) {
  const maxAge = ttlToMs(remember ? TTL.LONG : TTL.SHORT);
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // 'lax' works for same-origin while still preventing CSRF
    path: '/auth',
    maxAge,
  });
}
function clearRefreshCookie(res) {
  res.clearCookie('refresh_token', { path: '/auth' });
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role || 'teacher',
    emailVerified: !!u.email_verified,
    hasPassword: !!u.password_hash,
    hasGoogle: !!u.google_sub,
    credits: u.credits ?? 0,
  };
}

// Auto-promote users to admin if their email is in ADMIN_EMAILS env var
// (comma-separated list, e.g. ADMIN_EMAILS=alice@example.com,bob@example.com)
function shouldBeAdmin(email) {
  const list = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(email || '').toLowerCase());
}
async function promoteIfAdminEmail(user) {
  if (!user) return user;
  if (user.role !== 'admin' && shouldBeAdmin(user.email)) {
    await db.updateUser(user.id, { role: 'admin', updated_at: now() });
    user.role = 'admin';
  }
  return user;
}

async function issueSession(user, req, res, remember) {
  const access = signAccessToken(user);
  const { token: refresh, jti } = signRefreshToken(user, { remember });
  const expiresAt = now() + ttlToMs(remember ? TTL.LONG : TTL.SHORT);
  await db.insertRefreshToken({
    id: jti,
    user_id: user.id,
    token_hash: hashToken(refresh),
    user_agent: (req.headers['user-agent'] || '').slice(0, 255),
    ip: req.ip || null,
    expires_at: expiresAt,
    revoked_at: null,
    created_at: now(),
  });
  setRefreshCookie(res, refresh, remember);
  return { accessToken: access, user: publicUser(user) };
}

// ─── POST /auth/register ────────────────────────────────
router.post('/register', limiters.register, async (req, res) => {
  try {
    const { email, password, displayName, remember } = req.body || {};
    if (!validateEmail(email)) return res.status(400).json({ error: 'invalid_email', message: 'อีเมลไม่ถูกต้อง' });
    const policyError = validatePasswordPolicy(password);
    if (policyError) return res.status(400).json({ error: 'weak_password', message: policyError });

    if (await db.findUserByEmail(email)) {
      return res.status(409).json({ error: 'email_taken', message: 'อีเมลนี้ถูกใช้แล้ว' });
    }
    const hash = await hashPassword(password);
    const id = crypto.randomUUID();
    const t = now();
    const role = shouldBeAdmin(email) ? 'admin' : 'teacher';
    await db.insertUser({
      id,
      email: email.toLowerCase(),
      password_hash: hash,
      display_name: (displayName || '').trim() || null,
      google_sub: null,
      role,
      email_verified: isEmailEnabled() ? 0 : 1,
      failed_attempts: 0,
      locked_until: null,
      last_login_at: null,
      created_at: t,
      updated_at: t,
      credits: FREE_CREDITS_ON_REGISTER,
    });
    const user = await db.findUserById(id);
    // Give free bonus credits
    if (FREE_CREDITS_ON_REGISTER > 0) {
      await db.addCredits(id, FREE_CREDITS_ON_REGISTER, 'bonus',
        `ฟรี ${FREE_CREDITS_ON_REGISTER} แผนแรก`, null, crypto.randomUUID());
    }
    audit(id, ACTIONS.REGISTER, { method: 'password', role }, req);
    // Send verification email async — don't block the response
    createAndSendVerification(user).catch(() => {});
    res.json(await issueSession(user, req, res, !!remember));
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /auth/login ───────────────────────────────────
router.post('/login', limiters.auth, async (req, res) => {
  try {
    const { email, password, remember } = req.body || {};
    if (!validateEmail(email) || typeof password !== 'string') {
      return res.status(400).json({ error: 'invalid_credentials', message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }
    const user = await db.findUserByEmail(email);

    if (user && user.locked_until && user.locked_until > now()) {
      return res.status(429).json({
        error: 'account_locked',
        message: 'บัญชีถูกล็อกชั่วคราว กรุณารอ 15 นาที',
      });
    }

    const ok = await verifyPassword(password, user?.password_hash);
    if (!ok) {
      if (user) {
        const attempts = (user.failed_attempts || 0) + 1;
        const lockUntil = attempts >= LOCKOUT_THRESHOLD ? now() + LOCKOUT_MS : null;
        await db.updateUser(user.id, { failed_attempts: attempts, locked_until: lockUntil, updated_at: now() });
        audit(user.id, ACTIONS.LOGIN_FAILED, { attempts }, req);
      }
      return res.status(401).json({ error: 'invalid_credentials', message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }
    await db.updateUser(user.id, { failed_attempts: 0, locked_until: null, last_login_at: now(), updated_at: now() });
    await promoteIfAdminEmail(user);
    audit(user.id, ACTIONS.LOGIN_SUCCESS, { method: 'password' }, req);
    res.json(await issueSession(user, req, res, !!remember));
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /auth/google ──────────────────────────────────
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post('/google', limiters.auth, async (req, res) => {
  try {
    const { credential, remember } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'missing_credential' });
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'google_not_configured' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub, email, email_verified, name } = payload || {};
    if (!sub || !email) return res.status(400).json({ error: 'invalid_google_token' });

    let user = await db.findUserByGoogleSub(sub) || await db.findUserByEmail(email);
    const t = now();
    if (!user) {
      const id = crypto.randomUUID();
      const role = shouldBeAdmin(email) ? 'admin' : 'teacher';
      await db.insertUser({
        id, email: email.toLowerCase(), password_hash: null,
        display_name: name || null, google_sub: sub, role,
        email_verified: email_verified ? 1 : 0,
        failed_attempts: 0, locked_until: null,
        last_login_at: t, created_at: t, updated_at: t,
        credits: FREE_CREDITS_ON_REGISTER,
      });
      user = await db.findUserById(id);
      // Give free bonus credits
      if (FREE_CREDITS_ON_REGISTER > 0) {
        await db.addCredits(id, FREE_CREDITS_ON_REGISTER, 'bonus',
          `ฟรี ${FREE_CREDITS_ON_REGISTER} แผนแรก`, null, crypto.randomUUID());
      }
      audit(id, ACTIONS.REGISTER, { method: 'google', role }, req);
      // Google sign-up: email already verified by Google
    } else if (!user.google_sub) {
      await db.updateUser(user.id, { google_sub: sub, email_verified: 1, updated_at: t, last_login_at: t });
      user = await db.findUserById(user.id);
      audit(user.id, ACTIONS.LINK_GOOGLE, null, req);
    } else {
      await db.updateUser(user.id, { last_login_at: t, updated_at: t });
    }
    await promoteIfAdminEmail(user);
    audit(user.id, ACTIONS.LOGIN_SUCCESS, { method: 'google' }, req);
    res.json(await issueSession(user, req, res, !!remember));
  } catch (err) {
    console.error('google login error', err);
    res.status(401).json({ error: 'google_verification_failed' });
  }
});

// ─── POST /auth/refresh ─────────────────────────────────
router.post('/refresh', limiters.auth, async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ error: 'no_refresh_token' });
  try {
    const payload = verifyRefreshToken(token);
    const row = await db.findRefreshToken(payload.jti);
    if (!row || row.revoked_at || row.expires_at < now()) {
      return res.status(401).json({ error: 'refresh_invalid' });
    }
    if (row.token_hash !== hashToken(token)) {
      await db.revokeAllUserTokens(payload.sub, now());
      audit(payload.sub, ACTIONS.REFRESH_TOKEN_MISMATCH, null, req);
      return res.status(401).json({ error: 'refresh_invalid' });
    }
    const user = await db.findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'user_not_found' });

    await db.revokeRefreshToken(payload.jti, now());
    const remember = (row.expires_at - row.created_at) > ttlToMs(TTL.SHORT) + 1000;
    res.json(await issueSession(user, req, res, remember));
  } catch {
    return res.status(401).json({ error: 'refresh_invalid' });
  }
});

// ─── POST /auth/logout ──────────────────────────────────
router.post('/logout', async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await db.revokeRefreshToken(payload.jti, now());
      audit(payload.sub, ACTIONS.LOGOUT, null, req);
    } catch { /* ignore */ }
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
});

// ─── GET /auth/config ──────────────────────────────────
// Public endpoint: lets the frontend know which auth features are wired.
router.get('/config', (_req, res) => {
  res.json({
    emailEnabled: isEmailEnabled(),
    googleEnabled: !!process.env.GOOGLE_CLIENT_ID,
  });
});

// ─── GET /auth/me ───────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const user = await db.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  res.json({ user: publicUser(user) });
});

// ─── POST /auth/change-password ─────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) return res.status(400).json({ error: 'weak_password', message: policyError });
    const user = await db.findUserById(req.user.id);
    if (user.password_hash) {
      const ok = await verifyPassword(oldPassword || '', user.password_hash);
      if (!ok) return res.status(401).json({ error: 'wrong_password' });
    }
    const hash = await hashPassword(newPassword);
    await db.updateUser(user.id, { password_hash: hash, updated_at: now() });
    await db.revokeAllUserTokens(user.id, now());
    audit(user.id, ACTIONS.CHANGE_PASSWORD, null, req);
    res.json({ ok: true });
  } catch (e) {
    console.error('change-password error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /auth/resend-verification ─────────────────────
router.post('/resend-verification', requireAuth, limiters.email, async (req, res) => {
  try {
    if (!isEmailEnabled()) {
      return res.status(503).json({
        error: 'email_disabled',
        message: 'ระบบส่งอีเมลยังไม่ได้ตั้งค่า — บัญชีของคุณถูกยืนยันให้อัตโนมัติแล้ว',
      });
    }
    const user = await db.findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'not_found' });
    if (user.email_verified) {
      return res.status(400).json({ error: 'already_verified', message: 'อีเมลได้รับการยืนยันแล้ว' });
    }
    await createAndSendVerification(user);
    audit(user.id, ACTIONS.RESEND_VERIFICATION, null, req);
    res.json({ ok: true, message: 'ส่งอีเมลยืนยันแล้ว กรุณาตรวจสอบกล่องจดหมาย' });
  } catch (e) {
    console.error('resend-verification error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /auth/verify-email ─────────────────────────────
// Body: { token }  (the raw 64-char hex from the email link)
router.post('/verify-email', limiters.strict, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'missing_token' });
    }
    const hash = hashRawToken(token.trim());
    const row = await db.findEmailToken(hash);

    if (!row || row.type !== 'verify_email') {
      return res.status(400).json({ error: 'invalid_token', message: 'ลิงก์ยืนยันไม่ถูกต้อง' });
    }
    if (row.used_at) {
      return res.status(400).json({ error: 'token_used', message: 'ลิงก์นี้ถูกใช้ไปแล้ว' });
    }
    if (row.expires_at < now()) {
      return res.status(400).json({ error: 'token_expired', message: 'ลิงก์หมดอายุแล้ว กรุณาขอส่งใหม่' });
    }

    await db.useEmailToken(row.id);
    await db.updateUser(row.user_id, { email_verified: 1, updated_at: now() });
    audit(row.user_id, ACTIONS.EMAIL_VERIFIED, null, req);
    res.json({ ok: true, message: 'ยืนยันอีเมลสำเร็จ' });
  } catch (e) {
    console.error('verify-email error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /auth/forgot-password ─────────────────────────
router.post('/forgot-password', limiters.email, async (req, res) => {
  try {
    if (!isEmailEnabled()) {
      return res.status(503).json({
        error: 'email_disabled',
        message: 'ระบบส่งอีเมลยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบเพื่อรีเซ็ตรหัสผ่าน',
      });
    }
    const { email } = req.body || {};
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'invalid_email', message: 'อีเมลไม่ถูกต้อง' });
    }
    // Always respond with the same message to prevent email enumeration
    const user = await db.findUserByEmail(email);
    if (user) {
      const raw = makeRawToken();
      const hash = hashRawToken(raw);
      const expiresAt = now() + 60 * 60 * 1000; // 1 hour
      await db.createEmailToken(user.id, 'reset_password', hash, expiresAt);
      await sendPasswordResetEmail(user.email, raw).catch(err =>
        console.error('[mailer] sendPasswordResetEmail failed:', err.message)
      );
      audit(user.id, ACTIONS.FORGOT_PASSWORD, null, req);
    }
    // Same response regardless of whether email exists
    res.json({ ok: true, message: 'หากอีเมลนี้มีในระบบ คุณจะได้รับลิงก์รีเซ็ตรหัสผ่านในไม่ช้า' });
  } catch (e) {
    console.error('forgot-password error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /auth/reset-password ──────────────────────────
router.post('/reset-password', limiters.strict, async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'missing_token' });
    }
    const policyError = validatePasswordPolicy(password);
    if (policyError) return res.status(400).json({ error: 'weak_password', message: policyError });

    const hash = hashRawToken(token.trim());
    const row = await db.findEmailToken(hash);

    if (!row || row.type !== 'reset_password') {
      return res.status(400).json({ error: 'invalid_token', message: 'ลิงก์ไม่ถูกต้อง' });
    }
    if (row.used_at) {
      return res.status(400).json({ error: 'token_used', message: 'ลิงก์นี้ถูกใช้ไปแล้ว กรุณาขอรีเซ็ตใหม่' });
    }
    if (row.expires_at < now()) {
      return res.status(400).json({ error: 'token_expired', message: 'ลิงก์หมดอายุแล้ว กรุณาขอรีเซ็ตใหม่' });
    }

    const newHash = await hashPassword(password);
    await db.useEmailToken(row.id);
    await db.updateUser(row.user_id, { password_hash: newHash, failed_attempts: 0, locked_until: null, updated_at: now() });
    await db.revokeAllUserTokens(row.user_id, now()); // log out all sessions
    audit(row.user_id, ACTIONS.RESET_PASSWORD, null, req);
    res.json({ ok: true, message: 'รีเซ็ตรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' });
  } catch (e) {
    console.error('reset-password error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
