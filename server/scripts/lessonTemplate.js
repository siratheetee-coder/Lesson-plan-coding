// Lesson plan one-page template preview.
// Generates lesson-template-preview.docx using sample data matching the
// attached reference image. Style:
//   • A4 portrait, 2 columns
//   • Each section = bordered single-cell table (orange border, white fill)
//   • Heart bullet ♡ in pink before each section title
//   • Vocab table inline inside Presentation phase
//   • Font: TH SarabunPSK
//
// Run:  node server/scripts/lessonTemplate.js

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, HeightRule,
  ShadingType,
} from 'docx';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const FONT = 'TH SarabunPSK';

// ─── colors ─────────────────────────────────────────────
const C = {
  panelBorder: 'E2725B',   // soft terracotta orange
  panelShade:  'FFF5EE',   // very light cream tint
  headBorder:  'D9534F',   // header band red
  headShade:   'FFF0E6',
  heart:       'E83A6B',   // pink heart
  text:        '1F2937',
  meta:        '6B7280',
};

// ─── helpers ────────────────────────────────────────────
const T = (text, opts = {}) =>
  new TextRun({ text: String(text ?? ''), font: FONT, ...opts });

const P = (children, opts = {}) =>
  new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });

const allBorders = (color, sz = 8) => ({
  top:    { style: BorderStyle.SINGLE, size: sz, color },
  bottom: { style: BorderStyle.SINGLE, size: sz, color },
  left:   { style: BorderStyle.SINGLE, size: sz, color },
  right:  { style: BorderStyle.SINGLE, size: sz, color },
});
const noBorders = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

// Heart-titled panel: bordered single-cell table whose first paragraph is
// "♡ Title" in pink/bold; subsequent paragraphs are body content.
function heartPanel(title, bodyChildren, opts = {}) {
  const cellChildren = [
    P([
      T('♡  ', { color: C.heart, bold: true, size: 26 }),
      T(title, { bold: true, color: C.text, size: 26 }),
    ], { spacing: { after: 100 } }),
    ...bodyChildren,
  ];
  return new Table({
    width: { size: opts.widthPct || 100, type: WidthType.PERCENTAGE },
    borders: allBorders(C.panelBorder, 8),
    rows: [new TableRow({
      children: [new TableCell({
        borders: allBorders(C.panelBorder, 8),
        shading: { type: ShadingType.SOLID, color: 'FFFFFF', fill: 'FFFFFF' },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: cellChildren,
      })],
    })],
  });
}

const body = (text, size = 22) => P(T(text, { size }), { spacing: { after: 60 } });
const blank = () => new Paragraph({ children: [] });

// ─── HEADER PANEL ───────────────────────────────────────
function buildHeader(d) {
  // Inside the header panel: 2-col layout (left labels / right info)
  // Row 1: title "แผนการจัดการเรียนรู้ที่ N" (right-aligned, big)
  // Row 2: subject group | class level
  // Row 3: unit / topic / hours
  // Row 4: lesson title / hours
  const inner = [
    P([
      T('แผนการจัดการเรียนรู้ที่ ', { bold: true, size: 30 }),
      T(d.planNo, { bold: true, size: 30 }),
    ], { alignment: AlignmentType.CENTER, spacing: { after: 100 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [new TableRow({
        children: [
          new TableCell({
            borders: noBorders, width: { size: 70, type: WidthType.PERCENTAGE },
            children: [P(T(`กลุ่มสาระการเรียนรู้${d.subjectGroup}`, { size: 24 }))],
          }),
          new TableCell({
            borders: noBorders, width: { size: 30, type: WidthType.PERCENTAGE },
            children: [P(T(`ชั้น${d.classLevel}`, { size: 24 }), { alignment: AlignmentType.RIGHT })],
          }),
        ],
      })],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [new TableRow({
        children: [
          new TableCell({
            borders: noBorders, width: { size: 70, type: WidthType.PERCENTAGE },
            children: [P(T(`หน่วยการเรียนรู้  ${d.unitNo}    เรื่อง  ${d.unitTitle}`, { size: 24 }))],
          }),
          new TableCell({
            borders: noBorders, width: { size: 30, type: WidthType.PERCENTAGE },
            children: [P(T(`เวลา  ${d.unitHours}  ชั่วโมง`, { size: 24 }), { alignment: AlignmentType.RIGHT })],
          }),
        ],
      })],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [new TableRow({
        children: [
          new TableCell({
            borders: noBorders, width: { size: 70, type: WidthType.PERCENTAGE },
            children: [P(T(`เรื่อง  ${d.lessonTitle}`, { size: 24, bold: true }))],
          }),
          new TableCell({
            borders: noBorders, width: { size: 30, type: WidthType.PERCENTAGE },
            children: [P(T(`เวลา  ${d.lessonHours}  ชั่วโมง`, { size: 24, bold: true }), { alignment: AlignmentType.RIGHT })],
          }),
        ],
      })],
    }),
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: allBorders(C.headBorder, 12),
    rows: [new TableRow({
      children: [new TableCell({
        borders: allBorders(C.headBorder, 12),
        shading: { type: ShadingType.SOLID, color: C.headShade, fill: C.headShade },
        margins: { top: 140, bottom: 140, left: 180, right: 180 },
        children: inner,
      })],
    })],
  });
}

