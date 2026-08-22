/* js/app-core.js - Core State, Sale, Cart, & Pin Authentication */

const roundAmt = (num) => Math.round((parseFloat(num) || 0) * 100) / 100;
const roundStock = (num) => Math.round((parseFloat(num) || 0) * 10000) / 10000;
const formatMoney = (val) => "฿" + roundAmt(val).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const generateID = () => Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();

function escapeHTML(str) {
  if (!str) return '';
  return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const DB_KEY_BASE = "smart_pos_pro_v620_db";
const DB_DEFAULT = {
  schemaVersion: 2,
  storeName: "Smart POS Pro",
  storeAddress: "",
  promptPayId: "",
  categories: [],
  products: {},
  customers: {},
  bills: [],
  shifts: [],
  cashLedger: [],
  counters: { product: 1, barcode: 1, variant: 1 },
  users: []
};

let db = JSON.parse(JSON.stringify(DB_DEFAULT));
let cart = [];
let activeView = "sale";

window.db = db;
window.cart = cart;

function persist() {
  window.db = db;
  localforage.setItem(DB_KEY_BASE, db).catch(err => console.error("Save error:", err));
}
window.persist = persist;

window.showToast = function(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  document.getElementById('toast-message').innerText = msg;
  toast.style.transform = 'translateY(0)';
  toast.style.opacity = '1';
  setTimeout(() => {
    toast.style.transform = 'translateY(-100px)';
    toast.style.opacity = '0';
  }, 3000);
};

window.showAlert = function(title, desc) {
  document.getElementById('custom-alert-title').innerText = title;
  document.getElementById('custom-alert-desc').innerText = desc;
  const modal = document.getElementById('custom-alert-modal');
  if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
};

window.closeCustomAlert = function() {
  const modal = document.getElementById('custom-alert-modal');
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
};

window.closeModal = function(id) {
  const modal = document.getElementById(id);
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
};

window.showView = function(view) {
  activeView = view;
  document.querySelectorAll('.view-content').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(`view-${view}`);
  if (target) target.classList.remove('hidden');

  if ((view === 'sale' || view === 'stock') && typeof window.refreshPrivateStorageUrls === 'function') {
    window.refreshPrivateStorageUrls().then(() => renderAll());
  }
};

function renderAll() {
  const storeTitle = document.getElementById('store-name-title');
  if (storeTitle) storeTitle.innerText = db.storeName;
  if (activeView === 'stock' && typeof window.renderStock === 'function') window.renderStock();
}
window.renderAll = renderAll;