/* ==========================================
       AUTO PRODUCT CODE GENERATOR (รันรหัสสินค้า)
       Assigns clean sequential codes (e.g. A-0001, A-0002...) across the
       whole catalog, ordered alphabetically by name — mainly for printing
       shelf labels / price tags. Read-only preview updates live as the
       person types, real changes only happen after pressing "เริ่มรันรหัส".
       ========================================== */
    function computeRunCodePreview() {
      const prefix = document.getElementById('run-code-prefix').value.trim();
      const start = parseInt(document.getElementById('run-code-start').value) || 0;
      const digits = parseInt(document.getElementById('run-code-digits').value) || 4;
      const samples = [0, 1, 2].map(i => prefix + String(start + i).padStart(digits, '0'));
      document.getElementById('run-code-preview').innerText = samples.join(', ') + ' ...';
    }
    ['run-code-prefix', 'run-code-start', 'run-code-digits'].forEach(id => {
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', computeRunCodePreview);
      });
    });

    window.openQuickCategoryEdit = function (productId) {
      const p = db.products[productId];
      if (!p) return;
      window.__quickCatEditProductId = productId;
      document.getElementById('quick-cat-edit-product-name').innerText = p.name;

      const currentCats = new Set(p.cat || []);
      const topLevel = db.categories.filter(c => !c.parentId);
      const checkboxHtml = c => `
        <label class="flex items-center gap-2 bg-slate-50 rounded-lg px-2 py-1.5 cursor-pointer">
          <input type="checkbox" class="quick-cat-checkbox w-4 h-4 accent-indigo-600" value="${escapeHTML(c.name)}" ${currentCats.has(c.name) ? 'checked' : ''}>
          <span class="text-xs font-bold text-slate-700">${escapeHTML(c.icon || '📁')} ${escapeHTML(c.name)}</span>
        </label>
      `;
      let html = '';
      topLevel.forEach(c => {
        html += checkboxHtml(c);
        const subs = db.categories.filter(s => s.parentId === c.id);
        subs.forEach(s => { html += `<div class="ml-5">${checkboxHtml(s)}</div>`; });
      });
      document.getElementById('quick-cat-edit-list').innerHTML = html || `<p class="text-xs text-slate-400 text-center py-4">ยังไม่มีหมวดหมู่ในระบบ</p>`;

      document.getElementById('modal-quick-cat-edit').classList.remove('hidden');
      document.getElementById('modal-quick-cat-edit').classList.add('flex');
    };

    window.saveQuickCategoryEdit = function () {
      const productId = window.__quickCatEditProductId;
      const p = db.products[productId];
      if (!p) return;
      const selected = Array.from(document.querySelectorAll('.quick-cat-checkbox:checked')).map(el => el.value);
      p.cat = selected;
      if (typeof window.decoupledPersist === 'function') window.decoupledPersist(['products']);
      else persist();
      window.closeModal('modal-quick-cat-edit');
      window.renderStock();
      showToast('อัปเดตหมวดหมู่เรียบร้อย');
    };

    window.openRunCodeModal = function () {
      computeRunCodePreview();
      document.getElementById('modal-run-code').classList.remove('hidden');
      document.getElementById('modal-run-code').classList.add('flex');
    };

    window.runAutoProductCode = function () {
      const prefix = document.getElementById('run-code-prefix').value.trim();
      const start = parseInt(document.getElementById('run-code-start').value) || 0;
      const digits = parseInt(document.getElementById('run-code-digits').value) || 4;
      const scope = document.getElementById('run-code-scope').value; // MISSING | ALL

      let products = Object.values(db.products).filter(p => !p.isDeleted);
      products.sort((a, b) => a.name.localeCompare(b.name, 'th'));
      if (scope === 'MISSING') products = products.filter(p => !p.code);

      if (products.length === 0) {
        return window.showAlert('ไม่มีรายการให้รัน', scope === 'MISSING' ? 'สินค้าทุกตัวมีรหัสอยู่แล้ว' : 'ไม่พบสินค้าในระบบ', true);
      }

      window.showCustomConfirm(
        `รันรหัสสินค้า ${products.length} รายการ?`,
        scope === 'ALL'
          ? `⚠️ จะเขียนทับรหัสเดิมของสินค้าทั้งหมด ${products.length} รายการด้วยรหัสใหม่ที่เรียงตามชื่อ ก-ฮ การกระทำนี้ย้อนกลับไม่ได้ (ระบบจะสำรองข้อมูลเป็นไฟล์ดาวน์โหลดให้ก่อนเสมอ)`
          : `จะตั้งรหัสใหม่ให้เฉพาะสินค้า ${products.length} รายการที่ยังไม่มีรหัส เรียงตามชื่อ ก-ฮ`,
        () => {
          if (scope === 'ALL' && typeof downloadJSONFile === 'function') {
            downloadJSONFile(db, 'BeforeRunCode_Safety');
          }
          products.forEach((p, idx) => {
            p.code = prefix + String(start + idx).padStart(digits, '0');
          });
          persist();
          logTransaction('BULK_PRODUCT_CODE_RUN', { count: products.length, scope, prefix, start, digits });
          window.closeModal('modal-run-code');
          if (activeView === 'stock') window.renderStock();
          showToast(`รันรหัสสินค้าเรียบร้อย ${products.length} รายการ`);
        }
      );
    };
