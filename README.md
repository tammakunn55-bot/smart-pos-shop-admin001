# Smart POS — Clean Supabase Edition

ชุดนี้เป็น Static Web App สำหรับ GitHub Pages โดยใช้ Supabase เป็นระบบ Auth, Database และ Storage

## จุดสำคัญของรุ่นนี้

- Owner สมัครครั้งแรกด้วย **ชื่อร้าน + Email + Password** ผ่าน Supabase Auth
- ไม่ใช้ `owner01`, `internalEmail` หรือ Local Password เป็นบัญชี Owner หลัก
- Supabase Session ถูกเก็บตามระบบ Auth ของ Supabase (`persistSession` + `autoRefreshToken`)
- เมื่อเปิดเว็บครั้งต่อไป หาก Session ยังใช้ได้ ระบบจะ restore ร้านและเข้า POS โดยไม่ถาม Password ซ้ำ
- Logout จะ `signOut()` และกลับหน้า Login
- Project URL และ Publishable/anon key กรอกตอน Runtime ไม่ฝังค่าร้านจริงไว้ใน Repository
- ห้ามใช้ `service_role` หรือ `sb_secret` ใน Browser
- ระบบใช้ RLS แยกข้อมูลตาม `owner_id`
- Product images และ documents อยู่ใน Private Storage
- ระบบนำเข้ารูปแบบชุดยังรองรับ `image_mapping.json` + รูปหลายไฟล์
- ไม่มีปุ่ม “บันทึกและเชื่อมต่อโปรเจกต์นี้” หรือ “บังคับซิงค์ตอนนี้” ในหน้าตั้งค่าแล้ว การเชื่อมต่อทำอัตโนมัติจาก Auth Session

## โครงสร้าง

```text
smart-pos/
├── index.html
├── .gitignore
├── README.md
├── AUDIT_REPORT_TH.md
├── scripts/
│   └── preflight_security.py
├── js/
│   ├── 00-error-overlay.js
│   ├── 00-failsafe.js
│   ├── 01-core.js
│   ├── 02-sales-stock.js
│   ├── 03-admin-backup.js
│   ├── 04-supabase.js
│   ├── 05-transaction-monitoring.js
│   ├── 10-product-code.js
│   ├── 11-image-cleanup.js
│   ├── 12-gestures.js
│   ├── 13-bulk-image-import.js
│   └── 14-documents.js
└── sql/
    └── 001_fresh_install.sql
```

## ติดตั้ง Supabase ใหม่

1. สร้าง Supabase Project ใหม่
2. ตั้ง Security ตามนี้
   - **Enable Data API: ON**
   - **Automatically expose new tables: OFF**
   - **Enable automatic RLS: ON**
3. เปิด SQL Editor
4. รัน `sql/001_fresh_install.sql` ทั้งไฟล์ครั้งเดียว
5. ตั้งค่า Auth Email ตามนโยบายของร้าน
6. ถ้าต้องการทดสอบให้สมัครและเข้าใช้งานทันที สามารถปิด Confirm email ชั่วคราว หรือยืนยันอีเมลก่อน Login

## สร้างร้านครั้งแรก

เปิด `index.html` แล้วกรอก:

- ชื่อร้าน
- Email เจ้าของร้าน
- Supabase Project URL
- Supabase Publishable/anon key
- Password
- ยืนยัน Password

จากนั้นระบบทำ:

```text
Supabase Auth signUp
        ↓
auth.users
        ↓
create_pos_account()
        ↓
app_accounts
        ↓
pos_state
        ↓
บันทึก Session
        ↓
เข้า Smart POS
```

Password ไม่ถูกบันทึกลง Local Storage หรือ source code

## การเข้าใช้งานครั้งต่อไป

```text
เปิดเว็บ
  ↓
Supabase getSession()
  ↓
มี Session?
  ├─ ใช่ → ดึง app_accounts + pos_state → เข้า POS
  └─ ไม่ใช่ → หน้า Login → Email + Password → เข้า POS
```

## Logout

Logout จะเรียก Supabase Auth `signOut()` และล้างเฉพาะสถานะ Session ในเครื่อง ไม่ลบข้อมูลร้านในฐานข้อมูล

## ตรวจความปลอดภัยก่อน Commit

รันจากโฟลเดอร์ Repository:

```bash
python scripts/preflight_security.py
```

ต้องได้:

```text
SECURITY PREFLIGHT: PASS
```

ห้าม Commit:

- `.env`
- `service_role`
- `sb_secret`
- database password
- private key / certificate
- GitHub token
- password ของเจ้าของร้าน
- ข้อมูลลูกค้าจริง
- ข้อมูลยอดขายจริง
- database dump / backup
- รูปหรือเอกสารส่วนตัวของร้าน

## GitHub Pages

Repository สามารถเป็น Static Site ได้ ไม่ต้องมี Node build ขั้นตอนนี้

ตั้ง GitHub Pages เป็น:

```text
Branch: main
Folder: / (root)
```

## หลักความปลอดภัย

GitHub เก็บ **โปรแกรมและ SQL schema**

Supabase เก็บ **Auth และข้อมูลจริงของร้าน**

Browser ใช้เฉพาะ Publishable/anon key + Auth Session และให้ Postgres RLS เป็นตัวควบคุมสิทธิ์ข้อมูล
