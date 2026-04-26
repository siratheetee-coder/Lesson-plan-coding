# Lesson Plan Generator — Auth Backend

ระบบ login สำหรับเว็บแผนการสอน รองรับ:
- ✅ Email + Password (bcrypt, salt rounds 12)
- ✅ จดจำการเข้าสู่ระบบ (refresh token 7d ปกติ / 30d เมื่อติ๊ก remember)
- ✅ Google Sign-In (Google Identity Services)
- ✅ Account lockout (5 ครั้งผิด → ล็อก 15 นาที)
- ✅ Rate limiting (10 login/15min/IP)
- ✅ Refresh token rotation + theft detection
- ✅ Audit log

---

## 1. ติดตั้ง

```bash
cd server
npm install
cp .env.example .env
```

แก้ไข `.env`:
```bash
# สร้าง JWT secret ด้วยคำสั่งนี้ 2 ครั้ง (ได้ 2 ค่าที่ต่างกัน)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

นำค่าที่ได้ไปใส่ `JWT_ACCESS_SECRET` และ `JWT_REFRESH_SECRET`

---

## 2. ตั้งค่า Google Login (ทางเลือก)

1. ไปที่ https://console.cloud.google.com/apis/credentials
2. **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. **Authorized JavaScript origins:** ใส่ origin ของหน้าเว็บ เช่น `http://localhost:5500`
5. คัดลอก **Client ID** มาใส่ใน `.env` ที่ `GOOGLE_CLIENT_ID=...`
6. ใน `index.html` ก่อน `<script>` ของ auth client ใส่:
   ```html
   <script>
     window.AUTH_API_BASE = 'http://localhost:3000';
     window.GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
   </script>
   ```

---

## 3. รัน

```bash
npm start         # production
npm run dev       # auto-restart on change (Node 18+)
```

เซิร์ฟเวอร์รันที่ `http://localhost:3000`

ทดสอบ: `curl http://localhost:3000/health`

---

## 4. Frontend

เปิด `index.html` ผ่าน Live Server (VSCode) ที่ `http://localhost:5500`
(ค่า `APP_ORIGIN` ใน `.env` ต้องตรงกับ origin ของหน้าเว็บ ไม่งั้น CORS จะปฏิเสธ)

หน้า login จะปรากฏอัตโนมัติเมื่อโหลดหน้าเว็บถ้ายังไม่ได้ login

---

## 5. ความปลอดภัยที่ใช้

| ภัยคุกคาม | การป้องกัน |
|---|---|
| Plain-text password | bcrypt salt 12 |
| Brute force | rate limit + lockout |
| User enumeration | error message เหมือนกัน + dummy bcrypt compare |
| XSS ขโมย token | refresh token = httpOnly + Secure cookie |
| CSRF | SameSite=Strict cookie |
| SQL injection | parameterized queries (better-sqlite3) |
| Token theft | refresh token rotation + revoke-all on mismatch |
| Timing attack | bcrypt compare ทุกครั้งแม้ user ไม่มีจริง |

---

## 6. Endpoints

```
POST /auth/register            { email, password, displayName?, remember? }
POST /auth/login               { email, password, remember? }
POST /auth/google              { credential, remember? }   # Google ID token
POST /auth/refresh             (cookie)
POST /auth/logout              (cookie)
GET  /auth/me                  (Bearer token)
POST /auth/change-password     { oldPassword?, newPassword }
GET  /health
```

---

## 7. Database

- ใช้ SQLite (`data/app.db`) — zero config
- Schema สร้างอัตโนมัติเมื่อเปิดเซิร์ฟเวอร์ครั้งแรก
- Backup: คัดลอก `data/app.db` ไปเก็บ
- ถ้าจะย้ายไป PostgreSQL ภายหลัง: เปลี่ยน `db.js` และ migrate ข้อมูล

---

## 8. ขั้นต่อไป

- [ ] Forgot password (ต้องเชื่อม email service)
- [ ] เชื่อม `/lessons` endpoints (CRUD แผนการสอน)
- [ ] เชื่อม Claude API (`/ai/generate-rubric`, `/ai/generate-outline`)
- [ ] Deploy production (HTTPS + reverse proxy + DB backup)
