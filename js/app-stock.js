/* js/app-stock.js - Product CRUD, Stock Table, & Excel Import */

window.saveProduct = function() {
  const idInput = document.getElementById('edit-p-id');
  const nameInput = document.getElementById('p-name');
  const imageUrlInput = document.getElementById('p-image-url');

  const id = idInput ? idInput.value : '';
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) return showAlert("กรอกข้อมูลไม่ครบ", "กรุณาระบุชื่อสินค้าหลัก");

  const imageUrl = imageUrlInput ? imageUrlInput.value.trim() : '';
  const isEdit = !!id && !!db.products[id];
  const prodId = isEdit ? id : 'P-' + generateID();

  let imageStoragePath = db.products[prodId]?.imageStoragePath || '';
  if (window.__pendingProductImageStoragePath) {
    imageStoragePath = window.__pendingProductImageStoragePath;
    window.__pendingProductImageStoragePath = null;
  }

  db.products[prodId] = {
    id: prodId,
    name,
    imageUrl,
    imageStoragePath,
    isDeleted: false,
    variants: [{ id: 'V-' + generateID(), sizeName: 'ปกติ', cost: 0, price: 0, stock: 0 }]
  };

  persist();
  closeModal('modal-product');
  showToast(isEdit ? "บันทึกสินค้าเรียบร้อย" : "เพิ่มสินค้าเรียบร้อย");
  renderAll();

  if (typeof window.pushFullStateToSupabaseSafe === 'function') {
    window.pushFullStateToSupabaseSafe(true);
  }
};

window.renderStock = function() {
  const tbody = document.getElementById('stock-table-body');
  if (!tbody) return;

  const products = Object.values(db.products || {}).filter(p => !p.isDeleted);
  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">ไม่มีสินค้าในคลัง</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => `
    <tr class="hover:bg-slate-50">
      <td class="p-3 font-bold">${escapeHTML(p.name)}</td>
      <td class="p-3">${p.imageUrl ? `<img src="${escapeHTML(p.imageUrl)}" class="w-10 h-10 object-cover rounded-lg">` : '📦'}</td>
      <td class="p-3 text-indigo-600 font-bold">${formatMoney(p.variants[0]?.price || 0)}</td>
      <td class="p-3 text-emerald-600 font-bold">${p.variants[0]?.stock || 0}</td>
      <td class="p-3 text-right">
        <button onclick="window.deleteProduct('${p.id}')" class="text-rose-500 font-bold text-xs">ลบ</button>
      </td>
    </tr>
  `).join('');
};

window.openClearProductsModal = function() {
  const input = document.getElementById('clear-products-confirm-input');
  const btn = document.getElementById('btn-confirm-clear-products');
  if (input) input.value = '';
  if (btn) { btn.disabled = true; btn.className = 'flex-1 py-3 bg-slate-300 text-slate-400 rounded-xl font-bold text-xs btn-touch cursor-not-allowed'; }

  const modal = document.getElementById('modal-clear-products');
  if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
};

window.validateClearProductsInput = function() {
  const input = document.getElementById('clear-products-confirm-input');
  const btn = document.getElementById('btn-confirm-clear-products');
  if (!input || !btn) return;

  if (input.value.trim() === 'DELETE ALL PRODUCTS') {
    btn.disabled = false;
    btn.className = 'flex-1 py-3 bg-rose-600 text-white rounded-xl font-bold text-xs btn-touch cursor-pointer';
  } else {
    btn.disabled = true;
    btn.className = 'flex-1 py-3 bg-slate-300 text-slate-400 rounded-xl font-bold text-xs btn-touch cursor-not-allowed';
  }
};

window.executeClearAllProducts = async function() {
  try {
    const total = Object.keys(db.products || {}).length;
    db.products = {};
    if (db.counters) { db.counters.product = 1; db.counters.barcode = 1; db.counters.variant = 1; }

    persist();
    renderAll();
    closeModal('modal-clear-products');

    if (typeof window.pushFullStateToSupabaseSafe === 'function') {
      await window.pushFullStateToSupabaseSafe(true);
    }

    showToast(`ล้างข้อมูลสินค้า ${total} รายการเรียบร้อยแล้ว`);
  } catch (err) {
    showAlert("เกิดข้อผิดพลาด", err.message || err);
  }
};

window.exportExcel = function() {
  const rows = [["ชื่อสินค้า", "ราคาขาย", "สต็อก"]];
  Object.values(db.products).forEach(p => {
    if (!p.isDeleted) {
      rows.push([p.name, p.variants[0]?.price || 0, p.variants[0]?.stock || 0]);
    }
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Stock");
  XLSX.writeFile(wb, "SmartPOS_Stock.xlsx");
};

