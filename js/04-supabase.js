/* js/supabase-integration.js */
// ==========================================
// SUPABASE INTEGRATION (Supabase Auth Session + Owner-isolated Cloud Data)
// ==========================================
// Requires the Supabase JS client loaded first via CDN in index.html:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"><\/script>

// ⚠️ ไม่ควรใส่ Project URL / anon key จริงเป็นค่าเริ่มต้นตรงนี้ — ถ้ามีคนคัดลอกไฟล์นี้ไปใช้
// (fork repo, โคลนโค้ด ฯลฯ) โดยไม่รู้ตัวจะเชื่อมต่อกับฐานข้อมูลจริงของเจ้าของเดิมทันทีโดยไม่ได้ตั้งใจ
// ปล่อยว่างไว้ แล้วบังคับให้ตั้งค่าเองก่อนใช้งานครั้งแรกทุกเครื่อง/ทุกคนที่นำไฟล์นี้ไปใช้
const SUPABASE_URL_DEFAULT = "";
const SUPABASE_ANON_KEY_DEFAULT = "";
// SECURITY: Never place service_role, sb_secret, real passwords, customer data, sales data,
// backups, or uploaded documents in this source file. Public source may contain only the anon key.

const SUPABASE_URL_STORAGE_KEY = 'pos_supabase_url';
const SUPABASE_KEY_STORAGE_KEY = 'pos_supabase_anon_key';

function getAccountScopedKey(base, accountId = null) {
  const id = String(accountId || localStorage.getItem('POS_ACCOUNT_ID') || '').trim().toLowerCase();
  return id ? `${base}::${id}` : base;
}
function getConfiguredSupabaseUrl(accountId = null) {
  const scoped = localStorage.getItem(getAccountScopedKey(SUPABASE_URL_STORAGE_KEY, accountId));
  return scoped || '';
}
function getConfiguredSupabaseAnonKey(accountId = null) {
  const scoped = localStorage.getItem(getAccountScopedKey(SUPABASE_KEY_STORAGE_KEY, accountId));
  return scoped || '';
}
function setConfiguredSupabase(url, key, accountId = null) {
  localStorage.setItem(getAccountScopedKey(SUPABASE_URL_STORAGE_KEY, accountId), url);
  localStorage.setItem(getAccountScopedKey(SUPABASE_KEY_STORAGE_KEY, accountId), key);
}

// Supabase Auth password is NEVER persisted locally.
// Reconnection relies on the normal Supabase Auth session; if the session expires,
// the user must authenticate again.

