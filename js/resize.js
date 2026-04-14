/* =============================================
   自畵像 — 패널 오버레이 토글
   의존성: 없음
   ============================================= */

function initResize() {
  // 드래그 리사이즈 폐기 — 오버레이 패널 방식으로 전환
  // 기존 collapsed 상태 무시 (새 방식에서는 panel-open 클래스만 사용)
  localStorage.removeItem('sidebar_collapsed');
  localStorage.removeItem('aipanel_collapsed');
}

// ---------------------------------------------------------------------------
// 패널 열기 / 닫기
// ---------------------------------------------------------------------------

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ai = document.getElementById('ai-panel');
  const bd = document.getElementById('panel-backdrop');
  const isOpen = sb.classList.toggle('panel-open');
  // 양쪽 동시 열림 방지
  if (isOpen) ai.classList.remove('panel-open');
  bd.classList.toggle('visible', isOpen || ai.classList.contains('panel-open'));
  _updateMobileNavActive();
}

function toggleAIPanel() {
  const sb = document.getElementById('sidebar');
  const ai = document.getElementById('ai-panel');
  const bd = document.getElementById('panel-backdrop');
  const isOpen = ai.classList.toggle('panel-open');
  if (isOpen) sb.classList.remove('panel-open');
  bd.classList.toggle('visible', isOpen || sb.classList.contains('panel-open'));
  _updateMobileNavActive();
}

function closePanels() {
  document.getElementById('sidebar')?.classList.remove('panel-open');
  document.getElementById('ai-panel')?.classList.remove('panel-open');
  document.getElementById('panel-backdrop')?.classList.remove('visible');
  _updateMobileNavActive();
}

function _updateMobileNavActive() {
  const sbOpen = document.getElementById('sidebar')?.classList.contains('panel-open');
  const aiOpen = document.getElementById('ai-panel')?.classList.contains('panel-open');
  document.getElementById('mnav-list')?.classList.toggle('active', !!sbOpen);
  document.getElementById('mnav-main')?.classList.toggle('active', !sbOpen && !aiOpen);
  document.getElementById('mnav-ai')?.classList.toggle('active', !!aiOpen);
}
