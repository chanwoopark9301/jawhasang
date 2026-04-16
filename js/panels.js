/* =============================================
   自畵像 — 패널·사이드바·모바일 레이아웃
   의존성: state.js
   (chat.js에서 분리)
   ============================================= */

// ---------------------------------------------------------------------------
// + 버튼 팝업 메뉴
// ---------------------------------------------------------------------------

function openPlusMenu() {
  const existing = document.getElementById('plus-menu');
  if (existing) {
    existing.classList.toggle('open');
    return;
  }

  const isMyRecords = state.view === 'myrecords';
  const items = [
    { icon: '📎', label: '축어록 첨부',   action: `closePlusMenu();openModal('verbatim')`,       show: !isMyRecords },
    { icon: '✎',  label: '직접 쓰기',     action: `closePlusMenu();openModal('write')`,          show: isMyRecords },
    { icon: '◑',  label: '대화 모드 변경', action: `closePlusMenu();openModal('mode')` },
    { icon: '＋', label: isMyRecords ? '새 주제 만들기' : '새 내담자 추가',
      action: isMyRecords
        ? `closePlusMenu();openModal('new-topic')`
        : `closePlusMenu();openModal('new-student')` },
  ].filter(i => i.show !== false);

  const menu = document.createElement('div');
  menu.id        = 'plus-menu';
  menu.className = 'plus-menu open';
  menu.innerHTML = items.map((item, idx) => `
    <div class="pm-item" onclick="${item.action}">
      <span style="font-size:14px;">${item.icon}</span>
      <span>${esc(item.label)}</span>
    </div>
    ${idx === 1 ? '<div class="pm-separator"></div>' : ''}`).join('');

  const inputArea = document.getElementById('input-area');
  if (inputArea) inputArea.appendChild(menu);
  else document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('click', _closePlusMenuOutside, { once: true });
  }, 0);
}

function closePlusMenu() {
  document.getElementById('plus-menu')?.remove();
}

function _closePlusMenuOutside(e) {
  if (!document.getElementById('plus-menu')?.contains(e.target)) {
    closePlusMenu();
  }
}

// ---------------------------------------------------------------------------
// 사이드바 접기 토글 (데스크탑)
// ---------------------------------------------------------------------------

function toggleLeftSidebar() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  const collapsed = sb.classList.toggle('collapsed');
  localStorage.setItem('sb_left_collapsed', collapsed ? '1' : '');
  const btn = document.getElementById('sb-left-toggle');
  if (btn) btn.textContent = collapsed ? '›' : '‹';
}

function toggleRightPanel() {
  const rp = document.getElementById('right-panel');
  if (!rp) return;
  const collapsed = rp.classList.toggle('collapsed');
  localStorage.setItem('sb_right_collapsed', collapsed ? '1' : '');
  const btn = document.getElementById('sb-right-toggle');
  if (btn) btn.textContent = collapsed ? '‹' : '›';
}

function initSidebarState() {
  if (localStorage.getItem('sb_left_collapsed')) {
    document.getElementById('sidebar')?.classList.add('collapsed');
    const btn = document.getElementById('sb-left-toggle');
    if (btn) btn.textContent = '›';
  }
  if (localStorage.getItem('sb_right_collapsed')) {
    document.getElementById('right-panel')?.classList.add('collapsed');
    const btn = document.getElementById('sb-right-toggle');
    if (btn) btn.textContent = '‹';
  }
}

// ---------------------------------------------------------------------------
// 모바일 패널 토글
// ---------------------------------------------------------------------------

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ai = document.getElementById('right-panel');
  const bd = document.getElementById('panel-backdrop');
  if (!sb) return;
  const isOpen = sb.classList.toggle('panel-open');
  if (isOpen && ai) ai.classList.remove('panel-open');
  if (bd) bd.classList.toggle('visible', isOpen || !!(ai?.classList.contains('panel-open')));
  _updateMobileNavActive();
}

function toggleAIPanel() {
  const sb = document.getElementById('sidebar');
  const ai = document.getElementById('right-panel');
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
  document.getElementById('panel-backdrop')?.classList.remove('visible');
  _updateMobileNavActive();
}

function _updateMobileNavActive() {
  const sbOpen = document.getElementById('sidebar')?.classList.contains('panel-open');
  const aiOpen = document.getElementById('right-panel')?.classList.contains('panel-open');
  document.getElementById('mnav-list')?.classList.toggle('active', !!sbOpen);
  document.getElementById('mnav-main')?.classList.toggle('active', !sbOpen && !aiOpen);
  document.getElementById('mnav-ai')?.classList.toggle('active', !!aiOpen);
}

// ---------------------------------------------------------------------------
// iOS Safari 키보드 대응 — Visual Viewport API
// ---------------------------------------------------------------------------

function _initVisualViewport() {
  if (!window.visualViewport) return;

  function _onVVChange() {
    const vv = window.visualViewport;
    const kbHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const hasKeyboard = kbHeight > 50;

    // CSS 변수로 키보드 높이를 전달 → CSS에서 레이아웃 처리
    document.documentElement.style.setProperty('--kb-offset', hasKeyboard ? kbHeight + 'px' : '0px');

    const mobileNav = document.getElementById('mobile-nav');
    if (mobileNav) mobileNav.style.opacity = hasKeyboard ? '0' : '';

    // 키보드 올라올 때 대화창도 맨 아래로
    if (hasKeyboard) {
      setTimeout(() => scrollChatToBottom(), 80);
    }
  }

  window.visualViewport.addEventListener('resize', _onVVChange);
  window.visualViewport.addEventListener('scroll', _onVVChange);
}

// ---------------------------------------------------------------------------
// 모바일 레이아웃 업데이트 (render-main.js에서 호출)
// ---------------------------------------------------------------------------

function updateMobileLayout() {
  _updateMobileNavActive();
}
