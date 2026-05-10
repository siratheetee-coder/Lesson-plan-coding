// AI endpoints (Claude API integration).
// AI calls are FREE — credits are only charged on lesson export (1 credit = 1 แผน).
// Pattern (cost > 0 only): deduct first → call Claude → refund on failure.
// Per-user rate limit + global ref_id idempotency.

import express from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { limiters } from '../utils/limiters.js';
import { audit, ACTIONS } from '../utils/audit.js';
import { outlineSemaphore } from '../utils/concurrency.js';
import {
  generateObjectives,
  generateConcept,
  generateMedia,
  generateTask,
  generateActivities,
  generatePassingCriteria,
  generateAssessments,
  generateUnitArc,
  generateUnitOutline,
  isConfigured,
} from '../utils/claude.js';

const router = express.Router();
router.use(requireAuth);

const aiLimiter = limiters.ai;

// ─── Generic handler ──────────────────────────────────────
// cost = 0 → free AI call (no credit ledger entries)
// cost > 0 → Pattern A: deduct first → call Claude → refund on failure
async function handleAi(req, res, { kind, cost, generator, semaphore }) {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'claude_not_configured', message: 'ระบบ AI ยังไม่ได้ตั้งค่า' });
  }
  // Resolve dynamic cost (function) vs static (number)
  if (typeof cost === 'function') {
    try { cost = Number(cost(req)) || 0; } catch { cost = 0; }
  }
  // ── Semaphore: cap simultaneous heavy AI ops (e.g. unit outliner) ──
  // Acquire BEFORE deducting credits so failures cost nothing.
  let releaseSlot = null;
  if (semaphore) {
    try {
      const queuedAt = Date.now();
      releaseSlot = await semaphore.acquire();
      const waitMs = Date.now() - queuedAt;
      if (waitMs > 1000) {
        console.log(`[ai/${kind}] queued ${waitMs}ms before slot acquired (active=${semaphore.active}, queue=${semaphore.queue.length})`);
      }
    } catch (e) {
      // queue_full or queue_timeout
      audit(req.user.id, ACTIONS.AI_GENERATE_FAILED, { kind, code: e.code || 'overloaded' }, req);
      const message = e.code === 'queue_full'
        ? 'ระบบกำลังหนักมาก ขณะนี้มีผู้ใช้รออยู่หลายคน — กรุณาลองใหม่ในอีกสักครู่'
        : 'ระบบกำลังหนัก รอนานเกินไป — กรุณาลองใหม่ในอีกสักครู่';
      return res.status(503).json({
        error: 'ai_overloaded',
        code: e.code,
        message,
        retry_after_seconds: e.code === 'queue_full' ? 30 : 60,
      });
    }
  }
  try {
    // ── Paid path: credit check + idempotency guard ──────
    if (cost > 0) {
      const idemKey = req.body?.idempotency_key || crypto.randomUUID();
      const refId = `ai:${kind}:${req.user.id}:${idemKey}`;
      const existing = await db.findCreditTransactionByRefId(refId);
      if (existing) {
        return res.status(409).json({
          error: 'duplicate_request',
          message: 'คำขอนี้ถูกประมวลผลไปแล้ว กรุณาลองใหม่',
        });
      }

      const deduct = await db.deductCredits(
        req.user.id, cost, 'usage',
        `AI: ${kind}`, refId
      );
      if (!deduct.ok) {
        return res.status(402).json({
          error: 'insufficient_credits',
          message: 'เครดิตไม่เพียงพอ กรุณาเติมเครดิต',
        });
      }

      let result;
      try {
        result = await generator(req.body || {});
      } catch (err) {
        await db.addCredits(
          req.user.id, cost, 'refund',
          `คืนเครดิต — AI ${kind} ขัดข้อง (${err.code || err.message})`,
          `refund:${refId}`
        ).catch(() => {});
        audit(req.user.id, ACTIONS.AI_GENERATE_FAILED, { kind, code: err.code || err.message }, req);
        console.error(`[ai/${kind}] generation failed:`, {
          message: err.message,
          code: err.code,
          stop_reason: err.stop_reason,
          text_length: err.text_length,
          usage: err.usage,
          raw_preview: err.raw ? err.raw.slice(0, 300) : null,
        });
        return res.status(502).json({
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
    }

    // ── Free path: just call Claude, no ledger touch ─────
    let result;
    try {
      result = await generator(req.body || {});
    } catch (err) {
      audit(req.user.id, ACTIONS.AI_GENERATE_FAILED, { kind, code: err.code || err.message }, req);
      console.error(`[ai/${kind}] generation failed:`, {
        message: err.message,
        code: err.code,
        stop_reason: err.stop_reason,
        text_length: err.text_length,
        usage: err.usage,
        raw_preview: err.raw ? err.raw.slice(0, 300) : null,
      });
      return res.status(502).json({
        error: 'claude_failed',
        message: 'AI ขัดข้องชั่วคราว กรุณาลองใหม่',
      });
    }

    const balance = await db.getCredits(req.user.id);
    return res.json({
      ok: true,
      data: result.data,
      credits: balance,
      deducted: 0,
      idempotency_key: null,
    });
  } catch (e) {
    console.error(`[ai/${kind}] handler error:`, e);
    res.status(500).json({ error: 'server_error' });
  } finally {
    if (typeof releaseSlot === 'function') releaseSlot();
  }
}

const COST = 0; // AI generation is FREE — 1 credit is charged only on export

// ─── 6 AI endpoints ──────────────────────────────────────
router.post('/generate-objectives', aiLimiter, (req, res) =>
  handleAi(req, res, { kind: 'objectives', cost: COST, generator: generateObjectives }));

router.post('/generate-concept', aiLimiter, (req, res) =>
  handleAi(req, res, { kind: 'concept', cost: COST, generator: generateConcept }));

router.post('/generate-media', aiLimiter, (req, res) =>
  handleAi(req, res, { kind: 'media', cost: COST, generator: generateMedia }));

router.post('/generate-task', aiLimiter, (req, res) =>
  handleAi(req, res, { kind: 'task', cost: COST, generator: generateTask }));

router.post('/generate-activities', aiLimiter, (req, res) =>
  handleAi(req, res, { kind: 'activities', cost: COST, generator: generateActivities }));

router.post('/generate-passing-criteria', aiLimiter, (req, res) =>
  handleAi(req, res, { kind: 'passing_criteria', cost: COST, generator: generatePassingCriteria }));

router.post('/generate-assessments', aiLimiter, (req, res) =>
  handleAi(req, res, { kind: 'assessments', cost: COST, generator: generateAssessments }));

router.post('/generate-unit-arc', aiLimiter, (req, res) =>
  handleAi(req, res, { kind: 'unit_arc', cost: COST, generator: generateUnitArc }));

// Unit Outline — paid feature: 1 credit per planned lesson
// (drafts created from this call are PRE-PAID → exports of them are free via lesson_hash idempotency)
// Semaphore caps simultaneous outlines (default 3) to protect memory + Anthropic rate limit.
router.post('/generate-unit-outline', aiLimiter, (req, res) =>
  handleAi(req, res, {
    kind: 'unit_outline',
    cost: (r) => {
      const n = parseInt(r.body?.lesson_count) || 0;
      // Fallback: derive from total_hours / 2 (matches prompt rule)
      if (n > 0) return Math.max(3, Math.min(15, n));
      const h = parseFloat(r.body?.total_hours) || 0;
      return h > 0 ? Math.max(3, Math.min(12, Math.round(h / 2))) : 5;
    },
    generator: generateUnitOutline,
    semaphore: outlineSemaphore,
  }));

// Health endpoint — returns active/queued count for monitoring
router.get('/queue-status', (_req, res) => {
  res.json({ outline: outlineSemaphore.stats() });
});

// ─── Status ──────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json({ configured: isConfigured(), model: 'claude-haiku-4-5' });
});

export default router;