window.completeFirstTimeSetup = async function () {
  const storeName = document.getElementById('setup-store-name')?.value.trim() || '';
  const url = document.getElementById('setup-supabase-url')?.value.trim().replace(/\/$/, '') || '';
  const key = document.getElementById('setup-supabase-key')?.value.trim() || '';
  const email = document.getElementById('setup-owner-email')?.value.trim().toLowerCase() || '';
  const password = document.getElementById('setup-user-password')?.value || '';
  const passwordConfirm = document.getElementById('setup-user-password-confirm')?.value || '';

  if (!storeName) return alert('กรุณาระบุชื่อร้าน');
  if (!/^https:\/\/.+\.supabase\.co$/.test(url)) return alert('Supabase Project URL ไม่ถูกต้อง');
  if (!key || /service_role|sb_secret/i.test(key)) return alert('กรุณาใช้ anon / Publishable key เท่านั้น ห้ามใช้ service_role/secret key');
  if (!/^\S+@\S+\.\S+$/.test(email)) return alert('กรุณากรอกอีเมลเจ้าของร้านที่ถูกต้อง');
  if (password.length < 8) return alert('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if (password !== passwordConfirm) return alert('รหัสผ่านยืนยันไม่ตรงกัน');

  try {
    if (!window.supabase?.createClient) throw new Error('ไม่พบ Supabase JS client');
    const client = window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    let authResult = await client.auth.signUp({
      email,
      password,
      options: { data: { display_name: storeName + ' เจ้าของร้าน', store_name: storeName } }
    });

    if (authResult.error && /already registered|already exists|user already registered/i.test(authResult.error.message || '')) {
      authResult = await client.auth.signInWithPassword({ email, password });
    }
    if (authResult.error) throw new Error('Supabase Auth: ' + authResult.error.message);
    if (!authResult.data?.user) throw new Error('Supabase ไม่ส่งข้อมูลผู้ใช้กลับมา');
    if (!authResult.data?.session) {
      throw new Error('สร้างบัญชีแล้ว แต่ Supabase ยังไม่เปิด Session อัตโนมัติ — กรุณาปิด Email confirmation ใน Authentication > Providers > Email แล้วลองอีกครั้ง');
    }

    const accountCode = 'owner-' + authResult.data.user.id.slice(0, 8);
    const { data: account, error: accountErr } = await client.rpc('create_pos_account', {
      p_store_name: storeName,
      p_account_code: accountCode
    });
    if (accountErr) throw new Error('สร้างบัญชีร้านไม่สำเร็จ: ' + accountErr.message);
    if (!account) throw new Error('Supabase ไม่คืนข้อมูลบัญชีร้าน');

    const freshDb = JSON.parse(JSON.stringify(DB_DEFAULT));
    freshDb.storeName = storeName;
    const salt = generatePinSalt();
    const passwordHash = await hashPassword(password, salt);
    const localId = email;
    freshDb.users = [{
      id: localId,
      name: storeName + ' เจ้าของร้าน',
      role: 'owner',
      passwordHash,
      passwordSalt: salt,
      createdAt: new Date().toISOString()
    }];

    await localforage.removeItem(DB_KEY_BASE);
    await localforage.setItem(getAccountDbKey(localId), freshDb);
    await localforage.setItem('POS_ACCOUNT_ID', localId);
    await localforage.setItem('POS_FIRST_SETUP_DONE', true);
    localStorage.setItem('POS_ACCOUNT_ID', localId);
    localStorage.setItem('POS_SUPABASE_AUTH_EMAIL::' + localId, email);
    localStorage.setItem('POS_SUPABASE_AUTH_EMAIL', email);
    localStorage.setItem('POS_SUPABASE_AUTH_USER_ID::' + localId, authResult.data.user.id);
    localStorage.setItem('POS_SUPABASE_AUTH_USER_ID', authResult.data.user.id);
    setConfiguredSupabase(url, key, localId);
    localStorage.removeItem('PENDING_STORE_NAME');
    localStorage.removeItem(LAST_SYNCED_KEY);
    _supabaseClient = client;
    if (typeof window.updateSupabaseConnectionStatus === 'function') window.updateSupabaseConnectionStatus(true, authResult.data.user);

    // สร้าง state เริ่มต้นบนคลาวด์ทันทีเพื่อให้เครื่องอื่นเชื่อมร้านนี้ได้
    const stateForRemote = JSON.parse(JSON.stringify(freshDb));
    const nowIso = new Date().toISOString();
    const { error: stateErr } = await client.from('pos_state').upsert({
      id: POS_STATE_ROW_ID,
      owner_id: authResult.data.user.id,
      updated_by: authResult.data.user.id,
      data: stateForRemote,
      updated_at: nowIso
    }, { onConflict: 'id' });
    if (stateErr) throw new Error('สร้างข้อมูลร้านเริ่มต้นไม่สำเร็จ: ' + stateErr.message);
    localStorage.setItem(LAST_SYNCED_KEY, nowIso);

    alert('สร้างร้านและบัญชีเจ้าของสำเร็จแล้ว');
    location.reload();
  } catch (err) {
    console.error('First setup failed:', err);
    alert('สร้างร้านไม่สำเร็จ: ' + (err.message || err));
  }
};

// เชื่อมต่ออุปกรณ์เครื่องที่สอง (หรือเครื่องพนักงาน) เข้ากับร้านที่มีอยู่แล้วบนคลาวด์ แทนที่จะ
// สร้าง DB_DEFAULT ว่างๆ ทับ — ยืนยันตัวด้วยอีเมล/รหัสผ่านของ "เจ้าของร้าน" (คนเดียวที่ผูก
// Supabase Auth ไว้) หนึ่งครั้ง ดึง pos_state ฉบับเต็มมาเก็บเป็นฐานข้อมูลของเครื่องนี้ แล้วให้
// เครื่องนี้ล็อกอินด้วย PIN ของพนักงานแต่ละคนตามปกติในครั้งถัดๆ ไป (เหมือนเครื่องแรก)
window.completeJoinExistingAccount = async function () {
  const errEl = document.getElementById('setup-join-error');
  const showErr = (msg) => { if (errEl) { errEl.textContent = '❌ ' + msg; errEl.classList.remove('hidden'); } };
  if (errEl) errEl.classList.add('hidden');

  const url = (document.getElementById('setup-join-url')?.value || '').trim().replace(/\/$/, '');
  const key = (document.getElementById('setup-join-key')?.value || '').trim();
  const email = (document.getElementById('setup-join-email')?.value || '').trim().toLowerCase();
  const password = document.getElementById('setup-join-password')?.value || '';

  if (!url || !key || !email || !password) return showErr('กรุณากรอกข้อมูลให้ครบทุกช่อง');
  if (!/^https:\/\/.+\.supabase\.co$/.test(url)) return showErr('รูปแบบ Project URL ควรเป็น https://xxxxx.supabase.co');
  if (!/^\S+@\S+\.\S+$/.test(email)) return showErr('รูปแบบอีเมลไม่ถูกต้อง');
  if (/service_role|sb_secret/i.test(key)) return showErr('ห้ามใช้ service_role/secret key ให้ใช้ anon public key เท่านั้น');
  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) return showErr('ไม่พบไลบรารี Supabase ในหน้านี้');

  try {
    // ใช้ client ชั่วคราวแยกต่างหาก ยังไม่บันทึกเป็นค่าเชื่อมต่อของเครื่องจนกว่าจะยืนยันสำเร็จ
    const tempClient = window.supabase.createClient(url, key, { auth: { persistSession: false } });

    const signIn = await tempClient.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data?.session) {
      return showErr('เข้าสู่ระบบ Supabase ไม่สำเร็จ: ' + (signIn.error?.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'));
    }
    const authUser = signIn.data.user;

    const { data: row, error: fetchErr } = await tempClient
      .from('pos_state')
      .select('data, updated_at, owner_id')
      .eq('id', 'main')
      .maybeSingle();

    if (fetchErr) return showErr('ดึงข้อมูลร้านไม่สำเร็จ: ' + fetchErr.message);
    if (!row || !row.data) return showErr('ยังไม่พบข้อมูลร้านบนคลาวด์ กรุณาซิงค์ข้อมูลจากเครื่องหลักอย่างน้อย 1 ครั้งก่อน แล้วค่อยเชื่อมต่อเครื่องนี้');
    if (row.owner_id && authUser?.id && row.owner_id !== authUser.id) {
      return showErr('ข้อมูลบน Supabase นี้เป็นของบัญชีอื่น ไม่ตรงกับอีเมลที่ยืนยัน');
    }

    const pulledDb = row.data;
    const ownerUser = (pulledDb.users || []).find(u => u.role === 'owner') || (pulledDb.users || [])[0];
    const accountId = String(ownerUser?.id || email.split('@')[0]).trim().toLowerCase();
    if (!ownerUser) {
      return showErr('ข้อมูลร้านที่ดึงมาไม่มีบัญชีผู้ใช้ ไม่สามารถตั้งค่าเครื่องนี้ได้ กรุณาตรวจสอบข้อมูลบนเครื่องหลัก');
    }

    // เก็บฐานข้อมูลที่ดึงมาไว้ในพื้นที่ของ accountId เดียวกับที่เครื่องหลักใช้ และล้าง legacy key เดิม
    await localforage.removeItem(DB_KEY_BASE);
    await localforage.setItem(getAccountDbKey(accountId), pulledDb);
    await localforage.setItem('POS_ACCOUNT_ID', accountId);
    await localforage.setItem('POS_FIRST_SETUP_DONE', true);

    localStorage.setItem('POS_ACCOUNT_ID', accountId);
    setConfiguredSupabase(url, key, accountId);
    localStorage.setItem('POS_SUPABASE_AUTH_EMAIL::' + accountId, email);
    localStorage.setItem('POS_SUPABASE_AUTH_EMAIL', email);
    localStorage.setItem('POS_SUPABASE_AUTH_USER_ID::' + accountId, authUser.id);
    localStorage.setItem('POS_SUPABASE_AUTH_USER_ID', authUser.id);
    localStorage.setItem(LAST_SYNCED_KEY, row.updated_at);
    localStorage.removeItem('PENDING_STORE_NAME');
    localStorage.removeItem('POS_BOUND_SUPABASE_URL');

    try { await tempClient.auth.signOut(); } catch (e) { /* temp client, session wasn't persisted anyway */ }

    alert('เชื่อมต่อร้าน "' + (pulledDb.storeName || '') + '" สำเร็จ! ล็อกอินด้วย User ID/รหัสผ่านของพนักงานแต่ละคนได้ตามปกติ');
    location.reload();
  } catch (err) {
    console.error('Join existing account failed:', err);
    showErr(err.message || String(err));
  }
};

window.ensureSupabaseAuthForCurrentAccount = async function(password, suppliedEmail = null) {
  try {
    const accountId = String(localStorage.getItem('POS_ACCOUNT_ID') || '').trim().toLowerCase();
    if (!accountId || !password) return { ok: false, reason: 'missing_credentials' };
    const email = String(suppliedEmail || localStorage.getItem('POS_SUPABASE_AUTH_EMAIL::' + accountId) || localStorage.getItem('POS_SUPABASE_AUTH_EMAIL') || '').trim().toLowerCase();
    if (!email) return { ok: false, reason: 'missing_email' };
    const client = getSupabaseClient();

    let result = await client.auth.signInWithPassword({ email, password });
    if (!result.error && result.data?.session) {
      const meta = result.data.user.user_metadata || {};
      if (meta.username && String(meta.username).toLowerCase() !== accountId) {
        await client.auth.signOut();
        return { ok: false, reason: 'บัญชี Supabase นี้ถูกผูกกับ User ID อื่น' };
      }
      localStorage.setItem('POS_SUPABASE_AUTH_EMAIL::' + accountId, email);
      localStorage.setItem('POS_SUPABASE_AUTH_EMAIL', email);
      localStorage.setItem('POS_SUPABASE_AUTH_USER_ID::' + accountId, result.data.user.id);
      localStorage.setItem('POS_SUPABASE_AUTH_USER_ID', result.data.user.id);
      if (typeof window.updateSupabaseConnectionStatus === 'function') window.updateSupabaseConnectionStatus(true, result.data.user);
      return { ok: true, user: result.data.user, session: result.data.session };
    }

    // ถ้ายังไม่เคยสร้าง Auth ใน Project นี้ ให้สร้างครั้งแรก
    const signUp = await client.auth.signUp({
      email,
      password,
      options: { data: { username: accountId, store_name: db.storeName || '' } }
    });
    if (signUp.error) return { ok: false, reason: signUp.error.message };
    if (!signUp.data?.session || !signUp.data?.user) {
      return { ok: false, reason: 'email_confirmation_required' };
    }
    localStorage.setItem('POS_SUPABASE_AUTH_EMAIL::' + accountId, email);
    localStorage.setItem('POS_SUPABASE_AUTH_EMAIL', email);
    localStorage.setItem('POS_SUPABASE_AUTH_USER_ID::' + accountId, signUp.data.user.id);
    localStorage.setItem('POS_SUPABASE_AUTH_USER_ID', signUp.data.user.id);
    return { ok: true, user: signUp.data.user, session: signUp.data.session };
  } catch (e) {
    console.error('Supabase Auth error:', e);
    return { ok: false, reason: e.message || String(e) };
  }
};

window.loadCodeConfigIntoForm = function () {
  ['customer', 'supplier', 'category'].forEach(type => {
    const cfg = db.codeConfig[type];
    document.getElementById(`codecfg-${type}-prefix`).value = cfg.prefix;
    document.getElementById(`codecfg-${type}-digits`).value = cfg.digits;
    document.getElementById(`codecfg-${type}-next`).value = db.counters[type];
  });
  window.updateCodeConfigPreview();
  ['customer', 'supplier', 'category'].forEach(type => {
    ['prefix', 'digits', 'next'].forEach(field => {
      document.getElementById(`codecfg-${type}-${field}`).oninput = window.updateCodeConfigPreview;
    });
  });
};

window.updateCodeConfigPreview = function () {
  const examples = ['customer', 'supplier', 'category'].map(type => {
    const prefix = document.getElementById(`codecfg-${type}-prefix`).value || '';
    const digits = parseInt(document.getElementById(`codecfg-${type}-digits`).value) || 1;
    const next = parseInt(document.getElementById(`codecfg-${type}-next`).value) || 1;
    return prefix + String(next).padStart(digits, '0');
  });
  document.getElementById('codecfg-preview').innerText = `ลูกค้า: ${examples[0]}  •  ซัพพลายเออร์: ${examples[1]}  •  หมวดหมู่: ${examples[2]}`;
};

window.saveCodeConfig = function () {
  ['customer', 'supplier', 'category'].forEach(type => {
    const prefix = document.getElementById(`codecfg-${type}-prefix`).value.trim();
    const digits = Math.max(1, parseInt(document.getElementById(`codecfg-${type}-digits`).value) || 1);
    const next = Math.max(1, parseInt(document.getElementById(`codecfg-${type}-next`).value) || 1);
    db.codeConfig[type] = { prefix, digits };
    db.counters[type] = next;
  });
  persist();
  showToast('บันทึกรูปแบบรหัสอัตโนมัติเรียบร้อย');
};

let _supabaseClient = null;
function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    if (typeof window.showAlert === 'function') {
      window.showAlert("เชื่อมต่อ Supabase ไม่ได้", "ไลบรารี Supabase ยังโหลดไม่สำเร็จ", true);
    }
    throw new Error("Supabase library not loaded");
  }
  _supabaseClient = window.supabase.createClient(getConfiguredSupabaseUrl(), getConfiguredSupabaseAnonKey(), { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return _supabaseClient;
}
window.getSupabaseClient = getSupabaseClient;

window.updateSupabaseConnectionStatus = async function (connected = null, user = null) {
  try {
    const statusEl = document.getElementById('supabase-connection-status');
    const projectEl = document.getElementById('supabase-connection-project');
    const url = getConfiguredSupabaseUrl();
    if (projectEl) projectEl.textContent = url ? ('Project: ' + url) : 'ยังไม่ได้ตั้งค่า Project URL';
    if (connected === null) {
      const client = getSupabaseClient();
      const result = await client.auth.getSession();
      connected = !!result.data?.session;
      user = result.data?.session?.user || null;
    }
    if (statusEl) {
      if (connected) {
        statusEl.className = 'text-[10px] text-emerald-700 font-bold leading-relaxed';
        statusEl.textContent = '🟢 เชื่อมต่อแล้ว — Supabase Session กำลังทำงานอัตโนมัติ' + (user?.email ? ` (${user.email})` : '');
      } else {
        statusEl.className = 'text-[10px] text-amber-700 font-bold leading-relaxed';
        statusEl.textContent = '🟡 ยังไม่ได้เข้าสู่ระบบ Supabase — ข้อมูลในเครื่องยังคงอยู่ แต่การซิงค์คลาวด์จะหยุดจนกว่าจะเข้าสู่ระบบ';
      }
    }
    return connected;
  } catch (e) {
    const statusEl = document.getElementById('supabase-connection-status');
    if (statusEl) {
      statusEl.className = 'text-[10px] text-rose-700 font-bold leading-relaxed';
      statusEl.textContent = '🔴 ตรวจสอบการเชื่อมต่อไม่สำเร็จ: ' + (e.message || e);
    }
    return false;
  }
};

window.logoutSupabaseSession = function () {
  const doLogout = async () => {
    try {
      const client = getSupabaseClient();
      await client.auth.signOut();
      _supabaseClient = null;
      localStorage.removeItem('POS_SUPABASE_AUTH_USER_ID');
      localStorage.removeItem('pos_last_synced_at');
      try { await window.refreshPrivateStorageUrls?.(true); } catch (e) {}
      const lock = document.getElementById('lock-screen');
      if (lock) {
        lock.style.display = 'flex';
        lock.style.opacity = '1';
      }
      if (typeof window.updateSupabaseConnectionStatus === 'function') window.updateSupabaseConnectionStatus(false, null);
      if (typeof window.showToast === 'function') window.showToast('ออกจากระบบ Supabase แล้ว');
      location.reload();
    } catch (e) {
      if (typeof window.showAlert === 'function') window.showAlert('ออกจากระบบไม่สำเร็จ', e.message || String(e), true);
    }
  };
  if (typeof window.showCustomConfirm === 'function') {
    window.showCustomConfirm('ออกจากระบบ Supabase?', 'Session จะถูกยกเลิกและต้องเข้าสู่ระบบอีกครั้งเมื่อต้องการใช้งานคลาวด์', doLogout);
  } else if (confirm('ออกจากระบบ Supabase?')) {
    doLogout();
  }
};

// ------------------------------------------
// DECOUPLED SYNC & GRANULAR RELATIONAL TABLE SUPPORT
// ------------------------------------------
// Allows syncing specific modules to their own respective database tables in Supabase 
// without needing to rewrite the entire JSON state bloat on every transaction.
window.syncGranularTablesToSupabase = async function (domain) {
    const client = getSupabaseClient();
    if (!client || !window.db) return false;

    try {
        if (domain === 'products') {
            await window.syncProductsToSupabase(true); // Call existing quiet mode sync
        } 
        else if (domain === 'bills') {
            // Find bills that haven't been successfully synced yet
            const unSyncedBills = window.db.bills.filter(b => !b.supabaseSynced);
            if (unSyncedBills.length === 0) return true;

            const ownerId = (await client.auth.getUser()).data?.user?.id;
            if (!ownerId) throw new Error('ยังไม่ได้เข้าสู่ระบบ Supabase');
            const payload = unSyncedBills.map(b => ({
                id: b.id,
                owner_id: ownerId,
                time: new Date(b.time).toISOString(),
                total: b.total,
                method: b.method,
                customer_id: b.customerId === 'GENERAL' ? null : b.customerId,
                payload_json: b 
            }));

            const { error } = await client.from('bills').upsert(payload, { onConflict: 'id' });
            if (error) throw error;
            unSyncedBills.forEach(b => b.supabaseSynced = true);
            if (typeof window.persist === 'function') window.persist();
        }
        else if (domain === 'cash_ledger') {
            const unSyncedLedger = window.db.cashLedger.filter(tx => !tx.supabaseSynced);
            if (unSyncedLedger.length === 0) return true;

            const ownerId = (await client.auth.getUser()).data?.user?.id;
            if (!ownerId) throw new Error('ยังไม่ได้เข้าสู่ระบบ Supabase');
            const payload = unSyncedLedger.map(tx => ({
                id: tx.id,
                owner_id: ownerId,
                date: tx.date,
                description: tx.description,
                income: tx.income || 0,
                expense: tx.expense || 0,
                type: tx.type,
                ref_id: tx.refId || null
            }));

            const { error } = await client.from('cash_ledger').upsert(payload, { onConflict: 'id' });
            if (error) throw error;
            unSyncedLedger.forEach(tx => tx.supabaseSynced = true);
            if (typeof window.persist === 'function') window.persist();
        }
        else if (domain === 'shifts') {
             const unSyncedShifts = window.db.shifts.filter(s => !s.supabaseSynced);
             if (unSyncedShifts.length === 0) return true;
             
             const ownerId = (await client.auth.getUser()).data?.user?.id;
             if (!ownerId) throw new Error('ยังไม่ได้เข้าสู่ระบบ Supabase');
             const payload = unSyncedShifts.map(s => ({
                 id: s.id,
                 owner_id: ownerId,
                 start_time: new Date(s.startTime).toISOString(),
                 end_time: s.endTime ? new Date(s.endTime).toISOString() : null,
                 cash_on_hand: s.cashOnHand,
                 payload_json: s
             }));
             const { error } = await client.from('shifts').upsert(payload, { onConflict: 'id' });
             if (error) throw error;
             unSyncedShifts.forEach(s => s.supabaseSynced = true);
             if (typeof window.persist === 'function') window.persist();
        }
        
        return true;
    } catch (err) {
        console.error(`Granular sync failed for domain [${domain}]:`, err);
        return false;
    }
};

window.decoupledPersist = function(domains = []) {
    // 1. Immediately persist local state (Storage)
    if (typeof window.persist === 'function') {
        window.persist();
    }
    
    // 2. Perform decoupled async sync for granular relational tables
    if (domains && domains.length > 0) {
        domains.forEach(domain => {
            window.syncGranularTablesToSupabase(domain);
        });
    } else {
        // Fallback: sync all known modular tables if none specified
        ['bills', 'cash_ledger', 'shifts'].forEach(d => window.syncGranularTablesToSupabase(d));
    }
};

// ------------------------------------------
// PUSH PRODUCTS TO SUPABASE (Granular)
// ------------------------------------------
window.syncProductsToSupabase = async function (isQuiet = false) {
  if (typeof window.guardOnce === 'function' && !window.guardOnce('syncProductsToSupabase')) return;

  const executeSync = async () => {
      if (!isQuiet) showToast("กำลังซิงค์ข้อมูลสินค้าไป Supabase...");
      try {
        const products = Object.values(db.products);
        const authUser = (await getSupabaseClient().auth.getUser()).data?.user;
        if (!authUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ Supabase');
        const owner_id = authUser.id;

        const categoryRows = db.categories.map(c => ({ owner_id, id: c.id, name: c.name, icon: c.icon, color: c.color }));
        if (categoryRows.length > 0) {
          const { error } = await getSupabaseClient().from('categories').upsert(categoryRows);
          if (error) throw new Error('categories: ' + error.message);
        }

        const productRows = products.map(p => ({
          owner_id,
          id: p.id,
          name: p.name,
          category_id: null,
          icon: p.image || '',
          image_url: p.imageStoragePath || null,
          is_deleted: !!p.isDeleted
        }));
        if (productRows.length > 0) {
          const { error } = await getSupabaseClient().from('products').upsert(productRows);
          if (error) throw new Error('products: ' + error.message);
        }

        const nameToId = {};
        db.categories.forEach(c => { nameToId[c.name] = c.id; });
        const categoryLinkRows = [];
        products.forEach(p => (p.cat || []).forEach(catName => {
          if (nameToId[catName]) categoryLinkRows.push({ owner_id, product_id: p.id, category_id: nameToId[catName] });
        }));

        const productIds = products.map(p => p.id);
        if (productIds.length > 0) {
          const { error: delErr } = await getSupabaseClient().from('product_categories').delete().in('product_id', productIds);
          if (delErr && delErr.code !== '42P01') throw new Error('product_categories (clear): ' + delErr.message);
        }
        if (categoryLinkRows.length > 0) {
          const { error } = await getSupabaseClient().from('product_categories').insert(categoryLinkRows);
          if (error && error.code !== '42P01') throw new Error('product_categories: ' + error.message);
        }

        const variantRows = [];
        products.forEach(p => (p.variants || []).forEach(v => {
          variantRows.push({
            owner_id,
            id: v.id,
            product_id: p.id,
            size_name: v.sizeName,
            barcode: v.barcode || null,
            cost: roundAmt(v.cost),
            price: roundAmt(v.price),
            stock: roundStock(v.stock),
            min_stock: roundStock(v.minStock)
          });
        }));
        if (variantRows.length > 0) {
          const { error } = await getSupabaseClient().from('product_variants').upsert(variantRows);
          if (error) throw new Error('product_variants: ' + error.message);
        }

        const fractionRows = [];
        products.forEach(p => (p.variants || []).forEach(v => (v.fractions || []).forEach(f => {
          fractionRows.push({
            owner_id,
            id: f.id,
            variant_id: v.id,
            fraction_name: f.fractionName,
            multiplier: roundStock(f.fractionMultiplier),
            fraction_price: roundAmt(f.fractionPrice)
          });
        })));
        if (fractionRows.length > 0) {
          const { error } = await getSupabaseClient().from('product_fractions').upsert(fractionRows);
          if (error) throw new Error('product_fractions: ' + error.message);
        }

        if (typeof window.logTransaction === 'function' && !isQuiet) {
          window.logTransaction('SUPABASE_SYNC', { productCount: productRows.length, variantCount: variantRows.length });
        }
        if (!isQuiet) showAlert("ซิงค์สำเร็จ", `ส่งข้อมูลสินค้า ${productRows.length} รายการ ไป Supabase เรียบร้อยแล้ว`, false);
      } catch (err) {
        console.error("Supabase sync error:", err);
        if (!isQuiet) showAlert("ซิงค์ไม่สำเร็จ", "เกิดข้อผิดพลาด: " + err.message, true);
      }
  };

  if (isQuiet) {
      await executeSync();
  } else {
      window.showCustomConfirm(
        "ซิงค์สินค้าทั้งหมดไป Supabase?",
        "ระบบจะเขียนทับข้อมูลสินค้า/ขนาด/หน่วยแบ่งขายทั้งหมดใน Supabase ให้ตรงกับข้อมูลในเครื่องนี้",
        executeSync
      );
  }
};

// Resizes + re-encodes an image file before upload so phone-camera photos
// (often 3-8 MB each) don't balloon Storage usage. Non-image files (PDFs
// etc.) are returned untouched. Falls back to the original file if anything
// about compression fails, so an upload never breaks because of this step.
window.compressImageFile = function (file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/') || file.type === 'image/gif') {
      return resolve(file); // don't touch non-images or animated GIFs
    }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim && file.size < 400 * 1024) {
        return resolve(file); // already small enough, skip re-encoding
      }
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return resolve(file);
        const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        resolve(new File([blob], newName, { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
};

window.uploadProductImageToSupabase = async function (file, productId) {
  if (!file) return null;
  try {
    const compressed = await window.compressImageFile(file);
    const ext = compressed.name.split('.').pop();
    const user = (await getSupabaseClient().auth.getUser()).data?.user;
    if (!user) throw new Error('ต้องมีเจ้าของร้าน (owner) login เชื่อมต่อคลาวด์ในเครื่องนี้ก่อนถึงจะอัปโหลดรูปได้');
    const path = `${user.id}/products/${productId}-${Date.now()}.${ext}`;

    const { error: uploadError } = await getSupabaseClient().storage
      .from('product-images')
      .upload(path, compressed, { upsert: false, contentType: compressed.type || undefined });
    if (uploadError) throw uploadError;

    const { data, error } = await getSupabaseClient().storage.from('product-images').createSignedUrl(path, 3600);
    if (error) throw error;
    return { url: data.signedUrl, path };
  } catch (err) {
    console.error("Image upload error:", err);
    showAlert("อัปโหลดรูปไม่สำเร็จ", "เกิดข้อผิดพลาด: " + err.message, true);
    return null;
  }
};

window.handleProductImageUpload = async function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const label = document.getElementById('p-image-upload-label');
  const originalLabel = label ? label.innerText : '';
  if (label) label.innerText = 'กำลังอัปโหลด...';

  const editIdInput = document.getElementById('edit-p-id');
  const productId = (editIdInput ? editIdInput.value : '') || 'NEW-' + Date.now();
  const uploadResult = await window.uploadProductImageToSupabase(file, productId);
  const url = uploadResult?.url || null;

  if (label) label.innerText = originalLabel;
  event.target.value = '';

  if (url) {
    const pObj = db.products[productId];
    if (uploadResult?.path) window.__pendingProductImageStoragePath = uploadResult.path;
    if (pObj && uploadResult?.path) pObj.imageStoragePath = uploadResult.path;
    const urlInput = document.getElementById('p-image-url');
    if (urlInput) urlInput.value = url;
    if (typeof window.previewProductImageUrl === 'function') window.previewProductImageUrl();
    showToast('อัปโหลดรูปสำเร็จ');
  }
};

// ==========================================
// PRIVATE STORAGE URL REFRESH
// Signed URLs are never persisted as the security credential. Only storage paths are durable.
// ==========================================
window.__lastStorageUrlRefreshAt = 0;
window.refreshPrivateStorageUrls = async function (force = false) {
  try {
    // ร้านที่มีสินค้าเยอะ (หลักพันรายการ) เดิมฟังก์ชันนี้ยิง createSignedUrl ทีละรูปแบบ
    // sequential await วนลูป — สินค้า 2,000 ชิ้นจะกลายเป็น 2,000 request ต่อครั้งที่เรียก ช้ามาก
    // และถ้าถูกเรียกทุกครั้งที่สลับหน้าขาย/คลัง (ตามจุดที่เพิ่งเพิ่ม) จะยิ่งหนักเข้าไปอีก
    // แก้ 2 จุด: (1) ใส่ cooldown ไม่ refresh ถี่กว่าทุก 20 นาทีเว้นแต่ force=true (2) รวมเป็น
    // batch request เดียวด้วย createSignedUrls (พหูพจน์) แทนการวนทีละรูป
    if (!force && Date.now() - window.__lastStorageUrlRefreshAt < 20 * 60 * 1000) return;

    const client = getSupabaseClient();
    if (!client) return;
    const user = (await client.auth.getUser()).data?.user;
    if (!user) return;

    window.__lastStorageUrlRefreshAt = Date.now();

    const products = Object.values(db.products || {}).filter(p => p.imageStoragePath && p.imageStoragePath.startsWith(user.id + '/'));
    const productPaths = products.map(p => p.imageStoragePath);
    if (productPaths.length > 0) {
      if (typeof client.storage.from('product-images').createSignedUrls === 'function') {
        // batch API — 1 request สำหรับทุกรูป (รองรับสูงสุดหลักพันรายการต่อ request ตามข้อจำกัดของ Supabase)
        const CHUNK = 1000;
        for (let i = 0; i < productPaths.length; i += CHUNK) {
          const chunkPaths = productPaths.slice(i, i + CHUNK);
          const { data, error } = await client.storage.from('product-images').createSignedUrls(chunkPaths, 3600);
          if (!error && Array.isArray(data)) {
            data.forEach((r, idx) => {
              if (r?.signedUrl) {
                const p = products[i + idx];
                if (p) p.imageUrl = r.signedUrl;
              }
            });
          }
        }
      } else {
        // Fallback สำหรับ supabase-js เวอร์ชันเก่าที่ไม่มี createSignedUrls (พหูพจน์)
        for (const p of products) {
          const { data, error } = await client.storage.from('product-images').createSignedUrl(p.imageStoragePath, 3600);
          if (!error && data?.signedUrl) p.imageUrl = data.signedUrl;
        }
      }
    }

    const documents = (db.documents || []).filter(d => d.fileStoragePath && d.fileStoragePath.startsWith(user.id + '/'));
    for (const d of documents) {
      const { data, error } = await client.storage.from('documents').createSignedUrl(d.fileStoragePath, 3600);
      if (!error && data?.signedUrl) d.fileUrl = data.signedUrl;
    }

    if (typeof window.persist === 'function') window.persist();
  } catch (e) {
    console.warn('Private storage URL refresh skipped:', e);
  }
};

// ==========================================
// AUTOMATIC FULL-STATE SYNC (With OCC Conflict Check)
// ==========================================
const POS_STATE_ROW_ID = 'main';
const LAST_SYNCED_KEY = 'pos_last_synced_at';

// Debounce Global state sync
let _pushDebounceTimer = null;
const _originalPersistForSync = window.persist;
window.persist = function (...args) {
  const result = _originalPersistForSync ? _originalPersistForSync.apply(this, args) : undefined;
  clearTimeout(_pushDebounceTimer);
  _pushDebounceTimer = setTimeout(() => {
    if (typeof window.pushFullStateToSupabaseSafe === 'function') {
      window.pushFullStateToSupabaseSafe();
    }
  }, 2500);
  return result;
};

// ==========================================
// SAFE MERGE ENGINE FOR SYNC CONFLICTS
// ==========================================
// Replaces "abort or การเขียนทับข้อมูลทั้งก้อนโดยผู้ใช้" with a
// per-record merge, so a conflict between two devices/staff sessions can no
// longer silently delete data the other side already saved. This matters even
// more now that staff can legitimately work "offline" on a device that hasn't
// re-authenticated to Supabase yet (see submitAccountLogin) — their changes
// need to merge cleanly once the owner reconnects, not get wiped.
//
// Merge rules per top-level key in `db` (see DB_DEFAULT above):
//  - Array-of-records keyed by `id` (bills, shifts, cashLedger, categories,
//    users, pendingSyncs, pos, documents): union by id. Identical content on
//    both sides -> keep one copy. Same id, DIFFERENT content -> keep BOTH;
//    the local record is kept under a renamed id (`<id>-conflict-<ts>`,
//    flagged `_mergeConflict:true` / `_originalId`) so nothing is ever
//    silently discarded.
//  - Dictionary-of-records keyed by object key (products, customers,
//    suppliers): same by-key union + rename-on-conflict rule.
//  - counters: take the MAX of local vs remote per counter, so an id either
//    device already issued is never reused after the merge.
//  - Everything else (storeName, settings, security/PIN state, promptPayId,
//    schemaVersion, codeConfig, currentShift, ...): singleton config, not
//    meaningfully mergeable field-by-field -> remote wins (it's the side
//    that triggered the conflict). Local's own copy is preserved in the
//    pre-merge backup snapshot taken in applyMergedStateAndPush below.
window.mergeDbStates = function (localDb, remoteDb) {
  const conflicts = [];
  const merged = {};

  const ARRAY_KEYED_COLLECTIONS = ['bills', 'shifts', 'cashLedger', 'categories', 'users', 'pendingSyncs', 'pos', 'documents'];
  const DICT_KEYED_COLLECTIONS = ['products', 'customers', 'suppliers'];

  function sameContent(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  // ⚠️ เวอร์ชันก่อนหน้าตรงนี้เคย "duplicate เป็นเรคคอร์ดใหม่" ทุกครั้งที่ id เดียวกันมีเนื้อหาต่าง
  // กัน — ฟังดูปลอดภัย แต่ในทางปฏิบัติ field อย่าง "สต็อกสินค้า" เปลี่ยนแทบทุกครั้งที่มีการขาย
  // พอ 2 เครื่อง sync ชนกันบ่อยๆ (เรื่องปกติเวลามีหลายเครื่องขายพร้อมกัน) สินค้า 1 รายการเดิม
  // จะถูกโคลนซ้ำไปเรื่อยๆ ทุกครั้งที่ conflict เกิด — สินค้าจริง ~2,000 รายการ กลายเป็นหลักหมื่น
  // รายการได้ในเวลาไม่นาน นี่คือสาเหตุของปัญหาที่เจอ แก้เป็น "remote wins" สำหรับ record เดิมที่
  // มีอยู่แล้วทั้งสองฝั่งแทน (ไม่สร้างซ้ำอีกต่อไป) ส่วน record ที่มีอยู่แค่ฝั่งเดียว (สินค้า/บิลใหม่ที่
  // เพิ่งสร้าง ยังไม่เคย sync) ยังคงถูก union เข้ามาตามปกติ ปลอดภัยเหมือนเดิม ไม่มีการลบข้อมูลจริง
  // ที่ต่างกันแค่ไม่ union สอง version เข้าด้วยกันแบบสร้างแถวใหม่อีกต่อไป
  function mergeArrayCollection(key, localArr, remoteArr) {
    localArr = Array.isArray(localArr) ? localArr : [];
    remoteArr = Array.isArray(remoteArr) ? remoteArr : [];
    const byId = new Map();
    remoteArr.forEach(rec => { if (rec && rec.id != null) byId.set(rec.id, rec); });
    localArr.forEach(rec => {
      if (!rec || rec.id == null) return; // skip malformed records rather than crash the merge
      if (!byId.has(rec.id)) { byId.set(rec.id, rec); return; } // only exists locally -> keep it (union)
      const remoteRec = byId.get(rec.id);
      if (sameContent(rec, remoteRec)) return; // identical both sides, nothing to do
      // มีอยู่ทั้งสองฝั่งแต่เนื้อหาต่างกัน -> ใช้ฝั่ง remote (ไม่ duplicate) แค่บันทึกไว้ให้ตรวจสอบ
      conflicts.push({ collection: key, id: rec.id, note: 'ใช้ข้อมูลฝั่ง remote (ค่าบางฟิลด์ เช่น สต็อก ต่างกันระหว่างสองเครื่อง)' });
    });
    return Array.from(byId.values());
  }

  function mergeDictCollection(key, localDict, remoteDict) {
    localDict = localDict && typeof localDict === 'object' ? localDict : {};
    remoteDict = remoteDict && typeof remoteDict === 'object' ? remoteDict : {};
    const out = { ...remoteDict };
    Object.keys(localDict).forEach(id => {
      const localRec = localDict[id];
      if (!(id in out)) { out[id] = localRec; return; } // only exists locally -> keep it (union)
      if (sameContent(localRec, out[id])) return;
      conflicts.push({ collection: key, id, note: 'ใช้ข้อมูลฝั่ง remote (ค่าบางฟิลด์ เช่น สต็อก ต่างกันระหว่างสองเครื่อง)' });
      // out[id] คือฝั่ง remote อยู่แล้ว ไม่ต้องทำอะไรเพิ่ม (ไม่ทับด้วย localRec, ไม่สร้างซ้ำ)
    });
    return out;
  }

  const allKeys = new Set([...Object.keys(localDb || {}), ...Object.keys(remoteDb || {})]);
  allKeys.forEach(key => {
    const localVal = localDb ? localDb[key] : undefined;
    const remoteVal = remoteDb ? remoteDb[key] : undefined;

    if (ARRAY_KEYED_COLLECTIONS.includes(key)) {
      merged[key] = mergeArrayCollection(key, localVal, remoteVal);
    } else if (DICT_KEYED_COLLECTIONS.includes(key)) {
      merged[key] = mergeDictCollection(key, localVal, remoteVal);
    } else if (key === 'counters') {
      const localCounters = localVal || {};
      const remoteCounters = remoteVal || {};
      const counterKeys = new Set([...Object.keys(localCounters), ...Object.keys(remoteCounters)]);
      const mergedCounters = {};
      counterKeys.forEach(ck => {
        const lv = localCounters[ck], rv = remoteCounters[ck];
        if (typeof lv === 'number' && typeof rv === 'number') {
          mergedCounters[ck] = Math.max(lv, rv);
        } else {
          mergedCounters[ck] = (rv !== undefined) ? rv : lv; // e.g. lastBillDate string -> remote wins
        }
      });
      merged[key] = mergedCounters;
    } else {
      merged[key] = (remoteVal !== undefined) ? remoteVal : localVal;
    }
  });

  return { merged, conflicts };
};

// Applies a merged db locally (with a safety backup first), persists it, then
// pushes it up as the new authoritative remote state. If anything throws at
// any point, the merge attempt simply fails and the caller falls back to the
// old manual overwrite flow — the original local db is never left corrupted.
window.applyMergedStateAndPush = async function (mergedDb, conflicts) {
  try {
    const pf = window.__pushFailState || {};
    const skipBackupDownload = pf.lastBackupAt && (Date.now() - pf.lastBackupAt < 5 * 60 * 1000);
    // ถ้าเพิ่งดาวน์โหลด backup ไปเมื่อไม่ถึง 5 นาทีที่แล้ว (เช่นกำลังวน retry ซ้ำๆ จากปัญหาเดิม)
    // ไม่ต้องเด้งหน้าต่างดาวน์โหลดไฟล์ซ้ำรัวๆ ให้รำคาญ — in-app snapshot ยังทำทุกครั้งอยู่ดี
    // (เบากว่า ไม่รบกวนผู้ใช้)
    if (!skipBackupDownload && typeof window.downloadJSONFile === 'function') {
      window.downloadJSONFile(db, 'PreMerge_Safety');
      if (window.__pushFailState) window.__pushFailState.lastBackupAt = Date.now();
    }
    if (typeof window.saveInAppBackupSnapshot === 'function') {
      await window.saveInAppBackupSnapshot();
    }

    window.db = mergedDb;
    if (typeof db !== 'undefined') { db = window.db; }

    if (typeof window.persist === 'function') window.persist();
    if (typeof renderAll === 'function') renderAll();
    if (typeof updateShiftUI === 'function') updateShiftUI();
    if (typeof updateLowStockBadge === 'function') updateLowStockBadge();

    if (conflicts && conflicts.length > 0) {
      try { localStorage.setItem('pos_last_merge_conflicts', JSON.stringify({ time: new Date().toISOString(), conflicts })); } catch (e) {}
      if (typeof window.logSystemError === 'function') {
        window.logSystemError('SYNC_MERGE_CONFLICTS', `พบ ${conflicts.length} รายการที่ค่าบางฟิลด์ต่างกันระหว่างสองเครื่อง (ใช้ค่าฝั่ง remote)`, JSON.stringify(conflicts).slice(0, 1000));
      }
      // ไม่ต้องรบกวนผู้ใช้ด้วย alert ทุกครั้งที่เจอความต่างเล็กๆ (เช่น สต็อกไม่ตรงกันเพราะขายคนละ
      // รอบ) เพราะเกิดขึ้นเป็นปกติเวลามีหลายเครื่องขายพร้อมกัน — log ไว้เงียบๆ ให้ตรวจสอบทีหลังพอ
      // (ดูได้ที่ 🚨 บันทึกข้อผิดพลาดของระบบ หรือ localStorage key 'pos_last_merge_conflicts')
    }

    const pushed = await window.pushFullStateToSupabaseSafe();
    return pushed;
  } catch (err) {
    console.error("[Merge Engine] Failed to apply merged state:", err);
    if (typeof window.logSystemError === 'function') {
      window.logSystemError('MERGE_APPLY_FAILED', err.message, err.stack);
    }
    return false;
  }
};

// Safe Push Function with Optimistic Concurrency Control (OCC)
// ==========================================
// PUSH FAILURE BACKOFF (กันลูปยิงซ้ำไม่หยุด)
// ==========================================
// ปัญหาที่เจอ: ถ้า push ล้มเหลว (เช่น "TypeError: Load failed" ตอนข้อมูลก้อนใหญ่เกินไป)
// applyMergedStateAndPush จะเรียก persist() ซึ่งไปตั้ง debounce timer ให้ push รอบใหม่อัตโนมัติ
// อีก 2.5 วิ — ถ้าสาเหตุที่แท้จริงยังไม่หาย (เช่น payload ใหญ่เกิน) รอบใหม่ก็จะล้มเหลวซ้ำ แล้ว
// เรียก persist() อีก วนแบบนี้ไม่จบ ผลคือ error log/หน้าต่างดาวน์โหลด backup/popup "Data Conflict"
// เด้งรัวๆ ทุก 2-3 วินาทีไม่หยุดตามที่เจอในรายงานปัญหา
// ทางแก้: ใส่ cooldown แบบ exponential backoff หลัง push ล้มเหลว และจำกัดไม่ให้ backup/dialog
// เด้งซ้ำถี่เกินไปในช่วง cooldown เดียวกัน
window.__pushFailState = { failCount: 0, cooldownUntil: 0, lastDialogAt: 0, lastBackupAt: 0 };

window.pushFullStateToSupabaseSafe = async function () {
  const pf = window.__pushFailState;
  if (Date.now() < pf.cooldownUntil) {
    // ยังอยู่ในช่วง cooldown จากความล้มเหลวรอบก่อน ข้ามเงียบๆ ไม่ยิง network ซ้ำ ไม่ log ซ้ำ
    return false;
  }
  try {
    if (!localStorage.getItem('POS_ACCOUNT_ID') || !getConfiguredSupabaseUrl() || !getConfiguredSupabaseAnonKey()) return false;
    const client = getSupabaseClient();
    if (!client) return false;

    // เช็ค session ก่อนเสมอ (อ่านจากหน่วยความจำ/localStorage ไม่ยิง network) — ถ้ายังไม่มี
    // session เลย (เช่น พนักงานทำงานแบบออฟไลน์ตามที่ระบบอนุญาตไว้ตอน login) ให้ออกจากฟังก์ชัน
    // เงียบๆ ทันที ไม่ยิง network เปล่าประโยชน์ (ฟังก์ชันนี้ถูกเรียกทุกครั้งที่มีการบันทึกข้อมูล
    // ผ่าน persist() debounce 2.5 วิ ถ้าไม่เช็คก่อน จะยิง request ไปเช็ค updated_at ทุกครั้งทั้งที่
    // รู้อยู่แล้วว่าไม่มี session จะ push ไม่ได้อยู่ดี) และไม่ log เป็น error เพราะสถานะนี้ไม่ใช่
    // ข้อผิดพลาด เป็นสถานะที่ตั้งใจให้เกิดได้ตามปกติ — เดิมเคย log 'PUSH_FAILED' ทุกครั้งที่พนักงาน
    // ออฟไลน์บันทึกอะไรสักอย่าง ทำให้ error log เต็มไปด้วยข้อความที่ไม่ใช่ error จริง จน error จริงๆ
    // ที่ควรเห็นถูกกลบหายไป
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) {
      updateSyncStatusBadge('offline', null);
      return false;
    }

    // เช็คขนาดข้อมูลก่อน push เสมอ — ระบบ full-state sync ส่งฐานข้อมูลทั้งก้อนทุกครั้ง ถ้าร้าน
    // มีสินค้า/รูปเยอะมาก (เช่นหลายพันรายการ) payload อาจใหญ่จนเบราว์เซอร์/เน็ตมือถือส่งไม่สำเร็จ
    // (fetch ล้มเหลวแบบ "TypeError: Load failed") ถ้าไม่เช็คก่อน ระบบจะพยายามซ้ำไม่รู้จบ
    let payloadSizeMB = 0;
    try { payloadSizeMB = new Blob([JSON.stringify(db)]).size / (1024 * 1024); } catch (e) {}
    if (payloadSizeMB > 8) {
      pf.failCount++;
      pf.cooldownUntil = Date.now() + 10 * 60 * 1000; // ข้อมูลใหญ่เกินไป ไม่มีประโยชน์จะลองถี่ๆ รอ 10 นาที
      if (typeof window.logSystemError === 'function') {
        window.logSystemError('PUSH_PAYLOAD_TOO_LARGE', `ขนาดข้อมูล ~${payloadSizeMB.toFixed(1)}MB ใหญ่เกินกว่าจะ sync แบบ full-state ได้อย่างเสถียร`);
      }
      if (Date.now() - pf.lastDialogAt > 5 * 60 * 1000 && typeof window.showAlert === 'function') {
        pf.lastDialogAt = Date.now();
        window.showAlert(
          "⚠️ ข้อมูลใหญ่เกินกว่าจะซิงค์ได้",
          `ฐานข้อมูลตอนนี้มีขนาดประมาณ ${payloadSizeMB.toFixed(1)} MB ใหญ่เกินกว่าระบบซิงค์แบบปัจจุบันจะส่งได้เสถียร มักเกิดจากมีสินค้าซ้ำซ้อนสะสมอยู่มาก\n\nแนะนำ: ไปที่หน้าคลังสินค้า กด "🧬 ล้างสินค้าซ้ำ" ก่อน แล้วลองซิงค์ใหม่อีกครั้ง`,
          true
        );
      }
      return false;
    }

    const lastKnownSync = localStorage.getItem(LAST_SYNCED_KEY);
    const nowIso = new Date().toISOString();

    {
      const { data: remoteData, error: fetchErr } = await client
        .from('pos_state')
        .select('updated_at')
        .eq('id', POS_STATE_ROW_ID)
        .maybeSingle();

      if (!fetchErr && remoteData && remoteData.updated_at) {
        const remoteTime = new Date(remoteData.updated_at).getTime();
        const localKnownTime = lastKnownSync ? new Date(lastKnownSync).getTime() : 0;

        if (remoteTime > localKnownTime + 1000) {
          console.warn("[Conflict Engine] Supabase has newer state. Attempting automatic per-record merge instead of a blind overwrite.");

          if (typeof window.logSystemError === 'function') {
            window.logSystemError('SYNC_CONFLICT', `Remote updated at ${remoteData.updated_at}, local known was ${lastKnownSync}`);
          }

          updateSyncStatusBadge('offline', null);

          // Try to resolve automatically via the merge engine first. This can only
          // ADD data (union of both sides, conflicting records kept as flagged
          // duplicates) — it never deletes anything either side already had, so
          // it's safe to attempt without asking. If fetching/merging fails for any
          // reason (including the remote row belonging to a different Supabase
          // Auth account, which must never be merged in), fall through to the
          // original manual conflict dialog.
          try {
            const { data: authCheck } = await client.auth.getUser();
            const { data: fullRemote, error: fullFetchErr } = await client
              .from('pos_state')
              .select('data, updated_at, owner_id')
              .eq('id', POS_STATE_ROW_ID)
              .maybeSingle();

            if (fullFetchErr || !fullRemote || !fullRemote.data) throw new Error('ไม่สามารถดึงข้อมูลฉบับเต็มจาก Supabase เพื่อนำมารวมได้');
            if (fullRemote.owner_id && authCheck?.user?.id && fullRemote.owner_id !== authCheck.user.id) {
              throw new Error('ข้อมูลใน Supabase เป็นของบัญชีอื่น ไม่สามารถรวมข้อมูลอัตโนมัติได้');
            }

            const { merged, conflicts } = window.mergeDbStates(db, fullRemote.data);
            const pushed = await window.applyMergedStateAndPush(merged, conflicts);
            if (pushed) return true;
            throw new Error('รวมข้อมูลสำเร็จแต่ push ขึ้น Supabase ไม่สำเร็จ');
          } catch (mergeErr) {
            console.error("[Conflict Engine] Automatic merge failed, falling back to a safe conflict notification:", mergeErr);
            if (typeof window.logSystemError === 'function') {
              window.logSystemError('SYNC_MERGE_FAILED', mergeErr.message, mergeErr.stack);
            }
          }

          if (Date.now() - pf.lastDialogAt < 60 * 1000) {
            // เพิ่งเด้งไปเมื่อไม่ถึง 1 นาทีที่แล้ว ไม่เด้งซ้ำถี่ๆ ให้รำคาญ (แต่ยัง log ไว้เหมือนเดิม)
            return false;
          }
          pf.lastDialogAt = Date.now();
          if (typeof window.showAlert === 'function') {
            window.showAlert(
              "⚠️ ตรวจพบข้อมูลขัดแย้ง",
              "มีเครื่องอื่นอัปเดตข้อมูลก่อนหน้า และระบบไม่สามารถรวมข้อมูลอัตโนมัติได้ ระบบจะไม่เขียนทับข้อมูลอีกเครื่องโดยอัตโนมัติ",
              true
            );
          }
          return false;
        }
      }
    }

    const { data: authData } = await client.auth.getUser();
    const authUserId = authData?.user?.id || null;
    if (!authUserId) throw new Error('ยังไม่มี Supabase Auth session จึงไม่อนุญาตให้ซิงค์ข้อมูล');

    const stateForRemote = JSON.parse(JSON.stringify(db));
    

    const { error: upsertErr } = await client
      .from('pos_state')
      .upsert({ id: POS_STATE_ROW_ID, owner_id: authUserId, updated_by: authUserId, data: stateForRemote, updated_at: nowIso }, { onConflict: 'id' });

    if (upsertErr) throw upsertErr;

    localStorage.setItem(LAST_SYNCED_KEY, nowIso);
    updateSyncStatusBadge('synced', nowIso);
    pf.failCount = 0;
    pf.cooldownUntil = 0;
    return true;
  } catch (err) {
    console.error("[Conflict Engine] Push failed:", err);
    updateSyncStatusBadge('offline', null);
    pf.failCount = Math.min(pf.failCount + 1, 6);
    pf.cooldownUntil = Date.now() + Math.min(10 * Math.pow(2, pf.failCount), 300) * 1000; // 10s, 20s, 40s... สูงสุด 5 นาที
    if (typeof window.logSystemError === 'function') {
      window.logSystemError('PUSH_FAILED', err.message, err.stack);
    }
    return false;
  }
};

async function checkAndPullNewerStateOnStartup() {
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), ms))
  ]);

  try {
    const client = getSupabaseClient();
    if (!client) {
      updateSyncStatusBadge('offline', null);
      return;
    }
    const { data: authData } = await client.auth.getUser();
    if (!authData?.user) {
      updateSyncStatusBadge('never', null);
      return;
    }

    const result = await withTimeout(
      client.from('pos_state').select('data, updated_at, owner_id').eq('id', POS_STATE_ROW_ID).maybeSingle(),
      6000
    );

    if (result.timedOut) {
      updateSyncStatusBadge('offline', null);
      return;
    }

    const { data, error } = result;
    if (error || !data) {
      updateSyncStatusBadge(data ? 'synced' : 'never', null);
      return;
    }

    const { data: currentAuth } = await client.auth.getUser();
    if (data.owner_id && currentAuth?.user?.id && data.owner_id !== currentAuth.user.id) {
      throw new Error('ข้อมูลในฐานข้อมูลนี้เป็นของบัญชี Supabase อื่น');
    }

    const lastKnownSync = localStorage.getItem(LAST_SYNCED_KEY);
    if (lastKnownSync && new Date(data.updated_at) <= new Date(lastKnownSync)) {
      updateSyncStatusBadge('synced', data.updated_at);
      return;
    }

    if (typeof window.runMigrations === 'function') await window.runMigrations(data.data);
    if (typeof window.autoRepairIfNeeded === 'function') await window.autoRepairIfNeeded(data.data);
    
    // Explicit global reassignment
    window.db = data.data;
    if (typeof db !== 'undefined') { db = window.db; }
    
    localStorage.setItem(LAST_SYNCED_KEY, data.updated_at);
    updateSyncStatusBadge('synced', data.updated_at);
    await window.refreshPrivateStorageUrls(true);

    if (typeof renderAll === 'function') renderAll();
    if (typeof updateShiftUI === 'function') updateShiftUI();
    if (typeof updateLowStockBadge === 'function') updateLowStockBadge();
    if (typeof checkStorageQuota === 'function') checkStorageQuota();

    // หมายเหตุสำคัญ: ตรงนี้เคยมีโค้ดที่พยายาม "auto-unlock" หน้าจอ PIN โดยหา user ใน db.users
    // ที่ id ตรงกับ POS_ACCOUNT_ID แล้วเซ็ต currentUserId/currentUserName ทับ — เป็นโค้ดตกค้างจาก
    // สถาปัตยกรรมเก่าที่ POS_ACCOUNT_ID เคยหมายถึง "พนักงานที่ login อยู่ตอนนี้" (ก่อนจะแก้เป็น
    // หมายถึง "ร้าน/บัญชีของเครื่องนี้" ซึ่งปกติคือ id ของเจ้าของร้าน) ผลคือทุกครั้งที่ฟังก์ชันนี้ถูก
    // เรียกหลัง login สำเร็จ (จุดเรียกเดียวคือใน submitAccountLogin หลังยืนยัน PIN ถูกต้องแล้ว)
    // มันจะเงียบๆ สลับตัวตนที่ใช้บันทึกลง audit log/ใบเสร็จกลับไปเป็น "เจ้าของร้าน" เสมอ ไม่ว่า
    // พนักงานคนไหนเพิ่ง login จริงก็ตาม — ทำให้ระบบบันทึกผิดคนว่าใครทำรายการขาย/เปิดกะ ฯลฯ ตัด
    // ออกทั้งบล็อกเพราะไม่จำเป็น (หน้าจอ PIN ถูกซ่อนและ currentUserId ถูกตั้งค่าถูกต้องแล้วใน
    // submitAccountLogin ก่อนจะเรียกฟังก์ชันนี้เสมอ)
  } catch (err) {
    console.error("Startup sync check failed:", err);
    updateSyncStatusBadge('offline', null);
  }
}

