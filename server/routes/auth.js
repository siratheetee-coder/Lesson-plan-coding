import express from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import { db, now } from '../db.js';
import {
  hashPassword, verifyPassword, validatePasswordPolicy, validateEmail,
} from '../utils/password.js';
import {
  signAccessToken, signRefreshToken, verifyRefreshToken, hashToken, ttlToMs, TTL,
} from '../utils/jwt.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// ─── Rate limiters ──────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts', message: 'พยายามล็อกอินบ่อยเกินไป กรุณารอสักครู่' },
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function audit(userId, action, meta, req) {
  // Fire-and-forget; we don't wait on audit writes (avoids blocking the response)
  Promise.resolve(db.audit({
    user_id: userId || null, action, meta: meta || null,
    ip: req.ip || null, created_at: now(),
  })).catch(err => console.error('audit error', err));
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

async function auditAsync(userId, action, meta, req) {
  await db.audit({
    user_id: userId || null, action,
    meta: meta || null, ip: req.ip || null, created_at: now(),
  });
}

// ─── POST /auth/register ────────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
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
      email_verified: 0,
      failed_attempts: 0,
      locked_until: null,
      last_login_at: null,
      created_at: t,
      updated_at: t,
    });
    const user = await db.findUserById(id);
    audit(id, 'register', { method: 'password', role }, req);
    res.json(await issueSession(user, req, res, !!remember));
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /auth/login ───────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
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
        audit(user.id, 'login_failed', { attempts }, req);
      }
      return res.status(401).json({ error: 'invalid_credentials', message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }
    await db.updateUser(user.id, { failed_attempts: 0, locked_until: null, last_login_at: now(), updated_at: now() });
    await promoteIfAdminEmail(user);
    audit(user.id, 'login_success', { method: 'password' }, req);
    res.json(await issueSession(user, req, res, !!remember));
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /auth/google ──────────────────────────────────
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post('/google', loginLimiter, async (req, res) => {
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
      });
      user = await db.findUserById(id);
      audit(id, 'register', { method: 'google', role }, req);
    } else if (!user.google_sub) {
      await db.updateUser(user.id, { google_sub: sub, email_verified: 1, updated_at: t, last_login_at: t });
      user = await db.findUserById(user.id);
      audit(user.id, 'link_google', null, req);
    } else {
      await db.updateUser(user.id, { last_login_at: t, updated_at: t });
    }
    await promoteIfAdminEmail(user);
    audit(user.id, 'login_success', { method: 'google' }, req);
    res.json(await issueSession(user, req, res, !!remember));
  } catch (err) {
    console.error('google login error', err);
    res.status(401).json({ error: 'google_verification_failed' });
  }
});

// ─── POST /auth/refresh ─────────────────────────────────
router.post('/refresh', async (req, res) => {
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
      audit(payload.sub, 'refresh_token_mismatch', null, req);
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
      audit(payload.sub, 'logout', null, req);
    } catch { /* ignore */ }
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
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
    audit(user.id, 'change_password', null, req);
    res.json({ ok: true });
  } catch (e) {
    console.error('change-password error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
