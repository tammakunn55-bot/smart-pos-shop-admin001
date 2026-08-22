# Smart POS V4 — Supabase First / GitHub Safe

ชุดนี้ออกแบบให้ Supabase Auth เป็นตัวตนหลักของระบบ และไม่ฝัง Secret หรือ Project key ลงใน source code

## ติดตั้งครั้งแรก
1. สร้าง Supabase Project ใหม่
2. เปิด SQL Editor และรัน `SMARTPOS_V4_SINGLE_RUN.sql` ทั้งไฟล์ครั้งเดียว
3. ตรวจ Authentication > Providers > Email
   - ถ้าปิด Confirm email: สร้างร้านแล้วเข้าใช้งานได้ทันที
   - ถ้าเปิด Confirm email: ยืนยันอีเมลก่อน แล้วกลับมา Login ระบบจะสร้างร้านที่ค้างไว้ให้อัตโนมัติ
4. นำ `index.html` และโฟลเดอร์ `js/` ขึ้น GitHub Pages
5. เปิดเว็บ → สร้างร้าน
6. กรอก ชื่อร้าน + อีเมลเจ้าของ + Supabase Project URL + Publishable/anon key + รหัสผ่าน
7. URL/key ที่กรอกจะเก็บเฉพาะใน browser runtime/localStorage ไม่อยู่ใน GitHub
8. ระบบจะ Supabase Auth → create_store → store_members(role=owner) → Dashboard

## การเข้าใช้งานครั้งต่อไป
Supabase Auth จะ persist/refresh session ใน browser; ถ้ายังมี session ให้เข้าใช้งานต่อโดยไม่ต้องพิมพ์รหัสผ่านซ้ำ
เมื่อ Logout/session หมดอายุ จึง Login ด้วยอีเมลและรหัสผ่านอีกครั้ง

## ความปลอดภัย
ห้ามใส่ service_role, sb_secret, database password, JWT secret หรือ private key ใน HTML/JS/Repository
Publishable/anon key หากใช้ใน browser ต้องถูกป้องกันด้วย RLS และไม่ใช่ Secret

ก่อน Commit ให้รัน:
`python scripts/preflight_security.py`

## ไฟล์ JS
ชุดนี้ใช้ไฟล์ที่มีอยู่จริงในโปรแกรม:
00-error-overlay.js
00-failsafe.js
01-core.js
02-sales-stock.js
03-admin-backup.js
04-supabase.js
05-transaction-monitoring.js
10-product-code.js
11-image-cleanup.js
12-gestures.js
13-bulk-image-import.js
14-documents.js
15-cost-control.js
17-v3-ui.js

ไม่มีการสร้างไฟล์ 07/08/09/16 ขึ้นมาเดาเอง เพราะไม่พบไฟล์เหล่านี้ใน source ที่ตรวจสอบ