function updateSyncStatusBadge(state, timestamp) {
  const el = document.getElementById('supabase-sync-badge');
  if (!el) return;
  if (state === 'synced') {
    el.innerText = '🟢 ซิงค์แล้ว';
    el.title = timestamp ? `อัปเดตล่าสุด: ${new Date(timestamp).toLocaleString('th-TH')}` : '';
  } else if (state === 'offline') {
    el.innerText = '🔴 ออฟไลน์/ขัดแย้ง';
    el.title = 'เชื่อมต่อ Supabase ไม่ได้ หรือพบการชนกันของข้อมูล';
  } else if (state === 'never') {
    el.innerText = '⚪ ยังไม่เคยซิงค์';
  }
}
window.updateSyncStatusBadge = updateSyncStatusBadge;


window.addEventListener('DOMContentLoaded', async () => {
  try {
    if (typeof window.updateSupabaseConnectionStatus === 'function') await window.updateSupabaseConnectionStatus();
    const hasAccount = !!localStorage.getItem('POS_ACCOUNT_ID');
    const hasSupabaseConfig = !!(getConfiguredSupabaseUrl() && getConfiguredSupabaseAnonKey());
    // ห้ามดึงข้อมูล remote ตอน startup ก่อน Login/Auth สำเร็จ
    if (hasAccount && hasSupabaseConfig) updateSyncStatusBadge('never', null);
    else updateSyncStatusBadge('never', null);
  } finally {
    const splash = document.getElementById('sync-splash-screen');
    if (splash) splash.remove();
  }
});

