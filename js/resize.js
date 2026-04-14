/* =============================================
   自畵像 — 패널 토글 (모바일 오버레이 전용)
   데스크탑: 사이드바/오른쪽 패널이 항상 고정 표시되므로 동작 없음.
   모바일(≤767px): 기존 오버레이 슬라이드 방식 유지.
   ============================================= */

function initResize() {
  localStorage.removeItem('sidebar_collapsed');
  localStorage.removeItem('aipanel_collapsed');
}

// ---------------------------------------------------------------------------
// 패널 열기 / 닫기
// ---------------------------------------------------------------------------

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ai = document.getElementById('right-panel') || document.getElementById('ai-panel');
  const bd = document.getElementById('panel-backdrop');
  if (!sb) return;
  const isOpen = sb.classList.toggle('panel-open');
  if (isOpen && ai) ai.classList.remove('panel-open');
  if (bd) bd.classList.toggle('visible', isOpen || !!(ai?.classList.contains('panel-open')));
  _updateMobileNavActive();
}

function toggleAIPanel() {
  const sb = document.getElementById('sidebar');
  const ai = document.getElementById('right-panel') || document.getElementById('ai-panel');
  const bd = document.getElementById('panel-backdrop');
  if (!ai) return;
  const isOpen = ai.classList.toggle('panel-open');
  if (isOpen && sb) sb.classList.remove('panel-open');
  if (bd) bd.classList.toggle('visible', isOpen || !!(sb?.classList.contains('panel-open')));
  _updateMobileNavActive();
}

function closePanels() {
  document.getElementById('sidebar')?.classList.remove('panel-open');
  document.getElementById('right-panel')?.classList.remove('panel-open');
  document.getElementById('ai-panel')?.classList.remove('panel-open');
  document.getElementById('panel-backdrop')?.classList.remove('visible');
  _updateMobileNavActive();
}

function _updateMobileNavActive() {
  const sbOpen = document.getElementById('sidebar')?.classList.contains('panel-open');
  const aiOpen = (document.getElementById('right-panel') || document.getElementById('ai-panel'))
                   ?.classList.contains('panel-open');
  document.getElementById('mnav-list')?.classList.toggle('active', !!sbOpen);
  document.getElementById('mnav-main')?.classList.toggle('active', !sbOpen && !aiOpen);
  document.getElementById('mnav-ai')?.classList.toggle('active', !!aiOpen);
}