// ─── LEFT COLUMN panels ─────────────────────────────────
function buildLeft(d) {
  return [
    heartPanel('สาระสำคัญ / ความคิดรวบยอด', [body(d.concept)]),
    blank(),

    heartPanel('มาตรฐานการเรียนรู้ / ตัวชี้วัด', [
      P([T('ตัวชี้วัดระหว่างทาง  :  ', { bold: true, size: 22 }),
         T(d.standards.interim.join(' , '), { size: 22 })], { spacing: { after: 60 } }),
      P([T('ตัวชี้วัดปลายทาง  :  ', { bold: true, size: 22 }),
         T(d.standards.final.join(' , '), { size: 22 })]),
    ]),
    blank(),

    heartPanel('จุดประสงค์การเรียนรู้', [
      P([T('ความรู้ (K)', { bold: true, size: 22 })], { spacing: { after: 30 } }),
      ...d.objectives.k.map(t => body(t)),
      P([T('ทักษะ/กระบวนการ (P)', { bold: true, size: 22 })], { spacing: { before: 60, after: 30 } }),
      ...d.objectives.p.map(t => body(t)),
      P([T('เจตคติ (A)', { bold: true, size: 22 })], { spacing: { before: 60, after: 30 } }),
      ...d.objectives.a.map(t => body(t)),
    ]),
    blank(),

    heartPanel('สื่อการเรียนรู้', [
      body(d.media.join('  ·  ')),
    ]),
    blank(),

    heartPanel('การวัดและประเมินผล', [
      ...d.assessments.map(a =>
        P([
          T(`${a.domain}  `, { bold: true, size: 22, color: C.headBorder }),
          T(`${a.name}     `, { size: 22 }),
          T(a.criteria, { size: 22, color: C.meta }),
        ], { spacing: { after: 40 } })
      ),
    ]),
  ];
}

// ─── RIGHT COLUMN panels ────────────────────────────────
function buildRight(d) {
  const actChildren = [];
  for (const a of d.activities) {
    actChildren.push(P([
      T(`♦  `, { color: C.headBorder, bold: true, size: 24 }),
      T(`${a.phase}. ${a.name}`, { bold: true, size: 24 }),
    ], { spacing: { before: 80, after: 40 } }));
    if (a.detail) {
      // Split detail into lines if multi-line
      const lines = String(a.detail).split('\n').filter(Boolean);
      for (const line of lines) actChildren.push(body(line));
    }
    // Vocab table inside phase 2 (Presentation)
    if (a.vocabTable && a.vocabTable.length) {
      actChildren.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders,
        rows: a.vocabTable.map(row => new TableRow({
          children: row.map(w => new TableCell({
            borders: noBorders,
            children: [P(T(w, { size: 22 }), { spacing: { after: 0 } })],
          })),
        })),
      }));
      actChildren.push(blank());
    }
  }
  return [
    heartPanel('กิจกรรมการเรียนรู้', actChildren),
  ];
}

// ─── FOOTER (post-notes + signatures) ───────────────────
function buildFooter() {
  const noteLines = [];
  // 4 lines total. Last paragraph has no spacing-after so it doesn't push
  // an extra empty line past the cell padding.
  const N_LINES = 4;
  for (let i = 0; i < N_LINES; i++) {
    noteLines.push(new Paragraph({
      children: [T(' ', { size: 22 })],
      border: { bottom: { style: BorderStyle.DOTTED, size: 8, color: '6B7280', space: 4 } },
      spacing: (i === N_LINES - 1) ? { after: 0 } : { after: 180 },
    }));
  }
  return [
    blank(),
    heartPanel('บันทึกหลังการสอน', noteLines),
    blank(),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [new TableRow({
        children: [
          new TableCell({ borders: noBorders, width: { size: 50, type: WidthType.PERCENTAGE },
            children: [
              P(T('ลงชื่อ .................................... ผู้สอน', { size: 22 }), { alignment: AlignmentType.CENTER, spacing: { before: 80 } }),
              P(T('(                                    )', { size: 22 }), { alignment: AlignmentType.CENTER }),
            ],
          }),
          new TableCell({ borders: noBorders, width: { size: 50, type: WidthType.PERCENTAGE },
            children: [
              P(T('ลงชื่อ .................................... ผู้อำนวยการโรงเรียน', { size: 22 }), { alignment: AlignmentType.CENTER, spacing: { before: 80 } }),
              P(T('(                                    )', { size: 22 }), { alignment: AlignmentType.CENTER }),
            ],
          }),
        ],
      })],
    }),
  ];
}

