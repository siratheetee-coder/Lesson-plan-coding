// Worksheet extractor — parses a saved lesson's `data` JSON and returns
// the worksheets the teacher already planned for, plus the surrounding
// activity context for each one.
//
// What we look for:
//   • media[] entries containing "ใบงาน" or "worksheet"
//   • activities[].name or .detail mentioning each worksheet by name
//   • vocab[] and sentences[] (key expressions) for content scaffolding
//
// Output shape:
// {
//   meta: { subject, level, topic },
//   worksheets: [
//     { label, displayName, activityContext, source: 'media'|'inferred' },
//     ...
//   ],
//   vocab: [...], keyExpressions: [...]
// }

const WS_KEYWORD_RE = /ใบงาน|worksheet/i;

// Keyword → section-type mapping. First match wins per keyword group.
// Order matters slightly: more specific patterns first.
const TYPE_HINTS = [
  { type: 'writing',      patterns: [/เขียน(เรียง|บรรยาย|ย่อหน้า|paragraph|เรื่อง|essay)/i, /เขียนเล่า/i, /แต่งเรื่อง/i, /\bwriting\b/i, /\bessay\b/i, /\bparagraph\b/i] },
  { type: 'short_answer', patterns: [/ตอบคำถาม\s*(สั้น)?/i, /short\s*answer/i, /\bquestion\b.*\banswer\b/i, /ตอบสั้น/i] },
  { type: 'matching',     patterns: [/จับคู่/i, /\bmatch(ing)?\b/i, /โยงเส้น/i] },
  { type: 'fill_blank',   patterns: [/เติมคำ/i, /เติมในช่องว่าง/i, /เติมประโยค/i, /fill\s*(in|the)?\s*blank/i, /gap\s*fill/i, /cloze/i] },
  { type: 'mcq',          patterns: [/เลือกคำตอบ/i, /เลือกตอบ/i, /ตัวเลือก/i, /multiple\s*choice/i, /\bmcq\b/i, /ก\s*ข\s*ค\s*ง/i] },
  { type: 'true_false',   patterns: [/ถูก\s*\/?\s*ผิด/i, /true\s*\/?\s*false/i, /T\s*\/\s*F/i, /\bT\/F\b/i] },
  { type: 'reordering',   patterns: [/เรียง(ประโยค|คำ|ลำดับ)/i, /reorder/i, /rearrange/i, /scrambled?/i, /unscramble/i] },
  { type: 'reading',      patterns: [/อ่าน(จับใจความ|บทความ|เรื่อง)/i, /\breading\b/i, /\bpassage\b/i, /\bcomprehension\b/i] },
];

// Returns array of types suggested by text content. Empty = no signal.
export function detectSectionTypes(text) {
  if (!text) return [];
  const hits = new Set();
  for (const h of TYPE_HINTS) {
    if (h.patterns.some(p => p.test(text))) hits.add(h.type);
  }
  return [...hits];
}

// Try to extract a worksheet "number" (e.g. "ใบงานที่ 1") to use for matching
function parseWorksheetLabel(text) {
  if (!text) return null;
  // Match "ใบงานที่ 1", "ใบงานที่1", "worksheet 1", "worksheet #1"
  const m = String(text).match(/(ใบงานที่|worksheet\s*#?)\s*(\d+)/i);
  if (m) return { kind: 'numbered', no: m[2], raw: m[0] };
  if (WS_KEYWORD_RE.test(text)) return { kind: 'plain', no: null, raw: text };
  return null;
}

export function extractWorksheets(lessonData) {
  if (!lessonData || typeof lessonData !== 'object') {
    return { meta: {}, worksheets: [], vocab: [], keyExpressions: [] };
  }
  const f = lessonData.fields || {};
  const meta = {
    subject:    f['subject-name'] || '',
    level:      f['class-level']  || '',
    topic:      f.topic           || '',
    unit:       f['unit-number']  || '',
    planNo:     f['plan-number']  || '',
  };

  const media      = Array.isArray(lessonData.media) ? lessonData.media.filter(Boolean) : [];
  const activities = Array.isArray(lessonData.activities) ? lessonData.activities : [];
  const vocab      = Array.isArray(lessonData.vocab) ? lessonData.vocab.filter(v => v.word) : [];
  const keyExpressions = Array.isArray(lessonData.sentences) ? lessonData.sentences.filter(Boolean) : [];

  // ── Find worksheet entries in media[] ──
  const mediaWorksheets = [];
  for (const m of media) {
    const lbl = parseWorksheetLabel(m);
    if (lbl) mediaWorksheets.push({ label: lbl, raw: String(m) });
  }

  // Helper: for a given worksheet label, find activities that reference it
  function activitiesFor(label) {
    const needle = label.no
      ? new RegExp(`ใบงานที่\\s*${label.no}|worksheet\\s*#?\\s*${label.no}`, 'i')
      : WS_KEYWORD_RE;
    return activities
      .filter(a => needle.test(a.name || '') || needle.test(a.detail || ''))
      .map(a => ({
        phase:  a.phase || '',
        name:   a.name  || '',
        detail: a.detail || '',
      }));
  }

  // Build worksheet candidates
  const worksheets = [];

  if (mediaWorksheets.length > 0) {
    for (const w of mediaWorksheets) {
      const acts = activitiesFor(w.label);
      const ctx  = acts.map(a => `[${a.phase}] ${a.name}${a.detail ? ' — ' + a.detail : ''}`).join('\n');
      worksheets.push({
        label:       w.label.no ? `ใบงานที่ ${w.label.no}` : 'ใบงาน',
        displayName: w.raw,
        worksheetNo: w.label.no || String(worksheets.length + 1),
        source:      'media',
        activityContext: ctx,
        suggestedTypes:  detectSectionTypes(`${w.raw}\n${ctx}`),
      });
    }
  } else {
    // Fallback: scan activities for "ใบงาน" even if not in media
    const inferred = activities.filter(a =>
      WS_KEYWORD_RE.test(a.name || '') || WS_KEYWORD_RE.test(a.detail || '')
    );
    if (inferred.length > 0) {
      const ctx = inferred.map(a => `[${a.phase}] ${a.name}${a.detail ? ' — ' + a.detail : ''}`).join('\n');
      worksheets.push({
        label:       'ใบงาน',
        displayName: `ใบงานเรื่อง ${meta.topic || 'บทเรียน'}`,
        worksheetNo: '1',
        source:      'inferred',
        activityContext: ctx,
        suggestedTypes:  detectSectionTypes(ctx),
      });
    }
  }

  return { meta, worksheets, vocab, keyExpressions };
}
