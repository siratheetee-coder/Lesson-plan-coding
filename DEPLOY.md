# Deploy บน Render (Backend + PostgreSQL)

## ภาพรวม

```
[Render Web Service]     [Render PostgreSQL]
  Express server    ───►   Database (ถาวร)
  + Frontend static
```

คำสั่งเดียว ได้ทั้ง backend + frontend + database — ฟรีทุกอย่าง

---

## ขั้นที่ 1: Push code ขึ้น GitHub

1. ไปที่ https://github.com/new → สร้าง repo ใหม่ (private หรือ public)
2. เปิด PowerShell ที่ root โปรเจกต์:

```powershell
cd "C:\Users\Lenovo_\Desktop\Cowork (Website)\AI Website Lesson Generator"
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

> **.gitignore** จะกัน `.env` และ `node_modules/` ไม่ให้ขึ้น GitHub

---

## ขั้นที่ 2: สร้าง PostgreSQL บน Render

1. ไปที่ https://render.com → Login ด้วย GitHub
2. กด **New → PostgreSQL**
3. ตั้งค่า:
   - **Name:** `lesson-plan-db` (ตั้งชื่ออะไรก็ได้)
   - **Region:** Singapore (ใกล้ไทยที่สุด)
   - **Plan:** Free
4. กด **Create Database**
5. รอ 1-2 นาที → copy **Internal Database URL**
   (หน้าตาเช่น: `postgresql://user:pass@host/dbname`)

---

## ขั้นที่ 3: สร้าง Web Service บน Render

1. กด **New → Web Service**
2. Connect GitHub → เลือก repo ที่เพิ่ง push
3. ตั้งค่า:

| Field | ค่า |
|---|---|
| **Name** | `lesson-plan-app` |
| **Region** | Singapore |
| **Branch** | main |
| **Root Directory** | `server` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Plan** | Free |

4. กด **Add Environment Variable** ใส่ทั้ง 3 ค่า:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_ACCESS_SECRET` | (รันคำสั่งด้านล่างได้ค่า) |
| `JWT_REFRESH_SECRET` | (รันอีกครั้งได้ค่าใหม่) |
| `DATABASE_URL` | (paste Internal Database URL จาก ขั้นที่ 2) |

**สร้าง JWT secrets:**
```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
รัน 2 ครั้ง → ได้ 2 ค่า → ใส่แต่ละ key

5. กด **Create Web Service**
6. รอ 3-5 นาทีให้ deploy เสร็จ

---

## ขั้นที่ 4: ทดสอบ

เปิดเบราว์เซอร์:
```
https://lesson-plan-app.onrender.com/health
```
ต้องเห็น: `{"ok":true,"time":...}`

แล้วเปิด:
```
https://lesson-plan-app.onrender.com
```
จะเห็นหน้า Login → กดสมัครสมาชิก → ใช้งานได้

---

## ขั้นที่ 5 (ถ้ามี): เพิ่ม Google Login

1. ไปที่ https://console.cloud.google.com/apis/credentials
2. Create → OAuth 2.0 Client ID → Web application
3. **Authorized JavaScript origins:** `https://lesson-plan-app.onrender.com`
4. เพิ่ม env var ใน Render:
   - `GOOGLE_CLIENT_ID` = client ID ที่ได้

---

## ข้อสังเกต Free Tier

| เรื่อง | รายละเอียด |
|---|---|
| **Sleep หลัง 15 นาที** | Request แรกช้า ~30 วินาที (Render spin up ใหม่) |
| **PostgreSQL ฟรี 90 วัน** | หลังจากนั้น $7/เดือน หรือย้ายไป Supabase (ฟรีถาวร) |
| **Web Service ฟรี** | 750 ชั่วโมง/เดือน (เพียงพอสำหรับ 1 app) |

---

## Auto-deploy

ทุกครั้งที่ `git push` → Render จะ deploy ใหม่อัตโนมัติ

```powershell
git add .
git commit -m "update something"
git push
```

---

## ทดสอบ local ยังทำได้ปกติ

```powershell
cd server
npm start
```
จะใช้ JSON file แทน PostgreSQL อัตโนมัติ (ถ้าไม่มี `DATABASE_URL` ใน `.env`)
