// Database adapter — supports PostgreSQL (production) and JSON file (local dev)
// Automatically switches based on DATABASE_URL env variable.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ─── Detect mode ─────────────────────────────────────────
const USE_POSTGRES = !!process.env.DATABASE_URL;

export function now() { return Date.now(); }

// ═══════════════════════════════════════════════════════════
//  POSTGRES MODE
// ═══════════════════════════════════════════════════════════
let pgPool = null;

async function initPostgres() {
  const { default: pg } = await import('pg');
  pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // required for Render PostgreSQL
    max: 10,
    idleTimeoutMillis: 30000,
  });

  // Create tables if not exist
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email           TEXT UNIQUE NOT NULL,
      password_hash   TEXT,
      display_name    TEXT,
      google_sub      TEXT UNIQUE,
      email_verified  INTEGER DEFAULT 0,
      failed_attempts INTEGER DEFAULT 0,
      locked_until    BIGINT,
      last_login_at   BIGINT,
      created_at      BIGINT NOT NULL,
      updated_at      BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL,
      user_agent  TEXT,
      ip          TEXT,
      expires_at  BIGINT NOT NULL,
      revoked_at  BIGINT,
      created_at  BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
    CREATE TABLE IF NOT EXISTS audit_log (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT,
      action     TEXT NOT NULL,
      meta       TEXT,
      ip         TEXT,
      created_at BIGINT NOT NULL
    );
  `);
  console.log('✓ PostgreSQL connected and schema ready');
}

const pgDb = {
  async insertUser(u) {
    await pgPool.query(
      `INSERT INTO users (id,email,password_hash,display_name,google_sub,email_verified,
        failed_attempts,locked_until,last_login_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [u.id, u.email, u.password_hash, u.display_name, u.google_sub,
       u.email_verified, u.failed_attempts, u.locked_until, u.last_login_at,
       u.created_at, u.updated_at]
    );
    return u;
  },
  async findUserByEmail(email) {
    const { rows } = await pgPool.query(
      'SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    return rows[0] || null;
  },
  async findUserById(id) {
    const { rows } = await pgPool.query('SELECT * FROM users WHERE id=$1', [id]);
    return rows[0] || null;
  },
  async findUserByGoogleSub(sub) {
    const { rows } = await pgPool.query('SELECT * FROM users WHERE google_sub=$1', [sub]);
    return rows[0] || null;
  },
  async updateUser(id, patch) {
    const keys = Object.keys(patch);
    const values = Object.values(patch);
    const set = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
    const { rows } = await pgPool.query(
      `UPDATE users SET ${set} WHERE id=$1 RETURNING *`, [id, ...values]);
    return rows[0] || null;
  },
  async insertRefreshToken(t) {
    await pgPool.query(
      `INSERT INTO refresh_tokens (id,user_id,token_hash,user_agent,ip,expires_at,revoked_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [t.id, t.user_id, t.token_hash, t.user_agent, t.ip,
       t.expires_at, t.revoked_at, t.created_at]
    );
    return t;
  },
  async findRefreshToken(jti) {
    const { rows } = await pgPool.query('SELECT * FROM refresh_tokens WHERE id=$1', [jti]);
    return rows[0] || null;
  },
  async revokeRefreshToken(jti, when) {
    await pgPool.query('UPDATE refresh_tokens SET revoked_at=$2 WHERE id=$1', [jti, when]);
  },
  async revokeAllUserTokens(userId, when) {
    await pgPool.query(
      'UPDATE refresh_tokens SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL',
      [userId, when]
    );
  },
  async audit(entry) {
    await pgPool.query(
      'INSERT INTO audit_log (user_id,action,meta,ip,created_at) VALUES ($1,$2,$3,$4,$5)',
      [entry.user_id, entry.action,
       entry.meta ? JSON.stringify(entry.meta) : null,
       entry.ip, entry.created_at]
    );
  },
};

// ═══════════════════════════════════════════════════════════
//  JSON FILE MODE (local dev — no PostgreSQL needed)
// ═══════════════════════════════════════════════════════════
const dbPath = process.env.DB_PATH || './data/app.db.json';
const initial = { users: [], refresh_tokens: [], audit_log: [] };
let state = initial;

function loadJson() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  try {
    if (fs.existsSync(dbPath)) {
      state = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      for (const k of Object.keys(initial)) if (!state[k]) state[k] = [];
    } else {
      state = structuredClone(initial);
      saveJson();
    }
  } catch { state = structuredClone(initial); }
}

let saveTimer = null;
function saveJson() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = dbPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, dbPath);
  }, 30);
}
function flushSync() {
  clearTimeout(saveTimer);
  if (!USE_POSTGRES) {
    try {
      fs.writeFileSync(dbPath + '.tmp', JSON.stringify(state, null, 2));
      fs.renameSync(dbPath + '.tmp', dbPath);
    } catch {}
  }
}

// Wrap sync JSON ops as async so route code works the same regardless of mode
const jsonDb = {
  async insertUser(u) { state.users.push(u); saveJson(); return u; },
  async findUserByEmail(email) {
    const e = String(email).toLowerCase();
    return state.users.find(u => u.email.toLowerCase() === e) || null;
  },
  async findUserById(id) { return state.users.find(u => u.id === id) || null; },
  async findUserByGoogleSub(sub) { return state.users.find(u => u.google_sub === sub) || null; },
  async updateUser(id, patch) {
    const u = state.users.find(x => x.id === id);
    if (u) { Object.assign(u, patch); saveJson(); }
    return u;
  },
  async insertRefreshToken(t) { state.refresh_tokens.push(t); saveJson(); return t; },
  async findRefreshToken(jti) { return state.refresh_tokens.find(t => t.id === jti) || null; },
  async revokeRefreshToken(jti, when) {
    const t = state.refresh_tokens.find(x => x.id === jti);
    if (t) { t.revoked_at = when; saveJson(); }
  },
  async revokeAllUserTokens(userId, when) {
    let n = 0;
    for (const t of state.refresh_tokens) {
      if (t.user_id === userId && !t.revoked_at) { t.revoked_at = when; n++; }
    }
    if (n) saveJson();
  },
  async audit(entry) { state.audit_log.push(entry); saveJson(); },
};

// ─── Export a unified db object ───────────────────────────
export const db = USE_POSTGRES ? pgDb : jsonDb;

// ─── Init function called by server.js on boot ───────────
export async function initDb() {
  if (USE_POSTGRES) {
    await initPostgres();
  } else {
    loadJson();
    process.on('exit', flushSync);
    process.on('SIGINT', () => { flushSync(); process.exit(0); });
    console.log(`✓ JSON storage ready at ${dbPath}`);
  }
}
