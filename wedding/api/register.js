const { getRegistrations, setRegistrations, redis } = require('../lib/store');

const RATE_LIMIT = 5;

async function checkRateLimit(ip) {
  const key = `rate:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);
  return count <= RATE_LIMIT;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const allowed = await checkRateLimit(ip);
  if (!allowed) return res.status(429).json({ error: 'กรุณารอสักครู่แล้วลองใหม่อีกครั้ง' });

  const { name, phone, email, guests, food, foodNote, message } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อ-นามสกุล' });
  }

  const registrations = await getRegistrations();

  if (phone && phone.trim()) {
    const normalized = phone.replace(/\D/g, '');
    const dup = registrations.find(r => r.phone && r.phone.replace(/\D/g, '') === normalized);
    if (dup) {
      return res.status(409).json({ error: 'เบอร์โทรนี้ได้ลงทะเบียนไว้แล้ว' });
    }
  }

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    phone: phone?.trim() || '',
    email: email?.trim() || '',
    guests: Number(guests) || 0,
    food: Array.isArray(food) ? food : (food ? [food] : []),
    foodNote: foodNote?.trim() || '',
    message: message?.trim() || '',
    createdAt: new Date().toISOString(),
  };

  registrations.push(entry);
  await setRegistrations(registrations);

  res.status(201).json({ success: true, id: entry.id });
};
