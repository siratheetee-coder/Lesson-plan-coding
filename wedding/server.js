const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'wedding2025';

const DATA_FILE = path.join(__dirname, 'data', 'registrations.json');
const LIKES_FILE = path.join(__dirname, 'data', 'likes.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
if (!fs.existsSync(LIKES_FILE)) fs.writeFileSync(LIKES_FILE, '{}', 'utf8');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

function readRegistrations() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeRegistrations(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function readLikes() {
  try {
    return JSON.parse(fs.readFileSync(LIKES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeLikes(data) {
  fs.writeFileSync(LIKES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

app.post('/api/register', (req, res) => {
  const { name, phone, guests, food, foodNote, message } = req.body;
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อ-นามสกุล' });
  }
  const registrations = readRegistrations();
  const entry = {
    id: randomUUID(),
    name: name.trim(),
    phone: (phone || '').trim(),
    guests: parseInt(guests) || 0,
    food: Array.isArray(food) ? food : [food].filter(Boolean),
    foodNote: (foodNote || '').trim(),
    message: (message || '').trim(),
    createdAt: new Date().toISOString(),
  };
  registrations.push(entry);
  writeRegistrations(registrations);
  res.json({ success: true, id: entry.id });
});

app.get('/api/registrations', (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const registrations = readRegistrations();
  const totalGuests = registrations.reduce((sum, r) => sum + r.guests + 1, 0);
  res.json({ registrations, totalGuests, count: registrations.length });
});

app.delete('/api/registrations/:id', (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const registrations = readRegistrations().filter(r => r.id !== req.params.id);
  writeRegistrations(registrations);
  res.json({ success: true });
});

app.post('/api/photos', upload.array('photos', 50), (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) {
    req.files?.forEach(f => fs.unlinkSync(f.path));
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const uploaded = (req.files || []).map(f => `/uploads/${f.filename}`);
  res.json({ success: true, files: uploaded });
});

app.get('/api/photos', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR)
      .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
      .sort((a, b) => {
        const ta = fs.statSync(path.join(UPLOADS_DIR, a)).mtimeMs;
        const tb = fs.statSync(path.join(UPLOADS_DIR, b)).mtimeMs;
        return tb - ta;
      })
      .map(f => `/uploads/${f}`);
    const likes = readLikes();
    res.json({ photos: files, likes });
  } catch {
    res.json({ photos: [], likes: {} });
  }
});

// Toggle a like for a photo. Body: { filename, action: 'like' | 'unlike' }
app.post('/api/likes', (req, res) => {
  const { filename, action } = req.body;
  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'filename required' });
  }
  const key = path.basename(filename);
  if (!/\.(jpg|jpeg|png|webp|gif)$/i.test(key) || !fs.existsSync(path.join(UPLOADS_DIR, key))) {
    return res.status(404).json({ error: 'photo not found' });
  }
  const likes = readLikes();
  const current = likes[key] || 0;
  likes[key] = action === 'unlike' ? Math.max(0, current - 1) : current + 1;
  writeLikes(likes);
  res.json({ success: true, count: likes[key] });
});

app.delete('/api/photos/:filename', (req, res) => {
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const filepath = path.join(UPLOADS_DIR, req.params.filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  const likes = readLikes();
  if (likes[req.params.filename] !== undefined) {
    delete likes[req.params.filename];
    writeLikes(likes);
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Wedding registration server running at http://localhost:${PORT}`);
  console.log(`Admin secret: ${ADMIN_SECRET}`);
});
