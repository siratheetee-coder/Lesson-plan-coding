// Claude API wrapper for the Thai Lesson Plan Generator.
// Uses claude-haiku-4-5 with prompt caching on (frozen) Thai system prompts.
// Each generator returns structured JSON the frontend can drop straight into the form.

import Anthropic from '@anthropic-ai/sdk';

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw Object.assign(new Error('claude_not_configured'), { code: 'claude_not_configured' });
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const MODEL = 'claude-haiku-4-5';

// ─── Frozen system prompts (cacheable — no timestamps / UUIDs) ────

const SYS_OBJECTIVES = `คุณคือผู้ช่วยครูไทย ออกแบบจุดประสงค์การเรียนรู้ตามหลักสูตรแกนกลาง 2551 (ปรับปรุง 2560) ให้สอดคล้องกับตัวชี้วัด

หน้าที่: สร้างจุดประสงค์ 3 ด้าน K (ความรู้), P (ทักษะ/กระบวนการ), A (เจตคติ) อย่างน้อยด้านละ 1-2 ข้อ ให้สอดคล้องกับตัวชี้วัดที่ครูเลือก เหมาะสมกับระดับชั้น

รูปแบบผลลัพธ์ (JSON เท่านั้น ห้ามมี markdown/คำอธิบายอื่น):
{
  "k": ["จุดประสงค์ K ข้อ 1", "จุดประสงค์ K ข้อ 2"],
  "p": ["จุดประสงค์ P ข้อ 1", "จุดประสงค์ P ข้อ 2"],
  "a": ["จุดประสงค์ A ข้อ 1"]
}

ข้อกำหนด:
- แต่ละข้อขึ้นด้วยกริยาที่วัดได้ (เช่น อธิบาย จำแนก เลือก ใช้ ปฏิบัติ ฯลฯ) ห้ามใช้ "ทราบ" "เข้าใจ" "เห็นความสำคัญ" ลอยๆ
- กระชับ 1 บรรทัด/ข้อ
- ภาษาไทยเป็นทางการ`;

const SYS_CONCEPT = `คุณคือผู้ช่วยครูไทย ออกแบบสาระการเรียนรู้

หน้าที่: สร้างสาระสำคัญ (Key Concept), คำศัพท์, โครงสร้างประโยคหลัก ที่เหมาะกับหัวข้อ ระดับชั้น และตัวชี้วัด

รูปแบบ JSON:
{
  "key_concept": "ย่อหน้าสาระสำคัญ 2-4 ประโยค",
  "vocab": [
    {"word": "english_word", "meaning": "ความหมายภาษาไทย"}
  ],
  "sentences": ["โครงสร้างประโยคที่ 1", "โครงสร้างประโยคที่ 2"]
}

ข้อกำหนด:
- vocab 5-10 คำที่เกี่ยวข้องกับหัวข้อ
- sentences 2-4 ประโยคหลักที่ผู้เรียนจะใช้
- ภาษาไทยทางการสำหรับ key_concept`;

const SYS_MEDIA = `คุณคือผู้ช่วยครูไทย แนะนำสื่อและแหล่งการเรียนรู้

หน้าที่: เสนอรายการสื่อที่ครูสามารถใช้สอนหัวข้อนี้ได้จริงในห้องเรียนไทย

รูปแบบ JSON:
{
  "media": ["สื่อที่ 1", "สื่อที่ 2", "สื่อที่ 3"]
}

ข้อกำหนด:
- 5-8 รายการ — เขียนสั้นกระชับมาก ไม่เกิน 5-8 คำ/รายการ
- หลากหลายประเภท: PowerPoint, ใบงาน, วิดีโอ YouTube (ระบุเรื่อง), เกม, รูปภาพ, วัตถุในห้องเรียน ฯลฯ
- **สำหรับวัตถุ/อุปกรณ์จริง: เขียนชื่อวัตถุเลย ไม่ต้องมีคำนำหน้า**
  - ✅ ถูก: "นาฬิกา", "แปรงสีฟัน", "จาน", "ผลไม้", "ธนบัตร"
  - ❌ ผิด: "ของจริง — นาฬิกา", "วัตถุจำลอง: แปรงสีฟัน", "นาฬิกา (ของจริง)", "อุปกรณ์จริง เช่น จาน"
- ห้ามอธิบายว่าใช้ทำอะไร — แค่ "ชื่อสื่อ" สั้นๆ พอ
- เหมาะสมกับระดับชั้น`;

