# SmartPOS V4 — GitHub Safe / Supabase First

ชุดนี้จัดเตรียมสำหรับนำขึ้น GitHub โดย **ไม่ฝังค่า Supabase URL/Key, password, service_role หรือข้อมูลร้านจริงใน source code**

## ก่อนขึ้น GitHub

1. สร้าง Supabase Project ใหม่
2. รัน `SMARTPOS_V4_SINGLE_RUN.sql` ใน SQL Editor เพียงครั้งเดียว
3. ตรวจสอบ RLS และ Storage policies
4. เปิด Email Auth ตามวิธีที่ระบบต้องการ
5. อัปโหลด `index.html` และโฟลเดอร์ `js/`
6. **ห้ามแก้ `js/04-supabase.js` เพื่อใส่ Key**

## การตั้งค่า Supabase ของ Frontend

หน้า Setup ของโปรแกรมให้กรอก Project URL และ Publishable/anon key **ตอน Runtime** แล้วระบบจะเก็บค่าไว้ในเครื่องของผู้ใช้ ไม่เก็บไว้ใน Git repository

> Publishable/anon key สามารถถูกเปิดเผยใน Browser ได้ตามการออกแบบของ Supabase แต่ถ้าต้องการนโยบาย "ไม่มี Key ใน Repository" ชุดนี้ก็ไม่ฝังค่าไว้ใน source

**ห้ามนำสิ่งต่อไปนี้ขึ้น GitHub เด็ดขาด:**
- `service_role` / `sb_secret`
- Database password
- JWT secret
- OAuth client secret
- Private key / certificate private key
- Backup ฐานข้อมูล
- Export ลูกค้า/ยอดขาย/ข้อมูลร้านจริง
- รูปหรือเอกสารจริงที่ไม่ต้องการเผยแพร่

## ตรวจความปลอดภัยก่อน Commit

รัน:

```bash
python scripts/preflight_security.py
```

ถ้าผ่านจะแสดง `SECURITY PREFLIGHT: PASS` และควร Commit เฉพาะไฟล์ที่ผ่านการตรวจแล้ว

## โครงสร้าง

- `SMARTPOS_V4_SINGLE_RUN.sql` — SQL ใหม่สำหรับ Supabase Project ใหม่
- `index.html` — Frontend
- `js/` — JavaScript ของระบบ
- `scripts/preflight_security.py` — ตรวจ secret/ข้อมูลต้องห้ามก่อน commit
- `.gitignore` — กันไฟล์ลับและข้อมูลจริงไม่ให้ถูก track

## สำคัญ

`.gitignore` ป้องกันเฉพาะไฟล์ที่ยังไม่ถูก track เท่านั้น หากเคย Commit secret ไปแล้ว การเพิ่มชื่อไฟล์ใน `.gitignore` **ไม่ลบ secret ออกจาก Git history** ต้องลบออกจาก history และ rotate/revoke secret นั้นด้วย
