/* =============================================
   自畵像 — 대화창 통합 관리
   의존성: state.js, utils.js, ai-counseling.js, ai-myrecords.js, modal.js
   ============================================= */

// ---------------------------------------------------------------------------
// 입력창 키 핸들러
// ---------------------------------------------------------------------------

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCurrentChat();
  }
}

// ---------------------------------------------------------------------------
// 전송 라우팅
// ---------------------------------------------------------------------------

function sendCurrentChat() {
  const input = document.getElementById('chat-input-bottom');
  const text  = input?.value.trim();
  if (!text) return;
  input.value = '';

  if (state.view === 'myrecords') {
    sendMyChatMessage(text);
  } else {
    sendChatMessage(text);
  }
}

// ---------------------------------------------------------------------------
// state.currentChatMessages 관리
// ---------------------------------------------------------------------------

function appendMessage(role, text) {
  state.currentChatMessages.push({ role, text });
  renderChatView();
  scrollChatToBottom();
}

function appendSystemMessage(text) {
  state.currentChatMessages.push({ role: 'system', text });
  renderChatView();
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
    // 기존 대화 컨테이너도 함께 처리
    const el2 = document.getElementById('my-chat-messages');
    if (el2) el2.scrollTop = el2.scrollHeight;
  });
}

// ---------------------------------------------------------------------------
// 대화창 렌더링 (currentChatMessages 기반)
// ---------------------------------------------------------------------------

function renderChatView() {
  const content = document.getElementById('main-content');
  if (!content) return;
  if (!state.currentChatMessages.length) {
    content.innerHTML = '<div class="empty-state">대화를 시작해보세요</div>';
    return;
  }
  content.innerHTML = `<div id="chat-messages" style="display:flex;flex-direction:column;gap:12px;padding:20px 0;">
    ${state.currentChatMessages.map(m => renderChatBubble(m)).join('')}
  </div>`;
  scrollChatToBottom();
}

function renderChatBubble(m) {
  if (m.role === 'system') {
    return `<div class="chat-system-msg">${esc(m.text)}</div>`;
  }
  const isUser = m.role === 'user';
  return `<div style="display:flex;justify-content:${isUser ? 'flex-end' : 'flex-start'};">
    <div style="max-width:75%;padding:10px 14px;border-radius:${isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px'};
      background:${isUser ? 'var(--color-accent)' : 'var(--color-bg-secondary)'};
      color:${isUser ? 'white' : 'var(--color-text)'};
      font-size:13px;line-height:1.7;white-space:pre-wrap;">
      ${esc(m.text)}
    </div>
  </div>`;
}

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

  // 입력창 바로 위에 삽입
  const inputArea = document.getElementById('input-area');
  if (inputArea) inputArea.appendChild(menu);
  else document.body.appendChild(menu);

  // 외부 클릭 시 닫기
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
// 사이드바 접기 토글
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
// 모바일 레이아웃 업데이트 (render-main.js에서 호출)
// ---------------------------------------------------------------------------

function updateMobileLayout() {
  // 기존 resize.js의 _updateMobileNavActive 호환
  if (typeof _updateMobileNavActive === 'function') _updateMobileNavActive();
}
