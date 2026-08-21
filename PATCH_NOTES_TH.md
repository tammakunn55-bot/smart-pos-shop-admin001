# Smart POS — Remove Legacy Join Store Flow

แก้ 2 ไฟล์เต็ม:
- index.html
- js/04-supabase.js

## แก้ปัญหา
ลบระบบเก่า “มีร้านอยู่แล้ว? เชื่อมต่อเครื่องนี้เข้ากับฐานข้อมูลร้านเดิม” และ `completeJoinExistingAccount()` ที่เรียก `public.pos_state` โดยตรง

Error เดิม:
`ดึงข้อมูลร้านไม่สำเร็จ: Could not query the database for the schema cache...`

สาเหตุคือ flow เก่านี้ยังพยายาม query ตาราง `pos_state` ซึ่งไม่ใช่จุดเริ่มต้นของสถาปัตยกรรมร้าน/สมาชิกแบบใหม่ และทำให้เกิด error เมื่อ schema ปัจจุบันไม่มีตารางดังกล่าว

## สำคัญ
- ไม่ต้องรัน SQL เพื่อสร้าง `pos_state` เพื่อแก้ error นี้
- ไม่ลบสินค้า
- ไม่ลบรูป
- ไม่แตะ stock
- ไม่แตะระบบนำเข้าสินค้าแบบเก่า

ให้แทนที่ไฟล์เต็ม 2 ไฟล์ตาม path เดิมเท่านั้น
