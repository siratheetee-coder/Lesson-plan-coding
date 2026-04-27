// Lesson plan history — per-user CRUD.
// All routes require auth. Lessons are scoped to req.user.id.

import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/lessons — list all saved lessons ────────────
router.get('/', async (req, res) => {
  try {
    const lessons = await db.listLessons(req.user.id);
    res.json({ lessons });
  } catch (e) {
    console.error('[lessons] list error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /api/lessons — create or update a lesson ────────
// Body: the full history entry object (id is client-generated)
router.post('/', async (req, res) => {
  try {
    const entry = req.body;
    if (!entry?.id || typeof entry.id !== 'string') {
      return res.status(400).json({ error: 'missing_id' });
    }
    await db.upsertLesson(req.user.id, entry);
    res.json({ ok: true });
  } catch (e) {
    console.error('[lessons] upsert error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── PATCH /api/lessons/:id — rename only ─────────────────
router.patch('/:id', async (req, res) => {
  try {
    const { title, customTitle } = req.body || {};
    await db.patchLesson(req.user.id, req.params.id, { title, customTitle });
    res.json({ ok: true });
  } catch (e) {
    console.error('[lessons] patch error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── DELETE /api/lessons/:id ───────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await db.deleteLesson(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('[lessons] delete error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
