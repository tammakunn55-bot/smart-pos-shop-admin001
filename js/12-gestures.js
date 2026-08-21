/* ==========================================
       SWIPE GESTURES — ปัดจอเพื่อสะดวกขึ้น
       หน้าขาย: ปัดซ้าย/ขวา = เปลี่ยนหมวดหมู่ถัดไป/ก่อนหน้า
       หน้าคลัง: ปัดซ้าย/ขวา = หน้าถัดไป/ก่อนหน้าของตาราง
       ========================================== */
    function attachSwipeGesture(elementId, onSwipeLeft, onSwipeRight) {
      const el = document.getElementById(elementId);
      if (!el) return;
      let startX = 0, startY = 0, startTime = 0;
      const MIN_DISTANCE = 60;   // ต้องปัดอย่างน้อยกี่พิกเซลถึงจะนับ กันการปัดมือสั่น/สครอลผิด
      const MAX_OFF_AXIS = 60;   // ปัดแนวตั้งเกินนี้ = ถือว่ากำลังสครอลหน้าจอ ไม่ใช่ปัดเปลี่ยนหน้า
      const MAX_DURATION = 600;  // ปัดช้าเกินนี้ = ถือว่าไม่ใช่ swipe (อาจแค่ลากนิ้วเฉยๆ)

      el.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        startX = t.screenX; startY = t.screenY; startTime = Date.now();
      }, { passive: true });

      el.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0];
        const dx = t.screenX - startX;
        const dy = t.screenY - startY;
        const dt = Date.now() - startTime;
        if (dt > MAX_DURATION) return;
        if (Math.abs(dy) > MAX_OFF_AXIS) return;
        if (dx <= -MIN_DISTANCE) onSwipeLeft && onSwipeLeft();
        else if (dx >= MIN_DISTANCE) onSwipeRight && onSwipeRight();
      }, { passive: true });
    }

    window.swipeToAdjacentCategory = function (direction) {
      const topLevel = db.categories.filter(c => !c.parentId);
      if (topLevel.length === 0) return;
      const curIdx = topLevel.findIndex(c => c.name === activeCategory);
      let nextIdx;
      if (curIdx === -1) nextIdx = 0;
      else nextIdx = (curIdx + direction + topLevel.length) % topLevel.length;
      window.selectCategory(topLevel[nextIdx].name);
      showToast(`📁 ${topLevel[nextIdx].name}`);
    };

    document.addEventListener('DOMContentLoaded', () => {
      attachSwipeGesture('product-selection', () => window.swipeToAdjacentCategory(1), () => window.swipeToAdjacentCategory(-1));
    });
