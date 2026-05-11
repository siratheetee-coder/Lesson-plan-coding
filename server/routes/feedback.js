// User feedback endpoint — stores rating (1-5) + optional message.
// Per-user rate-limited via limiters.write (already strict on writes).

import express from 'express';
import crypto from 'node:crypto';
import { db, now } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { limiters } from '../utils/limiters.js';
import { audit, ACTIONS } from '../utils/audit.js';

const router = express.Router();
router.use(requireAuth);

// POST /api/feedback  { rating: 1-5, message?: string }
router.post('/', limiters.write, async (req, res) => {
  try {
    const rating = parseInt(req.body?.rating);
    const message = String(req.body?.message || '').slice(0, 2000).trim();

    if (!(rating >= 1 && rating <= 5)) {
      return res.status(400).json({ error: 'invalid_rating', message: 'กรุณาให้ดาว 1-5' });
    }

    const entry = {
      id: 'fb_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
      user_id: req.user.id,
      rating,
      message: message || null,
      created_at: now(),
    };
    await db.insertFeedback(entry);

    audit(req.user.id, ACTIONS.FEEDBACK_SUBMITTED, { rating, has_message: !!message }, req);

    res.json({ ok: true, message: 'ขอบคุณสำหรับ feedback ค่ะ 💛' });
  } catch (e) {
    console.error('[feedback] insert error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// GET /api/feedback  (admin only) — list recent feedback
router.get('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const list = await db.listFeedback({ limit });
    res.json({ ok: true, items: list });
  } catch (e) {
    console.error('[feedback] list error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
