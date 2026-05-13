// One-off template generator — creates a sample worksheet .docx so we can
// inspect what the final output will look like before we wire the real
// AI + route. Run from /server:  node scripts/worksheetTemplate.js
//
// Output:  ../worksheet-template-preview.docx (in project root)

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, PageBreak,
  HeightRule,
} from 'docx';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FONT = 'TH SarabunPSK';

// ─── Helpers ───────────────────────────────────────────────────────────
const T = (text, opts = {}) =>
  new TextRun({ text: String(text ?? ''), font: FONT, ...opts });

const P = (children, opts = {}) =>
  new Paragraph({
    children: Array.isArray(children) ? children : [children],
    ...opts,
  });

const noBorder = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const thinBorder = {
  top:    { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  left:   { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  right:  { style: BorderStyle.SINGLE, size: 6, color: '000000' },
};

// Horizontal rule (used to separate parts)
const hr = (after = 160) =>
  new Paragraph({
    border: { bottom: { color: '000000', size: 6, style: BorderStyle.SINGLE, space: 1 } },
    spacing: { after },
    children: [],
  });

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

// ─── Header (school + worksheet title + name row) ──────────────────────
function buildHeader() {
  return [
    P(T('ใบงานที่ 1  เรื่อง Animals in the Forest', { bold: true, size: 36 }),
      { alignment: AlignmentType.CENTER, spacing: { after: 80 } }),
    P(T('รายวิชาภาษาอังกฤษ   ชั้นประถมศึกษาปีที่ 4   เวลา 20 นาที   คะแนนเต็ม 10 คะแนน',
        { size: 28 }),
      { alignment: AlignmentType.CENTER, spacing: { after: 240 } }),

    // Name / Class / Date row using a borderless table for clean alignment
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorder,
      rows: [new TableRow({
        children: [
          new TableCell({
            borders: noBorder,
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [P(T('ชื่อ–สกุล ........................................................', { size: 28 }))],
          }),
          new TableCell({
            borders: noBorder,
            width: { size: 20, type: WidthType.PERCENTAGE },
            children: [P(T('เลขที่ .........', { size: 28 }))],
          }),
          new TableCell({
            borders: noBorder,
            width: { size: 30, type: WidthType.PERCENTAGE },
            children: [P(T('วันที่ ......./......./.........', { size: 28 }))],
          }),
        ],
      })],
    }),
    hr(200),
  ];
}

