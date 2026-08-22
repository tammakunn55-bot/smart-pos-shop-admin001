/* js/app-supabase.js - Supabase Client, Authentication & Image Uploads */

let _supabaseClient = null;

function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  const url = localStorage.getItem('pos_supabase_url') || "";
  const key = localStorage.getItem('pos_supabase_anon_key') || "";
  if (!url || !key || typeof window.supabase === 'undefined') return null;

  _supabaseClient = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return _supabaseClient;
}
window.getSupabaseClient = getSupabaseClient;

window.uploadProductImageToSupabase = async function(file, productId) {
  if (!file) return null;
  try {
    const client = getSupabaseClient();
    if (!client) throw new Error("ยังไม่ได้ตั้งค่า Supabase");

    const user = (await client.auth.getUser()).data?.user;
    if (!user) throw new Error("ต้องเข้าสู่ระบบ Supabase ก่อนอัปโหลดรูป");

    const ext = file.name.split('.').pop();
    const path = `${user.id}/products/${productId}-${Date.now()}.${ext}`;

    const { error: uploadError } = await client.storage
      .from('product-images')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) throw uploadError;

    const { data, error } = await client.storage.from('product-images').createSignedUrl(path, 86400);
    if (error) throw error;

    return { url: data.signedUrl, path };
  } catch (err) {
    console.error("Upload image failed:", err);
    showAlert("อัปโหลดไม่สำเร็จ", err.message);
    return null;
  }
};

window.refreshPrivateStorageUrls = async function(force = false) {
  try {
    const client = getSupabaseClient();
    if (!client) return;

    const user = (await client.auth.getUser()).data?.user;
    if (!user) return;

    const products = Object.values(db.products || {}).filter(p => p.imageStoragePath && p.imageStoragePath.startsWith(user.id + '/'));
    const productPaths = products.map(p => p.imageStoragePath);

    if (productPaths.length > 0) {
      const { data, error } = await client.storage.from('product-images').createSignedUrls(productPaths, 86400);
      if (!error && Array.isArray(data)) {
        data.forEach((r, idx) => {
          if (r?.signedUrl && products[idx]) {
            products[idx].imageUrl = r.signedUrl;
          }
        });
      }
    }
    persist();
  } catch (e) {
    console.warn("Refresh URLs failed:", e);
  }
};

window.pushFullStateToSupabaseSafe = async function(force = false) {
  try {
    const client = getSupabaseClient();
    if (!client) return false;

    const authUser = (await client.auth.getUser()).data?.user;
    if (!authUser) return false;

    const nowIso = new Date().toISOString();
    const stateForRemote = JSON.parse(JSON.stringify(db));

    const { error } = await client
      .from('pos_state')
      .upsert({ id: 'main', owner_id: authUser.id, updated_by: authUser.id, data: stateForRemote, updated_at: nowIso }, { onConflict: 'id' });

    if (error) throw error;
    return true;
  } catch (err) {
    console.error("Push failed:", err);
    return false;
  }
};

