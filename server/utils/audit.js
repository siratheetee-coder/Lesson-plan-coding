// Centralized audit logging.
// Use ACTIONS constants instead of raw strings to avoid typos and drift.
// audit() is fire-and-forget — never blocks the response.

import { db, now } from '../db.js';

// ─── Action constants (the source of truth for action names) ──
export const ACTIONS = Object.freeze({
  // Authentication
  REGISTER:                'register',
  LOGIN_SUCCESS:           'login_success',
  LOGIN_FAILED:            'login_failed',
  LOGOUT:                  'logout',
  LINK_GOOGLE:             'link_google',
  REFRESH_TOKEN_MISMATCH:  'refresh_token_mismatch',
  CHANGE_PASSWORD:         'change_password',
  EMAIL_VERIFIED:          'email_verified',
  RESEND_VERIFICATION:     'resend_verification',
  FORGOT_PASSWORD:         'forgot_password',
  RESET_PASSWORD:          'reset_password',

  // Credits & payments
  CREDIT_EXPORT_CHARGE:    'credit_export_charge',
  CREDIT_EXPORT_REUSE:     'credit_export_reuse',  // idempotent re-export — no charge
  TOPUP_INIT:              'topup_init',
  TOPUP_SUCCESS:           'topup_success',
  SLIP_VERIFIED:           'slip_verified',
  SLIP_REJECTED:           'slip_rejected',

  // AI
  AI_GENERATE_FAILED:      'ai_generate_failed',

  // Admin
  ADMIN_LOCK_USER:         'admin_lock_user',
  ADMIN_UNLOCK_USER:       'admin_unlock_user',
  ADMIN_CHANGE_ROLE:       'admin_change_role',
  ADMIN_DELETE_USER:       'admin_delete_user',
  ADMIN_GRANT_CREDITS:     'admin_grant_credits',

  // Security
  RATE_LIMITED:            'rate_limited',
});

// ─── audit(userId, action, meta, req) — fire-and-forget ───
// meta is JSON-serialized; large objects are trimmed to keep the table small.
export function audit(userId, action, meta, req) {
  let metaStr = null;
  if (meta != null) {
    try {
      metaStr = typeof meta === 'string' ? meta : JSON.stringify(meta);
      if (metaStr.length > 500) metaStr = metaStr.slice(0, 497) + '...';
    } catch { metaStr = String(meta).slice(0, 500); }
  }
  Promise.resolve(db.audit({
    user_id: userId || null,
    action,
    meta: metaStr,
    ip: req?.ip || null,
    created_at: now(),
  })).catch(err => console.error('[audit] write failed:', err));
}

// ─── pruneAuditLog — retention cleanup, called on startup ──
// Removes entries older than RETENTION_DAYS (default 90).
export async function pruneAuditLog(retentionDays = 90) {
  if (typeof db.pruneAuditLog === 'function') {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    try {
      const removed = await db.pruneAuditLog(cutoff);
      if (removed > 0) console.log(`✓ Pruned ${removed} audit log entries older than ${retentionDays} days`);
    } catch (e) {
      console.warn('[audit] prune failed:', e.message);
    }
  }
}

// ─── pruneEmailTokens — cleanup expired/used email tokens ──
export async function pruneEmailTokens() {
  if (typeof db.pruneEmailTokens === 'function') {
    try {
      const removed = await db.pruneEmailTokens(Date.now());
      if (removed > 0) console.log(`✓ Pruned ${removed} expired/used email tokens`);
    } catch (e) {
      console.warn('[audit] prune email tokens failed:', e.message);
    }
  }
}
