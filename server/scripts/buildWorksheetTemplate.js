// One-shot: reads worksheet-template-preview.docx and produces
// worksheet-template.docx with docxtemplater placeholders inserted.
//
// Strategy:
//   1. Read the .docx as a zip
//   2. For each <w:p> paragraph, merge sibling <w:t> runs so the visible
//      text is one continuous string we can string-replace on.
//   3. Do exact replacements for known phrases (title, subject, etc.)
//   4. For the Part 1 table: transform row 1 into a docxtemplater loop
//      ({#part1}...{/part1}) and delete rows 2–5.
//   5. For the Part 2 sentence paragraphs: keep paragraph 1 with loop
//      placeholders, delete paragraphs 2–5.
//   6. Save as worksheet-template.docx
//
// Run:  node server/scripts/buildWorksheetTemplate.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const INPUT  = path.join(ROOT, 'worksheet-template-preview.docx');
const OUTPUT = path.join(ROOT, 'worksheet-template.docx');

// ─── Step 1: load docx ─────────────────────────────────────
const buf = fs.readFileSync(INPUT);
const zip = new PizZip(buf);
let xml = zip.file('word/document.xml').asText();

// ─── Step 2: paragraph-level run merger ────────────────────
// Replaces every <w:p>...</w:p> that contains multiple <w:t> elements
// with a single concatenated <w:t> inside the FIRST run's rPr, so we
// can safely string-replace visible text later.
function mergeParagraphRuns(xml) {
  // For each paragraph, find runs that have <w:t> text. Merge their text
  // into the FIRST text-bearing run, and remove only the OTHER text-bearing
  // runs. Leave non-text runs (drawing shapes, proofErr, etc.) untouched.
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paraXml) => {
    // Skip if this match contains nested <w:p> opens — non-greedy regex
    // may have matched the outer-open up to an inner close, producing
    // a malformed/truncated paragraph. Leave it untouched.
    const openTags = paraXml.match(/<w:p\b[^>]*>/g) || [];
    if (openTags.length > 1) return paraXml;
    const tMatches = [...paraXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
    if (tMatches.length <= 1) return paraXml;
    const fullText = tMatches.map(m => m[1]).join('');

    // Find all <w:r>...</w:r> blocks and pick those containing <w:t>
    const runRegex = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
    const textRuns = [];
    let m;
    while ((m = runRegex.exec(paraXml)) !== null) {
      if (/<w:t(?:\s[^>]*)?>/.test(m[0])) {
        textRuns.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      }
    }
    if (textRuns.length <= 1) return paraXml;

    // Build new paragraph: keep everything before first text run,
    // splice in modified first text run, then for each subsequent gap:
    // keep non-text content between/after but drop the other text runs.
    let result = paraXml.slice(0, textRuns[0].start);
    // Modified first run with merged text
    const newFirstRun = textRuns[0].text.replace(
      /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/,
      `<w:t xml:space="preserve">${escapeXml(fullText)}</w:t>`
    );
    result += newFirstRun;
    // Walk through remaining text runs, preserving inter-run content
    for (let i = 1; i < textRuns.length; i++) {
      const prevEnd = textRuns[i - 1].end;
      const inter = paraXml.slice(prevEnd, textRuns[i].start);
      result += inter; // keep proofErr, etc.
      // Skip this text run (drop it)
    }
    // Append everything after the last text run
    result += paraXml.slice(textRuns[textRuns.length - 1].end);
    return result;
  });
}
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

xml = mergeParagraphRuns(xml);

