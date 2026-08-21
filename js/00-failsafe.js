// FAILSAFE: force-remove the startup splash after 15s no matter what happens
      // elsewhere (slow/blocked CDN, unexpected error, etc.) so the app can never
      // hang forever on this screen.
      setTimeout(function () {
        var splash = document.getElementById('sync-splash-screen');
        if (splash) splash.remove();
      }, 15000);


// SMART POS LOGOUT FAILSAFE
(function () {
  function doLogout() {
    try {
      if (typeof window.logoutCurrentUser === 'function' && window.logoutCurrentUser !== doLogout) {
        return window.logoutCurrentUser();
      }
      var finish = function () {
        try { ['POS_SUPABASE_AUTH_USER_ID','POS_ACCOUNT_ID','POS_STORE_ID','POS_STORE_NAME','POS_STORE_ROLE'].forEach(function(k){localStorage.removeItem(k);}); } catch (_) {}
        try { location.reload(); } catch (_) {}
      };
      if (typeof window.signOutSupabaseOnly === 'function') {
        Promise.resolve(window.signOutSupabaseOnly()).catch(function () {}).finally(finish);
      } else finish();
    } catch (_) {}
  }
  window.logoutCurrentUser = window.logoutCurrentUser || doLogout;
  window.confirmLogout = window.confirmLogout || function () {
    var message = 'ระบบจะบันทึกข้อมูลที่ค้างอยู่ก่อน แล้วออกจากบัญชีบนเครื่องนี้ ต้องการดำเนินการต่อหรือไม่?';
    if (typeof window.showCustomConfirm === 'function') {
      window.showCustomConfirm('ออกจากระบบ?', message, function () { Promise.resolve(doLogout()).catch(function () {}); });
      return;
    }
    try { if (window.confirm('ออกจากระบบ?\n\n' + message)) doLogout(); } catch (_) {}
  };
})();
