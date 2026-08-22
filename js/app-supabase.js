/* js/part3.js */
// ==========================================
// SMART POS PRO — PART 3 of 3 (plain <script>, no build step)
// Excel import, settings, backup/restore, storage quota, archive, auto-backup, clear products, and the Database Validator/Health/Audit Log/Auto Repair/Versioning systems
// ==========================================

      // EXCEL / CSV QUICK IMPORT ENGINE
      const fieldsToMap = [
        { key: 'name', label: 'ชื่อสินค้าหลัก' },
        { key: 'code', label: 'รหัสสินค้า (SKU)' },
        { key: 'rowType', label: 'ประเภทแถว (ขนาดหลัก/แบ่งขาย)' },
        { key: 'size', label: 'ขนาดสินค้า' },
        { key: 'category', label: 'หมวดหมู่สินค้า' },
        { key: 'groupName', label: 'กลุ่มสินค้า (การ์ดร่วม, ถ้ามี)' },
        { key: 'barcode', label: 'รหัสบาร์โค้ด' },
        { key: 'cost', label: 'ราคาทุน' },
        { key: 'price', label: 'ราคาขาย (หรือราคาแบ่งขาย)' },
        { key: 'stock', label: 'จำนวนสต็อก' },
        { key: 'minStock', label: 'จุดสั่งซื้อขั้นต่ำ' },
        { key: 'fractionName', label: 'ชื่อหน่วยแบ่งขาย' },
        { key: 'fractionMultiplier', label: 'อัตราส่วนแบ่งขาย' }
      ];

      function checkHeaderMatch(header, key) {
        if (!header) return false;
        header = header.toString().toLowerCase().trim();

        const exactHeaders = {
          name: 'ชื่อสินค้า', code: 'รหัสสินค้า', rowType: 'ประเภทแถว', size: 'ขนาด', category: 'หมวดหมู่',
          groupName: 'กลุ่มสินค้า', barcode: 'บาร์โค้ด', cost: 'ทุน', price: 'ราคาขาย', stock: 'สต็อก',
          minStock: 'สต็อกขั้นต่ำ', fractionName: 'ชื่อหน่วยแบ่งขาย', fractionMultiplier: 'อัตราส่วนแบ่งขาย'
        };
        const exactMatchKey = Object.keys(exactHeaders).find(k => exactHeaders[k].toLowerCase() === header);
        if (exactMatchKey) return exactMatchKey === key;

        const rules = {
          name: ["ชื่อสินค้า", "ชื่อ", "name", "สินค้า", "product", "รายการ"],
          code: ["รหัสสินค้า", "sku", "product code", "รหัสอ้างอิง"],
          rowType: ["ประเภทแถว", "ประเภท", "rowtype", "row type", "type"],
          size: ["ขนาด", "size", "รุ่น", "variant"],
          category: ["หมวดหมู่", "category", "หมวด", "ประเภทสินค้า", "cat"],
          groupName: ["กลุ่มสินค้า", "กลุ่ม", "group"],
          barcode: ["บาร์โค้ด", "barcode", "รหัส", "code", "id"],
          cost: ["ทุน", "cost", "ซื้อ", "ราคาส่ง"],
          price: ["ราคาขาย", "ขาย", "ราคา", "price", "ปลีก"],
          stock: ["สต็อก", "stock", "จำนวน", "คงเหลือ", "qty", "quantity", "ชิ้น"],
          minStock: ["ขั้นต่ำ", "min", "reorder", "เกณฑ์", "เตือน"],
          fractionName: ["ชื่อหน่วยแบ่งขาย", "หน่วยแบ่งขาย", "fraction name", "fractionname"],
          fractionMultiplier: ["อัตราส่วนแบ่งขาย", "อัตราส่วน", "multiplier", "fraction"]
        };
        if (key === 'stock' && rules.minStock.some(term => header.includes(term))) return false;

        return rules[key] ? rules[key].some(term => header.includes(term)) : false;
      }

      window.handleBulkFileUpload = function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        const fileExtension = file.name.split('.').pop().toLowerCase();

        reader.onload = function(e) {
          try {
            const data = new Uint8Array(e.target.result);
            let workbook;
            
            if (fileExtension === 'csv') {
              let decodedText;
              try {
                const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
                decodedText = utf8Decoder.decode(data);
              } catch (err) {
                const winDecoder = new TextDecoder('windows-874');
                decodedText = winDecoder.decode(data);
              }
              workbook = XLSX.read(decodedText, { type: 'string' });
            } else {
              workbook = XLSX.read(data, { type: 'array' });
            }

            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

            if (json.length < 2) return showAlert("ไฟล์ไม่มีข้อมูล", "ไม่พบข้อมูลสำหรับประมวลผลภายในตารางของไฟล์นี้", true);
            
            uploadedHeaders = json[0].map(h => (h || '').toString().trim());
            uploadedRows = json.slice(1).filter(row => row && row.some(cell => cell !== null && cell !== undefined && cell !== ''));
            showMappingSetup();
          } catch (err) {
            console.error(err);
            showAlert("ข้อผิดพลาดการอ่านข้อมูล", "เกิดปัญหาขัดข้องขณะถอดรหัสโครงสร้างตารางของไฟล์นี้", true);
          }
        };
        
        reader.readAsArrayBuffer(file);
      };

      window.openQuickCommandModal = function() {
        document.getElementById('command-input').value = "";
        document.getElementById('import-preview-area').innerHTML = "";
        document.getElementById('preview-actions-bar').classList.add('hidden');
        document.getElementById('import-hint').classList.add('hidden');
        document.getElementById('import-mapping-sec').classList.add('hidden');
        document.getElementById('btn-confirm-import').classList.add('hidden');
        pendingImportData = []; uploadedHeaders = []; uploadedRows = [];
        document.getElementById('modal-command').classList.remove('hidden');
        document.getElementById('modal-command').classList.add('flex');
      };

      window.processCommandText = function() {
        const text = document.getElementById('command-input').value.trim();
        if(!text) return showAlert("ไม่มีข้อมูล", "กรุณากรอกระบุข้อมูลสินค้าแบบรายบรรทัดเพื่อวิเคราะห์ข้อมูล", true);

        const rows = text.split('\n').map(line => line.split(',').map(cell => cell.trim()));
        if (rows.length < 1) return showAlert("รูปแบบข้อมูลตกหล่น", "โปรดตรวจสอบรูปแบบการใช้เครื่องหมายจุลภาคคั่นระหว่างข้อมูล", true);

        uploadedHeaders = ["ชื่อสินค้า", "ขนาด", "หมวดหมู่", "บาร์โค้ด", "ราคาทุน", "ราคาขาย", "จำนวนสต็อก", "จุดสั่งซื้อขั้นต่ำ"];
        uploadedRows = rows;

        showMappingSetup();
      };

      function showMappingSetup() {
        const grid = document.getElementById('mapping-selectors-grid');
        grid.innerHTML = fieldsToMap.map(field => {
          let optionsHtml = `<option value="">-- ไม่ระบุ (ใช้ค่าเริ่มต้น) --</option>`;
          uploadedHeaders.forEach((header, idx) => {
            const isMatch = checkHeaderMatch(header, field.key);
            optionsHtml += `<option value="${idx}" ${isMatch ? 'selected' : ''}>${escapeHTML(header)}</option>`;
          });
          return `
            <div>
              <label class="font-bold text-indigo-900 block mb-1 text-[10px]">${escapeHTML(field.label)}</label>
              <select id="map-${escapeHTML(field.key)}" class="w-full bg-white border p-1 rounded font-bold outline-none text-[10px] text-slate-800">${optionsHtml}</select>
            </div>
          `;
        }).join('');

        document.getElementById('import-mapping-sec').classList.remove('hidden');
      }

      function parseImportNumber(raw, defaultIfBlank) {
        if (defaultIfBlank === undefined) defaultIfBlank = 0;
        if (raw === undefined || raw === null || raw.toString().trim() === '') {
          return { value: defaultIfBlank, blank: true, invalid: false, negative: false };
        }
        const cleaned = raw.toString().replace(/,/g, '').trim();
        const num = parseFloat(cleaned);
        if (isNaN(num)) return { value: defaultIfBlank, blank: false, invalid: true, negative: false };
        return { value: num, blank: false, invalid: false, negative: num < 0 };
      }

      /* ==========================================
         CLEAR ALL PRODUCTS FEATURE (ระบบล้างข้อมูลสินค้าทั้งหมด)
         ========================================== */

      /**
       * 1. เปิด Modal ล้างสินค้า พร้อมตรวจสอบสิทธิ์ PIN ผู้จัดการ
       */
      window.openClearProductsModal = function () {
        window.openManagerPinModal(() => {
          const input = document.getElementById('clear-products-confirm-input');
          const btn = document.getElementById('btn-confirm-clear-products');

          if (input) input.value = '';
          if (btn) {
            btn.disabled = true;
            btn.className = 'flex-1 py-3 bg-slate-300 text-slate-400 rounded-xl font-bold text-xs btn-touch cursor-not-allowed transition-all';
          }

          const modal = document.getElementById('modal-clear-products');
          if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
          }
        });
      };

      /**
       * 2. ตรวจสอบข้อความพิมพ์ยืนยัน
       */
      window.validateClearProductsInput = function () {
        const input = document.getElementById('clear-products-confirm-input');
        const btn = document.getElementById('btn-confirm-clear-products');
        if (!input || !btn) return;

        const EXPECTED_TEXT = 'DELETE ALL PRODUCTS';
        const isMatch = input.value.trim() === EXPECTED_TEXT;

        if (isMatch) {
          btn.disabled = false;
          btn.className = 'flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold text-xs btn-touch shadow-md transition-all cursor-pointer';
        } else {
          btn.disabled = true;
          btn.className = 'flex-1 py-3 bg-slate-300 text-slate-400 rounded-xl font-bold text-xs btn-touch cursor-not-allowed transition-all';
        }
      };

      /**
       * 3. ทำการล้างข้อมูลสินค้าทั้งหมด
       */
      window.executeClearAllProducts = async function () {
        if (typeof window.guardOnce === 'function' && !window.guardOnce('executeClearAllProducts')) return;

        try {
          const loadingOverlay = document.getElementById('loading-overlay');
          const loadingText = document.getElementById('loading-text');
          if (loadingOverlay) {
            if (loadingText) loadingText.innerText = 'กำลังสำรองข้อมูลและล้างสินค้า...';
            loadingOverlay.classList.remove('hidden');
            loadingOverlay.classList.add('flex');
          }

          // 1. สำรองข้อมูลก่อนลบ
          if (typeof downloadJSONFile === 'function') {
            downloadJSONFile(window.db, 'Backup_Before_Clear_Products');
          }
          if (typeof saveInAppBackupSnapshot === 'function') {
            await saveInAppBackupSnapshot();
          }

          // 2. ล้างข้อมูลสินค้า
          const totalCount = Object.keys(window.db.products || {}).length;
          window.db.products = {};
          
          if (window.db.counters) {
            window.db.counters.product = 1;
            window.db.counters.barcode = 1;
            window.db.counters.variant = 1;
          }

          // 3. รีเซ็ตดรรชนีบาร์โค้ด และบันทึกข้อมูล
          if (typeof invalidateBarcodeIndex === 'function') {
            invalidateBarcodeIndex();
          }
          if (typeof persist === 'function') {
            persist();
          }
          if (typeof renderAll === 'function') {
            renderAll();
          }

          // 4. บันทึกประวัติ และซิงค์คลาวด์
          if (typeof logTransaction === 'function') {
            logTransaction('CLEAR_ALL_PRODUCTS', { deletedCount: totalCount });
          }
          if (typeof window.pushFullStateToSupabaseSafe === 'function') {
            await window.pushFullStateToSupabaseSafe(true);
          }

          window.closeModal('modal-clear-products');

          if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
            loadingOverlay.classList.remove('flex');
          }

          if (typeof showAlert === 'function') {
            showAlert(
              'ล้างข้อมูลสินค้าสำเร็จ',
              `ลบสินค้าในระบบไปทั้งหมด ${totalCount} รายการเรียบร้อยแล้ว (ไฟล์สำรองถูกดาวน์โหลดเก็บบนเครื่องแล้ว)`,
              false
            );
          } else if (typeof showToast === 'function') {
            showToast(`ล้างข้อมูลสินค้า ${totalCount} รายการเรียบร้อยแล้ว`);
          }

        } catch (err) {
          console.error('Clear products failed:', err);
          const loadingOverlay = document.getElementById('loading-overlay');
          if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
            loadingOverlay.classList.remove('flex');
          }
          if (typeof showAlert === 'function') {
            showAlert('เกิดข้อผิดพลาด', 'ไม่สามารถล้างข้อมูลสินค้าได้: ' + (err.message || err), true);
          }
        }
      };

      // BACKUP / EXPORT / RESTORE SYSTEM
      window.exportExcel = function() {
        const rows = [[
          "ชื่อสินค้า", "รหัสสินค้า", "ประเภทแถว", "ขนาด", "หมวดหมู่", "กลุ่มสินค้า", "บาร์โค้ด",
          "ทุน", "ราคาขาย", "สต็อก", "สต็อกขั้นต่ำ",
          "ชื่อหน่วยแบ่งขาย", "อัตราส่วนแบ่งขาย"
        ]];
        Object.values(db.products).forEach(p => {
          if (p.isDeleted) return;
          const categoryText = Array.isArray(p.cat) ? p.cat.join(', ') : (p.cat || '');
          p.variants.forEach(v => {
            rows.push([
              p.name, p.code || '', "ขนาดหลัก", v.sizeName, categoryText, p.groupName || '', v.barcode,
              v.cost, v.price, v.stock, v.minStock || 10,
              "", ""
            ]);
            (v.fractions || []).forEach(f => {
              rows.push([
                p.name, "", "แบ่งขาย", v.sizeName, "", "", "",
                "", f.fractionPrice, "", "",
                f.fractionName, f.fractionMultiplier
              ]);
            });
          });
        });
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, "Stock");
        XLSX.writeFile(wb, "SmartPOS_Stock.xlsx");
      };

      function downloadJSONFile(dataObj, filenamePrefix) {
        try {
          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dataObj));
          const a = document.createElement('a');
          a.setAttribute("href", dataStr);
          a.setAttribute("download", `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`);
          a.click();
          return true;
        } catch (e) {
          console.error("Backup download failed:", e);
          return false;
        }
      }

      async function checkStorageQuota() {
        try {
          if (!(navigator.storage && navigator.storage.estimate)) return;
          const est = await navigator.storage.estimate();
          const banner = document.getElementById('storage-warning-banner');
          if (!banner || !est.quota || !est.usage) return;
          const pct = (est.usage / est.quota) * 100;
          if (pct >= 80) {
            const usageMB = (est.usage / (1024 * 1024)).toFixed(1);
            const quotaMB = (est.quota / (1024 * 1024)).toFixed(0);
            banner.innerText = `⚠️ พื้นที่จัดเก็บข้อมูลใช้ไปแล้ว ${pct.toFixed(0)}% (${usageMB}MB จาก ${quotaMB}MB) แนะนำให้ตรวจสอบและลดข้อมูลที่ไม่จำเป็นเพื่อคืนพื้นที่`;
            banner.classList.remove('hidden');
          } else {
            banner.classList.add('hidden');
          }
        } catch (e) {
          console.error("Storage quota check failed:", e);
        }
      }

      const AUTO_BACKUP_DATE_KEY = 'POS_LAST_AUTO_BACKUP_DATE';
      const IN_APP_BACKUP_PREFIX = "in_app_backup_";
      const IN_APP_BACKUP_KEEP = 14;

      async function saveInAppBackupSnapshot() {
        try {
          const todayStr = new Date().toISOString().slice(0, 10);
          await localforage.setItem(IN_APP_BACKUP_PREFIX + todayStr, {
            savedAt: new Date().toISOString(),
            data: db
          });
          const keys = await localforage.keys();
          const backupKeys = keys.filter(k => k.startsWith(IN_APP_BACKUP_PREFIX)).sort();
          if (backupKeys.length > IN_APP_BACKUP_KEEP) {
            const toRemove = backupKeys.slice(0, backupKeys.length - IN_APP_BACKUP_KEEP);
            for (const k of toRemove) await localforage.removeItem(k);
          }
        } catch (e) { console.error("In-app backup snapshot failed:", e); }
      }
      window.saveInAppBackupSnapshot = saveInAppBackupSnapshot;

      window.listInAppBackups = async function () {
        const keys = await localforage.keys();
        return keys.filter(k => k.startsWith(IN_APP_BACKUP_PREFIX)).sort().reverse();
      };

      function typeOf(v) {
        if (Array.isArray(v)) return 'array';
        if (v === null) return 'null';
        return typeof v;
      }

      function validateDatabase(db) {
        const errors = [];
        const warnings = [];

        if (!db || typeof db !== 'object') {
          return { valid: false, errors: ['ฐานข้อมูลว่างเปล่าหรือไม่ใช่ object'], warnings };
        }

        for (const [key, expectedType] of Object.entries(DB_TOP_LEVEL_TYPES)) {
          if (!(key in db)) {
            errors.push(`ขาดฟิลด์หลัก: "${key}"`);
            continue;
          }
          const actual = typeOf(db[key]);
          if (actual !== expectedType) {
            errors.push(`ฟิลด์ "${key}" ควรเป็น ${expectedType} แต่พบ ${actual}`);
          }
        }

        if (typeOf(db.products) !== 'object' || typeOf(db.customers) !== 'object' || typeOf(db.categories) !== 'array') {
          return { valid: errors.length === 0, errors, warnings };
        }

        const categoryNames = new Set((db.categories || []).map(c => c.name));
        const productIds = new Set(Object.keys(db.products || {}));

        for (const [pid, p] of Object.entries(db.products || {})) {
          if (pid !== p.id) errors.push(`สินค้า key "${pid}" กับ id ภายใน "${p.id}" ไม่ตรงกัน`);
          if (!p.name) warnings.push(`สินค้า ${pid} ไม่มีชื่อ`);
          if (!Array.isArray(p.variants)) {
            errors.push(`สินค้า ${pid} ไม่มี variants เป็น array`);
            continue;
          }
          (p.cat || []).forEach(catName => {
            if (!categoryNames.has(catName)) warnings.push(`สินค้า ${pid} อ้างอิงหมวดหมู่ "${catName}" ที่ไม่มีอยู่จริง`);
          });
        }

        return { valid: errors.length === 0, errors, warnings };
      }

      window.validateDatabase = validateDatabase;

      async function checkDatabaseHealth(db) {
        const { valid, errors, warnings } = validateDatabase(db);
        let score = 100;
        score -= errors.length * 12;
        score -= warnings.length * 3;
        score = Math.max(0, Math.min(100, score));

        const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 50 ? 'C' : score >= 25 ? 'D' : 'F';
        const stats = {
          productCount: Object.keys(db.products || {}).length,
          customerCount: Object.keys(db.customers || {}).length,
          billCount: (db.bills || []).length,
          categoryCount: (db.categories || []).length,
          schemaVersion: db.schemaVersion || 0
        };

        return { valid, score, grade, errors, warnings, stats, checkedAt: new Date().toISOString() };
      }

      window.checkDatabaseHealth = checkDatabaseHealth;

