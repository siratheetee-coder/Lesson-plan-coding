// AI endpoints (Claude API integration).
// Pattern: deduct first → call Claude → refund on failure.
// Per-user rate limit + global ref_id idempotency.

import express from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { AI_COSTS } from '../config/packages.js';
import { generateRubric, generateOutline, isConfigured } from '../utils/claude.js';

const router = express.Router();
router.use(requireAuth);

// Rate limit: 10 AI calls per user per minute (gentler than the original 10/hour
// since users may iterate quickly — the credit system is the real cost gate)
const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'เรียกใช้ AI ถี่เกินไป กรุณารอสักครู่' },
});

// ─── Generic handler with Pattern A (deduct → call → refund on fail) ─
async function handleAi(req, res, { kind, cost, generator }) {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'claude_not_configured', message: 'ระบบ AI ยังไม่ได้ตั้งค่า' });
  }
  try {
    // Idempotency: client may pass `idempotency_key` to safely retry on network errors
    const idemKey = req.body?.idempotency_key || crypto.randomUUID();
    const refId = `ai:${kind}:${req.user.id}:${idemKey}`;

    // Idempotency check first — return cached if same key already charged
    const existing = await db.findCreditTransactionByRefId(refId);
    if (existing) {
      // Already charged. Tell client to retry with a fresh key for a new generation.
      return res.status(409).json({
        error: 'duplicate_request',
        message: 'คำขอนี้ถูกประมวลผลไปแล้ว กรุณาลองใหม่',
      });
    }

    // 1. Deduct first (atomic)
    const deduct = await db.deductCredits(
      req.user.id, cost, 'usage',
      `AI: ${kind}`,
      refId
    );
    if (!deduct.ok) {
      return res.status(402).json({
        error: 'insufficient_credits',
        message: 'เครดิตไม่เพียงพอ กรุณาเติมเครดิต',
      });
    }

    // 2. Call Claude
    let result;
    try {
      result = await generator(req.body || {});
    } catch (err) {
      // 3. Refund on any Claude-side failure
      await db.addCredits(
        req.user.id, cost, 'refund',
        `คืนเครดิต — AI ${kind} ขัดข้อง (${err.code || err.message})`,
        `refund:${refId}`
      ).catch(() => {});
      console.error(`[ai/${kind}] generation failed:`, err.message, err.raw || '');
      const status = err.code === 'claude_not_configured' ? 503 : 502;
      return res.status(status).json({
        error: 'claude_failed',
        message: 'AI ขัดข้องชั่วคราว เครดิตได้คืนแล้ว กรุณาลองใหม่',
      });
    }

    const balance = await db.getCredits(req.user.id);
    return res.json({
      ok: true,
      data: result.data,
      credits: balance,
      deducted: cost,
      idempotency_key: idemKey,
    });
  } catch (e) {
    console.error(`[ai/${kind}] handler error:`, e);
    res.status(500).json({ error: 'server_error' });
  }
}

// ─── POST /api/ai/generate-rubric ────────────────────────────
// Body: { title, level, indicators, objectives, time, idempotency_key? }
router.post('/generate-rubric', aiLimiter, (req, res) =>
  handleAi(req, res, {
    kind: 'rubric',
    cost: AI_COSTS.generate_rubric || 1,
    generator: generateRubric,
  })
);

// ─── POST /api/ai/generate-outline ───────────────────────────
// Body: { topic, level, time, indicators, objectives, idempotency_key? }
router.post('/generate-outline', aiLimiter, (req, res) =>
  handleAi(req, res, {
    kind: 'outline',
    cost: AI_COSTS.generate_outline || 1,
    generator: generateOutline,
  })
);

// ─── GET /api/ai/status ──────────────────────────────────────
// Lets the frontend check if AI features are available
router.get('/status', (_req, res) => {
  res.json({ configured: isConfigured(), model: 'claude-opus-4-7' });
});

export default router;
