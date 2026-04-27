// Unit planner — per-user CRUD.
// All routes require auth. Units are scoped to req.user.id.

import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { limiters } from '../utils/limiters.js';

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/units — list all units ──────────────────────
router.get('/', async (req, res) => {
  try {
    const units = await db.listUnits(req.user.id);
    res.json({ units });
  } catch (e) {
    console.error('[units] list error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── PUT /api/units/:id — upsert a unit ───────────────────
// Body: full unit object (id is client-generated)
router.put('/:id', limiters.write, async (req, res) => {
  try {
    const unit = req.body;
    if (!unit?.id || unit.id !== req.params.id) {
      return res.status(400).json({ error: 'id_mismatch' });
    }
    await db.upsertUnit(req.user.id, unit);
    res.json({ ok: true });
  } catch (e) {
    console.error('[units] upsert error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── DELETE /api/units/:id ─────────────────────────────────
router.delete('/:id', limiters.write, async (req, res) => {
  try {
    await db.deleteUnit(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[units] delete error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
