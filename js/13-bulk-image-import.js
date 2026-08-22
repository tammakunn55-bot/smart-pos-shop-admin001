/* Smart POS — Legacy JSON image importer
 * image_mapping.json: { "ชื่อสินค้า": "ชื่อไฟล์รูป.ext" }
 * Keeps the legacy import flow and uses the currently authenticated Supabase client.
 */
(function () {
  window.openModal = window.openModal || function (id) {
    const el = document.getElementById(id);
    if (!el) return false;
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');
    return true;
  };
  window.closeModal = window.closeModal || function (id) {
    const el = document.getElementById(id);
    if (!el) return false;
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.fixed.inset-0:not(.hidden)[id^="modal-"]')) document.body.classList.remove('overflow-hidden');
    return true;
  };
})();

window.startBulkImageImport = async function () {
  const mappingInput = document.getElementById('bulk-image-mapping-input');
  const filesInput = document.getElementById('bulk-image-files-input');
  const btn = document.getElementById('btn-start-bulk-image');
  const progressWrap = document.getElementById('bulk-image-progress-wrap');
  const progressBar = document.getElementById('bulk-image-progress-bar');
  const progressText = document.getElementById('bulk-image-progress-text');
  const logBox = document.getElementById('bulk-image-log');

  if (!mappingInput?.files?.[0]) return window.showAlert('ยังไม่ได้เลือกไฟล์', 'กรุณาเลือกไฟล์ image_mapping.json ก่อน', true);
  if (!filesInput?.files?.length) return window.showAlert('ยังไม่ได้เลือกรูป', 'กรุณาเลือกไฟล์รูปภาพอย่างน้อย 1 ไฟล์', true);
  if (typeof window.uploadProductImageToSupabase !== 'function') return window.showAlert('ระบบอัปโหลดไม่พร้อม', 'ไม่พบฟังก์ชันอัปโหลดรูป กรุณารีโหลดหน้าเว็บอีกครั้ง', true);

  // Make sure the current account's Supabase client/session is ready.
  // The integration layer also migrates legacy unscoped public config keys,
  // so an existing connected store is not incorrectly reported as disconnected.
  if (typeof window.ensureSupabaseClientReady === 'function') {
    const ready = await window.ensureSupabaseClientReady();
    if (!ready.ok) {
      return window.showAlert('เชื่อมต่อคลาวด์ไม่พร้อม', 'ไม่สามารถเตรียมการเชื่อมต่อร้านได้: ' + ready.reason, true);
    }
  } else if (typeof window.getSupabaseClient === 'function' && !window.getSupabaseClient()) {
    return window.showAlert('ระบบคลาวด์ไม่พร้อม', 'ไม่พบ Supabase Client กรุณารีโหลดหน้าเว็บอีกครั้ง', true);
  }

  let mapping;
  try {
    mapping = JSON.parse(await mappingInput.files[0].text());
  } catch (err) {
    return window.showAlert('ไฟล์ mapping ไม่ถูกต้อง', 'เปิดไฟล์ image_mapping.json ไม่สำเร็จ: ' + (err.message || err), true);
  }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return window.showAlert('ไฟล์ mapping ไม่ถูกต้อง', 'ต้องเป็น JSON แบบ {"ชื่อสินค้า":"ชื่อไฟล์รูป"}', true);
  }

  const fileByName = Object.create(null);
  Array.from(filesInput.files).forEach(f => { fileByName[f.name] = f; fileByName[f.name.toLowerCase()] = f; });
  const entries = Object.entries(mapping).filter(([name, fname]) => String(name || '').trim() && String(fname || '').trim());
  if (!entries.length) return window.showAlert('ไม่มีข้อมูลให้นำเข้า', 'ไฟล์ mapping ไม่มีรายการที่ระบุชื่อไฟล์รูป', true);

  btn.disabled = true;
  btn.innerText = 'กำลังนำเข้า...';
  progressWrap?.classList.remove('hidden');
  logBox?.classList.remove('hidden');
  if (logBox) logBox.innerHTML = '';

  let done = 0, ok = 0, noProduct = 0, noFile = 0, failed = 0;
  const total = entries.length;
  const log = msg => { if (logBox) { logBox.innerHTML += msg + '\n'; logBox.scrollTop = logBox.scrollHeight; } };
  const updateProgress = () => {
    const pct = Math.round((done / total) * 100);
    if (progressBar) progressBar.style.width = pct + '%';
    if (progressText) progressText.innerText = `${done}/${total} — สำเร็จ ${ok} | หาสินค้าไม่เจอ ${noProduct} | หารูปไม่เจอ ${noFile} | ล้มเหลว ${failed}`;
  };
  updateProgress();

  const products = Object.values(window.db?.products || {});
  const normalize = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const productByName = new Map();
  products.forEach(p => { if (p?.name) productByName.set(normalize(p.name), p); });

  const CONCURRENCY = 2; // safer on iPhone/iPad and Supabase Storage
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= entries.length) return;
      const [productName, imageName] = entries[idx];
      const file = fileByName[imageName] || fileByName[String(imageName).toLowerCase()];
      const product = productByName.get(normalize(productName));

      if (!file) { noFile++; done++; updateProgress(); log(`⬜ ไม่พบไฟล์รูป "${imageName}" สำหรับ "${productName}"`); continue; }
      if (!product) { noProduct++; done++; updateProgress(); log(`⬜ ไม่พบสินค้าชื่อ "${productName}" ในระบบ (ข้าม)`); continue; }

      try {
        const result = await window.uploadProductImageToSupabase(file, product.id);
        if (!result?.path) throw new Error('อัปโหลดสำเร็จแต่ไม่ได้ imageStoragePath');
        product.imageStoragePath = result.path;
        product.imageUrl = result.url || '';
        product.imageUpdatedAt = new Date().toISOString();
        product.imageVersion = Number(product.imageVersion || 0) + 1;
        ok++;
        log(`✅ ${productName}`);
      } catch (err) {
        failed++;
        log(`❌ ${productName} — ${err?.message || err}`);
      }
      done++; updateProgress();
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
    if (typeof window.decoupledPersist === 'function') window.decoupledPersist(['products']);
    else if (typeof window.persist === 'function') window.persist();
    if (window.activeView === 'stock' && typeof window.renderStock === 'function') window.renderStock();
    window.showAlert('นำเข้ารูปภาพเสร็จสิ้น', `สำเร็จ ${ok} รายการ จากทั้งหมด ${total} รายการ (หาสินค้าไม่เจอ ${noProduct}, หารูปไม่เจอ ${noFile}, ล้มเหลว ${failed})`, failed > 0);
  } finally {
    btn.disabled = false;
    btn.innerText = 'เริ่มนำเข้ารูปภาพ';
  }
};
