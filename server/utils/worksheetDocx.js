// Worksheet DOCX renderer — programmatic (uses `docx` library).
// Supports 8 section types:
//   matching, fill_blank, mcq, true_false, short_answer,
//   writing, reordering, reading
//
// Each section type has its own _renderXxx() function. The main
// renderWorksheetDocx() wraps the page with a thick rectangular page
// border, a dark title banner, and a metadata strip; sections are
// emitted in order; an answer-key page is appended last.

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  PageBreak, HeightRule, ShadingType,
} from 'docx';

const FONT = 'TH SarabunPSK';

// ─── helpers ──────────────────────────────────────────────
const T = (text, opts = {}) =>
  new TextRun({ text: String(text ?? ''), font: FONT, ...opts });

const P = (children, opts = {}) =>
  new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });

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

const hr = (after = 160) => new Paragraph({
  border: { bottom: { color: '000000', size: 6, style: BorderStyle.SINGLE, space: 1 } },
  spacing: { after }, children: [],
});

const blank = (after = 80) => new Paragraph({ spacing: { after }, children: [] });

// ─── Page header: title banner + metadata + name row ─────
function buildHeader(data) {
  const headerParts = [];

  // Title banner — single-cell black-filled table with white bold text
  const titleTbl = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        borders: thinBorder,
        shading: { type: ShadingType.SOLID, color: '111827', fill: '111827' },
        margins: { top: 180, bottom: 180, left: 200, right: 200 },
        children: [P(
          T(`ใบงานที่ ${data.worksheetNo || '1'}  เรื่อง ${data.title || ''}`,
            { bold: true, size: 40, color: 'FFFFFF' }),
          { alignment: AlignmentType.CENTER }
        )],
      })],
    })],
  });
  headerParts.push(titleTbl);
  headerParts.push(blank(80));

  // Metadata line (subject / level / duration / score)
  headerParts.push(P(
    T(`รายวิชา${data.subject || '—'}    ชั้น${data.level || '—'}    เวลา ${data.duration || '—'} นาที    คะแนนเต็ม ${data.totalScore || '10'} คะแนน`,
      { size: 28 }),
    { alignment: AlignmentType.CENTER, spacing: { after: 160 } }
  ));

  // Name / No. / Date row using a borderless 3-col table
  headerParts.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorder,
    rows: [new TableRow({
      children: [
        new TableCell({
          borders: noBorder, width: { size: 55, type: WidthType.PERCENTAGE },
          children: [P(T('Name: ' + '.'.repeat(60), { size: 28 }))],
        }),
        new TableCell({
          borders: noBorder, width: { size: 18, type: WidthType.PERCENTAGE },
          children: [P(T('No.: ' + '.'.repeat(8), { size: 28 }))],
        }),
        new TableCell({
          borders: noBorder, width: { size: 27, type: WidthType.PERCENTAGE },
          children: [P(T('Date: ' + '....../....../......', { size: 28 }))],
        }),
      ],
    })],
  }));
  headerParts.push(hr(120));

  return headerParts;
}

// ─── Section heading ──────────────────────────────────────
function sectionHeading(part, type, title, score) {
  return [
    P([
      T(`Part ${part}: `, { bold: true, size: 30 }),
      T(title || _defaultTitle(type), { bold: true, size: 30 }),
      T(`   (${score || '5'} คะแนน)`, { size: 28 }),
    ], { spacing: { before: 120, after: 60 } }),
  ];
}
function _defaultTitle(type) {
  return {
    matching:    'Match the items.',
    fill_blank:  'Fill in the blanks.',
    mcq:         'Choose the correct answer.',
    true_false:  'Write T (true) or F (false).',
    short_answer:'Answer the questions.',
    writing:     'Write your answer.',
    reordering:  'Reorder the words to form correct sentences.',
    reading:     'Read the passage and answer the questions.',
  }[type] || 'Section';
}
function instructionLine(text) {
  if (!text) return [];
  return [P(T(`คำชี้แจง: ${text}`, { italics: true, size: 26 }), { spacing: { after: 120 } })];
}

// ─── Section renderers (one per type) ─────────────────────
function _renderMatching(sec) {
  const items = Array.isArray(sec.items) ? sec.items : [];
  const rows = items.map(it => new TableRow({
    children: [
      _bCell(`${it.num || ''}.`, 8),
      _bCell(it.word || '', 20, true),
      _bCell('(......)', 14),
      _bCell(`${it.letter || ''}.  ${it.meaning || ''}`, 58),
    ],
  }));
  return [
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorder, rows }),
    hr(),
  ];
}