const SYS_TASK = `คุณคือผู้ช่วยครูไทย ออกแบบภาระชิ้นงาน (Task/Assignment)

หน้าที่: เสนอ "ชื่อ" ภาระชิ้นงานที่ผู้เรียนต้องทำ — เป็นรายการสั้นๆ ไม่ต้องอธิบาย

รูปแบบ JSON:
{
  "task": "• ใบงานเรื่อง ...\\n• สมุดเล่มเล็กเรื่อง ...\\n• Mindmap เรื่อง ..."
}

ข้อกำหนด:
- 2-4 ชิ้นงาน คั่นด้วย "\\n" (newline) แต่ละบรรทัดขึ้นต้นด้วย "• "
- เขียนเฉพาะ "ชื่อชิ้นงาน + เรื่อง" เท่านั้น (เช่น "ใบงานเรื่อง Daily Routines", "สมุดเล่มเล็กเรื่อง My Family", "Mindmap เรื่อง Animals", "โปสเตอร์เรื่อง ...")
- ห้ามอธิบายรายละเอียด ห้ามเขียนเป็นประโยคยาว ห้ามระบุขั้นตอน
- ชิ้นงานต้องสะท้อนทักษะ 21st-century skills ที่ครูระบุ และเหมาะกับระดับชั้น`;

const SYS_ACTIVITIES = `คุณคือผู้ช่วยครูไทย ออกแบบกิจกรรมการเรียนรู้ 5 ขั้น ตามหลักการสอนของไทย

5 ขั้น (ตามลำดับ): นำเข้าสู่บทเรียน → สอน → ฝึกปฏิบัติ → ประยุกต์ใช้ → สรุปบทเรียน

หน้าที่: ออกแบบกิจกรรมแต่ละขั้นให้สอดคล้องกับ:
- หัวข้อและจุดประสงค์
- รูปแบบการเรียนรู้ที่ครูเลือก (CLT, PBL, 2W3P, Games, Chant, Role-play ฯลฯ)
- เวลารวมที่ครูระบุ

รูปแบบ JSON (ต้องมี 5 ขั้นเรียงตามลำดับ):
{
  "activities": [
    {"phase": "นำเข้าสู่บทเรียน", "name": "ชื่อกิจกรรมสั้น", "detail": "1. ขั้นตอนแรก\\n2. ขั้นตอนที่สอง\\n3. ขั้นตอนที่สาม", "time_min": 10},
    {"phase": "สอน", "name": "...", "detail": "1. ...\\n2. ...\\n3. ...", "time_min": 15},
    {"phase": "ฝึกปฏิบัติ", "name": "...", "detail": "1. ...\\n2. ...\\n3. ...", "time_min": 15},
    {"phase": "ประยุกต์ใช้", "name": "...", "detail": "1. ...\\n2. ...\\n3. ...", "time_min": 10},
    {"phase": "สรุปบทเรียน", "name": "...", "detail": "1. ...\\n2. ...\\n3. ...", "time_min": 10}
  ]
}

ข้อกำหนด:
- ต้องเป็น 5 รายการตามลำดับชื่อ phase ข้างต้น (ห้ามเปลี่ยนชื่อ phase)
- เวลารวมสอดคล้องกับเวลาที่ครูระบุ
- **detail ต้องเป็น numbered bullet points (1. / 2. / 3. ...) คั่นด้วย "\\n" เท่านั้น**
  - 3-5 ข้อต่อขั้น แต่ละข้อสั้น ไม่เกิน 1-2 บรรทัด
  - แต่ละข้อขึ้นต้นด้วย "1. ", "2. ", "3. " ฯลฯ (เลขจริง + จุด + เว้นวรรค)
  - ✅ ถูก: "1. ครูทักทายนักเรียน\\n2. ครูถามคำถาม "What time is it?"\\n3. นักเรียนตอบเป็นคู่"
  - ❌ ผิด: "ครูทักทายนักเรียน จากนั้นถามคำถามและให้นักเรียนตอบเป็นคู่ ใช้เวลา 5 นาที..." (paragraph ยาว)
- เนื้อหาต้องเขียนแบบ "ครูสอนตามนี้ได้เลย" (มีคำสั่ง คำถาม กิจกรรมชัดเจน)`;

