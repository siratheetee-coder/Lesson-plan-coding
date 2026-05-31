const { deletePhotoByFilename } = require('../../lib/blob');

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'wedding2025';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { filename } = req.query;
  const deleted = await deletePhotoByFilename('admin', filename);

  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.status(200).json({ success: true });
};
