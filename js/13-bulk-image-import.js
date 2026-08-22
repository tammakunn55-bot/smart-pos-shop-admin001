/* Bulk image import tool — uploads many product images to Supabase Storage in one go
       and attaches each to the matching product by name, instead of one-by-one manually. */
    window.startBulkImageImport = async function () {
      const mappingInput = document.getElementById('bulk-image-mapping-input');
      const filesInput = document.getElementById('bulk-image-files-input');
      const btn = document.getElementById('btn-start-bulk-image');
      const progressWrap = document.getElementById('bulk-image-progress-wrap');
      const progressBar = document.getElementById('bulk-image-progress-bar');
      const progressText = document.getElementById('bulk-image-progress-text');
      const logBox = document.getElementById('bulk-image-log');

      if (!mappingInput.files[0]) return window.showAlert('ยังไม่ได้เลือกไฟล์', 'กรุณาเลือกไฟล์ image_mapping.json ก่อน', true);
      if (!filesInput.files.length) return window.showAlert('ยังไม่ได้เลือกรูป', 'กรุณาเลือกไฟล์รูปภาพอย่างน้อย 1 ไฟล์', true);

      let mapping;
      try {
        const text = await mappingInput.files[0].text();
        mapping = JSON.parse(text); // { "ชื่อสินค้า": "ชื่อไฟล์รูป.jpg", ... }
      } catch (err) {
        return window.showAlert('ไฟล์ mapping ไม่ถูกต้อง', 'เปิดไฟล์ image_mapping.json ไม่สำเร็จ: ' + err.message, true);
      }

      // Build a lookup of filename -> File object from the selected image files
      const fileByName = {};
      Array.from(filesInput.files).forEach(f => { fileByName[f.name] = f; });

      const entries = Object.entries(mapping).filter(([name, fname]) => fname); // skip products with no image file
      if (entries.length === 0) return window.showAlert('ไม่มีข้อมูลให้นำเข้า', 'ไฟล์ mapping ไม่มีรายการที่ระบุชื่อไฟล์รูปเลย', true);

      btn.disabled = true;
      btn.innerText = 'กำลังนำเข้า...';
      progressWrap.classList.remove('hidden');
      logBox.classList.remove('hidden');
      logBox.innerHTML = '';

      let done = 0, ok = 0, noProduct = 0, noFile = 0, failed = 0;
      const total = entries.length;
      const log = (msg) => { logBox.innerHTML += msg + '\n'; logBox.scrollTop = logBox.scrollHeight; };

      function updateProgress() {
        const pct = Math.round((done / total) * 100);
        progressBar.style.width = pct + '%';
        progressText.innerText = `${done}/${total} — สำเร็จ ${ok} | หาสินค้าไม่เจอ ${noProduct} | หารูปไม่เจอ ${noFile} | ล้มเหลว ${failed}`;
      }
      updateProgress();

      // Process with limited concurrency so we don't fire 500+ uploads at once
      const CONCURRENCY = 4;
      let cursor = 0;
      async function worker() {
        while (cursor < entries.length) {
          const idx = cursor++;
          const [productName, imgFileName] = entries[idx];

          const file = fileByName[imgFileName];
          if (!file) {
            noFile++; done++; updateProgress();
            log(`⬜ ไม่พบไฟล์รูป "${imgFileName}" สำหรับ "${productName}"`);
            continue;
          }

          const product = Object.values(db.products).find(p => p.name.toLowerCase() === productName.toLowerCase());
          if (!product) {
            noProduct++; done++; updateProgress();
            log(`⬜ ไม่พบสินค้าชื่อ "${productName}" ในระบบ (ข้าม)`);
            continue;
          }

          try {
            const uploadResult = await window.uploadProductImageToSupabase(file, product.id);
            if (uploadResult?.url) {
              product.imageUrl = uploadResult.url;
              product.imageStoragePath = uploadResult.path || product.imageStoragePath || '';
              ok++;
              log(`✅ ${productName}`);
            } else {
              failed++;
              log(`❌ อัปโหลดไม่สำเร็จ: ${productName}`);
            }
          } catch (err) {
            failed++;
            log(`❌ ${productName} — ${err.message || err}`);
          }
          done++; updateProgress();
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      if (typeof window.decoupledPersist === 'function') {
        window.decoupledPersist(['products']);
      } else if (typeof persist === 'function') {
        persist();
      }
      if (activeView === 'stock' && typeof window.renderStock === 'function') window.renderStock();

      btn.disabled = false;
      btn.innerText = 'เริ่มนำเข้ารูปภาพ';
      window.showAlert(
        'นำเข้ารูปภาพเสร็จสิ้น',
        `สำเร็จ ${ok} รายการ จากทั้งหมด ${total} รายการ (หาสินค้าไม่เจอ ${noProduct}, หารูปไม่เจอ ${noFile}, ล้มเหลว ${failed})`,
        false
      );
    };
