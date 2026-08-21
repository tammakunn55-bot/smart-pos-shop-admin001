/* Smart POS V3 UI controller
   Presentation-only enhancements. Business logic remains in the existing modules. */
(function(){
  const ready = fn => document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn, {once:true})
    : fn();

  ready(() => {
    // Add accessible labels without changing existing handlers.
    document.querySelectorAll('#bottom-nav .nav-btn-el').forEach(btn => {
      const label = btn.querySelector('span:last-child')?.textContent?.trim();
      if (label && !btn.getAttribute('aria-label')) btn.setAttribute('aria-label', label);
    });

    // Keep import image selection feedback immediate and readable.
    const imageInput = document.getElementById('import-image-files-uploader');
    if (imageInput) {
      imageInput.addEventListener('change', () => {
        const count = document.getElementById('import-image-file-count');
        if (count && imageInput.files) {
          count.textContent = imageInput.files.length
            ? `เลือกแล้ว ${imageInput.files.length.toLocaleString()} รูป`
            : 'ยังไม่ได้เลือกรูป';
        }
      });
    }

    // Prevent accidental double taps on destructive/commit actions.
    document.addEventListener('click', ev => {
      const btn = ev.target.closest('#btn-confirm-import, #btn-confirm-import-with-images');
      if (!btn || btn.disabled || btn.classList.contains('hidden')) return;
      // Let the existing handler run; lock only for the next short window.
      btn.dataset.v3Busy = '1';
      setTimeout(() => delete btn.dataset.v3Busy, 1400);
    }, true);

    // Make the current bottom-nav item visually explicit.
    const updateNav = () => {
      const active = document.querySelector('.view-content:not(.hidden)');
      const name = active?.id?.replace(/^view-/,'');
      document.querySelectorAll('#bottom-nav .nav-btn-el').forEach(btn => {
        const on = btn.dataset.view === name;
        btn.classList.toggle('bg-indigo-50', on);
        btn.classList.toggle('text-indigo-700', on);
        btn.classList.toggle('opacity-100', on);
        btn.classList.toggle('opacity-40', !on);
      });
    };
    updateNav();
    const main = document.getElementById('app-main');
    if (main && window.MutationObserver) {
      new MutationObserver(updateNav).observe(main, {subtree:true, attributes:true, attributeFilter:['class']});
    }
  });
})();