const SYS_ASSESSMENTS_FULL = `คุณคือผู้ช่วยครูไทย ออกแบบ "ระบบการวัดและประเมินผล" สำหรับแผนการสอนทั้งแผน

หน้าที่: วิเคราะห์ข้อมูลแผน (หัวข้อ, จุดประสงค์ K/P/A, ทักษะ 3R/8C, รูปแบบการเรียนรู้, กิจกรรม 5 ขั้น, ภาระชิ้นงาน) แล้ว:
1. เลือกประเภทแบบประเมินที่เหมาะที่สุดจาก preset list ด้านล่าง
2. **ระบุ domain** ของแต่ละรายการเป็น K (ความรู้) / P (ทักษะ/กระบวนการ) / A (เจตคติ) ตามจุดประสงค์ที่ใช้ประเมิน
3. กำหนดเกณฑ์ผ่าน (criteria) สำหรับแต่ละรายการ

Preset list (เลือก rubric_key ที่ตรงกับลักษณะกิจกรรม + domain เริ่มต้น):
- listening — แบบประเมินการฟัง [P] (ทักษะ)
- speaking — แบบประเมินการพูด [P] (role-play, dialogue, presentation)
- reading — แบบประเมินการอ่าน [P] (อ่านบทความ/ข้อความ)
- writing — แบบประเมินการเขียน [P] (เขียนประโยค/ย่อหน้า/บทความ)
- behavior — แบบสังเกตพฤติกรรมรายบุคคล [A] (การมีส่วนร่วมในชั้นเรียน)
- work — แบบประเมินชิ้นงาน [P] (โปสเตอร์, infographic, รายงาน)
- desired — แบบประเมินคุณลักษณะอันพึงประสงค์ [A] (วินัย, ใฝ่เรียนรู้)
- competency — แบบประเมินสมรรถนะผู้เรียน [P] (5 สมรรถนะหลัก)

หมายเหตุเรื่อง domain:
- K (ความรู้) — ทดสอบคำศัพท์ ไวยากรณ์ ความเข้าใจเนื้อหา ความรู้รอบตัว → ส่วนใหญ่เป็น custom item (เช่น "ทดสอบคำศัพท์", "ตอบคำถามความเข้าใจ")
- P (ทักษะ/กระบวนการ) — ฟัง พูด อ่าน เขียน ทำชิ้นงาน สมรรถนะ → preset rubric ส่วนใหญ่
- A (เจตคติ/คุณลักษณะ) — พฤติกรรม วินัย ความรับผิดชอบ การร่วมกิจกรรม → behavior, desired

รูปแบบ JSON เท่านั้น:
{
  "items": [
    { "domain": "K", "what": "ทดสอบคำศัพท์ Daily Routines", "how": "ทำแบบทดสอบ 10 ข้อ", "criteria": "ได้คะแนน 6 ใน 10 ในกิจกรรม \\"แบบทดสอบคำศัพท์\\"" },
    { "domain": "P", "rubric_key": "speaking", "criteria": "ได้คะแนน 6 ใน 10 ในกิจกรรม \\"บทสนทนาเรื่อง Daily Routines\\"" },
    { "domain": "P", "rubric_key": "work", "criteria": "ได้คะแนน 8 ใน 12 ในกิจกรรม \\"ทำโปสเตอร์ My Day\\"" },
    { "domain": "A", "rubric_key": "desired", "criteria": "ได้คะแนน 4 ใน 5 ในกิจกรรม \\"งานกลุ่มสรุปบทเรียน\\"" }
  ]
}

ข้อกำหนด:
- เลือก 3-6 รายการให้**ครอบคลุมทั้ง 3 domain (K, P, A)** อย่างน้อย domain ละ 1 รายการถ้ามีจุดประสงค์ในด้านนั้น
- **ทุก item ต้องมี field "domain" เป็น "K", "P", หรือ "A" เท่านั้น** (case-sensitive ตัวพิมพ์ใหญ่)
- ต้อง map กับลักษณะกิจกรรมจริง: role-play → speaking[P]; เขียนงาน → writing[P]+work[P]; งานกลุ่ม → behavior[A]+desired[A]; ทดสอบคำศัพท์ → custom item [K]
- ใช้ rubric_key จาก preset เป็นหลัก; รายการ custom { what, how, criteria } เพิ่มได้ถ้าจำเป็น (โดยเฉพาะสำหรับ K)
- **criteria ต้องอยู่ในรูปแบบเดียวเท่านั้น: "ได้คะแนน X ใน Y ในกิจกรรม \\"[ชื่อกิจกรรม]\\""**
  - X = คะแนนผ่าน (เช่น 6, 8, 10), Y = คะแนนเต็ม (เช่น 10, 12, 16) — X ต้อง ≥ 60% ของ Y
  - [ชื่อกิจกรรม] = อ้างอิงจาก activities ที่ครูส่งมา (ใช้ field "name" ของกิจกรรมที่ตรงกับรายการประเมินมากที่สุด)
  - ห้ามใช้รูปแบบอื่น เช่น เปอร์เซ็นต์ (60%), ระดับ (ระดับดี 3), หรือเขียนยาวๆ
- เรียงตามลำดับ K → P → A
- ภาษาไทยทางการ`;