// ─── Part 1: Matching ──────────────────────────────────────────────────
function buildPart1Matching() {
  const items = [
    { num: 1, word: 'cat',    blank: '(......)', meaning: 'a.  a small pet that says “meow”' },
    { num: 2, word: 'bird',   blank: '(......)', meaning: 'b.  an animal with long ears' },
    { num: 3, word: 'fish',   blank: '(......)', meaning: 'c.  an animal that can fly' },
    { num: 4, word: 'rabbit', blank: '(......)', meaning: 'd.  an animal that lives in water' },
    { num: 5, word: 'dog',    blank: '(......)', meaning: 'e.  a loyal pet that says “woof”' },
  ];

  const rows = items.map(it => new TableRow({
    children: [
      new TableCell({
        borders: noBorder,
        width: { size: 8,  type: WidthType.PERCENTAGE },
        children: [P(T(`${it.num}.`, { size: 28 }))],
      }),
      new TableCell({
        borders: noBorder,
        width: { size: 20, type: WidthType.PERCENTAGE },
        children: [P(T(it.word, { size: 28, bold: true }))],
      }),
      new TableCell({
        borders: noBorder,
        width: { size: 14, type: WidthType.PERCENTAGE },
        children: [P(T(it.blank, { size: 28 }))],
      }),
      new TableCell({
        borders: noBorder,
        width: { size: 58, type: WidthType.PERCENTAGE },
        children: [P(T(it.meaning, { size: 28 }))],
      }),
    ],
  }));

  return [
    P(T('Part 1 :  Match the words with their meanings.   (5 คะแนน)',
        { bold: true, size: 30 }),
      { spacing: { before: 120, after: 80 } }),
    P(T('คำชี้แจง : จับคู่คำศัพท์กับความหมายโดยเขียนตัวอักษร a–e ลงในวงเล็บ',
        { italics: true, size: 26 }),
      { spacing: { after: 160 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorder,
      rows,
    }),
    hr(),
  ];
}

// ─── Part 2: Fill in the blank (word bank) ─────────────────────────────
function buildPart2FillBlank() {
  // Word bank as a single-cell bordered table
  const wordBank = new Table({
    width: { size: 80, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
    rows: [new TableRow({
      children: [new TableCell({
        borders: thinBorder,
        children: [P(T('cat   |   bird   |   fish   |   dog   |   rabbit',
                       { size: 30, bold: true }),
                     { alignment: AlignmentType.CENTER })],
        margins: { top: 120, bottom: 120, left: 120, right: 120 },
      })],
    })],
  });

  const sentences = [
    '1.   I see a ........................ in the tree.',
    '2.   It is a ........................  It can swim.',
    '3.   Look!  A ........................ is running fast.',
    '4.   The ........................ has long ears and a short tail.',
    '5.   My ........................ likes to drink milk every morning.',
  ];

  return [
    P(T('Part 2 :  Fill in the blanks using the word bank.   (5 คะแนน)',
        { bold: true, size: 30 }),
      { spacing: { before: 80, after: 80 } }),
    P(T('คำชี้แจง : เติมคำในช่องว่างโดยเลือกคำจากกรอบด้านล่าง  (ใช้ได้ครั้งเดียวต่อคำ)',
        { italics: true, size: 26 }),
      { spacing: { after: 160 } }),

    wordBank,
    P(T(''), { spacing: { after: 160 } }),

    ...sentences.map(s =>
      P(T(s, { size: 28 }), { spacing: { after: 180 } })
    ),
    hr(),
  ];
}

// ─── Footer (score + teacher signature) ────────────────────────────────
function buildFooter() {
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorder,
      rows: [new TableRow({
        children: [
          new TableCell({
            borders: noBorder,
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [P(T('คะแนนรวม ............ / 10', { bold: true, size: 28 }))],
          }),
          new TableCell({
            borders: noBorder,
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [P(T('ลงชื่อครูผู้สอน .....................................',
                          { size: 28 }),
                       { alignment: AlignmentType.RIGHT })],
          }),
        ],
      })],
    }),
  ];
}

// ─── Answer key page ───────────────────────────────────────────────────
function buildAnswerKey() {
  return [
    pageBreak(),
    P(T('เฉลยใบงานที่ 1', { bold: true, size: 36 }),
      { alignment: AlignmentType.CENTER, spacing: { after: 80 } }),
    P(T('Animals in the Forest — Answer Key', { bold: true, size: 28 }),
      { alignment: AlignmentType.CENTER, spacing: { after: 240 } }),
    hr(200),

    P(T('Part 1 :  Matching', { bold: true, size: 30 }),
      { spacing: { before: 80, after: 120 } }),
    P(T('1. cat → e        2. bird → c        3. fish → d        4. rabbit → b        5. dog → a',
        { size: 28 }),
      { spacing: { after: 220 } }),

    P(T('Part 2 :  Fill in the blanks', { bold: true, size: 30 }),
      { spacing: { before: 80, after: 120 } }),
    P(T('1. bird        2. fish        3. dog        4. rabbit        5. cat',
        { size: 28 }),
      { spacing: { after: 220 } }),

    hr(120),
    P(T('© Easy ENG Plan — generated worksheet template (preview only)',
        { italics: true, size: 22, color: '888888' }),
      { alignment: AlignmentType.CENTER, spacing: { before: 240 } }),
  ];
}

// ─── Assemble document ─────────────────────────────────────────────────
const doc = new Document({
  creator: 'Easy ENG Plan',
  title: 'Worksheet Template Preview',
  styles: {
    default: {
      document: { run: { font: FONT, size: 28 } }, // 14pt body default
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1100, right: 1100, bottom: 1100, left: 1100 }, // ~2 cm
      },
    },
    children: [
      ...buildHeader(),
      ...buildPart1Matching(),
      ...buildPart2FillBlank(),
      ...buildFooter(),
      ...buildAnswerKey(),
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
const outPath = path.resolve(__dirname, '..', '..', 'worksheet-template-preview.docx');
fs.writeFileSync(outPath, buf);
console.log('✓ wrote', outPath, `(${buf.length} bytes)`);
