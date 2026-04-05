/* =============================================
   自畵像 — 패널 리사이즈
   의존성: nav.js (updateMobileLayout)

   버그픽스: _resizeInitialized 가드로 중복 리스너 방지
   ============================================= */

let _resizeInitialized = false;

function initResize() {
  if (_resizeInitialized) return;
  _resizeInitialized = true;

  const rh1 = document.getElementById('rh-1');
  const rh2 = document.getElementById('rh-2');
  const sb  = document.getElementById('sidebar');
  const ai  = document.getElementById('ai-panel');
  let dr    = null;

  function onDown(e, tgt, hdl, inv) {
    dr = { tgt, hdl, inv, sx: e.clientX, sw: tgt.offsetWidth };
    hdl.classList.add('dragging');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  rh1.addEventListener('mousedown', e => onDown(e, sb, rh1, false));
  rh2.addEventListener('mousedown', e => onDown(e, ai, rh2, true));

  document.addEventListener('mousemove', e => {
    if (!dr) return;
    const delta = dr.inv ? dr.sx - e.clientX : e.clientX - dr.sx;
    const w     = Math.max(140, Math.min(480, dr.sw + delta));
    document.documentElement.style.setProperty(
      dr.tgt === sb ? '--sidebar-width' : '--ai-width', w + 'px'
    );
  });

  document.addEventListener('mouseup', () => {
    if (!dr) return;
    dr.hdl.classList.remove('dragging');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    dr = null;
  });

  window.addEventListener('resize', updateMobileLayout);
}