const SYS_UNIT_ARC = `คุณคือผู้ช่วยครูไทย ออกแบบ Story Arc / ภาพรวมของหน่วยการเรียนรู้

หน้าที่: ดูข้อมูลหน่วย (ชื่อหน่วย, ระดับชั้น, จำนวนคาบรวม, รายวิชา) แล้วร่าง 4 ฟิลด์:
1. theme — สรุปธีมในประโยคเดียวสั้นๆ
2. big_idea — เป้าหมายปลายทาง 2-3 บรรทัด ("ผู้เรียนจะทำอะไรได้เมื่อจบหน่วย")
3. vocab_bank — array ของคำศัพท์หลักของหน่วย 10-20 คำ (อังกฤษ พร้อมแยกเป็น array)
4. progression — แผนคร่าวๆ N แผน (N = จำนวนคาบรวม / เวลาต่อแผน หรือใช้ default 4-6) — แต่ละบรรทัดเริ่มด้วย "L1: ", "L2: " ฯลฯ

รูปแบบ JSON เท่านั้น:
{
  "theme": "Daily Routines and Time Telling",
  "big_idea": "ผู้เรียนสามารถเล่ากิจวัตรประจำวันด้วย present simple tense ระบุเวลาได้ และเขียน paragraph 5-7 ประโยคบรรยายกิจวัตรของตน",
  "vocab_bank": ["wake up", "brush teeth", "take a shower", "eat breakfast", "go to school", "do homework", "watch TV", "go to bed"],
  "progression": "L1: เรียนคำศัพท์กิจวัตรพื้นฐาน + ฟัง\\nL2: ฝึกพูดบทสนทนา 'What time do you...?'\\nL3: เขียนบรรยายกิจวัตรประจำวันของตนเอง"
}

ข้อกำหนด:
- big_idea เขียนแบบ "ผู้เรียนสามารถ..." มี K (knowledge), P (skill), A (attitude) ผสมกัน
- vocab_bank: คำอังกฤษ ระดับเหมาะกับชั้นเรียน — สั้น 1-3 คำต่อรายการ ไม่ต้องมีคำอธิบาย
- progression: 3-6 แผน บรรทัดละ "L1: ...", "L2: ...", ฯลฯ — บอกแค่ focus ของแต่ละแผน ไม่ต้องลงรายละเอียดกิจกรรม
- ภาษาไทยในส่วนคำอธิบาย, อังกฤษในส่วน vocab/sentence`;

