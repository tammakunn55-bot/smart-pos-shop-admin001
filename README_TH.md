# Smart POS V4 FULL — Fresh Project

**ชุดนี้เป็นโปรแกรมเต็ม** ไม่ใช่ demo app แบบย่อ

## Frontend ที่รวม
- `index.html`
- JS เต็ม 16 ไฟล์ที่ใช้จริงในชุดนี้
- ระบบสินค้า/สต็อก/ขาย/ซื้อ/ลูกค้า/Supplier/รายงาน/เอกสาร/ต้นทุน/เสียง/รูป/gestures
- Login/Session Supabase
- Owner/Store/สมาชิก/สิทธิ์
- นำเข้ารูปแบบเดิมด้วย `image_mapping.json` + เลือกรูปหลายไฟล์
- Preview/ตรวจจับคู่ก่อน Upload ใน importer ที่แก้แล้ว
- เอา Integrated Product Import รุ่นใหม่ออกแล้ว
- เอา Legacy Join และปุ่ม Force Sync ออกจากหน้าเริ่มต้น

## SQL
`SMARTPOS_V4_SINGLE_RUN.sql` เป็นไฟล์เดียวสำหรับ **Supabase Project ใหม่**

1. สร้าง Project ใหม่
2. SQL Editor → New query
3. วางไฟล์นี้ทั้งหมด
4. Run ครั้งเดียว
5. Authentication → Providers → Email เปิดใช้งาน
6. สำหรับการทดสอบ ปิด Confirm email ชั่วคราวได้

## สำคัญเรื่อง Frontend เดิม
`pos_state` ยังคงอยู่ใน schema เพื่อให้ Frontend เต็มเดิมทุกฟังก์ชันทำงานต่อได้ทันที แต่ V4 เพิ่ม canonical tables สำหรับ Store/Members/Inventory/Sales/Images/Audit และมี RPC สำหรับธุรกรรมใหม่

## Supabase key
ใช้เฉพาะ Project URL + publishable/anon key
**ห้ามใช้ service_role หรือ sb_secret ใน Browser/GitHub**

## ทดสอบตามลำดับ
1. สร้างบัญชี Owner
2. เชื่อม Project ใหม่
3. สร้างร้าน
4. เพิ่มสมาชิก/คนขาย
5. เพิ่มหมวดหมู่
6. เพิ่มสินค้า + SKU + Barcode + Stock ตั้งต้น 3
7. เพิ่มลูกค้า
8. เพิ่ม Supplier
9. ซื้อเข้า/รับสินค้า
10. เปิดกะ
11. ขายสินค้าและตรวจ Stock ลด
12. คืนสินค้าและตรวจ Stock เพิ่ม
13. ตรวจรายงาน/VAT/ต้นทุน
14. นำเข้ารูป: `นำเข้าด่วน` → `image_mapping.json` → เลือกรูป → ตรวจจับคู่ → Upload
15. Logout แล้ว Login ใหม่ ตรวจว่า Session/ข้อมูลยังถูกต้อง

ไม่ต้องใช้ฐานข้อมูลร้านเก่า และไม่ต้อง migration ฐานเดิม


## ตรวจสอบลำดับไฟล์ JS
จากชุดโปรแกรมเดิมที่ตรวจสอบ ไม่พบไฟล์ `07`, `08`, `09` ใน source/index.html และไม่มีการเรียกใช้งานหมายเลขเหล่านี้ ดังนั้นจึงไม่สร้างไฟล์ปลอมขึ้นมาแทน เพื่อป้องกันการเปลี่ยนพฤติกรรมของระบบโดยไม่ทราบหน้าที่จริง

`13-bulk-image-import.js` ถูกผูกเข้ากับ `index.html` แล้ว เพื่อให้ระบบนำเข้ารูปแบบ JSON ถูกโหลดจริง
