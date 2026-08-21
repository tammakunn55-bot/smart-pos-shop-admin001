# SmartPOS v3 — JSON Image Import FIX v3

ไฟล์ที่ต้องแทนที่ทั้งไฟล์:
- `js/13-bulk-image-import.js`
- `js/04-supabase.js`

แก้ปัญหา `getSupabaseClient().auth` เมื่อ client เป็น null โดยตรวจ client ก่อนใช้งาน และส่ง error ที่อ่านเข้าใจได้

ระบบนำเข้ายังคงใช้ `image_mapping.json + เลือกรูปหลายไฟล์` แบบเดิม ไม่สร้างสินค้าใหม่และไม่แก้ Stock

ไม่ต้องรัน SQL และไม่ต้องอัปโหลดรูปใหม่ที่อัปโหลดสำเร็จแล้ว
