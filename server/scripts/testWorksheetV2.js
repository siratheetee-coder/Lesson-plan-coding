// Test the v2 (programmatic, 8-type) worksheet renderer.
// Run:  node server/scripts/testWorksheetV2.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWorksheetDocx } from '../utils/worksheetDocx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const data = {
  worksheetNo: '1',
  title:       'Animals in the Forest',
  subject:     'ภาษาอังกฤษ',
  level:       'ประถมศึกษาปีที่ 4',
  duration:    '40',
  totalScore:  '20',
  sections: [
    {
      type: 'matching',
      title: 'Match the words with their meanings.',
      score: '5',
      instructions: 'จับคู่คำศัพท์กับความหมายโดยเขียนตัวอักษร a–e ลงในวงเล็บ',
      items: [
        { num: '1', word: 'cat',    letter: 'c', meaning: 'a small pet that says "meow"' },
        { num: '2', word: 'bird',   letter: 'a', meaning: 'an animal that can fly' },
        { num: '3', word: 'fish',   letter: 'e', meaning: 'an animal that lives in water' },
        { num: '4', word: 'rabbit', letter: 'b', meaning: 'an animal with long ears' },
        { num: '5', word: 'dog',    letter: 'd', meaning: 'a loyal pet that says "woof"' },
      ],
    },
    {
      type: 'fill_blank',
      title: 'Fill in the blanks using the word bank.',
      score: '5',
      instructions: 'เติมคำในช่องว่างโดยเลือกคำจากกรอบด้านล่าง (ใช้ได้ครั้งเดียวต่อคำ)',
      wordBank: 'cat   |   bird   |   fish   |   dog   |   rabbit',
      items: [
        { num: '1', sentence: 'I see a ........................ in the tree.', answer: 'bird' },
        { num: '2', sentence: 'It is a ........................ It can swim.', answer: 'fish' },
        { num: '3', sentence: 'Look! A ........................ is running fast.', answer: 'dog' },
        { num: '4', sentence: 'The ........................ has long ears.', answer: 'rabbit' },
        { num: '5', sentence: 'My ........................ likes milk.', answer: 'cat' },
      ],
    },
    {
      type: 'mcq',
      title: 'Choose the correct answer.',
      score: '4',
      instructions: 'เลือกคำตอบที่ถูกต้องที่สุด',
      items: [
        { num: '1', question: 'Which animal can fly?',
          choices: ['a) cat', 'b) bird', 'c) fish', 'd) dog'], answer: 'b' },
        { num: '2', question: 'Which animal lives in water?',
          choices: ['a) rabbit', 'b) cat', 'c) fish', 'd) bird'], answer: 'c' },
      ],
    },
    {
      type: 'true_false',
      title: 'Write T (true) or F (false).',
      score: '3',
      instructions: 'ตอบ T ถ้าประโยคถูก หรือ F ถ้าผิด',
      items: [
        { num: '1', statement: 'A cat can fly.',           answer: 'F' },
        { num: '2', statement: 'A fish lives in water.',   answer: 'T' },
        { num: '3', statement: 'A dog has long ears.',     answer: 'F' },
      ],
    },
    {
      type: 'writing',
      title: 'My Favorite Animal',
      score: '3',
      instructions: 'เขียนบรรยายสัตว์ที่นักเรียนชอบ อย่างน้อย 3 ประโยค',
      prompt: 'My favorite animal is _____________. I like it because...',
      lines: 6,
      rubric: [
        { criterion: 'ความถูกต้องของไวยากรณ์', points: '1' },
        { criterion: 'การใช้คำศัพท์เหมาะสม', points: '1' },
        { criterion: 'ความครบถ้วนของเนื้อหา', points: '1' },
      ],
    },
  ],
};

const buf = await renderWorksheetDocx(data);
const outPath = path.join(ROOT, 'worksheet-v2-test.docx');
fs.writeFileSync(outPath, buf);
console.log('✓ wrote', outPath, `(${buf.length} bytes)`);
