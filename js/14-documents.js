/* ==========================================
       DOCUMENTS HUB — รวมเอกสารบิล/ใบเสร็จทั้งหมด
       (เอกสารที่ระบบสร้างเอง: บิลขาย + ใบรับสินค้า/PO,
        และไฟล์/รูปจากภายนอก: ใบส่งของ, บิลค่าน้ำค่าไฟ ฯลฯ)
       ========================================== */

    window.switchDocTab = function (tab) {
      document.getElementById('doc-tab-SYSTEM').className = tab === 'SYSTEM'
        ? 'flex-1 py-2 px-3 bg-indigo-600 text-white rounded-xl font-bold text-xs shadow-xs btn-touch'
        : 'flex-1 py-2 px-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs border btn-touch';
      document.getElementById('doc-tab-EXTERNAL').className = tab === 'EXTERNAL'
        ? 'flex-1 py-2 px-3 bg-indigo-600 text-white rounded-xl font-bold text-xs shadow-xs btn-touch'
        : 'flex-1 py-2 px-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs border btn-touch';
      document.getElementById('doc-panel-SYSTEM').classList.toggle('hidden', tab !== 'SYSTEM');
      document.getElementById('doc-panel-EXTERNAL').classList.toggle('hidden', tab !== 'EXTERNAL');
      if (tab === 'SYSTEM') window.renderSystemDocuments();
      else {
        // signed URL ของรูป/ไฟล์ในเครื่องหมดอายุทุก 1 ชม. เดิมมันจะ refresh ให้แค่ตอนที่มีการ
        // ดึงข้อมูลใหม่จากคลาวด์ (checkAndPullNewerStateOnStartup) เท่านั้น ถ้าไม่มีอะไรเปลี่ยน
        // ฝั่ง remote เลย ลิงก์จะค้างเป็นของเก่าที่หมดอายุแล้วไปเรื่อยๆ จึงต้อง refresh ทุกครั้งที่
        // เปิดแท็บนี้ด้วย ไม่ใช่รอ event อื่น
        if (typeof window.refreshPrivateStorageUrls === 'function') {
          window.refreshPrivateStorageUrls(true).then(() => window.renderExternalDocuments());
        }
        window.renderExternalDocuments();
      }
    };

    // ---------- SYSTEM DOCUMENTS (auto-collected from bills + POs) ----------
    window.renderSystemDocuments = function () {
      const container = document.getElementById('doc-system-list');
      if (!container) return;
      const q = (document.getElementById('doc-system-search').value || '').trim().toLowerCase();
      const typeFilter = document.getElementById('doc-system-type-filter').value;

      let entries = [];

      if (typeFilter === 'ALL' || typeFilter === 'SALE') {
        (db.bills || []).forEach(bill => {
          const cName = bill.customerId && bill.customerId !== 'GENERAL' && db.customers[bill.customerId] ? db.customers[bill.customerId].name : 'ลูกค้าทั่วไป';
          entries.push({
            type: 'SALE', id: bill.id, time: bill.time,
            title: `🧾 บิลขาย ${bill.id}`,
            sub: `${cName} • ${formatMoney(bill.total)} บาท`,
            searchText: (bill.id + ' ' + cName).toLowerCase(),
            ref: bill
          });
        });
      }
      if (typeFilter === 'ALL' || typeFilter === 'PO') {
        (db.pos || []).forEach(po => {
          const sName = db.suppliers[po.supplierId] ? db.suppliers[po.supplierId].name : 'ไม่ระบุซัพพลายเออร์';
          entries.push({
            type: 'PO', id: po.id, time: po.time,
            title: `🛒 ใบรับสินค้า ${po.id}`,
            sub: `${sName} • ${formatMoney(po.total)} บาท • ${po.status === 'PAID' ? 'จ่ายแล้ว' : 'ค้างจ่าย'}`,
            searchText: (po.id + ' ' + sName).toLowerCase(),
            ref: po
          });
        });
      }

      if (q) entries = entries.filter(e => e.searchText.includes(q));
      entries.sort((a, b) => b.time - a.time);
      entries = entries.slice(0, 200); // กันหน้าเว็บหนักถ้ามีประวัติเยอะมาก

      if (entries.length === 0) {
        container.innerHTML = `<div class="text-center text-slate-400 text-xs py-10">ไม่พบเอกสาร</div>`;
        return;
      }

      container.innerHTML = entries.map(e => `
        <div class="bg-white p-3 rounded-xl border flex justify-between items-center text-xs text-slate-800 shadow-sm">
          <div>
            <b class="text-sm block">${escapeHTML(e.title)}</b>
            <span class="text-slate-400">${escapeHTML(e.sub)} • ${new Date(e.time).toLocaleString('th-TH')}</span>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="window.${e.type === 'SALE' ? 'viewBillDocument' : 'viewPODocument'}('${escapeHTML(e.id)}')" class="px-3 py-2 bg-indigo-50 text-indigo-600 rounded-lg font-bold text-[10px] btn-touch">👁️ ดู/แชร์</button>
          </div>
        </div>
      `).join('');
    };

    window.viewBillDocument = function (billId) {
      const bill = (db.bills || []).find(b => b.id === billId);
      if (!bill) return window.showAlert('ไม่พบเอกสาร', 'ไม่พบบิลนี้ในระบบ', true);
      renderReceiptContent(bill);
      window.printReceiptDirectly();
      window.__lastDocShareTitle = `บิลขาย ${bill.id}`;
      window.__lastDocShareText = `บิลขาย ${bill.id} • ยอดสุทธิ ${formatMoney(bill.total)} บาท • ${new Date(bill.time).toLocaleString('th-TH')}`;
    };

    window.viewPODocument = function (poId) {
      const po = (db.pos || []).find(p => p.id === poId);
      if (!po) return window.showAlert('ไม่พบเอกสาร', 'ไม่พบใบรับสินค้านี้ในระบบ', true);
      const sName = db.suppliers[po.supplierId] ? db.suppliers[po.supplierId].name : 'ไม่ระบุ';
      const itemsHtml = po.items.map(i => `
        <div class="flex justify-between border-b border-dashed border-slate-200 py-1">
          <span class="flex-1">${escapeHTML(i.productName)} (${escapeHTML(i.sizeName)})</span>
          <span class="w-10 text-center">${i.qty}</span>
          <span class="w-16 text-right">${formatMoney(roundAmt(i.qty * i.cost))}</span>
        </div>
      `).join('');
      const html = `
        <div class="space-y-3 p-4 border rounded-xl bg-white max-w-sm mx-auto text-slate-800">
          <div class="text-center">
            <h2 class="text-xl font-bold">${escapeHTML(db.storeName)}</h2>
            <p class="text-xs text-slate-500">ใบรับสินค้า / ตั้งเจ้าหนี้</p>
            <div class="border-b-2 my-2 border-slate-300"></div>
          </div>
          <div class="text-[10px] space-y-0.5">
            <p><b>เลขที่:</b> ${escapeHTML(po.id)}</p>
            <p><b>วันที่รับของ:</b> ${new Date(po.time).toLocaleString('th-TH')}</p>
            <p><b>ซัพพลายเออร์:</b> ${escapeHTML(sName)}</p>
            <p><b>กำหนดชำระ:</b> ${escapeHTML(po.dueDate)} (${po.status === 'PAID' ? 'จ่ายแล้ว' : 'ค้างจ่าย'})</p>
          </div>
          <div class="font-bold border-b pb-1 mb-1 flex text-[10px]">
            <span class="flex-1">รายการ</span><span class="w-10 text-center">จำนวน</span><span class="w-16 text-right">รวม</span>
          </div>
          <div class="text-[10px] space-y-1">${itemsHtml}</div>
          <div class="mt-3 text-right text-xs">
            <div class="flex justify-between font-bold text-sm"><span>ยอดรวม:</span><span>${formatMoney(po.total)}</span></div>
          </div>
        </div>
      `;
      const area = document.getElementById('print-document-area');
      const titleEl = document.getElementById('doc-viewer-title');
      const modal = document.getElementById('modal-document-viewer');
      if (area) area.innerHTML = `<div class="max-w-[80mm] mx-auto text-black bg-white">${html}</div>`;
      if (titleEl) titleEl.innerText = "📄 ใบรับสินค้า";
      if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
      window.__lastDocShareTitle = `ใบรับสินค้า ${po.id}`;
      window.__lastDocShareText = `ใบรับสินค้า ${po.id} • ${sName} • ยอดรวม ${formatMoney(po.total)} บาท`;
    };

    // ---------- EXTERNAL DOCUMENTS (photos/files uploaded manually) ----------
    window.uploadGenericFileToSupabase = async function (file, folder) {
      if (!file || file.size > 20 * 1024 * 1024) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 20 MB');
      const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
      if (!allowed.includes(file.type)) throw new Error('อนุญาตเฉพาะ JPG/PNG/WebP/PDF');
      const compressed = file.type === 'application/pdf' ? file : await window.compressImageFile(file);
      const ext = compressed.name.split('.').pop();
      const user = (await getSupabaseClient().auth.getUser()).data?.user;
      if (!user) throw new Error('ต้องมีเจ้าของร้าน (owner) login เชื่อมต่อคลาวด์ในเครื่องนี้ก่อนถึงจะอัปโหลดเอกสารได้');
      const safeFolder = String(folder || 'external-docs').replace(/[^a-zA-Z0-9_-]/g, '-');
      const storeId = localStorage.getItem('POS_STORE_ID') || user.id;
      const path = `${storeId}/${safeFolder}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await getSupabaseClient().storage
        .from('documents')
        .upload(path, compressed, { upsert: false, contentType: compressed.type || undefined });
      if (uploadError) throw uploadError;
      const { data, error } = await getSupabaseClient().storage.from('documents').createSignedUrl(path, 3600);
      if (error) throw error;
      return { url: data.signedUrl, path };
    };

    window.handleExternalDocUpload = async function (event) {
      const file = event.target.files[0];
      if (!file) return;
      const statusEl = document.getElementById('doc-ext-upload-status');
      const title = document.getElementById('doc-ext-title').value.trim() || file.name;
      const category = document.getElementById('doc-ext-category').value;
      const note = document.getElementById('doc-ext-note').value.trim();

      statusEl.classList.remove('hidden');
      statusEl.innerText = 'กำลังอัปโหลด...';

      try {
        const uploadResult = await window.uploadGenericFileToSupabase(file, 'external-docs');
        const url = uploadResult?.url || null;
        const doc = {
          id: 'DOC-' + generateID(),
          title, category, note,
          fileUrl: url,
          fileStoragePath: uploadResult?.path || '',
          fileType: file.type,
          time: Date.now()
        };
        db.documents.push(doc);
        if (typeof window.decoupledPersist === 'function') window.decoupledPersist(['documents']);
        else persist();

        document.getElementById('doc-ext-title').value = '';
        document.getElementById('doc-ext-note').value = '';
        event.target.value = '';
        statusEl.innerText = '';
        statusEl.classList.add('hidden');
        showToast('อัปโหลดเอกสารสำเร็จ');
        window.renderExternalDocuments();
      } catch (err) {
        statusEl.innerText = '';
        statusEl.classList.add('hidden');
        window.showAlert('อัปโหลดไม่สำเร็จ', 'เกิดข้อผิดพลาด: ' + (err.message || err), true);
      }
    };

    window.renderExternalDocuments = function () {
      const container = document.getElementById('doc-external-list');
      if (!container) return;
      const docs = (db.documents || []).slice().sort((a, b) => b.time - a.time);
      if (docs.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center text-slate-400 text-xs py-10">ยังไม่มีเอกสารที่อัปโหลด</div>`;
        return;
      }
      container.innerHTML = docs.map(d => {
        const isImage = (d.fileType || '').startsWith('image/');
        const thumb = isImage
          ? `<img src="${escapeHTML(d.fileUrl)}" class="w-full h-24 object-cover rounded-xl mb-2">`
          : `<div class="w-full h-24 bg-slate-100 rounded-xl mb-2 flex items-center justify-center text-3xl">📄</div>`;
        return `
        <div class="bg-white p-3 rounded-2xl border shadow-sm text-slate-800">
          ${thumb}
          <b class="text-[11px] block truncate">${escapeHTML(d.title)}</b>
          <span class="text-[9px] text-slate-400 block truncate">${escapeHTML(d.category)}</span>
          <span class="text-[9px] text-slate-300 block mb-2">${new Date(d.time).toLocaleDateString('th-TH')}</span>
          <div class="flex gap-1">
            <button onclick="window.open('${escapeHTML(d.fileUrl)}', '_blank')" class="flex-1 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg font-bold text-[9px] btn-touch">👁️ ดู</button>
            <button onclick="window.shareExternalDocument('${escapeHTML(d.id)}')" class="flex-1 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg font-bold text-[9px] btn-touch">📤 แชร์</button>
            <button onclick="window.deleteExternalDocument('${escapeHTML(d.id)}')" class="py-1.5 px-2 bg-rose-50 text-rose-500 rounded-lg font-bold text-[9px] btn-touch">🗑️</button>
          </div>
        </div>
      `;
      }).join('');
    };

    window.shareExternalDocument = async function (docId) {
      const doc = (db.documents || []).find(d => d.id === docId);
      if (!doc) return;
      if (navigator.share) {
        try {
          await navigator.share({ title: doc.title, text: doc.category, url: doc.fileUrl });
          return;
        } catch (err) { /* ผู้ใช้กดยกเลิกการแชร์ ไม่ต้องแจ้งเตือน */ return; }
      }
      // เบราว์เซอร์ไม่รองรับ Web Share API — สำรองด้วยการคัดลอกลิงก์
      try {
        await navigator.clipboard.writeText(doc.fileUrl);
        showToast('คัดลอกลิงก์เอกสารแล้ว (วางเพื่อแชร์ต่อได้เลย)');
      } catch (err) {
        window.open(doc.fileUrl, '_blank');
      }
    };

    window.deleteExternalDocument = function (docId) {
      window.showCustomConfirm('ลบเอกสารนี้?', 'ไฟล์จะถูกลบออกจากรายการ (ไฟล์ที่อัปโหลดไปแล้วจะยังอยู่ใน Storage)', () => {
        db.documents = (db.documents || []).filter(d => d.id !== docId);
        if (typeof window.decoupledPersist === 'function') window.decoupledPersist(['documents']);
        else persist();
        window.renderExternalDocuments();
        showToast('ลบเอกสารแล้ว');
      });
    };
    window.shareSystemDocument = async function () {
      const title = window.__lastDocShareTitle || 'เอกสาร';
      const text = window.__lastDocShareText || (typeof selectedBillForReceipt !== 'undefined' && selectedBillForReceipt ? `บิลขาย ${selectedBillForReceipt.id} • ยอดสุทธิ ${formatMoney(selectedBillForReceipt.total)} บาท` : title);
      if (navigator.share) {
        try { await navigator.share({ title, text }); return; } catch (err) { return; }
      }
      try {
        await navigator.clipboard.writeText(text);
        showToast('คัดลอกข้อมูลเอกสารแล้ว (วางเพื่อแชร์ต่อได้เลย)');
      } catch (err) {
        window.showAlert('แชร์ไม่สำเร็จ', 'เบราว์เซอร์นี้ไม่รองรับการแชร์โดยตรง กรุณาใช้ปุ่มพิมพ์แทน', true);
      }
    };
