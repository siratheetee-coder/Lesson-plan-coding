// Test render: fill worksheet-template.docx with sample data and write
// worksheet-test-rendered.docx so we can open it in Word to verify the
// template is wired up correctly.
//
// Run:  node server/scripts/testWorksheetRender.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const content = fs.readFileSync(path.join(ROOT, 'worksheet-template.docx'));
const zip = new PizZip(content);
const doc = new Docxtemplater(zip, {
  paragraphLoop: true,
  linebreaks: true,
});

doc.render({
  worksheetNo: '1',
  title:       'Animals in the Forest',
  subject:     'ภาษาอังกฤษ',
  level:       'ประถมศึกษาปีที่ 4',
  duration:    '20',
  totalScore:  '10',

  part1Title:        'Match the words with their meanings.',
  part1Score:        '5',
  part1Instructions: 'จับคู่คำศัพท์กับความหมายโดยเขียนตัวอักษร a–e ลงในวงเล็บ',
  part1: [
    { num: '1', word: 'cat',    letter: 'a', meaning: 'a small pet that says "meow"' },
    { num: '2', word: 'bird',   letter: 'b', meaning: 'an animal with long ears' },
    { num: '3', word: 'fish',   letter: 'c', meaning: 'an animal that can fly' },
    { num: '4', word: 'rabbit', letter: 'd', meaning: 'an animal that lives in water' },
    { num: '5', word: 'dog',    letter: 'e', meaning: 'a loyal pet that says "woof"' },
  ],

  wordBank: 'cat   |   bird   |   fish   |   dog   |   rabbit',

  part2Title:        'Fill in the blanks using the word bank.',
  part2Score:        '5',
  part2Instructions: 'เติมคำในช่องว่างโดยเลือกคำจากกรอบด้านล่าง (ใช้ได้ครั้งเดียวต่อคำ)',
  part2: [
    { num: '1', sentence: 'I see a ........................ in the tree.' },
    { num: '2', sentence: 'It is a ........................  It can swim.' },
    { num: '3', sentence: 'Look!  A ........................ is running fast.' },
    { num: '4', sentence: 'The ........................ has long ears and a short tail.' },
    { num: '5', sentence: 'My ........................ likes to drink milk every morning.' },
  ],

  answer1Line: '1. cat → c        2. bird → c        3. fish → d        4. rabbit → b        5. dog → e',
  answer2Line: '1. bird        2. fish        3. dog        4. rabbit        5. cat',
});

const out = doc.getZip().generate({ type: 'nodebuffer' });
const outPath = path.join(ROOT, 'worksheet-test-rendered.docx');
fs.writeFileSync(outPath, out);
console.log('✓ rendered →', outPath);
