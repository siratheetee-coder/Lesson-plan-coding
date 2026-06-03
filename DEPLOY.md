# Deploy Guide — Neon (DB) + Koyeb (App)

Truly $0/month, always-on, no credit card needed. Replacement for Render free tier.

---

## 1. Backup Render Postgres

In Render Dashboard → your Postgres → **Connect** → copy External Database URL (looks like `postgresql://user:pass@host/db`).

On your local machine (needs `pg_dump` — install Postgres client or use Docker):

```bash
pg_dump "postgresql://YOUR_RENDER_URL" --no-owner --no-acl > backup.sql
```

If `pg_dump` not installed:
```bash
docker run --rm postgres:16 pg_dump "URL" > backup.sql
```

Verify backup is non-empty:
```bash
ls -lh backup.sql
head backup.sql
```

---

## 2. Set up Neon (free Postgres, 3 GB)

1. Sign up at **https://neon.tech** (Google login works)
2. Create project → name it `easy-eng-plan`
3. Region: pick closest to users (Asia Pacific Singapore = `aws-ap-southeast-1`)
4. Copy connection string from dashboard → looks like:
   ```
   postgresql://user:pass@ep-something-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
5. Restore backup:
   ```bash
   psql "NEON_URL" < backup.sql
   ```
6. Verify:
   ```bash
   psql "NEON_URL" -c "SELECT count(*) FROM users;"
   ```

---

## 3. Set up Koyeb (free app, 1 always-on nano)

1. Sign up at **https://app.koyeb.com** (GitHub login — no CC needed)
2. **Create Web Service**
3. Source: **GitHub** → select repo `siratheetee-coder/Lesson-plan-coding`
4. Branch: `main` · Build method: **Dockerfile**
5. Instance type: **Nano (free)**
6. Region: **Frankfurt** (or Singapore if available)
7. Port: `3000`
8. **Environment variables** (copy from Render dashboard):

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | Neon connection string from step 2 |
   | `JWT_ACCESS_SECRET` | (copy from Render) |
   | `JWT_REFRESH_SECRET` | (copy from Render) |
   | `JWT_ACCESS_TTL` | `15m` |
   | `JWT_REFRESH_TTL_SHORT` | `7d` |
   | `JWT_REFRESH_TTL_LONG` | `30d` |
   | `APP_ORIGIN` | `https://YOUR-APP.koyeb.app` (fill after first deploy) |
   | `GOOGLE_CLIENT_ID` | (your Google OAuth client) |
   | `ANTHROPIC_API_KEY` | (your Claude key) |
   | `ADMIN_EMAILS` | (admin emails) |
   | `RESEND_API_KEY` | (your Resend key) |
   | `SMTP_FROM` | (your sender) |
   | `SUPPORT_FB`, `SUPPORT_EMAIL`, etc. | (copy from Render) |
   | `NODE_ENV` | `production` |

9. Health check path: `/healthz`
10. Click **Deploy**

First build takes 3–5 min. Watch logs for `✓ Server running`.

---

## 4. Wire frontend

1. After Koyeb deploys, you get URL like `https://easy-eng-plan-yourname.koyeb.app`
2. Update env var `APP_ORIGIN` to this URL → triggers redeploy
3. **Google OAuth Console**: add the Koyeb URL to **Authorized JavaScript origins**
4. Test login, AI generation, DOCX export end-to-end

---

## 5. Custom domain (optional)

Koyeb supports free custom domains. Settings → Domains → add `easyengplan.com` → set CNAME at your DNS to `<app>.koyeb.app`.

---

## 6. Cleanup Render

Once Koyeb is verified working:
1. Render Dashboard → Web Service → **Suspend** (don't delete — keep 1 week as backup)
2. After 1 week of stable Koyeb: delete Render resources

---

## Notes

- **Koyeb nano**: 0.1 CPU, 256 MB RAM. Plenty for ~5 concurrent users.
- **Cold start**: <1 sec on Koyeb (Render free was 30 sec)
- **Egress**: 100 GB/mo free
- **Logs**: 7 days retention
- **Auto-deploy from GitHub**: enabled — every push to `main` redeploys

Issues? Check Koyeb service logs first. DB issues → Neon dashboard SQL editor.