// ─── Step 3: targeted string replacements ─────────────────
// All happen on the merged XML (each paragraph is one <w:t>).
const replacements = [
  // Title (appears twice: once in title banner shape, once in body)
  ['ใบงานที่ 1  เรื่อง Animals in the Forest', 'ใบงานที่ {worksheetNo}  เรื่อง {title}'],
  ['ใบงานที่ 1 เรื่อง Animals in the Forest',  'ใบงานที่ {worksheetNo} เรื่อง {title}'],

  // Subtitle line variations (depending on user spacing)
  ['รายวิชาภาษาอังกฤษ', 'รายวิชา{subject}'],
  ['ชั้นประถมศึกษาปีที่ 4', 'ชั้น{level}'],
  ['เวลา 20 นาที',          'เวลา {duration} นาที'],
  ['คะแนนเต็ม 10 คะแนน',    'คะแนนเต็ม {totalScore} คะแนน'],

  // Part 1 header
  ['Part 1 :  Match the words with their meanings.   (5 คะแนน)',
   'Part 1 :  {part1Title}   ({part1Score} คะแนน)'],
  ['คำชี้แจง : จับคู่คำศัพท์กับความหมายโดยเขียนตัวอักษร a–e ลงในวงเล็บ',
   'คำชี้แจง : {part1Instructions}'],

  // Part 2 header
  ['Part 2 :  Fill in the blanks using the word bank.   (5 คะแนน)',
   'Part 2 :  {part2Title}   ({part2Score} คะแนน)'],
  ['คำชี้แจง : เติมคำในช่องว่างโดยเลือกคำจากกรอบด้านล่าง  (ใช้ได้ครั้งเดียวต่อคำ)',
   'คำชี้แจง : {part2Instructions}'],

  // Word bank
  ['cat   |   bird   |   fish   |   dog   |   rabbit', '{wordBank}'],

  // Footer
  ['คะแนนรวม ............ / 10', 'คะแนนรวม ............ / {totalScore}'],

  // Answer key page
  ['เฉลยใบงานที่ 1',                       'เฉลยใบงานที่ {worksheetNo}'],
  ['Animals in the Forest — Answer Key',  '{title} — Answer Key'],
  ['1. cat → e        2. bird → c        3. fish → d        4. rabbit → b        5. dog → a',
   '{answer1Line}'],
  ['1. bird        2. fish        3. dog        4. rabbit        5. cat',
   '{answer2Line}'],
];

// ─── Helper: replace phrase across runs OR within a single run ───
// Handles both:
//   (a) phrase appears as substring within one <w:t> (post-merge case)
//   (b) phrase is split across multiple consecutive <w:t> runs
// Returns rewritten xml + count of replacements applied.
function replacePhraseAcrossRuns(xml, phrase, replacement) {
  let count = 0;
  const phraseEsc = escapeXml(phrase);
  const replaceEsc = escapeXml(replacement);

  // (a) Substring match inside any single <w:t>...</w:t>
  xml = xml.replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (full, inner) => {
    if (!inner.includes(phraseEsc)) return full;
    count++;
    const newInner = inner.split(phraseEsc).join(replaceEsc);
    return `<w:t xml:space="preserve">${newInner}</w:t>`;
  });

  // (b) Walk runs and find windows whose concatenated <w:t> = phrase
  const runRegex = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  const runs = [];
  let m;
  while ((m = runRegex.exec(xml)) !== null) {
    const tm = m[0].match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
    if (tm) runs.push({ start: m.index, end: m.index + m[0].length, text: tm[1], full: m[0] });
  }
  const wins = [];
  let i = 0;
  while (i < runs.length) {
    if (runs[i].text === phrase) { i++; continue; } // already handled by (a)
    let concat = '';
    let matched = -1;
    for (let j = i; j < runs.length; j++) {
      concat += runs[j].text;
      if (concat === phrase) { matched = j; break; }
      if (!phrase.startsWith(concat)) break;
    }
    if (matched !== -1 && matched > i) { // require multi-run window
      wins.push({ first: i, last: matched });
      i = matched + 1;
    } else {
      i++;
    }
  }
  for (const w of wins.reverse()) {
    count++;
    const firstRun = runs[w.first];
    const lastRun  = runs[w.last];
    const newFirst = firstRun.full.replace(
      /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/,
      `<w:t xml:space="preserve">${escapeXml(replacement)}</w:t>`
    );
    let middle = '';
    for (let k = w.first + 1; k <= w.last; k++) {
      const blanked = runs[k].full.replace(
        /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/,
        '<w:t xml:space="preserve"></w:t>'
      );
      middle += xml.slice(runs[k - 1].end, runs[k].start) + blanked;
    }
    xml = xml.slice(0, firstRun.start) + newFirst + middle + xml.slice(lastRun.end);
  }
  return { xml, count };
}

let replaceCount = 0;
for (const [from, to] of replacements) {
  const { xml: newXml, count } = replacePhraseAcrossRuns(xml, from, to);
  if (count > 0) {
    xml = newXml;
    replaceCount++;
    console.log(`  ✓ (×${count}) ${from.slice(0, 60)}${from.length > 60 ? '…' : ''}`);
  } else {
    console.warn(`  ⚠ NOT FOUND: ${from.slice(0, 80)}`);
  }
}