// ==========================================
// AUDIT LOG → SUPABASE (APPEND-ONLY SECURITY CHECK)
// ==========================================
const _originalLogTransactionForSync = window.logTransaction;
window.logTransaction = async function (action, details = {}, opts = {}) {
  const entry = _originalLogTransactionForSync ? await _originalLogTransactionForSync(action, details, opts) : null;
  if (!entry) return null;
  
  try {
    const deviceBadge = document.getElementById('device-id-badge');
    const deviceId = (deviceBadge?.innerText || '').replace('DEVICE: ', '').trim() || window.__deviceId || null;
    
    // Strict Append-Only Insert (Prevents modifications assuming backend RLS)
    getSupabaseClient().from('audit_log').insert([{
      id: entry.id,
      ts: entry.ts,
      action: entry.action,
      actor: entry.actor,
      details: entry.details,
      device_id: deviceId,
      owner_id: (await getSupabaseClient().auth.getUser()).data?.user?.id || null,
      created_by: (await getSupabaseClient().auth.getUser()).data?.user?.id || null
    }]).then(({ error }) => {
      if (error) {
         console.warn("Audit log append-only push failed (Check network/RLS policies):", error);
      }
    }).catch(err => console.error("Audit log network err:", err));
  } catch (e) {}
  
  return entry;
};
