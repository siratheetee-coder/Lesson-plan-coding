const { incrLike } = require('../lib/store');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { key, delta } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });

  const d = delta === -1 ? -1 : 1;
  const next = await incrLike(key, d);
  res.status(200).json({ key, count: next });
};