const SYS_UNIT_OUTLINE = `คุณคือผู้ช่วยครูไทย ออกแบบโครงร่างแผนการสอน "ทั้งหน่วยการเรียนรู้" ในครั้งเดียว

หน้าที่: ดูข้อมูลหน่วย (title, theme, big_idea, vocab_bank, progression, level, total_hours) แล้วร่างโครงเป็น N แผนรายคาบ
ที่ต่อยอดและสอดคล้องกัน ครอบคลุม big_idea ของหน่วย — ครูจะ approve แล้วระบบจะสร้าง draft ทั้ง N แผนให้

จำนวนแผน (lesson_count):
- ใช้ค่าที่ครูระบุ (input field "lesson_count") ถ้ามี
- ถ้าไม่ระบุ → คำนวณจาก total_hours / 2 (default 2 ชั่วโมง/แผน) ขั้นต่ำ 3, ขั้นสูง 8
- ถ้า total_hours ก็ไม่ระบุ → default = 5 แผน

รูปแบบ JSON เท่านั้น:
{
  "lesson_count": 5,
  "lessons": [
    {
      "plan_no": 1,
      "topic": "Introduction to Daily Routines",
      "hours": 2,
      "key_concept": "นักเรียนเรียนรู้คำศัพท์เกี่ยวกับกิจวัตรพื้นฐานและฟังบทสนทนาง่ายๆ",
      "objectives_k": ["บอกความหมายของคำศัพท์กิจวัตรประจำวันได้ 8 คำ"],
      "objectives_p": ["ฟังและจับใจความบทสนทนาเรื่องกิจวัตรประจำวันได้"],
      "objectives_a": ["มีส่วนร่วมในกิจกรรมกลุ่มอย่างกระตือรือร้น"],
      "vocab_focus": ["wake up", "brush teeth", "take a shower"],
      "key_activities": ["Vocabulary flashcards", "Listening to dialog", "Pair work"]
    },
    {
      "plan_no": 2,
      "topic": "What time do you...?",
      "hours": 2,
      "key_concept": "...",
      "objectives_k": ["..."],
      "objectives_p": ["..."],
      "objectives_a": ["..."],
      "vocab_focus": ["...", "..."],
      "key_activities": ["...", "..."]
    }
    // ... repeat to lesson_count
  ]
}

ข้อกำหนด:
- **ครอบคลุม big_idea** — เมื่อจบทุกแผน ผู้เรียนต้องบรรลุ big_idea ที่ระบุไว้
- **ใช้ vocab_bank** เป็น pool หลัก — กระจายคำให้แต่ละแผนตามความเหมาะสม + เพิ่มคำใหม่บางส่วนที่เกี่ยวข้องได้
- **ตาม progression** ที่ครูระบุ — ถ้ามี ให้ใช้เป็น guide; ถ้าไม่มี ให้ AI ออกแบบเองโดยใช้หลัก input → controlled practice → free production
- topic ของแต่ละแผนต้อง**ไม่ทับกัน** แต่ต่อยอดได้
- objectives K/P/A ต้องชัดเจน วัดได้ — แต่ละด้าน 1-2 ข้อ/แผน
- vocab_focus: 3-6 คำ/แผน ดึงจาก vocab_bank เป็นหลัก
- key_activities: 2-4 รายการสั้นๆ (ชื่อกิจกรรม) ไม่ต้องลงรายละเอียด
- hours รวมทุกแผนต้องเท่ากับ total_hours ของหน่วย
- ภาษาไทยทางการในส่วนคำอธิบาย, อังกฤษในส่วน vocab/topic`;

