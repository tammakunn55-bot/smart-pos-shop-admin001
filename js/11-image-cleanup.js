/* ==========================================
       ORPHANED IMAGE CLEANUP (ล้างรูปที่ไม่ได้ใช้แล้ว)
       Lists every file in the product-images Storage bucket and compares
       it against every imageUrl currently in use by an active product.
       Anything left over (typically leftover photos from products that
       got merged/grouped together, since merging only touches the app's
       own data — it never deletes the actual Storage file) is shown for
       manual, confirmed deletion. Never deletes anything automatically.
       ========================================== */
    // ==========================================
    // ล้างรายการซ้ำที่เกิดจากบั๊กเดิมของ Merge Engine (แก้บั๊กต้นตอแล้วใน mergeDbStates
    // ด้านล่าง — ฟังก์ชันนี้ไว้ล้าง "ผลพวง" ที่เกิดขึ้นไปแล้วในฐานข้อมูลก่อนหน้านี้)
    // ==========================================
    window.scanMergeDuplicates = function () {
      const report = { products: [], customers: [], suppliers: [], bills: [], shifts: [], cashLedger: [], categories: [], users: [], pos: [], documents: [] };
      ['products', 'customers', 'suppliers'].forEach(key => {
        const dict = db[key] || {};
        Object.keys(dict).forEach(id => { if (dict[id] && dict[id]._mergeConflict) report[key].push(id); });
      });
      ['bills', 'shifts', 'cashLedger', 'categories', 'users', 'pos', 'documents'].forEach(key => {
        (db[key] || []).forEach(rec => { if (rec && rec._mergeConflict) report[key].push(rec.id); });
      });
      return report;
    };

    window.cleanupMergeDuplicates = function () {
      const report = window.scanMergeDuplicates();
      const totalDup = Object.values(report).reduce((s, arr) => s + arr.length, 0);
      if (totalDup === 0) {
        return showAlert('ไม่พบรายการซ้ำ', 'ไม่มีรายการที่เกิดจากบั๊ก sync เดิมหลงเหลืออยู่ในฐานข้อมูลนี้แล้ว', false);
      }

      window.showCustomConfirm(
        `พบรายการซ้ำซ้อนจากบั๊กเดิม ${totalDup} รายการ`,
        `เกิดจากบั๊กของระบบ sync รุ่นก่อนหน้า (สต็อกสินค้าที่เปลี่ยนตลอดเวลาทำให้ระบบเข้าใจผิดว่าเป็นข้อมูลขัดแย้ง แล้วสร้างสำเนาใหม่ทุกครั้ง — แก้ต้นตอแล้ว) ต้องการลบรายการซ้ำเหล่านี้ทิ้งไหม?\n\nระบบจะสำรองข้อมูลทั้งหมดไว้ก่อนลบเสมอ และหลังลบเสร็จ ควรตรวจนับสต็อกจริงอีกครั้งสำหรับสินค้าที่ได้รับผลกระทบ เพราะตัวเลขสต็อกระหว่างสำเนาที่ถูกลบกับตัวจริงอาจไม่ตรงกัน (เกิดจากขายคนละรอบก่อนจะถูกแยกเป็นสำเนา)`,
        async () => {
          if (typeof window.downloadJSONFile === 'function') window.downloadJSONFile(db, 'PreDedup_Safety');
          if (typeof window.saveInAppBackupSnapshot === 'function') await window.saveInAppBackupSnapshot();

          let removedCount = 0;
          const stockWarnings = [];

          ['products', 'customers', 'suppliers'].forEach(key => {
            const dict = db[key] || {};
            Object.keys(dict).forEach(id => {
              const rec = dict[id];
              if (!rec || !rec._mergeConflict) return;
              if (key === 'products') {
                const original = dict[rec._originalId];
                const originalStock = original && Array.isArray(original.variants) ? original.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0) : null;
                const dupStock = Array.isArray(rec.variants) ? rec.variants.reduce((s, v) => s + (Number(v.stock) || 0), 0) : null;
                if (originalStock !== null && dupStock !== null && originalStock !== dupStock) {
                  stockWarnings.push({ name: rec.name || id, originalId: rec._originalId, originalStock, dupStock });
                }
              }
              delete dict[id];
              removedCount++;
            });
          });

          ['bills', 'shifts', 'cashLedger', 'categories', 'users', 'pos', 'documents'].forEach(key => {
            const before = (db[key] || []).length;
            db[key] = (db[key] || []).filter(rec => !(rec && rec._mergeConflict));
            removedCount += before - db[key].length;
          });

          if (typeof persist === 'function') persist();
          if (typeof renderAll === 'function') renderAll();

          let msg = `ลบรายการซ้ำไปทั้งหมด ${removedCount} รายการเรียบร้อยแล้ว`;
          if (stockWarnings.length > 0) {
            try { localStorage.setItem('pos_dedup_stock_warnings', JSON.stringify(stockWarnings)); } catch (e) {}
            msg += `\n\n⚠️ มี ${stockWarnings.length} สินค้าที่สต็อกระหว่างสำเนาไม่ตรงกัน แนะนำให้ตรวจนับสต็อกจริงสำหรับสินค้ากลุ่มนี้ (รายชื่อ ${stockWarnings.slice(0, 5).map(w => w.name).join(', ')}${stockWarnings.length > 5 ? ' ...' : ''})`;
          }
          window.showAlert('ลบรายการซ้ำสำเร็จ', msg, stockWarnings.length > 0);
          if (typeof window.pushFullStateToSupabaseSafe === 'function') window.pushFullStateToSupabaseSafe(true);
        }
      );
    };

    window.openCleanupImagesModal = function () {
      document.getElementById('cleanup-images-results').innerHTML = `<p class="text-center text-slate-400 text-xs py-10">กด "เริ่มสแกน" เพื่อหารูปที่ไม่มีสินค้าใช้แล้ว</p>`;
      document.getElementById('modal-cleanup-images').classList.remove('hidden');
      document.getElementById('modal-cleanup-images').classList.add('flex');
      if (typeof window.refreshPrivateStorageUrls === 'function') window.refreshPrivateStorageUrls(true);
    };

    window.scanOrphanedImages = async function () {
      const resultsEl = document.getElementById('cleanup-images-results');
      resultsEl.innerHTML = `<p class="text-center text-slate-400 text-xs py-10">⏳ กำลังสแกน Supabase Storage...</p>`;
      try {
        const client = getSupabaseClient();
        const user = (await client.auth.getUser()).data?.user;
        if (!user) throw new Error('ต้องมีเจ้าของร้าน (owner) login เชื่อมต่อคลาวด์ในเครื่องนี้ก่อนถึงจะสแกนได้');
        // ไฟล์รูปสินค้าทุกรูปถูกอัปโหลดไปที่ "<uid>/products/..." เสมอ (ดู
        // uploadProductImageToSupabase) การ list(user.id) แบบเดิมจะได้แค่โฟลเดอร์
        // "products" กลับมา 1 รายการ (ไม่ใช่ไฟล์รูปจริงข้างในเลย) ทำให้สแกนไม่เจอรูปที่มีอยู่จริง
        // ต้อง list เจาะเข้าไปที่ subfolder นี้โดยตรง
        const storeId = localStorage.getItem('POS_STORE_ID') || user.id;
        const prefix = storeId + '/products/';
        const { data: files, error } = await client.storage.from('product-images').list(storeId + '/products', { limit: 5000 });
        if (error) throw error;

        const usedPaths = new Set(
          Object.values(db.products)
            .filter(p => !p.isDeleted && p.imageStoragePath)
            .map(p => p.imageStoragePath)
        );

        const orphaned = [];
        for (const f of (files || [])) {
          if (!f.name || f.name === '.emptyFolderPlaceholder') continue;
          if (!f.id) continue; // entries with no id are subfolders, not files — skip (defensive, ไม่ควรมีที่ระดับนี้อยู่แล้ว)
          const path = prefix + f.name;
          if (usedPaths.has(path)) continue;
          const { data: signed } = await client.storage.from('product-images').createSignedUrl(path, 600);
          orphaned.push({ name: path, url: signed?.signedUrl || '', sizeKB: f.metadata && f.metadata.size ? Math.round(f.metadata.size / 1024) : null });
        }

        window.renderOrphanedImagesResult(orphaned);
      } catch (err) {
        resultsEl.innerHTML = `<p class="text-center text-rose-500 text-xs py-10">เกิดข้อผิดพลาด: ${escapeHTML(err.message || String(err))}</p>`;
      }
    };

    window.renderOrphanedImagesResult = function (orphaned) {
      const resultsEl = document.getElementById('cleanup-images-results');
      if (orphaned.length === 0) {
        resultsEl.innerHTML = `<p class="text-center text-emerald-600 font-bold text-xs py-10">✅ ไม่มีรูปที่ไม่ได้ใช้เลย พื้นที่สะอาดแล้ว</p>`;
        return;
      }
      const totalKB = orphaned.reduce((s, f) => s + (f.sizeKB || 0), 0);
      resultsEl.innerHTML = `
        <div class="flex justify-between items-center bg-amber-50 border border-amber-200 rounded-xl p-3 mb-2">
          <span class="text-xs font-bold text-amber-700">พบรูปไม่ได้ใช้ ${orphaned.length} ไฟล์ (~${(totalKB / 1024).toFixed(1)} MB)</span>
          <div class="flex gap-2">
            <button onclick="document.querySelectorAll('.orphan-img-checkbox').forEach(c=>c.checked=true)" class="text-[10px] font-bold text-amber-700 underline">เลือกทั้งหมด</button>
            <button onclick="window.deleteSelectedOrphanedImages()" class="bg-rose-500 text-white px-3 py-1.5 rounded-lg font-bold text-[10px] btn-touch">🗑️ ลบที่เลือก</button>
          </div>
        </div>
        <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
          ${orphaned.map(f => `
            <label class="relative block cursor-pointer">
              <input type="checkbox" class="orphan-img-checkbox absolute top-1 left-1 w-4 h-4 z-10" value="${escapeHTML(f.name)}">
              <img src="${escapeHTML(f.url)}" class="w-full h-20 object-cover rounded-lg border" loading="lazy">
              <span class="text-[8px] text-slate-400 block truncate">${f.sizeKB ? f.sizeKB + ' KB' : ''}</span>
            </label>
          `).join('')}
        </div>
      `;
    };

    window.deleteSelectedOrphanedImages = function () {
      const names = Array.from(document.querySelectorAll('.orphan-img-checkbox:checked')).map(el => el.value);
      if (names.length === 0) return window.showAlert('ยังไม่ได้เลือก', 'กรุณาเลือกรูปที่จะลบก่อน', true);
      window.showCustomConfirm(
        `ลบรูป ${names.length} ไฟล์?`,
        'ลบแล้วกู้คืนไม่ได้ — เฉพาะรูปที่ไม่มีสินค้าตัวไหนใช้อยู่แล้วเท่านั้น',
        async () => {
          try {
            const client = getSupabaseClient();
            const { data, error } = await client.storage.from('product-images').remove(names);
            if (error) throw error;
            // Supabase คืนค่า error เป็น null ได้แม้ลบไม่สำเร็จจริง ถ้า RLS ของ Storage ไม่มี
            // policy อนุญาตให้ลบ (DELETE) — ต้องเช็คว่า data ที่คืนมามีจำนวนตรงกับที่ขอลบจริง
            // ไม่งั้นจะเข้าใจผิดว่าลบสำเร็จทั้งที่ไฟล์ยังอยู่เหมือนเดิม (อาการที่เจอ: กดลบ ขึ้นสำเร็จ
            // แต่สแกนใหม่เจอรูปเดิมซ้ำอีก)
            const deletedCount = Array.isArray(data) ? data.length : 0;
            if (deletedCount === 0) {
              window.showAlert(
                '⚠️ ลบไม่สำเร็จจริง (ทั้งที่ไม่มี error)',
                'Supabase ไม่ได้แจ้ง error แต่ไฟล์ไม่ถูกลบจริง ซึ่งมักเกิดจาก Storage bucket "product-images" ยังไม่มีสิทธิ์ DELETE ให้ (RLS policy) — ไปที่ Supabase → SQL Editor รันคำสั่งเพิ่ม policy การลบให้ bucket นี้ก่อน แล้วค่อยลองใหม่',
                true
              );
              return;
            }
            if (deletedCount < names.length) {
              showToast(`ลบสำเร็จบางส่วน ${deletedCount}/${names.length} ไฟล์ (ที่เหลืออาจติดสิทธิ์ลบ)`);
            } else {
              showToast(`ลบรูปเรียบร้อย ${deletedCount} ไฟล์`);
            }
            window.scanOrphanedImages();
          } catch (err) {
            window.showAlert('ลบไม่สำเร็จ', 'เกิดข้อผิดพลาด: ' + (err.message || err), true);
          }
        }
      );
    };
