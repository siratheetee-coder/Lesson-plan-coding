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
      role            TEXT DEFAULT 'teacher',
      email_verified  INTEGER DEFAULT 0,
      failed_attempts INTEGER DEFAULT 0,
      locked_until    BIGINT,
      last_login_at   BIGINT,
      created_at      BIGINT NOT NULL,
      updated_at      BIGINT NOT NULL,
      credits         INT NOT NULL DEFAULT 0
    );
    -- Migrate older databases
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'teacher';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INT NOT NULL DEFAULT 0;

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

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type         TEXT NOT NULL,
      amount       INT NOT NULL,
      balance_after INT NOT NULL,
      ref_id       TEXT,
      note         TEXT,
      created_at   BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_credit_txn_user ON credit_transactions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS email_tokens (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at BIGINT NOT NULL,
      used_at    BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, type);

    CREATE TABLE IF NOT EXISTS lessons (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      saved_at     BIGINT NOT NULL,
      title        TEXT,
      custom_title TEXT,
      format       TEXT DEFAULT 'pdf',
      fingerprint  TEXT,
      data         TEXT NOT NULL DEFAULT '{}',
      created_at   BIGINT NOT NULL,
      updated_at   BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lessons_user ON lessons(user_id, saved_at DESC);

    CREATE TABLE IF NOT EXISTS units (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data       TEXT NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_units_user ON units(user_id, created_at DESC);
  `);
  console.log('✓ PostgreSQL connected and schema ready');
}

const pgDb = {
  async insertUser(u) {
    await pgPool.query(
      `INSERT INTO users (id,email,password_hash,display_name,google_sub,email_verified,
        failed_attempts,locked_until,last_login_at,created_at,updated_at,role,credits)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [u.id, u.email, u.password_hash, u.display_name, u.google_sub,
       u.email_verified, u.failed_attempts, u.locked_until, u.last_login_at,
       u.created_at, u.updated_at, u.role || 'teacher', u.credits || 0]
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

  // ─── Credits ────────────────────────────────────────────
  async getCredits(userId) {
    const { rows } = await pgPool.query('SELECT credits FROM users WHERE id=$1', [userId]);
    return rows[0]?.credits ?? 0;
  },
  async addCredits(userId, amount, type, note, refId, txnId) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'UPDATE users SET credits = credits + $2 WHERE id=$1 RETURNING credits',
        [userId, amount]
      );
      if (!rows[0]) throw new Error('user_not_found');
      const balanceAfter = rows[0].credits;
      const txn = {
        id: txnId || crypto.randomUUID(),
        user_id: userId, type, amount,
        balance_after: balanceAfter,
        ref_id: refId || null, note: note || null, created_at: now(),
      };
      await client.query(
        `INSERT INTO credit_transactions (id,user_id,type,amount,balance_after,ref_id,note,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [txn.id, txn.user_id, txn.type, txn.amount, txn.balance_after,
         txn.ref_id, txn.note, txn.created_at]
      );
      await client.query('COMMIT');
      return { balance_after: balanceAfter, transaction: txn };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
  async deductCredits(userId, amount, type, note, refId, txnId) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'UPDATE users SET credits = credits - $2 WHERE id=$1 AND credits >= $2 RETURNING credits',
        [userId, amount]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'insufficient_credits' };
      }
      const balanceAfter = rows[0].credits;
      const txn = {
        id: txnId || crypto.randomUUID(),
        user_id: userId, type, amount: -amount,
        balance_after: balanceAfter,
        ref_id: refId || null, note: note || null, created_at: now(),
      };
      await client.query(
        `INSERT INTO credit_transactions (id,user_id,type,amount,balance_after,ref_id,note,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [txn.id, txn.user_id, txn.type, txn.amount, txn.balance_after,
         txn.ref_id, txn.note, txn.created_at]
      );
      await client.query('COMMIT');
      return { ok: true, balance_after: balanceAfter, transaction: txn };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
  async getCreditTransactions(userId, limit = 20, offset = 0) {
    const { rows } = await pgPool.query(
      `SELECT * FROM credit_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows;
  },
  async findCreditTransactionByRefId(refId) {
    if (!refId) return null;
    const { rows } = await pgPool.query(
      'SELECT * FROM credit_transactions WHERE ref_id=$1 LIMIT 1', [refId]);
    return rows[0] || null;
  },

  // ─── Admin queries ──────────────────────────────────────
  async listUsers({ limit = 50, offset = 0, search = '' } = {}) {
    const args = [];
    let where = '';
    if (search) {
      args.push(`%${search}%`);
      where = `WHERE email ILIKE $${args.length} OR display_name ILIKE $${args.length}`;
    }
    args.push(limit); args.push(offset);
    const { rows } = await pgPool.query(
      `SELECT id, email, display_name, role, credits,
              google_sub IS NOT NULL AS has_google,
              password_hash IS NOT NULL AS has_password,
              email_verified, failed_attempts, locked_until, last_login_at, created_at
       FROM users ${where}
       ORDER BY created_at DESC
       LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args
    );
    return rows;
  },
  async countUsers() {
    const { rows } = await pgPool.query('SELECT COUNT(*)::int AS n FROM users');
    return rows[0].n;
  },
  async deleteUser(id) {
    await pgPool.query('DELETE FROM users WHERE id=$1', [id]);
  },
  async listAuditLog({ limit = 100, offset = 0, userId = null } = {}) {
    const args = [];
    let where = '';
    if (userId) { args.push(userId); where = `WHERE user_id=$${args.length}`; }
    args.push(limit); args.push(offset);
    const { rows } = await pgPool.query(
      `SELECT a.id, a.user_id, u.email, a.action, a.meta, a.ip, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${where}
       ORDER BY a.created_at DESC
       LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args
    );
    return rows;
  },
  async stats() {
    const dayMs = 24 * 60 * 60 * 1000;
    const oneDayAgo = Date.now() - dayMs;
    const sevenDaysAgo = Date.now() - 7 * dayMs;
    const [
      { rows: total }, { rows: today }, { rows: week }, { rows: locked },
      { rows: circulating }, { rows: exportsWeek }, { rows: grantsWeek },
    ] = await Promise.all([
      pgPool.query('SELECT COUNT(*)::int AS n FROM users'),
      pgPool.query("SELECT COUNT(*)::int AS n FROM audit_log WHERE action='login_success' AND created_at > $1", [oneDayAgo]),
      pgPool.query('SELECT COUNT(*)::int AS n FROM users WHERE created_at > $1', [sevenDaysAgo]),
      pgPool.query('SELECT COUNT(*)::int AS n FROM users WHERE locked_until > $1', [Date.now()]),
      pgPool.query('SELECT COALESCE(SUM(credits),0)::int AS n FROM users'),
      pgPool.query("SELECT COUNT(*)::int AS n FROM credit_transactions WHERE type='usage' AND created_at > $1", [sevenDaysAgo]),
      pgPool.query("SELECT COALESCE(SUM(amount),0)::int AS n FROM credit_transactions WHERE type IN ('manual_grant','bonus','topup') AND created_at > $1", [sevenDaysAgo]),
    ]);
    return {
      totalUsers: total[0].n,
      loginsToday: today[0].n,
      newUsersThisWeek: week[0].n,
      lockedUsers: locked[0].n,
      totalCreditsCirculating: circulating[0].n,
      exportsThisWeek: exportsWeek[0].n,
      creditsGrantedThisWeek: grantsWeek[0].n,
    };
  },

  // ─── Retention pruners ──────────────────────────────────
  async pruneAuditLog(cutoff) {
    const { rowCount } = await pgPool.query(
      'DELETE FROM audit_log WHERE created_at < $1', [cutoff]);
    return rowCount;
  },
  async pruneEmailTokens(now_) {
    // Remove tokens that are either expired or used >24h ago
    const dayAgo = now_ - 24 * 60 * 60 * 1000;
    const { rowCount } = await pgPool.query(
      'DELETE FROM email_tokens WHERE expires_at < $1 OR (used_at IS NOT NULL AND used_at < $2)',
      [now_, dayAgo]);
    return rowCount;
  },

  // ─── Email tokens ────────────────────────────────────────
  async createEmailToken(userId, type, tokenHash, expiresAt) {
    const id = crypto.randomUUID();
    await pgPool.query(
      `UPDATE email_tokens SET used_at=$1 WHERE user_id=$2 AND type=$3 AND used_at IS NULL`,
      [now(), userId, type]
    );
    await pgPool.query(
      `INSERT INTO email_tokens (id,user_id,type,token_hash,expires_at,used_at,created_at)
       VALUES ($1,$2,$3,$4,$5,NULL,$6)`,
      [id, userId, type, tokenHash, expiresAt, now()]
    );
    return id;
  },
  async findEmailToken(tokenHash) {
    const { rows } = await pgPool.query(
      'SELECT * FROM email_tokens WHERE token_hash=$1 LIMIT 1', [tokenHash]);
    return rows[0] || null;
  },
  async useEmailToken(id) {
    await pgPool.query('UPDATE email_tokens SET used_at=$2 WHERE id=$1', [id, now()]);
  },

  // ─── Lessons ────────────────────────────────────────────
  async listLessons(userId) {
    const { rows } = await pgPool.query(
      'SELECT * FROM lessons WHERE user_id=$1 ORDER BY saved_at DESC LIMIT 50',
      [userId]
    );
    return rows.map(r => {
      // r.data column stores the entire entry (includes its own .data form snapshot)
      const stored = JSON.parse(r.data || '{}');
      return {
        ...stored,                                       // bring forward .data + any other client fields
        id: r.id,
        savedAt: r.saved_at,
        title: r.title || stored.title || null,
        customTitle: r.custom_title || stored.customTitle || null,
        format: r.format || stored.format || 'pdf',
        fingerprint: r.fingerprint || stored.fingerprint || null,
      };
    });
  },
  async upsertLesson(userId, entry) {
    const t = now();
    await pgPool.query(
      `INSERT INTO lessons (id,user_id,saved_at,title,custom_title,format,fingerprint,data,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       ON CONFLICT (id) DO UPDATE SET
         saved_at=$3, title=$4, custom_title=$5, format=$6, fingerprint=$7, data=$8, updated_at=$9`,
      [entry.id, userId, entry.savedAt || t, entry.title || null, entry.customTitle || null,
       entry.format || 'pdf', entry.fingerprint || null, JSON.stringify(entry), t]
    );
  },
  async patchLesson(userId, id, patch) {
    await pgPool.query(
      `UPDATE lessons SET title=$3, custom_title=$4, updated_at=$5
       WHERE id=$1 AND user_id=$2`,
      [id, userId, patch.title || null, patch.customTitle || null, now()]
    );
  },
  async deleteLesson(userId, id) {
    await pgPool.query('DELETE FROM lessons WHERE id=$1 AND user_id=$2', [id, userId]);
  },

  // ─── Units ──────────────────────────────────────────────
  async listUnits(userId) {
    const { rows } = await pgPool.query(
      'SELECT * FROM units WHERE user_id=$1 ORDER BY created_at ASC',
      [userId]
    );
    return rows.map(r => JSON.parse(r.data || '{}'));
  },
  async upsertUnit(userId, unit) {
    const t = now();
    await pgPool.query(
      `INSERT INTO units (id,user_id,data,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$4)
       ON CONFLICT (id) DO UPDATE SET data=$3, updated_at=$4`,
      [unit.id, userId, JSON.stringify(unit), t]
    );
  },
  async deleteUnit(userId, id) {
    await pgPool.query('DELETE FROM units WHERE id=$1 AND user_id=$2', [id, userId]);
  },
};

// ═══════════════════════════════════════════════════════════
//  JSON FILE MODE (local dev — no PostgreSQL needed)
// ═══════════════════════════════════════════════════════════
const dbPath = process.env.DB_PATH || './data/app.db.json';
const initial = { users: [], refresh_tokens: [], audit_log: [], credit_transactions: [], email_tokens: [], lessons: [], units: [] };
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

  // ─── Credits ────────────────────────────────────────────
  async getCredits(userId) {
    const u = state.users.find(x => x.id === userId);
    return u?.credits ?? 0;
  },
  async addCredits(userId, amount, type, note, refId, txnId) {
    const u = state.users.find(x => x.id === userId);
    if (!u) throw new Error('user_not_found');
    u.credits = (u.credits || 0) + amount;
    const txn = {
      id: txnId || crypto.randomUUID(),
      user_id: userId, type, amount, balance_after: u.credits,
      ref_id: refId || null, note: note || null, created_at: now(),
    };
    state.credit_transactions.push(txn);
    saveJson();
    return { balance_after: u.credits, transaction: txn };
  },
  async deductCredits(userId, amount, type, note, refId, txnId) {
    const u = state.users.find(x => x.id === userId);
    if (!u || (u.credits || 0) < amount) {
      return { ok: false, error: 'insufficient_credits' };
    }
    u.credits = (u.credits || 0) - amount;
    const txn = {
      id: txnId || crypto.randomUUID(),
      user_id: userId, type, amount: -amount, balance_after: u.credits,
      ref_id: refId || null, note: note || null, created_at: now(),
    };
    state.credit_transactions.push(txn);
    saveJson();
    return { ok: true, balance_after: u.credits, transaction: txn };
  },
  async getCreditTransactions(userId, limit = 20, offset = 0) {
    const arr = (state.credit_transactions || []).filter(t => t.user_id === userId);
    return arr.sort((a, b) => b.created_at - a.created_at).slice(offset, offset + limit);
  },
  async findCreditTransactionByRefId(refId) {
    if (!refId) return null;
    return (state.credit_transactions || []).find(t => t.ref_id === refId) || null;
  },

  async listUsers({ limit = 50, offset = 0, search = '' } = {}) {
    let arr = state.users;
    if (search) {
      const s = search.toLowerCase();
      arr = arr.filter(u =>
        (u.email || '').toLowerCase().includes(s) ||
        (u.display_name || '').toLowerCase().includes(s));
    }
    return arr.slice().sort((a, b) => b.created_at - a.created_at)
      .slice(offset, offset + limit)
      .map(u => ({
        id: u.id, email: u.email, display_name: u.display_name,
        role: u.role || 'teacher',
        credits: u.credits || 0,
        has_google: !!u.google_sub, has_password: !!u.password_hash,
        email_verified: u.email_verified, failed_attempts: u.failed_attempts,
        locked_until: u.locked_until, last_login_at: u.last_login_at,
        created_at: u.created_at,
      }));
  },
  async countUsers() { return state.users.length; },
  async deleteUser(id) {
    state.users = state.users.filter(u => u.id !== id);
    state.refresh_tokens = state.refresh_tokens.filter(t => t.user_id !== id);
    state.credit_transactions = state.credit_transactions.filter(t => t.user_id !== id);
    saveJson();
  },
  async listAuditLog({ limit = 100, offset = 0, userId = null } = {}) {
    let arr = state.audit_log;
    if (userId) arr = arr.filter(a => a.user_id === userId);
    const userById = Object.fromEntries(state.users.map(u => [u.id, u.email]));
    return arr.slice().sort((a, b) => b.created_at - a.created_at)
      .slice(offset, offset + limit)
      .map(a => ({ ...a, email: userById[a.user_id] || null }));
  },
  async stats() {
    const dayMs = 24 * 60 * 60 * 1000;
    const oneDayAgo = Date.now() - dayMs;
    const sevenDaysAgo = Date.now() - 7 * dayMs;
    const txns = state.credit_transactions || [];
    return {
      totalUsers: state.users.length,
      loginsToday: state.audit_log.filter(a => a.action === 'login_success' && a.created_at > oneDayAgo).length,
      newUsersThisWeek: state.users.filter(u => u.created_at > sevenDaysAgo).length,
      lockedUsers: state.users.filter(u => u.locked_until && u.locked_until > Date.now()).length,
      totalCreditsCirculating: state.users.reduce((s, u) => s + (u.credits || 0), 0),
      exportsThisWeek: txns.filter(t => t.type === 'usage' && t.created_at > sevenDaysAgo).length,
      creditsGrantedThisWeek: txns
        .filter(t => ['manual_grant','bonus','topup'].includes(t.type) && t.created_at > sevenDaysAgo)
        .reduce((s, t) => s + (t.amount || 0), 0),
    };
  },

  // ─── Retention pruners ──────────────────────────────────
  async pruneAuditLog(cutoff) {
    const before = state.audit_log.length;
    state.audit_log = state.audit_log.filter(a => a.created_at >= cutoff);
    const removed = before - state.audit_log.length;
    if (removed > 0) saveJson();
    return removed;
  },
  async pruneEmailTokens(now_) {
    if (!state.email_tokens) return 0;
    const dayAgo = now_ - 24 * 60 * 60 * 1000;
    const before = state.email_tokens.length;
    state.email_tokens = state.email_tokens.filter(t =>
      t.expires_at >= now_ && !(t.used_at && t.used_at < dayAgo)
    );
    const removed = before - state.email_tokens.length;
    if (removed > 0) saveJson();
    return removed;
  },

  // ─── Email tokens ────────────────────────────────────────
  async createEmailToken(userId, type, tokenHash, expiresAt) {
    if (!state.email_tokens) state.email_tokens = [];
    // Invalidate previous tokens of same type
    state.email_tokens.forEach(t => {
      if (t.user_id === userId && t.type === type && !t.used_at) t.used_at = now();
    });
    const id = crypto.randomUUID();
    state.email_tokens.push({ id, user_id: userId, type, token_hash: tokenHash, expires_at: expiresAt, used_at: null, created_at: now() });
    saveJson();
    return id;
  },
  async findEmailToken(tokenHash) {
    return (state.email_tokens || []).find(t => t.token_hash === tokenHash) || null;
  },
  async useEmailToken(id) {
    const t = (state.email_tokens || []).find(x => x.id === id);
    if (t) { t.used_at = now(); saveJson(); }
  },

  // ─── Lessons ────────────────────────────────────────────
  async listLessons(userId) {
    return (state.lessons || [])
      .filter(l => l.user_id === userId)
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .slice(0, 50)
      .map(({ user_id, ...entry }) => entry); // strip server-only field
  },
  async upsertLesson(userId, entry) {
    if (!state.lessons) state.lessons = [];
    const i = state.lessons.findIndex(l => l.id === entry.id && l.user_id === userId);
    const record = { ...entry, user_id: userId };
    if (i >= 0) state.lessons[i] = record;
    else state.lessons.unshift(record);
    saveJson();
  },
  async patchLesson(userId, id, patch) {
    const l = (state.lessons || []).find(l => l.id === id && l.user_id === userId);
    if (l) {
      if ('title' in patch) l.title = patch.title;
      if ('customTitle' in patch) l.customTitle = patch.customTitle;
      saveJson();
    }
  },
  async deleteLesson(userId, id) {
    state.lessons = (state.lessons || []).filter(l => !(l.id === id && l.user_id === userId));
    saveJson();
  },

  // ─── Units ──────────────────────────────────────────────
  async listUnits(userId) {
    return (state.units || [])
      .filter(u => u.user_id === userId)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .map(({ user_id, ...unit }) => unit);
  },
  async upsertUnit(userId, unit) {
    if (!state.units) state.units = [];
    const i = state.units.findIndex(u => u.id === unit.id && u.user_id === userId);
    const record = { ...unit, user_id: userId };
    if (i >= 0) state.units[i] = record;
    else state.units.push(record);
    saveJson();
  },
  async deleteUnit(userId, id) {
    state.units = (state.units || []).filter(u => !(u.id === id && u.user_id === userId));
    saveJson();
  },
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