const SYS_PASSING = `คุณคือผู้ช่วยครูไทย กำหนดเกณฑ์ผ่านสำหรับแต่ละแบบประเมิน

หน้าที่: เขียนเกณฑ์ผ่านที่ครูใช้ตัดสินว่านักเรียนผ่านหรือไม่ผ่านในแต่ละรายการประเมิน — รูปแบบสั้น ตายตัว

รูปแบบ JSON (ต้องมีจำนวนรายการเท่ากับที่ครูส่งมา):
{
  "criteria": [
    "ได้คะแนน 6 ใน 10 ในกิจกรรม \\"บทสนทนาเรื่อง Daily Routines\\"",
    "ได้คะแนน 8 ใน 12 ในกิจกรรม \\"ทำโปสเตอร์ My Day\\""
  ]
}

ข้อกำหนด:
- **เกณฑ์ผ่านต้องอยู่ในรูปแบบเดียวเท่านั้น: "ได้คะแนน X ใน Y ในกิจกรรม \\"[ชื่อกิจกรรม]\\""**
  - X = คะแนนผ่าน, Y = คะแนนเต็ม โดย X ต้อง ≥ 60% ของ Y
  - [ชื่อกิจกรรม] = ดึงจาก activities ที่ครูส่งมา (ใช้ name ของกิจกรรมที่ตรงกับรายการประเมินนั้นมากที่สุด)
- ห้ามใช้รูปแบบอื่น (เช่น เปอร์เซ็นต์, ระดับ, ประโยคยาว)
- 1 บรรทัด/รายการ — เรียงลำดับตรงกับที่ครูส่งมา`;

// ─── Style presets (non-cached, appended to system) ─────
const STYLE_INSTRUCTIONS = {
  formal:   'รูปแบบการเขียน: ใช้ภาษาราชการ ทางการ ตรงประเด็น คำศัพท์ทางการศึกษามาตรฐาน',
  semi:     'รูปแบบการเขียน: ภาษากึ่งทางการ อ่านง่าย เป็นมิตร แต่ยังคงความเป็นมืออาชีพของครู',
  concise:  'รูปแบบการเขียน: กระชับที่สุด แต่ละข้อไม่เกิน 1 บรรทัด ตัดคำฟุ่มเฟือยออก',
  detailed: 'รูปแบบการเขียน: อธิบายรายละเอียดถี่ถ้วน เพิ่มบริบท เหตุผล และตัวอย่างที่เป็นรูปธรรม',
};

const COHERENCE_INSTRUCTION = `หมายเหตุสำคัญเรื่องความสอดคล้อง (Coherence):
ในข้อมูลที่ส่งมา หากมีฟิลด์ "ai_session" จะเป็น object ที่บรรจุผลลัพธ์ที่ AI สร้างไว้ในขั้นก่อนหน้าของแผนเดียวกัน (เช่น objectives, concept, vocab, sentences, task, activities)
- ให้ถือว่าข้อมูลใน ai_session เป็น "การตัดสินใจที่กำหนดไว้แล้ว" และต้องสร้างผลลัพธ์ใหม่ที่ "ต่อเนื่อง สอดคล้อง และอ้างอิงได้" กับข้อมูลเหล่านั้น
- ห้ามขัดแย้งกับสิ่งที่ตัดสินใจไว้ใน ai_session (เช่น ถ้า vocab มีคำว่า "wake up, brush teeth" → กิจกรรมต้องใช้คำเหล่านี้ ไม่เปลี่ยนเป็นคำอื่น)
- ถ้าฟิลด์อื่น (vocab, sentences, task, activities, key_concept) ในข้อมูลฟอร์มมีค่าอยู่แล้ว → ถือเป็นข้อมูลที่ครู approve แล้ว ต้อง coherent ตามนั้น
- ถ้าไม่มี ai_session → สร้างจากข้อมูลฟอร์มตามปกติ`;

