# Smart POS v2.3 — Store-Isolated / Cost-Control / Transaction-Safe

## แนวคิดฐานข้อมูลร้าน
- **1 Supabase Project/Database = 1 ร้านค้า**
- เจ้าของร้านสร้าง/เชื่อม Project ของร้านนั้น
- สมาชิกทุกคนของร้านเดียวกันใช้ฐานข้อมูลเดียวกันผ่าน `store_members`
- ร้านใหม่หรือเจ้าของคนอื่นต้องใช้ **Supabase Project ใหม่** ไม่แชร์ฐานข้อมูลเดิม
- `owner_id` ใช้เป็น actor/creator; `store_id` เป็นขอบเขตข้อมูลของร้าน

## SQL migration
รันตามลำดับใน Supabase SQL Editor:
1. `sql/001_fresh_install.sql`
2. `sql/002_cost_control.sql`
3. `sql/003_store_isolation.sql`
4. `sql/004_store_membership_security.sql`

`004_store_membership_security.sql` เป็นตัวหลักสำหรับ v2.3: store membership, RLS ตามร้าน, private Storage ตามร้าน, member Auth, atomic online checkout และ idempotency

## ต้นทุน
- `currentCost` / `lastCost` = ราคาทุนรับเข้าล่าสุดของ **สต็อกที่เหลืออยู่ปัจจุบัน**
- รับของใหม่จะ revalue สต็อกปัจจุบันเป็นทุนล่าสุด
- `costAtSale` / `profitAtSale` ของการขายเดิมไม่เปลี่ยน
- `purchaseHistory` + `costHistory` ใช้วิเคราะห์แนวโน้มราคาซื้อ
- ระบบคำนวณราคาขายขั้นต่ำจากทุนล่าสุดและ `minMarginPct`

## การขาย
เมื่อออนไลน์และมี Supabase Auth:
- checkout ใช้ `process_sale_atomic()` ฝั่ง PostgreSQL
- lock stock ด้วย row lock
- ตรวจสต็อกก่อนหัก
- snapshot ต้นทุน ณ เวลาขาย
- ตรวจราคาขายขั้นต่ำ
- สร้าง bill/items/receipt/cash ledger/stock movement/audit ใน transaction เดียว
- ใช้ idempotency key ป้องกันการกดชำระซ้ำ

เมื่อออฟไลน์:
- ใช้ local transaction engine + rollback และ sync ภายหลัง

## สมาชิก
- สมาชิกใหม่มี User ID/รหัสผ่านสำหรับ offline/local cache และอีเมลสำหรับ Supabase Auth
- เจ้าของร้านสร้าง Auth user ผ่าน Supabase `signUp` จากเครื่อง แล้วให้สิทธิ์ด้วย `add_store_member()`
- สมาชิกล็อกอินด้วย Supabase Auth ของตนเองเมื่อออนไลน์
- ระบบตรวจว่า session ที่เปิดอยู่ตรงกับสมาชิกคนที่กำลังใช้งาน เพื่อไม่ให้สมาชิก A ใช้ session ของสมาชิก B

## Security
- PIN ใหม่ใช้ PBKDF2 180,000 iterations + per-record salt; legacy SHA-256 รองรับ migration หลังยืนยันสำเร็จ
- Audit actor ฝั่ง Cloud ใช้ `auth.uid()` ไม่เชื่อข้อมูล actor จาก browser
- Storage private และไฟล์ใหม่ใช้ `<store_id>/...`
- จำกัดไฟล์รูปสินค้า 5 MB; เอกสาร 20 MB และ allowlist MIME
- ใช้ `crypto.randomUUID()` สำหรับ identifier ใหม่
- RLS อิง store membership ไม่ใช่ผู้ใช้คนเดียว

## หมายเหตุสำคัญ
อย่าใส่ `service_role` หรือ secret key ใน GitHub/HTML/JavaScript
