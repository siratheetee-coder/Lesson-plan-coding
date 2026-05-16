// Worksheet generator endpoints.
//
// POST /api/worksheets/scan        → list worksheet candidates extracted from a lesson (free)
// POST /api/worksheets/generate    → AI builds worksheet JSON for the chosen candidate (free)
// POST /api/worksheets/export-docx → render JSON → .docx file (charges 0.5 credit, idempotent by lesson+worksheetNo)

import express from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { limiters } from '../utils/limiters.js';
import { audit, ACTIONS } from '../utils/audit.js';
import { generateWorksheet, isConfigured } from '../utils/claude.js';
import { extractWorksheets } from '../utils/worksheetExtract.js';
import { renderWorksheetDocx } from '../utils/worksheetDocx.js';

const router = express.Router();
router.use(requireAuth);

const COST_PER_EXPORT = 0.5;

// ─── POST /scan ────────────────────────────────────────────
// body: { lesson_id }  → returns { worksheets: [...], meta, vocab, keyExpressions }
router.post('/scan', limiters.write, async (req, res) => {
  try {
    const lessonId = String(req.body?.lesson_id || '').trim();
    if (!lessonId) return res.status(400).json({ error: 'missing_lesson_id' });

    const lessons = await db.listLessons(req.user.id);
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) return res.status(404).json({ error: 'lesson_not_found' });

    const result = extractWorksheets(lesson.data || {});
    res.json({ ok: true, ...result, lessonTitle: lesson.title || result.meta.topic || '' });
  } catch (e) {
    console.error('[worksheets/scan]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /generate ────────────────────────────────────────
// body: { lesson_id, worksheet_index } → AI returns full worksheet JSON
router.post('/generate', limiters.ai, async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'claude_not_configured', message: 'ระบบ AI ยังไม่ได้ตั้งค่า' });
  }
  try {
    const lessonId = String(req.body?.lesson_id || '').trim();
    const wsIndex  = parseInt(req.body?.worksheet_index ?? 0, 10) || 0;
    if (!lessonId) return res.status(400).json({ error: 'missing_lesson_id' });

    const lessons = await db.listLessons(req.user.id);
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) return res.status(404).json({ error: 'lesson_not_found' });

    const { meta, worksheets, vocab, keyExpressions } = extractWorksheets(lesson.data || {});
    if (worksheets.length === 0) {
      return res.status(400).json({
        error: 'no_worksheets_in_plan',
        message: 'ไม่พบใบงานในแผนนี้ — กรุณาเพิ่มคำว่า "ใบงาน" ในสื่อฯ หรือกิจกรรมก่อน',
      });
    }
    const target = worksheets[wsIndex] || worksheets[0];

    // Build payload for Claude
    const aiPayload = {
      worksheetNo: target.worksheetNo,
      title:       target.displayName.replace(/^ใบงาน(ที่\s*\d+)?\s*(เรื่อง)?\s*/i, '').trim()
                   || meta.topic || 'Worksheet',
      subject:     meta.subject || 'ภาษาอังกฤษ',
      level:       meta.level || '',
      duration:    '20',
      totalScore:  '10',
      activity_context: target.activityContext || '',
      vocab:       vocab.slice(0, 10),         // cap to avoid blowing context
      sentences:   keyExpressions.slice(0, 10),
    };

    const result = await generateWorksheet(aiPayload);
    res.json({ ok: true, data: result.data });
  } catch (e) {
    audit(req.user.id, ACTIONS.AI_GENERATE_FAILED, { kind: 'worksheet', code: e.code || e.message }, req);
    console.error('[worksheets/generate]', {
      message: e.message, code: e.code, stop_reason: e.stop_reason,
      text_length: e.text_length, raw_preview: e.raw ? e.raw.slice(0, 300) : null,
    });
    if (e.code === 'claude_parse_failed') {
      return res.status(502).json({ error: 'claude_parse_failed', message: 'AI ตอบกลับไม่ถูกรูปแบบ กรุณาลองใหม่' });
    }
    res.status(502).json({ error: 'claude_failed', message: 'AI ขัดข้องชั่วคราว กรุณาลองใหม่' });
  }
});

// ─── POST /export-docx ─────────────────────────────────────
// body: { lesson_id, worksheet_no, data }  → DOCX file
// Charges 0.5 credit. Idempotent by ref_id = `worksheet:${lessonId}:${worksheetNo}:${hash}`.
router.post('/export-docx', limiters.write, async (req, res) => {
  try {
    const lessonId    = String(req.body?.lesson_id || '').trim();
    const worksheetNo = String(req.body?.worksheet_no || '1').trim();
    const data        = req.body?.data;
    if (!lessonId)         return res.status(400).json({ error: 'missing_lesson_id' });
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'missing_data' });

    // Content hash so re-export of same data doesn't double-charge
    const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
    const refId = `worksheet:${req.user.id}:${lessonId}:${worksheetNo}:${hash}`;

    const existing = await db.findCreditTransactionByRefId(refId);
    if (!existing) {
      const deduct = await db.deductCredits(
        req.user.id, COST_PER_EXPORT, 'usage',
        `Export ใบงาน: ${data.title || worksheetNo}`, refId
      );
      if (!deduct.ok) {
        return res.status(402).json({
          error: 'insufficient_credits',
          message: 'เครดิตไม่เพียงพอ กรุณาเติมเครดิต',
        });
      }
    }

    // Render
    let buf;
    try {
      buf = await renderWorksheetDocx(data);
    } catch (err) {
      // Refund if we just deducted
      if (!existing) {
        await db.addCredits(
          req.user.id, COST_PER_EXPORT, 'refund',
          `คืนเครดิต — render ใบงานขัดข้อง`, `refund:${refId}`
        ).catch(() => {});
      }
      console.error('[worksheets/export-docx] render error:', err);
      return res.status(500).json({ error: 'render_failed', message: 'สร้างไฟล์ DOCX ไม่สำเร็จ' });
    }

    // Filename
    const safeTitle = (data.title || 'worksheet').replace(/[\/\\?%*:|"<>]/g, '').slice(0, 40);
    const asciiName = `worksheet_${worksheetNo}.docx`;
    const thaiName  = `ใบงานที่_${worksheetNo}_${safeTitle}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(thaiName)}`);
    res.send(buf);
  } catch (e) {
    console.error('[worksheets/export-docx]', e);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
