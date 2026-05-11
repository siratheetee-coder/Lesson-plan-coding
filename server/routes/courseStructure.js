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
import { aggregate, renderHtml } from '../utils/courseStructure.js';

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

    // Aggregate → render
    const data = aggregate({ units, lessonsById, indicatorMap });
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

export default router;
