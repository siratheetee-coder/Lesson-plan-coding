# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An AI-powered Thai school lesson plan generator. Thai teachers fill in a multi-step wizard form, use Claude AI to generate lesson content (objectives, concept, activities, etc.), then export a formatted `.docx` file. Credits are charged only on export, not on AI generation.

## Running the Project

### Backend (required for auth, AI, and data persistence)

```bash
cd server
npm install       # first time only
npm start         # production mode
npm run dev       # dev mode with auto-restart (Node 18+ --watch)
```

Server starts at `http://localhost:3000`. Test with: `curl http://localhost:3000/health`

On first run with no `.env`, secrets are auto-generated from `.env.example`. The only required manual steps are adding `ANTHROPIC_API_KEY` and optionally `GOOGLE_CLIENT_ID`.

### Frontend

Open `index.html` via VS Code Live Server at `http://localhost:5500`. The `APP_ORIGIN` in `server/.env` must match this origin exactly for CORS to work (default example sets `APP_ORIGIN=http://localhost:5500`).

### No build step — no bundler, no transpilation, no test runner.

Scripts in `server/scripts/` are manual one-off utilities (template building, render tests) run directly with `node`.

## Environment Variables

All vars are in `server/.env` (copied from `server/.env.example`). Key ones:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required for any AI generation |
| `DATABASE_URL` | PostgreSQL URL → enables Postgres mode; absent = JSON file mode |
| `DB_PATH` | JSON file path for local dev (default `./data/app.db.json`) |
| `APP_ORIGIN` | Frontend origin for CORS (e.g. `http://localhost:5500`) |
| `GOOGLE_CLIENT_ID` | Enables Google Sign-In |
| `ADMIN_EMAILS` | Comma-separated emails that become admin on first login |
| `OMISE_SECRET_KEY` | Payment processing; absent = manual top-up mode |
| `SLIPOK_API_KEY` + `SLIPOK_BRANCH_ID` | Auto-verifies PromptPay slips |
| `RESEND_API_KEY` | Email sending (preferred for Render deployment) |

## Architecture

### Two-tier: vanilla JS frontend + Node.js/Express backend

**Frontend** — `index.html` (~13,700 lines, single file):
- No framework, no bundler. All JavaScript is inline.
- CDN dependencies: `PizZip` (zip/docx manipulation) and `FileSaver.js` loaded from jsDelivr; Google Sign-In from `accounts.google.com/gsi/client`.
- The lesson plan DOCX template is embedded as a base64 string (`TEMPLATE_B64` constant at line ~4725) and manipulated in-browser using `PizZip` + raw XML string replacement.
- `window.AUTH_API_BASE` overrides the API base URL (defaults to same origin). `window.AUTH_DISABLED = true` bypasses the login wall. `window.GOOGLE_CLIENT_ID` enables Google Sign-In.
- Data flow: localStorage is the primary cache (drafts, history, units), synced to server when authenticated. The frontend calls `window.authFetch` (defined in the auth script block) for all authenticated API calls — it handles token refresh automatically.

**Backend** — `server/` (Node.js ESM):
- `server/server.js` — entry point; bootstraps `.env`, initializes DB, mounts all routers, serves the frontend from the project root as static files.
- `server/db.js` — unified DB adapter. If `DATABASE_URL` is set, uses PostgreSQL (`pg` pool). Otherwise, uses a JSON file. Both expose the same async API (`db.listLessons`, `db.upsertLesson`, etc.) so routes are database-agnostic.
- `server/config/packages.js` — credit package definitions and AI cost constants (currently all AI = 0 credits; lesson export = 1 credit; worksheet export = 0.5 credits).

### Route map

