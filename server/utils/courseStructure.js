// Course Structure aggregator + renderer.
// Takes selected units (+ their linked lessons) and produces the
// "โครงสร้างรายวิชา" document — 5 sections of A4 HTML mirroring the
// template at course-structure-template.html.
//
// Aggregation rules:
//   - Subject info (code, name, group, class level, term, year) comes
//     from the first unit. Missing fields stay blank.
//   - Indicators are a UNION across all linked lessons (de-duplicated
//     by `code`). Text comes from the optional `indicator_map` the
//     frontend ships in the request body — backend doesn't ship the
//     curriculum so this lookup is required for full text.
//   - Total hours = sum of unit.totalHours.
//   - Score weights / midterm/final splits aren't tracked in the
//     current unit schema → placeholders are left blank for the user
//     to fill in by editing the printed doc.

// ─── Thai-language strand titles per subject prefix ──────
// First char of indicator code determines which subject curriculum.
// "ต" = ภาษาต่างประเทศ (foreign language)
// "ค" = คณิตศาสตร์ (math)
// "ว" = วิทยาศาสตร์ (science)
const STRAND_TITLES = {
  'ต': {
    '1': 'ภาษาเพื่อการสื่อสาร',
    '2': 'ภาษาและวัฒนธรรม',
    '3': 'ภาษากับความสัมพันธ์กับกลุ่มสาระการเรียนรู้อื่น',
    '4': 'ภาษากับความสัมพันธ์กับชุมชนและโลก',
  },
};

// ─── Helpers ─────────────────────────────────────────────
function parseIndicatorCode(code) {
  // "ต 1.1 ป.4/1" → { prefix: "ต", strandNum: "1", subStrand: "1.1", levelCode: "ป.4/1" }
  if (!code) return null;
  const m = String(code).trim().match(/^([ก-ฮ]+)\s*(\d+)\.(\d+)\s*(.+)?$/);
  if (!m) return null;
  return {
    prefix: m[1],
    strandNum: m[2],
    subStrand: `${m[2]}.${m[3]}`,
    levelCode: (m[4] || '').trim(),
    strandCode: `${m[1]} ${m[2]}.${m[3]}`,
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

// ─── Aggregate selected units + their lessons → data ─────
export function aggregate({ units, lessonsById, indicatorMap = {} }) {
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error('no_units');
  }

  // Subject info — first unit wins
  const first = units[0] || {};
  const subjectPrefix = (() => {
    // Detect prefix from any used indicator (fallback: ต for English)
    for (const u of units) {
      for (const lid of (u.lessonIds || [])) {
        const lesson = lessonsById[lid];
        const ids = lesson?.data?.indicatorIds || [];
        for (const id of ids) {
          const meta = indicatorMap[id];
          const parsed = meta && parseIndicatorCode(meta.code);
          if (parsed?.prefix) return parsed.prefix;
        }
      }
    }
    return 'ต';
  })();

  // Collect unique indicators across all lessons in all units
  const seen = new Map(); // code → { code, text }
  for (const u of units) {
    for (const lid of (u.lessonIds || [])) {
      const lesson = lessonsById[lid];
      const ids = lesson?.data?.indicatorIds || [];
      for (const id of ids) {
        const meta = indicatorMap[id];
        if (!meta) continue;
        const code = meta.code || id;
        if (!seen.has(code)) {
          seen.set(code, { code, text: meta.desc || meta.text || '' });
        }
      }
    }
  }

  // Group by strand code ("ต 1.1") for the short-code list (section 2)
  const byStrand = new Map(); // strandCode → [levelCodes]
  for (const { code } of seen.values()) {
    const p = parseIndicatorCode(code);
    if (!p) continue;
    if (!byStrand.has(p.strandCode)) byStrand.set(p.strandCode, []);
    byStrand.get(p.strandCode).push(p.levelCode);
  }
  const indicatorGroups = [...byStrand.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'th'))
    .map(([strandCode, levels]) => ({
      strand_code: strandCode,
      level_codes_joined: [...new Set(levels)].sort().join(' , '),
    }));

  // Group by main strand number (1, 2, 3, 4) for section 3 (full text)
  const byMainStrand = new Map(); // strandNum → [indicators]
  for (const { code, text } of seen.values()) {
    const p = parseIndicatorCode(code);
    if (!p) continue;
    if (!byMainStrand.has(p.strandNum)) byMainStrand.set(p.strandNum, []);
    byMainStrand.get(p.strandNum).push({ code, text });
  }
  let globalIdx = 0;
  const strands = [...byMainStrand.entries()]
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([no, inds]) => {
      const sorted = inds.sort((a, b) => a.code.localeCompare(b.code, 'th'));
      const enriched = sorted.map(ind => {
        globalIdx++;
        return { idx: globalIdx, code: ind.code, text: ind.text };
      });
      const titleMap = STRAND_TITLES[subjectPrefix] || {};
      return { no, title: titleMap[no] || '', indicators: enriched };
    });

  // Per-unit rows
  const unitRows = units.map((u, i) => {
    const linked = (u.lessonIds || []).map(id => lessonsById[id]).filter(Boolean);
    // Collect unique indicator codes used in THIS unit's lessons
    const codeSet = new Set();
    for (const l of linked) {
      for (const id of (l.data?.indicatorIds || [])) {
        const meta = indicatorMap[id];
        if (meta?.code) codeSet.add(meta.code);
      }
    }
    // Essence: aggregate from lessons (keyConcept / topic of first lesson)
    const essence = (() => {
      for (const l of linked) {
        const kc = l.data?.fields?.['key-concept'] || l.data?.keyConcept;
        if (kc && kc.trim()) return kc.trim();
      }
      return '';
    })();
    return {
      no: u.unitNo || String(i + 1),
      title: u.title || '',
      indicator_codes: [...codeSet].sort(),
      essence,
      hours: parseFloat(u.totalHours) || 0,
      score_weight: u.scoreWeight ?? '',
    };
  });

  const totalHours = unitRows.reduce((s, u) => s + (u.hours || 0), 0);

  return {
    subject_code:    first.subjectCode || '',
    subject_name:    first.subjectName || '',
    subject_group:   first.subjectGroup || '',
    class_level:     first.classLevel || '',
    terms:           first.semester || '',
    academic_year:   first.year || '',
    total_hours:     totalHours,
    hours_per_week: '',  // not tracked in unit schema
    teacher_name:   first.teacher || '',

    indicator_groups: indicatorGroups,
    total_indicators: seen.size,
    strands,

    units: unitRows,
    collected_score_total: '',  // user fills these in
    final_exam_score:     '',
    grand_total_score:    '',

    // Mirror unit rows for the assessment table (empty values — user fills)
    assessment_rows: unitRows.map(u => ({
      no: u.no, title: u.title,
      collected: u.score_weight ?? '',
      midterm: '', final: '', total: '',
    })),
  };
}