function _renderFillBlank(sec) {
  const out = [];
  if (sec.wordBank) {
    out.push(new Table({
      width: { size: 80, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.CENTER,
      rows: [new TableRow({
        children: [new TableCell({
          borders: thinBorder,
          margins: { top: 120, bottom: 120, left: 140, right: 140 },
          children: [P(T(sec.wordBank, { bold: true, size: 30 }),
                       { alignment: AlignmentType.CENTER })],
        })],
      })],
    }));
    out.push(blank(120));
  }
  const items = Array.isArray(sec.items) ? sec.items : [];
  for (const it of items) {
    out.push(P(T(`${it.num || ''}.   ${it.sentence || ''}`, { size: 28 }),
              { spacing: { after: 180 } }));
  }
  out.push(hr());
  return out;
}

function _renderMcq(sec) {
  const out = [];
  const items = Array.isArray(sec.items) ? sec.items : [];
  for (const it of items) {
    out.push(P(T(`${it.num || ''}.   ${it.question || ''}`, { size: 28 }),
              { spacing: { after: 60 } }));
    const choices = Array.isArray(it.choices) ? it.choices : [];
    // Two columns of choices for layout efficiency
    for (let i = 0; i < choices.length; i += 2) {
      const left  = choices[i]     || '';
      const right = choices[i + 1] || '';
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorder,
        rows: [new TableRow({
          children: [
            new TableCell({ borders: noBorder, width: { size: 50, type: WidthType.PERCENTAGE },
              children: [P(T('     ' + left, { size: 28 }))] }),
            new TableCell({ borders: noBorder, width: { size: 50, type: WidthType.PERCENTAGE },
              children: [P(T('     ' + right, { size: 28 }))] }),
          ],
        })],
      }));
    }
    out.push(blank(100));
  }
  out.push(hr());
  return out;
}

function _renderTrueFalse(sec) {
  const out = [];
  const items = Array.isArray(sec.items) ? sec.items : [];
  for (const it of items) {
    out.push(P([
      T('______   ', { size: 28, bold: true }),
      T(`${it.num || ''}.   ${it.statement || ''}`, { size: 28 }),
    ], { spacing: { after: 140 } }));
  }
  out.push(hr());
  return out;
}

function _renderShortAnswer(sec) {
  const out = [];
  const items = Array.isArray(sec.items) ? sec.items : [];
  for (const it of items) {
    out.push(P(T(`${it.num || ''}.   ${it.question || ''}`, { size: 28, bold: true }),
              { spacing: { after: 80 } }));
    const lineCount = Math.max(1, Math.min(5, parseInt(it.lines) || 2));
    for (let i = 0; i < lineCount; i++) {
      out.push(P(T('.'.repeat(90), { size: 28 }), { spacing: { after: 100 } }));
    }
  }
  out.push(hr());
  return out;
}

function _renderWriting(sec) {
  const out = [];
  if (sec.prompt) {
    out.push(P(T(sec.prompt, { size: 28, bold: true }),
              { spacing: { after: 100 } }));
  }
  const lineCount = Math.max(3, Math.min(15, parseInt(sec.lines) || 8));
  for (let i = 0; i < lineCount; i++) {
    out.push(P(T('.'.repeat(95), { size: 28 }), { spacing: { after: 140 } }));
  }
  if (Array.isArray(sec.rubric) && sec.rubric.length) {
    out.push(blank(80));
    out.push(P(T('เกณฑ์การให้คะแนน (Rubric):', { bold: true, size: 26 }),
              { spacing: { after: 60 } }));
    for (const r of sec.rubric) {
      out.push(P(T(`☐  ${r.criterion || ''}  (${r.points || ''} คะแนน)`, { size: 26 }),
                { spacing: { after: 40 } }));
    }
  }
  out.push(hr());
  return out;
}

function _renderReordering(sec) {
  const out = [];
  const items = Array.isArray(sec.items) ? sec.items : [];
  for (const it of items) {
    out.push(P([
      T(`${it.num || ''}.   `, { size: 28, bold: true }),
      T(it.scrambled || '', { size: 28 }),
    ], { spacing: { after: 40 } }));
    out.push(P(T('→ ' + '.'.repeat(80), { size: 28 }), { spacing: { after: 140 } }));
  }
  out.push(hr());
  return out;
}

function _renderReading(sec) {
  const out = [];
  if (sec.passage) {
    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({
        children: [new TableCell({
          borders: thinBorder,
          margins: { top: 140, bottom: 140, left: 180, right: 180 },
          children: sec.passage.split('\n').filter(Boolean).map(p =>
            P(T(p, { size: 28 }), { spacing: { after: 80 } })),
        })],
      })],
    }));
    out.push(blank(160));
  }
  // Reuse MCQ-style item rendering for the questions
  out.push(..._renderMcq({ items: sec.items }));
  return out;
}

// Cell helper
function _bCell(text, widthPct, bold = false) {
  return new TableCell({
    borders: noBorder,
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    children: [P(T(text, { size: 28, bold }))],
  });
}

// ─── Section dispatch ─────────────────────────────────────
const RENDERERS = {
  matching:     _renderMatching,
  fill_blank:   _renderFillBlank,
  mcq:          _renderMcq,
  true_false:   _renderTrueFalse,
  short_answer: _renderShortAnswer,
  writing:      _renderWriting,
  reordering:   _renderReordering,
  reading:      _renderReading,
};