// ═══ Assemble ═══════════════════════════════════════════
function buildDoc(d) {
  const header = buildHeader(d);
  const left   = buildLeft(d);
  const right  = buildRight(d);
  const footer = buildFooter();

  // 2-column layout via outer no-border table
  const twoCol = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    columnWidths: [4800, 200, 4800], // 5+gap+5
    rows: [new TableRow({
      children: [
        new TableCell({
          borders: noBorders,
          width: { size: 49, type: WidthType.PERCENTAGE },
          children: left,
        }),
        new TableCell({
          borders: noBorders,
          width: { size: 2, type: WidthType.PERCENTAGE },
          children: [blank()],
        }),
        new TableCell({
          borders: noBorders,
          width: { size: 49, type: WidthType.PERCENTAGE },
          children: right,
        }),
      ],
    })],
  });

  return new Document({
    creator: 'Easy ENG Plan',
    title: 'Lesson Plan Template',
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },  // A4
          margin: { top: 720, right: 720, bottom: 720, left: 720 }, // ~1.25cm
        },
      },
      children: [
        header,
        blank(),
        twoCol,
        ...footer,
      ],
    }],
  });
}

// ─── sample data (matches the reference image) ──────────
const data = {
  planNo:       '1',
  subjectGroup: 'ภาษาต่างประเทศ (รายวิชาภาษาอังกฤษ)',
  classLevel:   'ประถมศึกษาปีที่ 4',
  unitNo:       '1',
  unitTitle:    'About Me',
  unitHours:    '10',
  lessonTitle:  'My body',
  lessonHours:  '1',

  concept: 'ส่วนของร่างกาย เสื้อผ้าเครื่องแต่งกายและกิจวัตรประจำวันเป็นเรื่องใกล้ตัวนักเรียน การใช้ประโยคถาม-ตอบเรื่องเหล่านี้จะช่วยให้นักเรียนใช้ภาษาอังกฤษได้อย่างมั่นใจ',

  standards: {
    interim: ['ต 1.1 ป.4/3', 'ต 1.3 ป.4/1'],
    final:   ['ต 1.1 ป.4/2', 'ต 1.2 ป.4/1'],
  },

  objectives: {
    k: ['ให้ข้อมูลคำศัพท์เกี่ยวกับร่างกายได้'],
    p: ['พูด อ่านออกเสียง สะกดคำคำศัพท์เกี่ยวกับร่างกายได้'],
    a: ['มีวินัย ใฝ่เรียนรู้ และมุ่งมั่นในการทำงาน'],
  },

  media: ['หนังสือเรียน New Say Hello ป.4', 'ใบงานจับคู่คำศัพท์ My body'],

  assessments: [
    { domain: 'K', name: 'ตรวจใบงาน',               criteria: '60% ขึ้นไป ผ่านเกณฑ์' },
    { domain: 'P', name: 'ประเมินการพูด',           criteria: '60% ขึ้นไป ผ่านเกณฑ์' },
    { domain: 'A', name: 'การสังเกตการร่วมกิจกรรม', criteria: '60% ขึ้นไป ผ่านเกณฑ์' },
  ],

  activities: [
    { phase: '1', name: 'ขั้นนำ (Warm up)',
      detail: '1. ครูพูดทักทายนักเรียนในชั้นเรียน\n2. ครูสนทนากับนักเรียนเกี่ยวกับส่วนต่าง ๆ ของร่างกาย ให้นักเรียนช่วยกันบอกส่วนต่าง ๆ ของร่างกาย ดังนี้ หู, ตา, จมูก, ปาก, มือ, แขน, ขา' },
    { phase: '2', name: 'ขั้นเสนอ (Presentation)',
      detail: '1. ครูสอนคำศัพท์ใหม่ โดยครูยุดบัตรคำบนกระดาน นักเรียนอ่านออกเสียงตามครู 2 ครั้ง ดังนี้',
      vocabTable: [
        ['head', 'hair', 'eye', 'nose'],
        ['neck', 'arm', 'elbow', 'leg'],
        ['foot', 'toe', 'knee', 'finger'],
        ['hand', 'shoulder', 'mouth', 'ear'],
        ['eyebrow', '', '', ''],
      ] },
    { phase: '3', name: 'ขั้นฝึก (Practice)',
      detail: 'นักเรียนดูครูฝึกอ่านคำศัพท์และสะกดคำศัพท์ในหนังสือ หน้า 1' },
    { phase: '4', name: 'ขั้นนำไปใช้ (Production)',
      detail: '1. ครูยุดบัตรภาพและบัตรคำติดบนกระดาน จากนั้นให้อาสาสมัครนักเรียนสุมขึ้นมาชี้คู่บัตรภาพและบัตรคำ\n2. ครูตรวจสอบความถูกต้อง จากนั้นให้นักเรียนฝึกอ่านออกเสียงคำศัพท์ 1 ครั้ง' },
    { phase: '5', name: 'ขั้นสรุป (Wrap up)',
      detail: '1. นักเรียนสรุปคำศัพท์ลงในสมุด\n2. นักเรียนทำใบงานเติมคำในประโยค (Fill-blank) โดยจับคู่ลูกศรกับคำศัพท์' },
  ],
};

// ─── write file ─────────────────────────────────────────
const doc = buildDoc(data);
const buf = await Packer.toBuffer(doc);
const outPath = path.join(ROOT, 'lesson-template-preview.docx');
fs.writeFileSync(outPath, buf);
console.log('✓ wrote', outPath, `(${buf.length} bytes)`);
