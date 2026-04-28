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
- 5-8 รายการ
- หลากหลายประเภท: PowerPoint, ใบงาน, วิดีโอ YouTube (ระบุเรื่อง), เกม, รูปภาพ, ของจริง ฯลฯ
- เหมาะสมกับระดับชั้น
- เขียนสั้นกระชับ 1 บรรทัด/รายการ`;

const SYS_TASK = `คุณคือผู้ช่วยครูไทย ออกแบบภาระชิ้นงาน (Task/Assignment)

หน้าที่: เสนอภาระชิ้นงานที่ผู้เรียนต้องทำ ให้สอดคล้องกับหัวข้อ จุดประสงค์ และทักษะศตวรรษที่ 21 ที่ครูเลือก

รูปแบบ JSON:
{
  "task": "รายละเอียดภาระชิ้นงาน 2-4 ประโยค ระบุชัดเจนว่าผู้เรียนต้องผลิต/ทำอะไร ใช้ทักษะอะไร ส่งในรูปแบบใด"
}

ข้อกำหนด:
- ชิ้นงานต้องสะท้อนทักษะ 21st-century skills ที่ครูระบุ
- ระบุผลผลิตที่จับต้องได้ (เช่น โปสเตอร์, คลิปวิดีโอ, บทบาทสมมติ, รายงาน, infographic)
- ภาษาไทยทางการ`;

const SYS_ACTIVITIES = `คุณคือผู้ช่วยครูไทย ออกแบบกิจกรรมการเรียนรู้ 5 ขั้น ตามหลักการสอนของไทย

5 ขั้น (ตามลำดับ): นำเข้าสู่บทเรียน → สอน → ฝึกปฏิบัติ → ประยุกต์ใช้ → สรุปบทเรียน

หน้าที่: ออกแบบกิจกรรมแต่ละขั้นให้สอดคล้องกับ:
- หัวข้อและจุดประสงค์
- รูปแบบการเรียนรู้ที่ครูเลือก (CLT, PBL, 2W3P, Games, Chant, Role-play ฯลฯ)
- เวลารวมที่ครูระบุ

รูปแบบ JSON (ต้องมี 5 ขั้นเรียงตามลำดับ):
{
  "activities": [
    {"phase": "นำเข้าสู่บทเรียน", "name": "ชื่อกิจกรรมสั้น", "detail": "รายละเอียด 2-3 ประโยคที่ครูใช้สอนได้ทันที", "time_min": 10},
    {"phase": "สอน", "name": "...", "detail": "...", "time_min": 15},
    {"phase": "ฝึกปฏิบัติ", "name": "...", "detail": "...", "time_min": 15},
    {"phase": "ประยุกต์ใช้", "name": "...", "detail": "...", "time_min": 10},
    {"phase": "สรุปบทเรียน", "name": "...", "detail": "...", "time_min": 10}
  ]
}

ข้อกำหนด:
- ต้องเป็น 5 รายการตามลำดับชื่อ phase ข้างต้น (ห้ามเปลี่ยนชื่อ phase)
- เวลารวมสอดคล้องกับเวลาที่ครูระบุ
- detail ต้องเขียนแบบ "ครูสอนตามนี้ได้เลย" (มีคำสั่ง คำถาม กิจกรรมชัดเจน)`;

const SYS_ASSESSMENTS_FULL = `คุณคือผู้ช่วยครูไทย ออกแบบ "ระบบการวัดและประเมินผล" สำหรับแผนการสอนทั้งแผน

หน้าที่: วิเคราะห์ข้อมูลแผน (หัวข้อ, จุดประสงค์ K/P/A, ทักษะ 3R/8C, รูปแบบการเรียนรู้, กิจกรรม 5 ขั้น, ภาระชิ้นงาน) แล้ว:
1. เลือกประเภทแบบประเมินที่เหมาะที่สุดจาก preset list ด้านล่าง
2. กำหนดเกณฑ์ผ่าน (criteria) สำหรับแต่ละรายการ