| Mount | Router file | Notes |
|---|---|---|
| `/auth` | `routes/auth.js` | Register, login, Google, refresh, logout, change-password, email verify, forgot/reset password |
| `/admin/api` | `routes/admin.js` | User management (admin-only) |
| `/api/credits` | `routes/credits.js` | Balance, history, top-up (PromptPay QR + Omise + SlipOK slip verify) |
| `/api/ai` | `routes/ai.js` | All Claude AI generators (free) |
| `/api/lessons` | `routes/lessons.js` | Lesson plan CRUD |
| `/api/units` | `routes/units.js` | Teaching unit CRUD |
| `/api/feedback` | `routes/feedback.js` | User feedback submission |
| `/api/course-structure` | `routes/courseStructure.js` | Aggregates units → course structure doc (HTML preview + DOCX) |
| `/api/worksheets` | `routes/worksheets.js` | Scan lesson → generate worksheet JSON → export DOCX |

### Auth pattern

JWT access token (15-minute TTL) sent as `Bearer` in `Authorization` header. Refresh token stored in `httpOnly + SameSite=Strict` cookie (7d or 30d). `requireAuth` middleware at `server/middleware/auth.js` validates the access token and attaches `req.user = { id, email, role }`. `requireAdmin` extends this with a role check.

### AI integration (`server/utils/claude.js`)

Uses `claude-haiku-4-5` with prompt caching on frozen Thai system prompts. Each generator function returns structured JSON. The system prompt for each generator type is a module-level constant (not built at runtime) so it is eligible for Anthropic's prompt cache.

The `handleAi()` function in `routes/ai.js` is the generic handler for all AI endpoints:
- Cost = 0 → call Claude directly, no credit ledger entry.
- Cost > 0 → deduct credits first, call Claude, refund on failure (idempotent via `idempotency_key`).
- Heavy endpoints (unit outline) go through a `Semaphore` (`server/utils/concurrency.js`) to cap concurrent Claude calls.

### DOCX generation (two approaches)

1. **Lesson plan export** (frontend-only): `PizZip` decodes `TEMPLATE_B64`, replaces XML placeholders via string search/replace, re-encodes, downloads with `FileSaver.js`. Font is `TH SarabunPSK`.
2. **Worksheet export** (server-side): `server/utils/worksheetDocx.js` builds DOCX programmatically using the `docx` npm library. Supports 8 section types (matching, fill_blank, mcq, true_false, short_answer, writing, reordering, reading). Charged at 0.5 credits, idempotent by `(lesson_id, worksheetNo)`.
3. **Course structure export** (server-side): `server/utils/courseStructure.js` aggregates units/lessons and renders using the `docx` library.

### Rate limiting (`server/utils/limiters.js`)

All presets are in one file. Tiers: `strict` (5/15min) → `auth` (20/15min) → `register` (10/1h) → `email` (5/15min) → `ai` (15/min) → `write` (60/min) → `read` (200/min) → `global` (300/min, applied at app level to all routes). Rate-limit hits are written to the audit log.

## Deployment (Render.com)

See `DEPLOY.md` for step-by-step instructions. Key points:
- Root directory: `server` (Express serves both API + static frontend).
- Environment variables to set: `NODE_ENV=production`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL` (internal Render PostgreSQL URL), `ANTHROPIC_API_KEY`.
- Every `git push` to `main` triggers auto-deploy.
- Local dev still works without `DATABASE_URL` (falls back to JSON file).

## Key Conventions

- **IDs are client-generated** (UUID) for lessons and units; the server does an upsert on `POST`/`PUT`.
- **All data is user-scoped** — every DB query filters by `req.user.id`. There is no shared state between users except admin views.
- **Audit logging** is fire-and-forget via `audit()` from `server/utils/audit.js`. Use the `ACTIONS` constants (not raw strings) to keep action names consistent.
- **Thai language throughout** — user-facing strings in routes and frontend are in Thai. Error codes returned to the frontend are English machine-readable strings (e.g. `claude_not_configured`, `insufficient_credits`).
- **The `server/server` subdirectory** is a nested duplicate of the server (an old artifact). Ignore it; the active server is `server/` at the top level.
- **`_conflict_backup/`** — git conflict artifacts, not active code.
