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
      worksheets.push({
        label:       w.label.no ? `ใบงานที่ ${w.label.no}` : 'ใบงาน',
        displayName: w.raw,
        worksheetNo: w.label.no || String(worksheets.length + 1),
        source:      'media',
        activityContext: acts.map(a => `[${a.phase}] ${a.name}${a.detail ? ' — ' + a.detail : ''}`).join('\n'),
      });
    }
  } else {
    // Fallback: scan activities for "ใบงาน" even if not in media
    const inferred = activities.filter(a =>
      WS_KEYWORD_RE.test(a.name || '') || WS_KEYWORD_RE.test(a.detail || '')
    );
    if (inferred.length > 0) {
      worksheets.push({
        label:       'ใบงาน',
        displayName: `ใบงานเรื่อง ${meta.topic || 'บทเรียน'}`,
        worksheetNo: '1',
        source:      'inferred',
        activityContext: inferred
          .map(a => `[${a.phase}] ${a.name}${a.detail ? ' — ' + a.detail : ''}`)
          .join('\n'),
      });
    }
  }

  return { meta, worksheets, vocab, keyExpressions };
}
