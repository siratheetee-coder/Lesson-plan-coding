// POST /api/course-structure/preview
// Builds the "โครงสร้างรายวิชา" document HTML from selected unit IDs.
//
// Body: {
//   unit_ids: string[],                    // required, at least 1
//   indicator_map?: {                       // optional — frontend ships the curriculum
//     [indicatorId: string]: {              //   metadata since backend doesn't carry it
//       code: string,                       //   e.g. "ต 1.1 ป.4/1"
//       desc: string,                       //   indicator text
//     }
//   }
// }
//
// Response: { ok: true, html, data }  — preview is FREE, no credit deduction.

import express from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { limiters } from '../utils/limiters.js';
import { aggregate, renderHtml, renderDocx } from '../utils/courseStructure.js';

const router = express.Router();
router.use(requireAuth);

router.post('/preview', limiters.write, async (req, res) => {
  try {
    const unitIds = Array.isArray(req.body?.unit_ids) ? req.body.unit_ids : [];
    const indicatorMap = (req.body?.indicator_map && typeof req.body.indicator_map === 'object')
      ? req.body.indicator_map : {};

    if (unitIds.length === 0) {
      return res.status(400).json({ error: 'no_units', message: 'กรุณาเลือกหน่วยอย่างน้อย 1 หน่วย' });
    }
    if (unitIds.length > 50) {
      return res.status(400).json({ error: 'too_many', message: 'เลือกหน่วยได้สูงสุด 50 หน่วยต่อครั้ง' });
    }

    // Load all units owned by user, filter to requested IDs (in given order)
    const allUnits = await db.listUnits(req.user.id);
    const byId = new Map(allUnits.map(u => [u.id, u]));
    const units = unitIds.map(id => byId.get(id)).filter(Boolean);

    if (units.length === 0) {
      return res.status(404).json({ error: 'not_found', message: 'ไม่พบหน่วยที่เลือก' });
    }

    // Collect ALL linked lessons in one pass (one DB read)
    const allLessons = await db.listLessons(req.user.id);
    const lessonsById = Object.fromEntries(allLessons.map(l => [l.id, l]));

    // Aggregate → optionally attach AI description → render
    const data = aggregate({ units, lessonsById, indicatorMap });
    if (req.body?.description && typeof req.body.description === 'object') {
      data.description = {
        paragraph_1: String(req.body.description.paragraph_1 || ''),
        paragraph_2: String(req.body.description.paragraph_2 || ''),
      };
    }
    const html = renderHtml(data);

    res.json({ ok: true, html, data });
  } catch (e) {
    if (e.message === 'no_units') {
      return res.status(400).json({ error: 'no_units' });
    }
    console.error('[course-structure] preview error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── POST /api/course-structure/export-docx ────────────────
// Same body shape as /preview. Returns a .docx file as binary.
// FREE — does not deduct credits (course-level aggregation, no AI cost beyond preview).
router.post('/export-docx', limiters.write, async (req, res) => {
  try {
    const unitIds = Array.isArray(req.body?.unit_ids) ? req.body.unit_ids : [];
    const indicatorMap = (req.body?.indicator_map && typeof req.body.indicator_map === 'object')
      ? req.body.indicator_map : {};

    if (unitIds.length === 0) {
      return res.status(400).json({ error: 'no_units', message: 'กรุณาเลือกหน่วยอย่างน้อย 1 หน่วย' });
    }
    if (unitIds.length > 50) {
      return res.status(400).json({ error: 'too_many', message: 'เลือกหน่วยได้สูงสุด 50 หน่วยต่อครั้ง' });
    }

    const allUnits = await db.listUnits(req.user.id);
    const byId = new Map(allUnits.map(u => [u.id, u]));
    const units = unitIds.map(id => byId.get(id)).filter(Boolean);
    if (units.length === 0) {
      return res.status(404).json({ error: 'not_found', message: 'ไม่พบหน่วยที่เลือก' });
    }

    const allLessons = await db.listLessons(req.user.id);
    const lessonsById = Object.fromEntries(allLessons.map(l => [l.id, l]));

    const data = aggregate({ units, lessonsById, indicatorMap });
    if (req.body?.description && typeof req.body.description === 'object') {
      data.description = {
        paragraph_1: String(req.body.description.paragraph_1 || ''),
        paragraph_2: String(req.body.description.paragraph_2 || ''),
      };
    }

    const buf = await renderDocx(data);
    // ASCII-safe fallback filename + Thai RFC 5987 filename* for modern browsers
    const asciiPart = (data.subject_code || 'course').replace(/[^A-Za-z0-9]+/g, '').slice(0, 20) || 'course';
    const asciiName = `course-structure_${asciiPart}.docx`;
    const thaiName  = `โครงสร้างรายวิชา_${data.subject_name || 'course'}.docx`;
    const thaiEncoded = encodeURIComponent(thaiName);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${thaiEncoded}`);
    res.send(buf);
  } catch (e) {
    console.error('[course-structure] docx export error:', e);
    res.status(500).json({ error: 'server_error', message: 'สร้างไฟล์ DOCX ไม่สำเร็จ' });
  }
});

export default router;
