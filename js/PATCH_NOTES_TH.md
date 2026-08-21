# Smart POS — แก้ปุ่มนำเข้ารูป JSON แบบเก่า

## แก้ปัญหา
`window.openModal is not a function`

## ไฟล์ที่แก้
- `js/13-bulk-image-import.js`

## สิ่งที่เพิ่ม
- `window.openModal(id)` สำหรับเปิด modal
- `window.closeModal(id)` สำหรับปิด modal
- ไม่แตะระบบสินค้า, Stock, SQL หรือ Supabase schema

## วิธีติดตั้ง
แทนที่ไฟล์เดิม:
`js/13-bulk-image-import.js`

ไม่ต้องเปลี่ยนชื่อไฟล์ และไม่ต้องรัน SQL