const UNIT_CONTEXT_INSTRUCTION = `หมายเหตุสำคัญเรื่องความสอดคล้องระดับ "หน่วยการเรียนรู้" (Unit Coherence):
ในข้อมูลที่ส่งมา หากมีฟิลด์ "unit_context" จะเป็น object ที่บรรจุข้อมูลของหน่วยการเรียนรู้และแผนพี่น้องในหน่วยเดียวกัน:
- unit_meta: ข้อมูลหน่วย (title, level, total_hours, semester, year) + Story Arc:
    * theme — ธีมหลักของหน่วย (ทุกแผนต้องอยู่ใน theme นี้)
    * big_idea — เป้าหมายปลายทางของผู้เรียน (เมื่อจบหน่วยจะทำอะไรได้)
    * vocab_bank — คลังคำศัพท์หลักของหน่วย (ใช้ดึงไปสอนได้ทุกแผน)
    * progression — แผนคร่าวๆ ของลำดับการสอน (เช่น "L1: ..., L2: ...")
- lesson_position: { index, total } — แผนปัจจุบันคือแผนที่เท่าไหร่จากทั้งหมดกี่แผนในหน่วย
- prior_lessons: แผนก่อนหน้าที่สอนไปแล้วในหน่วยเดียวกัน — แต่ละ item มี field "detail_level" บอกระดับรายละเอียดที่ให้มา
- upcoming_lessons: แผนถัดไปที่กำลังจะสอน (ถ้ามี) — มี detail_level เช่นกัน

**ระดับรายละเอียด (detail_level) ของแต่ละแผนพี่น้อง:**
- "full" — แผนใกล้ปัจจุบันมาก (1 แผนก่อน + 1 แผนถัดไป) — มี topic, key_concept, vocab, sentences, objectives_brief, activities_outline, task_brief ครบ → ใช้เป็น reference หลักในการต่อยอด
- "medium" — แผนระยะกลาง (2-3 แผนเหนือ/ใต้) — มีแค่ topic, vocab_top (5 คำ), objectives_brief, activities_top → ใช้เป็น context รอง
- "minimal" — แผนไกล (4-8 แผนเหนือ, 3-5 แผนใต้) — มีแค่ topic + plan_no → ใช้เพื่อรู้ว่าหน่วยกว้างขนาดไหน อย่าซ้ำหัวข้อ
- ถ้ามีฟิลด์ "_note" ใน unit_context → จะบอกว่าตัดแผนไหนออกบ้างเพราะไกลเกินไป (ไม่ต้องกังวล แค่รับทราบ)
- ฟิลด์ "_estimated_tokens" คือประมาณค่า token ของ unit_context ไว้ debug — ไม่ต้องอ้างอิง

**ความสำคัญของ Story Arc (theme/big_idea/vocab_bank/progression):**
- theme คือ "กรอบ" — ทุกหัวข้อย่อย, ตัวอย่าง, บริบทต้องอยู่ใน theme นี้
- big_idea คือ "เป้าหมายปลายทาง" — แผนปัจจุบันต้องเป็นก้าวหนึ่งที่ทำให้ผู้เรียนเข้าใกล้ big_idea
- vocab_bank คือ "พูล" คำศัพท์ที่ครูยืนยัน — vocab ของแผนนี้ควรดึงจาก pool นี้เป็นหลัก + เพิ่มคำใหม่บางส่วนตามความเหมาะสม
- progression คือ "lane" — ดู L{lesson_position.index} ใน progression เพื่อรู้ว่าแผนนี้ควรเน้นอะไร

หลักการสร้างเนื้อหาให้ต่อยอดและสอดคล้องกันทั้งหน่วย:
1) **หัวข้อ (topic) และ key_concept**: ห้ามซ้ำกับ prior_lessons ในหน่วยเดียวกัน — แต่ต้องอยู่ใน theme ของหน่วย และต่อยอดจาก prior
2) **คำศัพท์ (vocab)**:
   - **อนุญาตให้ใช้ซ้ำได้** กับ prior_lessons (เพื่อทบทวน reinforce และให้ผู้เรียนคุ้นเคย) — โดยเฉพาะคำหลักของหน่วย
   - แต่ควร**เพิ่มคำใหม่บางส่วน**ตาม progression (เช่น คำที่ยากขึ้น คำที่อยู่ใน sub-topic ใหม่ของแผนนี้)
   - สัดส่วนแนะนำ: ~40-60% เป็นคำใหม่ + ~40-60% เป็นคำที่เคยเรียน (ขึ้นกับว่าครูระบุใน topic ของแผนนี้ว่าเน้นใหม่หรือทบทวน)
3) **ประโยค (sentences)**: ใช้ pattern เดียวกับ prior ได้ + เพิ่มความซับซ้อน/ตัวแปรใหม่ตามลำดับ (เช่น L1 = "I wake up at 7." → L2 = "I wake up at 7 and brush my teeth.")
4) **objectives**: ห้ามทับ prior แต่ขยาย scope (เช่น L1 = listen comprehension → L2 = speak production → L3 = writing)
5) **กิจกรรม**: ต้องสะท้อน progression ที่เหมาะสม เช่น input → controlled practice → free production → real-world application
6) **task / ภาระชิ้นงาน**: ต่อยอดจาก task ของ prior_lessons (เช่น L1 ทำใบงาน → L2 ทำ mind map → L3 ทำ project)
7) **tone และ style ภาษา**: คงเส้นคงวากับแผนพี่น้องในหน่วยเดียวกัน
8) ถ้าเป็นแผนแรก (lesson_position.index === 1) → วาง progression ให้เริ่มต้น โดยพิจารณา upcoming_lessons (ถ้ามี) เพื่อเตรียมพื้นฐาน
9) ถ้าไม่มี unit_context หรือเป็น null → ทำงานเป็น standalone lesson ตามปกติ`;