// ─── Step 4: Part 1 table — turn row 1 into loop, drop rows 2–5 ─
// The table contains exactly 5 data rows (one per item). We identify
// each row by its content: cells like "1.", "cat", "(......)", "a. ...".
// Approach: find each <w:tr> that contains a number+dot in the first
// cell. Take first row's cells and replace cell text. Drop the rest.
function transformPart1Table(xml) {
  // Find table rows whose first cell text is "1." through "5."
  // Each row is <w:tr ...>...</w:tr>
  const trRegex = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
  const allRows = [...xml.matchAll(trRegex)];

  // Filter rows that look like a Part 1 item: first <w:t> is "N." and
  // somewhere in the row the text "(......)" appears
  const itemRows = allRows.filter(m => {
    const row = m[0];
    const firstT = row.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/);
    if (!firstT) return false;
    return /^[1-5]\.$/.test(firstT[1].trim()) && row.includes('(......)');
  });

  if (itemRows.length < 2) {
    console.warn('  ⚠ Part 1 table: could not find item rows (expected 5)');
    return xml;
  }

  // Replace first row's cell texts
  const firstRow = itemRows[0];
  let newFirstRow = firstRow[0];
  // The cells contain (in order): "1.", "cat", "(......)", "a.  a small pet ..."
  // Replace by ordering: pattern first <w:t>… then word, blank stays, then meaning
  // Each <w:t>X</w:t> we touch:
  let cellTextIdx = 0;
  const cellReplacements = [
    '{#part1}{num}.',
    '{word}',
    null,             // keep "(......)"
    '{letter}.  {meaning}{/part1}',
  ];
  newFirstRow = newFirstRow.replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (full, inner) => {
    const repl = cellReplacements[cellTextIdx++];
    if (repl == null) return full;
    return `<w:t xml:space="preserve">${escapeXml(repl)}</w:t>`;
  });
  console.log(`  ✓ Part 1 table: transformed row 1 (loop wrapper)`);
  // Replace first row in XML
  xml = xml.replace(firstRow[0], newFirstRow);
  // Delete rows 2–5
  for (let i = 1; i < itemRows.length; i++) {
    xml = xml.replace(itemRows[i][0], '');
    console.log(`  ✓ Part 1 table: removed row ${i + 1}`);
  }
  return xml;
}
xml = transformPart1Table(xml);

// ─── Step 5: Part 2 — turn sentence 1 into loop, drop 2–5 ─────
function transformPart2Sentences(xml) {
  // The 5 sentences are paragraphs whose text starts with "1.   I see a"
  // through "5.   My ...". After merging, each is a single <w:t>.
  const paraRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const allParas = [...xml.matchAll(paraRegex)];

  const sentenceParas = allParas.filter(m => {
    const t = m[0].match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/);
    if (!t) return false;
    // "1.   I see a ........................ in the tree." etc.
    return /^[1-5]\.\s+\S.*\.{4,}/.test(t[1].trim());
  });

  if (sentenceParas.length < 2) {
    console.warn('  ⚠ Part 2 sentences: could not find sentence paragraphs');
    return xml;
  }

  // Replace first paragraph's text with just "{num}.   {sentence}",
  // then INSERT two bracket paragraphs (open before, close after) so
  // docxtemplater's paragraphLoop treats this as a paragraph loop and
  // emits one paragraph per item (not inline concat).
  const firstPara = sentenceParas[0];
  const newSentencePara = firstPara[0].replace(
    /<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/,
    `<w:t xml:space="preserve">${escapeXml('{num}.   {sentence}')}</w:t>`
  );
  const openPara  = '<w:p><w:r><w:t xml:space="preserve">{#part2}</w:t></w:r></w:p>';
  const closePara = '<w:p><w:r><w:t xml:space="preserve">{/part2}</w:t></w:r></w:p>';
  xml = xml.replace(firstPara[0], openPara + newSentencePara + closePara);
  console.log(`  ✓ Part 2: wrapped sentence 1 with {#part2}/{/part2} paragraphs`);
  // Delete paragraphs 2–5
  for (let i = 1; i < sentenceParas.length; i++) {
    xml = xml.replace(sentenceParas[i][0], '');
    console.log(`  ✓ Part 2: removed sentence ${i + 1}`);
  }
  return xml;
}
xml = transformPart2Sentences(xml);

// ─── Step 6: save ──────────────────────────────────────────
zip.file('word/document.xml', xml);
const out = zip.generate({ type: 'nodebuffer' });
fs.writeFileSync(OUTPUT, out);

// ─── Verify: extract placeholders found ───────────────────
const found = [...new Set(xml.match(/\{#?\/?[a-zA-Z][a-zA-Z0-9]*\}/g) || [])];
console.log(`\n✓ wrote ${OUTPUT}`);
console.log(`  replacements applied: ${replaceCount}/${replacements.length}`);
console.log(`  placeholders in output (${found.length}):`);
found.sort().forEach(p => console.log(`    - ${p}`));
