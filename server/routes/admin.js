import express from 'express';
import { db, now } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

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
    await db.audit({ user_id: req.user.id, action: 'admin_lock_user',
      meta: JSON.stringify({ target: req.params.id }), ip: req.ip, created_at: now() });
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
    await db.audit({ user_id: req.user.id, action: 'admin_unlock_user',
      meta: JSON.stringify({ target: req.params.id }), ip: req.ip, created_at: now() });
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
    await db.audit({ user_id: req.user.id, action: 'admin_change_role',
      meta: JSON.stringify({ target: req.params.id, role }), ip: req.ip, created_at: now() });
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
    await db.audit({ user_id: req.user.id, action: 'admin_delete_user',
      meta: JSON.stringify({ target: req.params.id }), ip: req.ip, created_at: now() });
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

export default router;
