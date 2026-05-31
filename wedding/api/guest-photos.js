const { parseMultipart } = require('../lib/multipart');
const { uploadPhoto, listPhotos } = require('../lib/blob');
const { redis } = require('../lib/store');

const RATE_LIMIT = 5;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function checkRateLimit(ip) {
  const key = `rate:${ip}:${Math.floor(Date.now() / 3600000)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);
  return count <= RATE_LIMIT;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const photos = await listPhotos('guest');
    return res.status(200).json(photos);
  }

  if (req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    const allowed = await checkRateLimit(ip);
    if (!allowed) return res.status(429).json({ error: 'กรุณารอสักครู่แล้วลองใหม่อีกครั้ง' });

    const { files } = await parseMultipart(req);
    if (!files.length) return res.status(400).json({ error: 'No file uploaded' });

    const file = files[0];
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    if (file.buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'ไฟล์ใหญ่เกิน 10MB' });
    }

    const ext = file.mimetype.split('/')[1].replace('jpeg', 'jpg');
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const url = await uploadPhoto('guest', filename, file.buffer, file.mimetype);

    return res.status(201).json({ url, filename });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
