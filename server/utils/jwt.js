import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL_SHORT = process.env.JWT_REFRESH_TTL_SHORT || '7d';
const REFRESH_TTL_LONG = process.env.JWT_REFRESH_TTL_LONG || '30d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  console.error('FATAL: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in .env');
  process.exit(1);
}

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role || 'teacher' },
    ACCESS_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

export function signRefreshToken(user, { remember }) {
  const jti = crypto.randomUUID();
  const ttl = remember ? REFRESH_TTL_LONG : REFRESH_TTL_SHORT;
  const token = jwt.sign({ sub: user.id, jti }, REFRESH_SECRET, { expiresIn: ttl });
  return { token, jti, ttl };
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Convert "30d" / "7d" / "15m" → ms (for cookie maxAge)
export function ttlToMs(ttl) {
  const m = String(ttl).match(/^(\d+)([smhd])$/);
  if (!m) return 0;
  const n = +m[1];
  return n * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2]];
}

export const TTL = { ACCESS: ACCESS_TTL, SHORT: REFRESH_TTL_SHORT, LONG: REFRESH_TTL_LONG };