function renderSection(sec, partNumber) {
  const fn = RENDERERS[sec.type];
  if (!fn) {
    return [P(T(`[unsupported section type: ${sec.type}]`, { color: 'B91C1C' }))];
  }
  return [
    ...sectionHeading(partNumber, sec.type, sec.title, sec.score),
    ...instructionLine(sec.instructions),
    ...fn(sec),
  ];
}

// ─── Answer key page ──────────────────────────────────────
function buildAnswerKey(data) {
  const out = [
    new Paragraph({ children: [new PageBreak()] }),
    P(T(`เฉลยใบงานที่ ${data.worksheetNo || '1'}`, { bold: true, size: 36 }),
      { alignment: AlignmentType.CENTER, spacing: { after: 80 } }),
    P(T(`${data.title || ''} — Answer Key`, { bold: true, size: 28 }),
      { alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
    hr(160),
  ];
  const sections = Array.isArray(data.sections) ? data.sections : [];
  sections.forEach((sec, i) => {
    out.push(P(T(`Part ${i + 1}: ${sec.title || _defaultTitle(sec.type)}`,
                 { bold: true, size: 28 }),
              { spacing: { before: 120, after: 60 } }));
    out.push(..._answerLines(sec));
  });
  return out;
}

function _answerLines(sec) {
  const items = Array.isArray(sec.items) ? sec.items : [];
  const out = [];
  switch (sec.type) {
    case 'matching':
      out.push(P(T(items.map(it => `${it.num}. ${it.word} → ${it.letter}`).join('     '),
                   { size: 26 }), { spacing: { after: 80 } }));
      break;
    case 'fill_blank':
    case 'reordering':
      out.push(P(T(items.map(it => `${it.num}. ${it.answer || it.sentence || ''}`).join('     '),
                   { size: 26 }), { spacing: { after: 80 } }));
      break;
    case 'mcq':
    case 'reading':
      out.push(P(T(items.map(it => `${it.num}. ${it.answer || '—'}`).join('     '),
                   { size: 26 }), { spacing: { after: 80 } }));
      break;
    case 'true_false':
      out.push(P(T(items.map(it => `${it.num}. ${it.answer || '—'}`).join('     '),
                   { size: 26 }), { spacing: { after: 80 } }));
      break;
    case 'short_answer':
      items.forEach(it => {
        out.push(P(T(`${it.num}. ${it.answer || it.question || ''}`, { size: 26 }),
                  { spacing: { after: 60 } }));
      });
      break;
    case 'writing':
      out.push(P(T('(ตรวจตาม rubric ที่กำหนด)', { size: 26, italics: true }),
                { spacing: { after: 80 } }));
      break;
  }
  return out;
}

// ─── Public: render full document ─────────────────────────
export async function renderWorksheetDocx(data) {
  if (!data || typeof data !== 'object') throw new Error('worksheet_data_missing');

  const sections = Array.isArray(data.sections) ? data.sections : [];
  const bodyContent = [];
  sections.forEach((sec, i) => {
    bodyContent.push(...renderSection(sec, i + 1));
  });

  // Footer (score + signature)
  bodyContent.push(blank(120));
  bodyContent.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorder,
    rows: [new TableRow({
      children: [
        new TableCell({ borders: noBorder, width: { size: 50, type: WidthType.PERCENTAGE },
          children: [P(T(`คะแนนรวม ............ / ${data.totalScore || '10'}`,
                         { bold: true, size: 28 }))] }),
        new TableCell({ borders: noBorder, width: { size: 50, type: WidthType.PERCENTAGE },
          children: [P(T('ลงชื่อครูผู้สอน .....................................',
                         { size: 28 }), { alignment: AlignmentType.RIGHT })] }),
      ],
    })],
  }));

  // Answer key page (only if any section has answers)
  const hasAnswers = sections.some(s => {
    return (Array.isArray(s.items) && s.items.some(it => it.answer != null))
        || s.type === 'writing';
  });

  const doc = new Document({
    creator: 'Easy ENG Plan',
    title:   `Worksheet ${data.worksheetNo || ''}`,
    styles: {
      default: { document: { run: { font: FONT, size: 28 } } },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1100, right: 1100, bottom: 1100, left: 1100 },
          // Whole-page border (rectangle, sharp corners — `art` borders not portable)
          borders: {
            pageBorderTop:    { style: BorderStyle.SINGLE, size: 18, color: '111827', space: 24 },
            pageBorderBottom: { style: BorderStyle.SINGLE, size: 18, color: '111827', space: 24 },
            pageBorderLeft:   { style: BorderStyle.SINGLE, size: 18, color: '111827', space: 24 },
            pageBorderRight:  { style: BorderStyle.SINGLE, size: 18, color: '111827', space: 24 },
          },
        },
      },
      children: [
        ...buildHeader(data),
        ...bodyContent,
        ...(hasAnswers ? buildAnswerKey(data) : []),
      ],
    }],
  });

  return await Packer.toBuffer(doc);
}
