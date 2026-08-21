/* SMART POS PRO — Cost Control / Inventory Intelligence
 * Keeps historical sale cost immutable while using latest purchase cost for current stock.
 * Local-first compatible: this module records immutable local movements/history and exposes
 * analytics for the existing POS UI. Supabase migration is provided separately in sql/002_cost_control.sql.
 */
(function () {
  'use strict';

  const nowIso = () => new Date().toISOString();
  const safeNum = n => Number.isFinite(Number(n)) ? Number(n) : 0;

  window.ensureCostSchema = function ensureCostSchema() {
    db.stockMovements = Array.isArray(db.stockMovements) ? db.stockMovements : [];
    db.purchaseHistory = Array.isArray(db.purchaseHistory) ? db.purchaseHistory : [];
    db.costHistory = Array.isArray(db.costHistory) ? db.costHistory : [];
    db.saleTransactions = Array.isArray(db.saleTransactions) ? db.saleTransactions : [];
    db.terminals = Array.isArray(db.terminals) ? db.terminals : [];
    db.syncQueue = Array.isArray(db.syncQueue) ? db.syncQueue : [];
    db.settings = db.settings || {};
    if (db.settings.minMarginPct === undefined) db.settings.minMarginPct = 20;
    if (db.settings.costTrendDays === undefined) db.settings.costTrendDays = 90;

    Object.values(db.products || {}).forEach(p => {
      (p.variants || []).forEach(v => {
        const cost = roundAmt(v.cost || 0);
        if (v.lastCost === undefined || v.lastCost === null) v.lastCost = cost;
        if (v.currentCost === undefined || v.currentCost === null) v.currentCost = cost;
        if (!v.costUpdatedAt) v.costUpdatedAt = nowIso();
        if (v.minMarginPct === undefined || v.minMarginPct === null) v.minMarginPct = safeNum(db.settings.minMarginPct);
      });
    });
  }

  function persistCostData() {
    if (typeof window.decoupledPersist === 'function') window.decoupledPersist(['products','stockMovements','purchaseHistory','costHistory','saleTransactions','terminals','syncQueue','settings']);
    else persist();
  }

  function variantRef(productId, variantId) {
    const p = db.products && db.products[productId];
    const v = p && (p.variants || []).find(x => x.id === variantId);
    return p && v ? { p, v } : null;
  }

  window.getCurrentCost = function (productId, variantId) {
    const r = variantRef(productId, variantId);
    if (!r) return 0;
    return roundAmt(r.v.currentCost ?? r.v.lastCost ?? r.v.cost ?? 0);
  };

  window.getMinimumSellingPrice = function (productId, variantId) {
    const r = variantRef(productId, variantId);
    if (!r) return 0;
    const cost = window.getCurrentCost(productId, variantId);
    const margin = safeNum(r.v.minMarginPct ?? db.settings.minMarginPct ?? 20);
    return roundAmt(cost * (1 + margin / 100));
  };

  window.checkSellingPriceGuard = function (productId, variantId, price) {
    const r = variantRef(productId, variantId);
    if (!r) return { ok: true, cost: 0, minPrice: 0, marginPct: 0 };
    const cost = window.getCurrentCost(productId, variantId);
    const marginPct = safeNum(r.v.minMarginPct ?? db.settings.minMarginPct ?? 20);
    const minPrice = roundAmt(cost * (1 + marginPct / 100));
    const p = roundAmt(price);
    return { ok: p >= minPrice || p <= 0, cost, minPrice, marginPct, price: p };
  };

  window.recordStockMovement = function (args) {
    ensureCostSchema();
    const qty = roundStock(args.qty || 0);
    if (!qty) return null;
    const row = {
      id: 'SM-' + crypto.randomUUID(),
      time: nowIso(),
      type: String(args.type || 'ADJUST'),
      productId: args.productId || null,
      variantId: args.variantId || null,
      qty,
      unitCost: roundAmt(args.unitCost ?? window.getCurrentCost(args.productId, args.variantId)),
      refId: args.refId || null,
      note: args.note || '',
      userId: typeof currentUserId !== 'undefined' ? currentUserId : null,
      deviceId: localStorage.getItem('POS_DEVICE_ID') || null
    };
    db.stockMovements.push(row);
    return row;
  };

  window.recordPurchaseCost = function (args) {
    ensureCostSchema();
    const cost = roundAmt(args.unitCost || 0);
    const qty = roundStock(args.qty || 0);
    const row = {
      id: 'PH-' + crypto.randomUUID(),
      time: nowIso(),
      productId: args.productId,
      variantId: args.variantId,
      supplierId: args.supplierId || null,
      qty,
      unitCost: cost,
      refId: args.refId || null
    };
    db.purchaseHistory.push(row);
    return row;
  };

  window.recordCostChange = function (args) {
    ensureCostSchema();
    const oldCost = roundAmt(args.oldCost || 0);
    const newCost = roundAmt(args.newCost || 0);
    const row = {
      id: 'CH-' + crypto.randomUUID(),
      time: nowIso(),
      productId: args.productId,
      variantId: args.variantId,
      oldCost,
      newCost,
      changePct: oldCost > 0 ? roundAmt(((newCost - oldCost) / oldCost) * 100) : null,
      refId: args.refId || null
    };
    db.costHistory.push(row);
    return row;
  };

  // Revalues CURRENT remaining inventory to the latest received cost. Historical sale cost is untouched.
  window.applyLatestCostToCurrentStock = function (productId, variantId, newCost, refId, meta) {
    ensureCostSchema();
    const r = variantRef(productId, variantId);
    if (!r) return null;
    const oldCost = window.getCurrentCost(productId, variantId);
    const cost = roundAmt(newCost);
    r.v.lastCost = cost;
    r.v.currentCost = cost;
    r.v.cost = cost; // backwards-compatible field used throughout the current UI
    r.v.costUpdatedAt = nowIso();
    if (oldCost !== cost) window.recordCostChange({ productId, variantId, oldCost, newCost: cost, refId });
    if (meta?.qty) window.recordPurchaseCost({ productId, variantId, qty: meta.qty, unitCost: cost, supplierId: meta.supplierId, refId });
    return { oldCost, newCost: cost };
  };

  window.getCostTrend = function (variantId, days) {
    ensureCostSchema();
    const cutoff = Date.now() - (Number(days || db.settings.costTrendDays || 90) * 86400000);
    const rows = db.purchaseHistory.filter(x => x.variantId === variantId && new Date(x.time).getTime() >= cutoff).sort((a,b) => new Date(a.time)-new Date(b.time));
    if (!rows.length) return { first: null, latest: null, changePct: 0, volatilityPct: 0, samples: 0 };
    const values = rows.map(x => safeNum(x.unitCost));
    const first = values[0], latest = values[values.length - 1];
    const changePct = first > 0 ? roundAmt(((latest-first)/first)*100) : 0;
    let max = Math.max(...values), min = Math.min(...values);
    const volatilityPct = latest > 0 ? roundAmt(((max-min)/latest)*100) : 0;
    return { first, latest, changePct, volatilityPct, samples: rows.length, rows };
  };

  window.getBuyingRecommendation = function (productId, variantId) {
    const r = variantRef(productId, variantId);
    if (!r) return null;
    const trend = window.getCostTrend(variantId, db.settings.costTrendDays || 90);
    const stock = roundStock(r.v.stock);
    let status = 'STABLE';
    let label = '🟢 ราคาค่อนข้างคงที่';
    if (trend.changePct >= 10 || trend.volatilityPct >= 15) {
      status = 'BUY_CONSIDER'; label = '🔴 ราคาเปลี่ยนเร็ว — ควรพิจารณาซื้อเก็บ';
    } else if (trend.changePct >= 5 || trend.volatilityPct >= 8) {
      status = 'WATCH'; label = '🟠 ราคาเริ่มเปลี่ยน — ควรติดตาม';
    }
    if (stock <= safeNum(r.v.minStock) && status === 'STABLE') {
      status = 'REORDER'; label = '🟡 สต็อกต่ำ — ควรสั่งตามยอดขาย';
    }
    return { status, label, stock, currentCost: window.getCurrentCost(productId, variantId), trend };
  };

  window.getCostAnalytics = function () {
    ensureCostSchema();
    const rows = [];
    Object.values(db.products || {}).forEach(p => (p.variants || []).forEach(v => {
      const rec = window.getBuyingRecommendation(p.id, v.id);
      if (!rec) return;
      rows.push({ productId:p.id, variantId:v.id, productName:p.name, sizeName:v.sizeName || '', barcode:v.barcode || '', price:roundAmt(v.price), ...rec });
    }));
    return rows.sort((a,b) => Math.abs(b.trend.changePct) - Math.abs(a.trend.changePct));
  };

  function ensureAnalyticsModal() {
    if (document.getElementById('modal-cost-analytics')) return;
    const el = document.createElement('div');
    el.id = 'modal-cost-analytics';
    el.className = 'fixed inset-0 z-[190] bg-slate-900/80 flex items-center justify-center p-4 hidden';
    el.innerHTML = `<div class="bg-white w-full max-w-5xl rounded-[2rem] p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
      <div class="flex justify-between items-center mb-3"><div><h3 class="text-lg font-black text-slate-800">📈 วิเคราะห์ต้นทุนและการซื้อเก็บ</h3><p class="text-[10px] text-slate-400">ประวัติการขายใช้ทุน ณ วันที่ขาย ส่วนสต็อกปัจจุบันใช้ทุนรับเข้าล่าสุด</p></div><button class="text-slate-400 text-xl font-bold" onclick="window.closeCostAnalytics()">✕</button></div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4" id="cost-analytics-summary"></div>
      <div class="overflow-x-auto"><table class="w-full text-xs"><thead class="bg-slate-50"><tr><th class="p-2 text-left">สินค้า</th><th class="p-2">สต็อก</th><th class="p-2">ทุนล่าสุด</th><th class="p-2">ราคาขาย</th><th class="p-2">เปลี่ยนแปลง</th><th class="p-2">ความผันผวน</th><th class="p-2 text-left">คำแนะนำ</th></tr></thead><tbody id="cost-analytics-body"></tbody></table></div>
    </div>`;
    document.body.appendChild(el);
  }

  window.showCostAnalytics = function () {
    ensureCostSchema(); ensureAnalyticsModal();
    const rows = window.getCostAnalytics();
    const hot = rows.filter(x => x.status === 'BUY_CONSIDER').length;
    const watch = rows.filter(x => x.status === 'WATCH').length;
    const stable = rows.filter(x => x.status === 'STABLE').length;
    const low = rows.filter(x => x.status === 'REORDER').length;
    document.getElementById('cost-analytics-summary').innerHTML = [
      ['🔴 ควรพิจารณาซื้อเก็บ',hot],['🟠 ต้องติดตาม',watch],['🟢 ราคาคงที่',stable],['🟡 สต็อกต่ำ',low]
    ].map(x=>`<div class="p-3 rounded-xl bg-slate-50 border border-slate-200"><div class="text-[10px] text-slate-500 font-bold">${x[0]}</div><div class="text-xl font-black text-slate-800">${x[1]}</div></div>`).join('');
    document.getElementById('cost-analytics-body').innerHTML = rows.slice(0, 300).map(x=>`<tr class="border-b hover:bg-slate-50"><td class="p-2 font-bold">${escapeHTML(x.productName)} <span class="text-slate-400">${escapeHTML(x.sizeName)}</span></td><td class="p-2 text-center">${x.stock}</td><td class="p-2 text-right font-bold">${formatMoney(x.currentCost)}</td><td class="p-2 text-right">${formatMoney(x.price)}</td><td class="p-2 text-right ${x.trend.changePct>=0?'text-rose-600':'text-emerald-600'}">${x.trend.changePct.toFixed(2)}%</td><td class="p-2 text-right">${x.trend.volatilityPct.toFixed(2)}%</td><td class="p-2 font-bold">${escapeHTML(x.label)}</td></tr>`).join('') || `<tr><td colspan="7" class="p-6 text-center text-slate-400">ยังไม่มีประวัติการรับสินค้าสำหรับวิเคราะห์</td></tr>`;
    const m = document.getElementById('modal-cost-analytics'); m.classList.remove('hidden');
  };
  window.closeCostAnalytics = function(){ const m=document.getElementById('modal-cost-analytics'); if(m)m.classList.add('hidden'); };

  function installReportsButton() {
    const ledger = document.getElementById('report-view-LEDGER');
    if (!ledger || document.getElementById('btn-cost-analytics')) return;
    const b = document.createElement('button'); b.id='btn-cost-analytics'; b.className='w-full mb-3 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs shadow btn-touch'; b.textContent='📈 วิเคราะห์ต้นทุน / สินค้าที่ควรซื้อเก็บ'; b.onclick=window.showCostAnalytics;
    ledger.prepend(b);
  }

  ensureCostSchema();
  if (typeof window.addEventListener === 'function') window.addEventListener('DOMContentLoaded', installReportsButton);
  setTimeout(installReportsButton, 1200);
})();
