// Centralized rate-limiter presets.
// Every endpoint should use one of these so behavior is consistent
// and tweaking quotas only happens here.
//
// Tier guide:
//   strict   — token brute-force or expensive 3rd-party calls (SlipOK)
//   auth     — login/register/google
//   email    — outbound email triggers (forgot, resend)
//   ai       — Claude API calls
//   write    — user CUD operations (lessons, units, credit charges)
//   read     — listings
//   global   — last-line defense, applied at app level

import rateLimit from 'express-rate-limit';
import { db, now } from '../db.js';

// ─── Helper: audit on rate-limit hit ──────────────────────
// Records who triggered which limiter so admins can spot abuse early.
function onLimitHit(name) {
  return (req, _res, _next, _options) => {
    Promise.resolve(db.audit({
      user_id: req.user?.id || null,
      action: 'rate_limited',
      meta: JSON.stringify({ limiter: name, path: req.originalUrl, method: req.method }),
      ip: req.ip || null,
      created_at: now(),
    })).catch(() => {});
  };
}

const baseOpts = {
  standardHeaders: true,
  legacyHeaders: false,
};

const userOrIp = (req) => req.user?.id || req.ip;
const emailOrIp = (req) => (req.body?.email || '').toLowerCase().trim() || req.ip;

// ─── Presets ──────────────────────────────────────────────
export const limiters = {
  // 5 / 15 min. Token-protected endpoints, password reset, verify-email.
  strict: rateLimit({
    ...baseOpts,
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => req.ip,
    handler: (req, res, next, options) => {
      onLimitHit('strict')(req, res, next, options);
      res.status(429).json({ error: 'too_many_attempts', message: 'พยายามบ่อยเกินไป กรุณารอสักครู่' });
    },
  }),

  // 20 / 15 min. Login, Google sign-in.
  auth: rateLimit({
    ...baseOpts,
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => req.ip,
    handler: (req, res, next, options) => {
      onLimitHit('auth')(req, res, next, options);
      res.status(429).json({ error: 'too_many_attempts', message: 'พยายามล็อกอินบ่อยเกินไป กรุณารอ 15 นาที' });
    },
  }),

  // 10 / 1h. Registration (creating accounts is rare).
  register: rateLimit({
    ...baseOpts,
    windowMs: 60 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.ip,
    handler: (req, res, next, options) => {
      onLimitHit('register')(req, res, next, options);
      res.status(429).json({ error: 'too_many_attempts', message: 'สมัครสมาชิกบ่อยเกินไป กรุณารอ 1 ชั่วโมง' });
    },
  }),

  // 5 / 15 min, keyed by email so attackers can't bypass by changing IP per request.
  email: rateLimit({
    ...baseOpts,
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: emailOrIp,
    handler: (req, res, next, options) => {
      onLimitHit('email')(req, res, next, options);
      res.status(429).json({ error: 'too_many_attempts', message: 'ส่งอีเมลบ่อยเกินไป กรุณารอสักครู่' });
    },
  }),

  // 15 / min per user. AI endpoints (Claude calls).
  ai: rateLimit({
    ...baseOpts,
    windowMs: 60 * 1000,
    max: 15,
    keyGenerator: userOrIp,
    handler: (req, res, next, options) => {
      onLimitHit('ai')(req, res, next, options);
      res.status(429).json({ error: 'rate_limited', message: 'เรียกใช้ AI ถี่เกินไป กรุณารอสักครู่' });
    },
  }),

  // 60 / min per user. Lessons/units writes, credit charges.
  write: rateLimit({
    ...baseOpts,
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: userOrIp,
    handler: (req, res, next, options) => {
      onLimitHit('write')(req, res, next, options);
      res.status(429).json({ error: 'rate_limited', message: 'บันทึกข้อมูลถี่เกินไป กรุณารอสักครู่' });
    },
  }),

  // 200 / min per user. Listing endpoints (cheap reads).
  read: rateLimit({
    ...baseOpts,
    windowMs: 60 * 1000,
    max: 200,
    keyGenerator: userOrIp,
    handler: (req, res, next, options) => {
      onLimitHit('read')(req, res, next, options);
      res.status(429).json({ error: 'rate_limited' });
    },
  }),

  // 300 / min per IP. Last-line defense — applied to /api and /auth at app level.
  global: rateLimit({
    ...baseOpts,
    windowMs: 60 * 1000,
    max: 300,
    keyGenerator: (req) => req.ip,
    handler: (req, res, next, options) => {
      onLimitHit('global')(req, res, next, options);
      res.status(429).json({ error: 'rate_limited', message: 'ส่งคำขอถี่เกินไป' });
    },
  }),
};