Preset list (เลือก rubric_key ที่ตรงกับลักษณะกิจกรรม):
- listening — แบบประเมินการฟัง (เหมาะกับกิจกรรมฟังเสียง/วิดีโอ)
- speaking — แบบประเมินการพูด (role-play, dialogue, presentation)
- reading — แบบประเมินการอ่าน (อ่านบทความ/ข้อความ)
- writing — แบบประเมินการเขียน (เขียนประโยค/ย่อหน้า/บทความ)
- behavior — แบบสังเกตพฤติกรรมรายบุคคล (การมีส่วนร่วมในชั้นเรียน)
- work — แบบประเมินชิ้นงาน (โปสเตอร์, infographic, รายงาน)
- desired — แบบประเมินคุณลักษณะอันพึงประสงค์ (วินัย, ใฝ่เรียนรู้)
- competency — แบบประเมินสมรรถนะผู้เรียน (5 สมรรถนะหลัก)

รูปแบบ JSON เท่านั้น:
{
  "items": [
    { "rubric_key": "speaking", "criteria": "ได้คะแนน 60% ขึ้นไป จากคะแนนเต็ม 16 คะแนน (10 คะแนนขึ้นไป)" },
    { "rubric_key": "work", "criteria": "ได้ระดับดี (3) ขึ้นไป จาก 4 ระดับ" },
    { "what": "การร่วมกิจกรรมกลุ่ม", "how": "สังเกตในชั้นเรียน", "criteria": "เข้าร่วมและให้ความร่วมมืออย่างน้อย 80% ของกิจกรรม" }
  ]
}

ข้อกำหนด:
- เลือก 3-5 รายการให้ครอบคลุมทั้ง K (ความรู้), P (ทักษะ/กระบวนการ), A (เจตคติ/คุณลักษณะ)
- ต้อง map กับลักษณะกิจกรรมจริง: role-play → speaking; เขียนงาน → writing+work; งานกลุ่ม → behavior+desired
- ใช้ rubric_key จาก preset เป็นหลัก; รายการ custom { what, how, criteria } เพิ่มได้ถ้าจำเป็น (ไม่เกิน 2 รายการ)
- criteria ต้องชัดเจน วัดได้ ระบุเป็นเปอร์เซ็นต์/ระดับ/คะแนนได้
- เรียงรายการสำคัญสุด (ใช้ประเมินจุดประสงค์หลัก) ขึ้นก่อน
- ภาษาไทยทางการ`;

const SYS_PASSING = `คุณคือผู้ช่วยครูไทย กำหนดเกณฑ์ผ่านสำหรับแต่ละแบบประเมิน

หน้าที่: เขียนเกณฑ์ผ่านที่ครูใช้ตัดสินว่านักเรียนผ่านหรือไม่ผ่านในแต่ละรายการประเมิน

รูปแบบ JSON (ต้องมีจำนวนรายการเท่ากับที่ครูส่งมา):
{
  "criteria": [
    "เกณฑ์ผ่านสำหรับรายการที่ 1 (เช่น ได้คะแนน 60% ขึ้นไป จากคะแนนเต็ม 16 = 10 คะแนนขึ้นไป)",
    "เกณฑ์ผ่านสำหรับรายการที่ 2"
  ]
}

ข้อกำหนด:
- เขียนแบบสั้นชัดเจน 1 บรรทัด/รายการ
- ระบุเกณฑ์เป็นเปอร์เซ็นต์หรือคะแนนที่จับต้องได้
- เหมาะสมกับประเภทของการประเมิน (เช่น แบบประเมินการพูดต่างจากแบบประเมินคุณลักษณะ)
- เรียงลำดับตรงกับที่ครูส่งมา`;

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
  // Extract style + ai_session — they alter the system prompt, not the data Claude reads
  const { style, ai_session, ...cleanPayload } = payload || {};

  // Re-inject ai_session if it has content (Claude reads it from payload JSON)
  const finalPayload = (ai_session && Object.keys(ai_session).length)
    ? { ...cleanPayload, ai_session }
    : cleanPayload;

  // System blocks: [0] frozen prompt (cacheable) + optional non-cached blocks
  const systemBlocks = [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
  ];
  if (ai_session && Object.keys(ai_session).length) {
    systemBlocks.push({ type: 'text', text: COHERENCE_INSTRUCTION });
  }
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

export function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}
