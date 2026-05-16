// Worksheet DOCX renderer.
// Fills worksheet-template.docx (docxtemplater placeholders) with the
// payload returned by the AI generator and returns a Buffer.
//
// Expected `data` shape (from AI):
// {
//   worksheetNo, title, subject, level, duration, totalScore,
//   part1Title, part1Score, part1Instructions,
//   part1: [{ num, word, letter, meaning }, ...],
//   wordBank,
//   part2Title, part2Score, part2Instructions,
//   part2: [{ num, sentence }, ...],
//   answer1Line, answer2Line
// }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(__dirname, '..', '..', 'worksheet-template.docx');

let _cachedTemplate = null;
function loadTemplate() {
  if (!_cachedTemplate) {
    _cachedTemplate = fs.readFileSync(TEMPLATE_PATH);
  }
  return _cachedTemplate;
}

export async function renderWorksheetDocx(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('worksheet_data_missing');
  }
  const zip = new PizZip(loadTemplate());
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',  // missing field → empty string (don't crash)
  });

  // Normalise into the exact shape docxtemplater expects (all strings)
  const payload = {
    worksheetNo:       String(data.worksheetNo || '1'),
    title:             String(data.title || ''),
    subject:           String(data.subject || ''),
    level:             String(data.level || ''),
    duration:          String(data.duration || ''),
    totalScore:        String(data.totalScore || '10'),

    part1Title:        String(data.part1Title || ''),
    part1Score:        String(data.part1Score || '5'),
    part1Instructions: String(data.part1Instructions || ''),
    part1:             Array.isArray(data.part1) ? data.part1.map((it, i) => ({
      num:     String(it.num || (i + 1)),
      word:    String(it.word || ''),
      letter:  String(it.letter || ''),
      meaning: String(it.meaning || ''),
    })) : [],

    wordBank:          String(data.wordBank || ''),

    part2Title:        String(data.part2Title || ''),
    part2Score:        String(data.part2Score || '5'),
    part2Instructions: String(data.part2Instructions || ''),
    part2:             Array.isArray(data.part2) ? data.part2.map((it, i) => ({
      num:      String(it.num || (i + 1)),
      sentence: String(it.sentence || ''),
    })) : [],

    answer1Line:       String(data.answer1Line || ''),
    answer2Line:       String(data.answer2Line || ''),
  };

  try {
    doc.render(payload);
  } catch (err) {
    // docxtemplater throws structured errors — surface the first one
    if (err.properties && err.properties.errors) {
      const inner = err.properties.errors.map(e => `${e.name}: ${e.properties?.explanation || e.message}`).join('; ');
      throw new Error(`docxtemplater render failed: ${inner}`);
    }
    throw err;
  }
  return doc.getZip().generate({ type: 'nodebuffer' });
}
