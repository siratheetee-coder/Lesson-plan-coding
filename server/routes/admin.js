import express from 'express';
import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { audit, ACTIONS } from '../utils/audit.js';

const router = express.Router();

// All admin routes require admin role
router.use(requireAdmin);

// ─── Dashboard stats ────────────────────────────────────
router.get('/stats', async (_req, res) => {
  try {
    const s = await db.stats();
    res.json(s);
  } catch (e) {
    console.error('stats error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── List users (with search + pagination) ─────────────
router.get('/users', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const search = (req.query.search || '').toString().trim();
    const [users, total] = await Promise.all([
      db.listUsers({ limit, offset, search }),
      db.countUsers(),
    ]);
    res.json({ users, total, limit, offset });
  } catch (e) {
    console.error('listUsers error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── Get one user (with their audit log) ────────────────
router.get('/users/:id', async (req, res) => {
  try {
    const user = await db.findUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'not_found' });
    const auditLog = await db.listAuditLog({ userId: user.id, limit: 50 });
    const { password_hash, ...safe } = user;
    res.json({ user: safe, auditLog });
  } catch (e) {
    console.error('getUser error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── Lock user (force password reset / temporary block) ─
router.post('/users/:id/lock', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'cannot_lock_self' });
    }
    // Lock for 100 years (effectively permanent until unlock)
    await db.updateUser(req.params.id, {
      locked_until: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
      updated_at: now(),
    });
    await db.revokeAllUserTokens(req.params.id, now());
    audit(req.user.id, ACTIONS.ADMIN_LOCK_USER, { target: req.params.id }, req);
    res.json({ ok: true });
  } catch (e) {
    console.error('lock error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/users/:id/unlock', async (req, res) => {
  try {
    await db.updateUser(req.params.id, {
      locked_until: null, failed_attempts: 0, updated_at: now(),
    });
    audit(req.user.id, ACTIONS.ADMIN_UNLOCK_USER, { target: req.params.id }, req);
    res.json({ ok: true });
  } catch (e) {
    console.error('unlock error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── Change role (promote/demote admin) ─────────────────
router.post('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!['teacher', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'invalid_role' });
    }
    if (req.params.id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'cannot_demote_self' });
    }
    await db.updateUser(req.params.id, { role, updated_at: now() });
    audit(req.user.id, ACTIONS.ADMIN_CHANGE_ROLE, { target: req.params.id, role }, req);
    res.json({ ok: true });
  } catch (e) {
    console.error('role error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── Delete user ────────────────────────────────────────
router.delete('/users/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'cannot_delete_self' });
    }
    await db.deleteUser(req.params.id);
    audit(req.user.id, ACTIONS.ADMIN_DELETE_USER, { target: req.params.id }, req);
    res.json({ ok: true });
  } catch (e) {
    console.error('delete error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── Audit log (all users, recent first) ────────────────
router.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const log = await db.listAuditLog({ limit, offset });
    res.json({ log, limit, offset });
  } catch (e) {
    console.error('audit error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── Get user's credit balance + history ────────────────
router.get('/users/:id/credits', async (req, res) => {
  try {
    const [credits, history] = await Promise.all([
      db.getCredits(req.params.id),
      db.getCreditTransactions(req.params.id, 50, 0),
    ]);
    res.json({ credits, history });
  } catch (e) {
    console.error('credits error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── Grant / deduct credits (admin manual adjustment) ───
router.post('/users/:id/credits/grant', async (req, res) => {
  try {
    const { amount, note } = req.body || {};
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10000) {
      return res.status(400).json({ error: 'invalid_amount', message: 'amount ต้องเป็นจำนวนเต็ม ไม่เป็น 0 และไม่เกิน 10,000' });
    }
    const adminEmail = req.user?.email || req.user?.id;
    const result = amount > 0
      ? await db.addCredits(req.params.id, amount, 'manual_grant',
          note || `Admin เพิ่มเครดิต โดย ${adminEmail}`, null, crypto.randomUUID())
      : await db.deductCredits(req.params.id, Math.abs(amount), 'manual_deduct',
          note || `Admin ลดเครดิต โดย ${adminEmail}`, null, crypto.randomUUID());

    if (result.ok === false) {
      return res.status(400).json({ error: 'insufficient_credits', message: 'เครดิตไม่พอสำหรับการหัก' });
    }

    audit(req.user.id, ACTIONS.ADMIN_GRANT_CREDITS, { target: req.params.id, amount, note }, req);
    res.json({ ok: true, credits: result.balance_after });
  } catch (e) {
    console.error('grant credits error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
