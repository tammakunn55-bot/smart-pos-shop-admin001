/* js/app-init.js - Application Entry Point */

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const saved = await localforage.getItem(DB_KEY_BASE);
    if (saved) {
      db = { ...DB_DEFAULT, ...saved };
      window.db = db;
    }

    setInterval(() => {
      const clock = document.getElementById('clock');
      if (clock) clock.innerText = new Date().toLocaleTimeString('th-TH');
    }, 1000);

    renderAll();
  } catch (err) {
    console.error("Init error:", err);
  } finally {
    const splash = document.getElementById('sync-splash-screen');
    if (splash) splash.remove();
  }
});

