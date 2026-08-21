/* Smart POS — Integrated product + image importer
   Imports products first, then attaches local image files using the strongest
   available identity: product code -> barcode -> exact product name.
   This avoids attaching the wrong photo when two products share a name. */
(function(){
  function basename(path){ return String(path||'').replace(/\\/g,'/').split('/').pop().trim(); }
  function normalize(s){ return basename(s).toLowerCase().trim(); }
  function normText(s){ return String(s||'').trim().toLowerCase().replace(/\s+/g,' '); }
  function normBarcode(s){ return String(s||'').replace(/\D/g,''); }

  function getProductKeys(item){
    const codes = [item.code, item.productCode].map(normText).filter(Boolean);
    const barcodes = [item.barcode].map(normBarcode).filter(Boolean);
    return { codes, barcodes, name: normText(item.name) };
  }

  function findImportedProduct(item){
    const keys = getProductKeys(item);
    const products = Object.values(window.db?.products || {}).filter(p => !p.isDeleted);

    // 1) Product code is the strongest identity in the import file.
    if (keys.codes.length) {
      const byCode = products.filter(p => keys.codes.includes(normText(p.code)));
      if (byCode.length === 1) return byCode[0];
    }

    // 2) Barcode is the next strongest identity. Search all variants.
    if (keys.barcodes.length) {
      const byBarcode = products.filter(p => (p.variants || []).some(v => keys.barcodes.includes(normBarcode(v.barcode))));
      if (byBarcode.length === 1) return byBarcode[0];
    }

    // 3) Exact name only when it resolves to exactly one product.
    if (keys.name) {
      const byName = products.filter(p => normText(p.name) === keys.name);
      if (byName.length === 1) return byName[0];
    }

    return null;
  }

  window.prepareIntegratedProductImageImport = function(){
    const input = document.getElementById('import-image-files-uploader');
    if (!input || !input.files.length) {
      return window.showAlert('ยังไม่ได้เลือกรูป', 'ให้เลือกไฟล์รูปที่ตรงกับคอลัมน์ "ไฟล์รูปสินค้า" ในไฟล์นำเข้า', true);
    }
    const files = Array.from(input.files);
    const map = new Map(files.map(f => [normalize(f.name), f]));
    window.__integratedImageFiles = map;
    const count = document.getElementById('import-image-file-count');
    if (count) count.textContent = `เลือกแล้ว ${files.length.toLocaleString()} รูป`;
    window.showToast(`เตรียมรูปสินค้า ${files.length.toLocaleString()} รูปแล้ว`);
  };

  window.enableIntegratedProductImageImport = function(){
    const input = document.getElementById('import-image-files-uploader');
    window.__integratedImageFiles = input && input.files.length
      ? new Map(Array.from(input.files).map(f => [normalize(f.name), f]))
      : new Map();

    const rows = typeof window.getPendingImportData === 'function' ? window.getPendingImportData() : [];
    if (!rows.length) return window.showAlert('ยังไม่มีข้อมูลสินค้า', 'เลือกไฟล์ Excel แล้วกดวิเคราะห์ก่อน', true);

    window.__afterProductImport = async function(validItems){
      const files = window.__integratedImageFiles || new Map();
      const imageItems = validItems.filter(i => i.rowType !== 'FRACTION' && i.imageFile);
      if (!imageItems.length) {
        window.showToast('นำเข้าสินค้าแล้ว — ไฟล์นี้ไม่มีรายการรูปที่ระบุไว้');
        return;
      }
      if (!files.size) {
        window.showAlert('นำเข้าสินค้าแล้ว แต่ยังไม่มีไฟล์รูป', `สินค้า ${imageItems.length} รายการมีชื่อไฟล์รูปใน Excel แต่ยังไม่ได้เลือกไฟล์รูป จึงยังไม่ได้อัปโหลดรูป`, true);
        return;
      }
      if (typeof window.uploadProductImageToSupabase !== 'function') {
        throw new Error('ระบบอัปโหลดรูปยังไม่พร้อม กรุณารีโหลดหน้าแล้วลองใหม่');
      }

      const log = document.getElementById('integrated-image-log');
      const progress = document.getElementById('integrated-image-progress');
      const bar = document.getElementById('integrated-image-bar');
      if (progress) progress.classList.remove('hidden');
      if (log) { log.classList.remove('hidden'); log.textContent = ''; }

      let ok=0, miss=0, fail=0, ambiguous=0, done=0;
      const total=imageItems.length;
      const writeLog=(x)=>{ if(log){log.textContent += x+'\n'; log.scrollTop=log.scrollHeight;} };
      const update=()=>{ if(bar) bar.style.width=Math.round(done/Math.max(total,1)*100)+'%'; };

      for (const item of imageItems) {
        const file = files.get(normalize(item.imageFile));
        if (!file) {
          miss++; done++;
          writeLog(`⬜ ไม่พบไฟล์: ${basename(item.imageFile)} — ${item.name}`);
          update(); continue;
        }

        const product = findImportedProduct(item);
        if (!product) {
          ambiguous++; done++;
          writeLog(`🟠 จับคู่สินค้าไม่ได้อย่างปลอดภัย: ${item.name} — ${basename(item.imageFile)} (ตรวจรหัส/บาร์โค้ด)`);
          update(); continue;
        }

        try {
          const result = await window.uploadProductImageToSupabase(file, product.id);
          if (!result?.path) throw new Error('ไม่พบ storage path หลังอัปโหลด');
          product.imageStoragePath = result.path;
          product.imageFile = basename(item.imageFile);
          product.imageUrl = result.url || product.imageUrl || '';
          ok++;
          writeLog(`✅ ${product.name} ← ${basename(item.imageFile)}`);
        } catch(err) {
          fail++;
          writeLog(`❌ ${product.name} — ${err.message||err}`);
        }
        done++; update();
      }

      if (typeof window.decoupledPersist === 'function') window.decoupledPersist(['products']);
      else if (typeof window.persist === 'function') window.persist();

      if (typeof window.syncProductsToSupabase === 'function') {
        try { await window.syncProductsToSupabase(true); }
        catch(e) { writeLog(`⚠️ อัปโหลดข้อมูลสินค้าเข้า Cloud ไม่สำเร็จ: ${e.message||e}`); }
      }
      if (typeof window.renderStock === 'function') window.renderStock();

      window.showAlert(
        'นำเข้าสินค้า + รูปเสร็จแล้ว',
        `รูปสำเร็จ ${ok} | ไม่พบไฟล์ ${miss} | จับคู่ไม่ได้อย่างปลอดภัย ${ambiguous} | ล้มเหลว ${fail}`,
        fail > 0 || ambiguous > 0,
        true
      );
      window.__integratedImageFiles = new Map();
    };

    window.showToast('หลังยืนยันนำเข้าสินค้า ระบบจะจับคู่และอัปโหลดรูปให้อัตโนมัติ');
    window.confirmImportData();
  };

  // Avoid a 500ms polling loop. Observe the import modal instead.
  function syncIntegratedButton(){
    const normal=document.getElementById('btn-confirm-import');
    const integrated=document.getElementById('btn-confirm-import-with-images');
    if(!normal || !integrated) return;
    integrated.classList.toggle('hidden', normal.classList.contains('hidden'));
  }

  window.addEventListener('DOMContentLoaded', () => {
    syncIntegratedButton();
    const target = document.getElementById('modal-command');
    if (target && window.MutationObserver) {
      const observer = new MutationObserver(syncIntegratedButton);
      observer.observe(target, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    }
  });
})();
