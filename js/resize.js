/* =============================================
   自畵像 — 패널 토글 (모바일 오버레이 전용)
   데스크탑: 사이드바/오른쪽 패널이 항상 고정 표시되므로 동작 없음.
   모바일(≤767px): 기존 오버레이 슬라이드 방식 유지.
   ============================================= */

function initResize() {
  localStorage.removeItem('sidebar_collapsed');
  localStorage.removeItem('aipanel_collapsed');
  _initVisualViewport();
}

// ---------------------------------------------------------------------------
// iOS Safari 키보드 대응 — Visual Viewport API
// 키보드가 올라올 때 하단 input-area가 가려지는 문제 방지
// ---------------------------------------------------------------------------

function _initVisualViewport() {
  if (!window.visualViewport) return;

  function _onVVChange() {
    const vv = window.visualViewport;
    const inputArea = document.getElementById('input-area');
    const mobileNav = document.getElementById('mobile-nav');

    // 키보드 높이 = 윈도우 높이 - 비주얼뷰포트 높이 - 뷰포트 오프셋
    const kbHeight = Math.max(0,
      window.innerHeight - vv.height - vv.offsetTop
    );
    const hasKeyboard = kbHeight > 50;

    // input-area가 표시 중일 때만 처리
    if (inputArea && inputArea.style.display !== 'none') {
      if (hasKeyboard) {
        // 키보드 높이만큼 input-area를 위로 밀어올림
        inputArea.style.marginBottom = kbHeight + 'px';
        // 모바일 내비게이션은 키보드 뒤로 숨김
        if (mobileNav) mobileNav.style.opacity = '0';
      } else {
        inputArea.style.marginBottom = '';
        if (mobileNav) mobileNav.style.opacity = '';
      }
      // 포커스된 입력창이 가려지지 않도록 스크롤
      const focused = document.activeElement;
      if (focused && (focused.id === 'chat-input-bottom')) {
        setTimeout(() => focused.scrollIntoView({ block: 'nearest' }), 50);
      }
    } else {
      // input-area 숨김 상태 — 키보드가 올라와도 기본 상태 유지
      if (mobileNav) mobileNav.style.opacity = '';
    }
  }

  window.visualViewport.addEventListener('resize', _onVVChange);
  window.visualViewport.addEventListener('scroll', _onVVChange);
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