// ─── Render → HTML mirroring course-structure-template.html ──
export function renderHtml(data) {
  const ph = (v) => v === '' || v === null || v === undefined
    ? '<span class="empty">—</span>'
    : esc(v);

  // Section 2: indicator code list
  const indicatorCodeList = data.indicator_groups.length
    ? data.indicator_groups.map(g => `
        <li>
          <span class="code">${esc(g.strand_code)}</span>
          <span>${esc(g.level_codes_joined)}</span>
        </li>`).join('')
    : '<li class="empty-row">— ไม่พบตัวชี้วัดในแผน —</li>';

  // Section 3: strands with full indicator text
  const strandsHtml = data.strands.length
    ? data.strands.map(s => `
        <div class="strand-heading">สาระที่ ${esc(s.no)}  ${esc(s.title)}</div>
        <ul class="strand-list">
          ${s.indicators.map(ind => `
            <li>
              <span class="idx">${ind.idx})</span>
              <span class="code">${esc(ind.code)}</span>
              <span>${esc(ind.text)}</span>
            </li>`).join('')}
        </ul>`).join('')
    : '<p class="empty-row">— ไม่พบตัวชี้วัด —</p>';

  // Section 4: course structure table
  const unitRowsHtml = data.units.map(u => `
    <tr>
      <td class="center">${ph(u.no)}</td>
      <td class="unit-name center">${ph(u.title)}</td>
      <td class="indicators">${u.indicator_codes.map(esc).join('<br>') || '<span class="empty">—</span>'}</td>
      <td class="essence">${ph(u.essence)}</td>
      <td class="center">${ph(u.hours || '')}</td>
      <td class="center">${ph(u.score_weight)}</td>
    </tr>`).join('');

  // Section 5: assessment table rows
  const assessRowsHtml = data.assessment_rows.map(r => `
    <tr>
      <td>${ph(r.no)}</td>
      <td>${ph(r.title)}</td>
      <td>${ph(r.collected)}</td>
      <td>${ph(r.midterm)}</td>
      <td>${ph(r.final)}</td>
      <td>${ph(r.total)}</td>
    </tr>`).join('');

  // Shared info-grid header (subject/term/level box)
  const infoGrid = `
    <div class="info-grid">
      <div class="col">
        <span>รหัสวิชา ${ph(data.subject_code)} รายวิชา ${ph(data.subject_name)}</span>
        <span>ภาคเรียนที่ ${ph(data.terms)} ปีการศึกษา ${ph(data.academic_year)}</span>
        <span>เวลาเรียน ${ph(data.total_hours || '')} ชั่วโมง</span>
      </div>
      <div class="col right">
        <span>กลุ่มสาระการเรียนรู้ ${ph(data.subject_group)}</span>
        <span>ชั้น ${ph(data.class_level)}</span>
        <span>เวลาเรียน ${ph(data.hours_per_week)} ชั่วโมง/สัปดาห์</span>
      </div>
    </div>
    <hr class="info-rule">`;

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>โครงสร้างรายวิชา — ${esc(data.subject_name || 'รายวิชา')}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap');
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; font-family:'Sarabun', sans-serif; background:#e5e7eb; color:#1f2937; }
  body { padding: 24px 0; }
  .page { width:210mm; min-height:297mm; background:white; margin:0 auto 18px; padding:22mm 18mm 22mm 22mm; box-shadow:0 4px 18px rgba(0,0,0,.12); font-size:15pt; line-height:1.55; }
  .doc-title { text-align:center; font-size:18pt; font-weight:600; margin:0 0 14px; }
  .info-grid { display:flex; justify-content:space-between; margin-bottom:8px; font-size:14pt; }
  .info-grid .col { display:flex; flex-direction:column; gap:2px; }
  .info-grid .col.right { text-align:right; }
  hr.info-rule { border:none; border-top:1px solid #1f2937; margin:6px 0 16px; }
  .indent-para { text-indent:32pt; text-align:justify; margin:12px 0; font-size:15pt; line-height:1.65; }
  .indicator-codes-title { font-weight:600; font-size:16pt; margin:0 0 10px; }
  .indicator-codes { list-style:none; padding:0; margin:0; font-size:15pt; line-height:1.9; }
  .indicator-codes li { display:flex; gap:14px; }
  .indicator-codes .code { min-width:60px; }
  .indicator-total { font-weight:600; text-align:center; margin-top:12px; font-size:15pt; }
  .strand-heading { font-weight:600; font-size:15pt; margin:16px 0 8px; }
  .strand-list { list-style:none; padding:0; margin:0; }
  .strand-list li { display:flex; gap:10px; margin-bottom:6px; padding-left:8px; font-size:14pt; line-height:1.55; }
  .strand-list .idx { min-width:28px; flex-shrink:0; }
  .strand-list .code { min-width:110px; flex-shrink:0; }
  table.course-table, table.assess-table { width:100%; border-collapse:collapse; margin:6px 0; font-size:13pt; }
  table.course-table th, table.course-table td, table.assess-table th, table.assess-table td { border:1px solid #1f2937; padding:8px 10px; vertical-align:top; line-height:1.45; }
  table.course-table th, table.assess-table th { text-align:center; background:#f8fafc; font-weight:600; }
  table.course-table td.center, table.assess-table td { text-align:center; }
  table.course-table td.unit-name { font-weight:500; }
  table.course-table td.indicators { white-space:normal; font-size:12.5pt; line-height:1.7; }
  table.course-table td.essence { text-align:left; font-size:13pt; line-height:1.55; }
  table.course-table .total-row td, table.assess-table .total-row td { font-weight:600; background:#f8fafc; }
  .empty { color:#9ca3af; font-style:italic; }
  .empty-row { color:#9ca3af; font-style:italic; margin:8px 0; }
  .preview-banner { max-width:210mm; margin:0 auto 14px; background:linear-gradient(135deg,#dbeafe,#bfdbfe); border:1px solid #3b82f6; border-radius:8px; padding:14px 20px; font-size:13pt; color:#1e3a8a; }
  .preview-banner b { color:#1d4ed8; }
  @media print {
    body { background:white; padding:0; }
    .page { margin:0; box-shadow:none; page-break-after:always; width:100%; min-height:auto; padding:22mm 18mm 22mm 22mm; }
    .page:last-child { page-break-after:auto; }
    .preview-banner { display:none; }
  }
</style>
</head>
<body>

<div class="preview-banner">
  📋 <b>โครงสร้างรายวิชา</b> — สร้างจาก ${data.units.length} หน่วยที่เลือก ·
  ใช้ <code>Ctrl+P</code> เพื่อพิมพ์ / save as PDF ·
  ช่องที่ <span class="empty">—</span> ขีดเส้นเทาคือยังไม่มีข้อมูล (เติมในแผนหรือแก้ในเอกสารเอง)
</div>

<!-- Section 1 — คำอธิบายรายวิชา -->
<div class="page">
  <h1 class="doc-title">คำอธิบายรายวิชา</h1>
  ${infoGrid}
  <p class="indent-para empty-row" style="text-indent:0; text-align:center;">
    (ย่อหน้าคำอธิบายรายวิชา — ใช้ AI สร้างได้ในขั้นถัดไป หรือพิมพ์ในเอกสารเอง)
  </p>
</div>

<!-- Section 2 — ตัวชี้วัด (รหัสย่อ) -->
<div class="page">
  <h2 class="indicator-codes-title">ตัวชี้วัด</h2>
  <ul class="indicator-codes">${indicatorCodeList}</ul>
  <p class="indicator-total">รวมทั้งหมด ${ph(data.total_indicators || 0)} ตัวชี้วัด</p>
</div>

<!-- Section 3 — สาระ มาตรฐาน และตัวชี้วัด (รายละเอียดเต็ม) -->
<div class="page">
  <h1 class="doc-title">สาระ มาตรฐานการเรียนรู้ และตัวชี้วัด</h1>
  ${infoGrid}
  ${strandsHtml}
</div>

<!-- Section 4 — โครงสร้างรายวิชา -->
<div class="page">
  <h1 class="doc-title">โครงสร้างรายวิชา</h1>
  ${infoGrid}
  <table class="course-table">
    <thead>
      <tr>
        <th style="width:8%;">หน่วยที่</th>
        <th style="width:16%;">ชื่อหน่วยการเรียนรู้</th>
        <th style="width:18%;">มาตรฐานการเรียนรู้/<br>ตัวชี้วัด</th>
        <th>สาระสำคัญ</th>
        <th style="width:10%;">เวลา<br>(ชั่วโมง)</th>
        <th style="width:10%;">น้ำหนัก<br>คะแนน</th>
      </tr>
    </thead>
    <tbody>
      ${unitRowsHtml}
      <tr class="total-row">
        <td colspan="4">คะแนนเก็บระหว่างเรียน</td>
        <td></td>
        <td>${ph(data.collected_score_total)}</td>
      </tr>
      <tr class="total-row">
        <td colspan="4">คะแนนสอบปลายปี</td>
        <td></td>
        <td>${ph(data.final_exam_score)}</td>
      </tr>
      <tr class="total-row">
        <td colspan="4">รวมตลอดปี</td>
        <td>${ph(data.total_hours || '')}</td>
        <td>${ph(data.grand_total_score)}</td>
      </tr>
    </tbody>
  </table>
</div>

<!-- Section 5 — การวัดผลประเมินผล -->
<div class="page">
  <h1 class="doc-title">การวัดผลประเมินผล</h1>
  ${infoGrid}
  <table class="assess-table">
    <thead>
      <tr>
        <th rowspan="3" style="width:8%;">หน่วยที่</th>
        <th rowspan="3" style="width:22%;">ชื่อหน่วย<br>การเรียนรู้</th>
        <th colspan="3">การวัดผลประเมินผล</th>
        <th rowspan="3" style="width:14%;">รวมทั้ง<br>ปีการศึกษา<br>(100 คะแนน)</th>
      </tr>
      <tr>
        <th rowspan="2" style="width:16%;">คะแนนเก็บ<br>ระหว่างเรียน</th>
        <th colspan="2">คะแนนสอบปลายปี</th>
      </tr>
      <tr>
        <th>สอบปลาย<br>ภาคเรียนที่ 1</th>
        <th>สอบปลาย<br>ภาคเรียนที่ 2</th>
      </tr>
    </thead>
    <tbody>
      ${assessRowsHtml}
      <tr class="total-row">
        <td colspan="2">รวม</td>
        <td>${ph(data.collected_score_total)}</td>
        <td>—</td>
        <td>—</td>
        <td>${ph(data.grand_total_score)}</td>
      </tr>
    </tbody>
  </table>
</div>

</body>
</html>`;
}
