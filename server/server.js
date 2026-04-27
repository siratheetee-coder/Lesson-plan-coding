import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Auto-create .env with strong random secrets on first run (local dev only) ───
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath) && !process.env.DATABASE_URL) {
  const examplePath = path.join(__dirname, '.env.example');
  let content = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : '';
  const rand = () => crypto.randomBytes(64).toString('hex');
  content = content
    .replace(/^JWT_ACCESS_SECRET=.*$/m, `JWT_ACCESS_SECRET=${rand()}`)
    .replace(/^JWT_REFRESH_SECRET=.*$/m, `JWT_REFRESH_SECRET=${rand()}`);
  fs.writeFileSync(envPath, content);
  console.log('✓ Created .env with auto-generated JWT secrets');
}
await import('dotenv/config');

// ─── Init database before starting server ────────────────
const { initDb } = await import('./db.js');
await initDb();

const authRouter    = (await import('./routes/auth.js')).default;
const adminRouter   = (await import('./routes/admin.js')).default;
const creditsRouter = (await import('./routes/credits.js')).default;
const aiRouter      = (await import('./routes/ai.js')).default;
const lessonsRouter = (await import('./routes/lessons.js')).default;
const unitsRouter   = (await import('./routes/units.js')).default;
const { requireAuth } = await import('./middleware/auth.js');
const { limiters }   = await import('./utils/limiters.js');
const { pruneAuditLog, pruneEmailTokens } = await import('./utils/audit.js');

// ─── Retention cleanup on startup + every 24h ────────────
async function runRetention() {
  await pruneAuditLog(90);   // keep 90 days of audit log
  await pruneEmailTokens();  // remove expired/used email tokens
}
runRetention().catch(err => console.warn('[retention] startup run failed:', err));
setInterval(runRetention, 24 * 60 * 60 * 1000);

const app = express();
const PORT = process.env.PORT || 3000;
const ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;

app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = [ORIGIN, `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
    cb(null, allowed.includes(origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

// Global last-line-of-defense limiter (300 req/min per IP) applied to ALL
// API + auth routes. Per-route limiters (auth/email/ai/write/strict) are stricter
// and enforced inside each router, but this catches anything we forget.
app.use('/auth', limiters.global, authRouter);
app.use('/admin/api', limiters.global, adminRouter);
app.use('/api/credits', limiters.global, creditsRouter);
app.use('/api/ai', limiters.global, aiRouter);
app.use('/api/lessons', limiters.global, lessonsRouter);
app.use('/api/units', limiters.global, unitsRouter);
app.get('/api/whoami', limiters.global, requireAuth, (req, res) => res.json({ user: req.user }));

// Serve frontend from project root
const FRONTEND_DIR = path.resolve(__dirname, '..');
app.use(express.static(FRONTEND_DIR, { index: 'index.html', extensions: ['html'] }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(PORT, () => {
  const isProd = process.env.NODE_ENV === 'production';
  const url = isProd ? `https://<your-app>.onrender.com` : `http://localhost:${PORT}`;
  console.log('');
  console.log(`  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║  ✓ Server running                            ║`);
  console.log(`  ║  → ${url.padEnd(40)}║`);
  console.log(`  ╚══════════════════════════════════════════════╝`);
  console.log('');
  console.log(`  DB:           ${process.env.DATABASE_URL ? 'PostgreSQL ✓' : 'JSON file (local dev)'}`);
  console.log(`  Google login: ${process.env.GOOGLE_CLIENT_ID ? 'enabled ✓' : 'disabled'}`);
  console.log(`  Claude AI:    ${process.env.ANTHROPIC_API_KEY ? 'enabled ✓ (claude-haiku-4-5)' : 'disabled (set ANTHROPIC_API_KEY)'}`);
  console.log(`  SlipOK:       ${process.env.SLIPOK_API_KEY ? 'enabled ✓' : 'disabled'}`);
  console.log('');
});
