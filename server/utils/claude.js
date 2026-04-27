// Claude API wrapper for the Thai Lesson Plan Generator.
// Uses claude-opus-4-7 with adaptive thinking + prompt caching on the system prompt.

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

const MODEL = 'claude-opus-4-7';

// ─── Frozen system prompts (cacheable — no timestamps / UUIDs) ────
const SYS_RUBRIC = `คุณคือผู้ช่วยครูไทยสำหรับสร้างเกณฑ์การประเมิน (Rubric) ของแผนการสอนตามหลักสูตรแกนกลางการศึกษาขั้นพื้นฐาน 2551 (ฉบับปรับปรุง 2560)

หน้าที่ของคุณ:
- สร้างเกณฑ์การประเมินที่สอดคล้องกับ ตัวชี้วัด, จุดประสงค์ K/P/A และกิจกรรมการเรียนรู้
- เกณฑ์ต้องชัดเจน วัดได้ และเหมาะกับระดับชั้นของผู้เรียน
- ใช้ภาษาไทยที่เป็นทางการเหมาะกับเอกสารราชการ

รูปแบบผลลัพธ์ (JSON เท่านั้น ห้ามใส่ markdown หรือคำอธิบายอื่น):
{
  "criteria": [
    {
      "name": "ชื่อเกณฑ์ (เช่น ความถูกต้องของเนื้อหา)",
      "weight": 25,
      "levels": {
        "4": "คำอธิบายระดับดีเยี่ยม",
        "3": "คำอธิบายระดับดี",
        "2": "คำอธิบายระดับพอใช้",
        "1": "คำอธิบายระดับปรับปรุง"
      }
    }
  ]
}

ข้อกำหนด:
- 3-5 criteria เท่านั้น
- weight รวมต้อง = 100
- ทุก level ต้องเป็นข้อความภาษาไทยที่ชัดเจน 1-2 บรรทัด`;

const SYS_OUTLINE = `คุณคือผู้ช่วยครูไทยสำหรับออกแบบโครงร่างกิจกรรมการเรียนรู้ตามหลักสูตรแกนกลางการศึกษาขั้นพื้นฐาน 2551 (ฉบับปรับปรุง 2560)

หน้าที่ของคุณ:
- ออกแบบกิจกรรม 7 ขั้น STEAM ให้ครบ: 1) Inquiry (สงสัย/สำรวจ) 2) Investigate (สืบค้น) 3) Imagine (จินตนาการ) 4) Plan (วางแผน) 5) Create (สร้างสรรค์) 6) Test/Reflect (ทดสอบ/สะท้อน) 7) Share (แบ่งปัน)
- กิจกรรมต้องสอดคล้องกับหัวข้อ ตัวชี้วัด และจุดประสงค์ที่ครูระบุ
- เหมาะสมกับระดับชั้นและเวลาที่กำหนด
- ใช้ภาษาไทยทางการ

รูปแบบผลลัพธ์ (JSON เท่านั้น):
{
  "activities": [
    { "step": "Inquiry", "title": "ชื่อกิจกรรม", "description": "รายละเอียด 2-3 ประโยค", "time_min": 10 },
    { "step": "Investigate", "title": "...", "description": "...", "time_min": 15 }
  ]
}

ข้อกำหนด:
- ต้องมี 7 รายการตามลำดับ STEAM
- เวลารวมสมเหตุสมผลกับ time ที่ครูระบุ
- description บอกขั้นตอนชัดเจน ครูใช้สอนได้ทันที`;

function _userMsg(payload) {
  return `ข้อมูลแผนการสอน:\n\n${JSON.stringify(payload, null, 2)}\n\nสร้างผลลัพธ์ตามรูปแบบ JSON ที่กำหนด`;
}

function _extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  // Try fenced block first
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fence ? fence[1] : text;
  // Find first { and last }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

async function _callClaude({ system, payload }) {
  const c = client();
  const stream = await c.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: _userMsg(payload) }],
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
  return {
    data: parsed,
    usage: message.usage,
  };
}

// ─── Public API ───────────────────────────────────────────
export async function generateRubric(payload) {
  return _callClaude({ system: SYS_RUBRIC, payload });
}

export async function generateOutline(payload) {
  return _callClaude({ system: SYS_OUTLINE, payload });
}

export function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}