// ─── Generic call ───────────────────────────────────────
function _userMsg(payload) {
  return `ข้อมูลแผนการสอน:\n\n${JSON.stringify(payload, null, 2)}\n\nสร้างผลลัพธ์ตามรูปแบบ JSON ที่กำหนด`;
}

function _extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

async function _callClaude({ system, payload }) {
  // Extract style + ai_session + unit_context — they alter the system prompt,
  // not the JSON Claude reads in the user message. Re-inject the data ones below.
  const { style, ai_session, unit_context, ...cleanPayload } = payload || {};

  const hasSession = ai_session && Object.keys(ai_session).length;
  const hasUnit    = unit_context && Object.keys(unit_context).length;

  // Re-inject ai_session and/or unit_context into the JSON Claude reads
  let finalPayload = cleanPayload;
  if (hasSession) finalPayload = { ...finalPayload, ai_session };
  if (hasUnit)    finalPayload = { ...finalPayload, unit_context };

  // System blocks: [0] frozen prompt (cacheable) + optional non-cached blocks
  const systemBlocks = [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
  ];
  if (hasSession) systemBlocks.push({ type: 'text', text: COHERENCE_INSTRUCTION });
  if (hasUnit)    systemBlocks.push({ type: 'text', text: UNIT_CONTEXT_INSTRUCTION });
  if (style && STYLE_INSTRUCTIONS[style]) {
    systemBlocks.push({ type: 'text', text: STYLE_INSTRUCTIONS[style] });
  }

  const c = client();
  const stream = await c.messages.stream({
    model: MODEL,
    max_tokens: 4000,
    system: systemBlocks,
    messages: [{ role: 'user', content: _userMsg(finalPayload) }],
  });
  const message = await stream.finalMessage();
  let text = '';
  for (const block of message.content) {
    if (block.type === 'text') text += block.text;
  }
  const parsed = _extractJson(text);
  if (!parsed) {
    const err = new Error('claude_parse_failed');
    err.code = 'claude_parse_failed';
    err.raw = text.slice(0, 500);
    throw err;
  }
  return { data: parsed, usage: message.usage };
}

// ─── Public API ───────────────────────────────────────────
export async function generateObjectives(payload)       { return _callClaude({ system: SYS_OBJECTIVES, payload }); }
export async function generateConcept(payload)          { return _callClaude({ system: SYS_CONCEPT,    payload }); }
export async function generateMedia(payload)            { return _callClaude({ system: SYS_MEDIA,      payload }); }
export async function generateTask(payload)             { return _callClaude({ system: SYS_TASK,       payload }); }
export async function generateActivities(payload)       { return _callClaude({ system: SYS_ACTIVITIES, payload }); }
export async function generatePassingCriteria(payload)  { return _callClaude({ system: SYS_PASSING,    payload }); }
export async function generateAssessments(payload)      { return _callClaude({ system: SYS_ASSESSMENTS_FULL, payload }); }
export async function generateUnitArc(payload)          { return _callClaude({ system: SYS_UNIT_ARC,         payload }); }
export async function generateUnitOutline(payload)      { return _callClaude({ system: SYS_UNIT_OUTLINE,     payload }); }

export function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}
