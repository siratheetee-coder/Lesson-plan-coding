const { parseMultipart } = require('../lib/multipart');
const { uploadPhoto, listPhotos } = require('../lib/blob');

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'wedding2025';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const photos = await listPhotos('admin');
    return res.status(200).json(photos);
  }

  if (req.method === 'POST') {
    if (req.query.secret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { files } = await parseMultipart(req);
    if (!files.length) return res.status(400).json({ error: 'No file uploaded' });

    const file = files[0];
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    const ext = file.mimetype.split('/')[1].replace('jpeg', 'jpg');
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const url = await uploadPhoto('admin', filename, file.buffer, file.mimetype);

    return res.status(201).json({ url, filename });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
