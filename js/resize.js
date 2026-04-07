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
    // 접힌 패널은 리사이즈 무시
    if (tgt.classList.contains('collapsed')) return;
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

  // 저장된 패널 접힘 상태 복원
  _restorePanelState();
}

function _restorePanelState() {
  if (localStorage.getItem('sidebar_collapsed') === 'true') {
    const sb = document.getElementById('sidebar');
    const btn = document.getElementById('sidebar-collapse-btn');
    if (sb) sb.classList.add('collapsed');
    if (btn) { btn.textContent = '▶'; btn.title = '사이드바 펼치기'; }
  }
  if (localStorage.getItem('aipanel_collapsed') === 'true') {
    const ai = document.getElementById('ai-panel');
    const btn = document.getElementById('ai-collapse-btn');
    if (ai) ai.classList.add('collapsed');
    if (btn) { btn.textContent = '◁'; btn.title = 'AI 패널 펼치기'; }
  }
}

function toggleSidebar() {
  const sb  = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-collapse-btn');
  const isCollapsed = sb.classList.toggle('collapsed');
  localStorage.setItem('sidebar_collapsed', isCollapsed);
  if (isCollapsed) {
    btn.textContent = '▶';
    btn.title = '사이드바 펼치기';
  } else {
    btn.textContent = '◀';
    btn.title = '사이드바 접기';
  }
}

function toggleAIPanel() {
  const ai  = document.getElementById('ai-panel');
  const btn = document.getElementById('ai-collapse-btn');
  const isCollapsed = ai.classList.toggle('collapsed');
  localStorage.setItem('aipanel_collapsed', isCollapsed);
  if (isCollapsed) {
    btn.textContent = '◁';
    btn.title = 'AI 패널 펼치기';
  } else {
    btn.textContent = '▶';
    btn.title = 'AI 패널 접기';
  }
}
