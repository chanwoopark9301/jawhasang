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

  // 일기 변환 모드: AI 없이 혼자 쓰기
  if (state.chatMode === 'diary-convert') {
    appendMessage('user', text);
    return;
  }

  // 새 대화창 구조: selSession/selRecord 없이 컨텍스트 대화
  continueContextChat(text);
}

async function continueContextChat(text) {
  if (!text || state._ctxChatLoading) return;
  state._ctxChatLoading = true;

  appendMessage('user', text);

  const isMyRecords = state.view === 'myrecords';
  const topic   = isMyRecords ? state.myTopics.find(t => t.id === state.selTopic) : null;
  const student = !isMyRecords ? state.students.find(s => s.id === state.selStudent) : null;

  const aiRole = topic?.aiPrompt || '따뜻하게 경청하고 공감하는 친구처럼';
  const sysPrompt = isMyRecords
    ? `당신은 ${aiRole} 역할입니다. 주제는 '${topic?.title || '나의 기록'}'입니다. 한국어 존댓말 사용.`
    : `당신은 학교상담 슈퍼바이저입니다. 내담자: ${student?.alias || '?'} (${student?.grade || ''}). 한국어 존댓말 사용.`;

  // currentChatMessages → Anthropic messages 형식 변환 (system 제외)
  const messages = state.currentChatMessages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 600,
        system: [{ type: 'text', text: sysPrompt, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    const data = await res.json();
    const reply = data.content?.map(c => c.text || '').join('').trim();
    if (reply) appendMessage('ai', reply);
  } catch (e) {
    appendMessage('ai', '죄송해요, 오류가 발생했어요. 다시 시도해주세요.');
  } finally {
    state._ctxChatLoading = false;
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
// 모바일 패널 토글 (resize.js에서 이전)
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

// iOS Safari 키보드 대응 — Visual Viewport API
function _initVisualViewport() {
  if (!window.visualViewport) return;

  function _onVVChange() {
    const vv = window.visualViewport;
    const inputArea = document.getElementById('input-area');
    const mobileNav = document.getElementById('mobile-nav');
    const kbHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const hasKeyboard = kbHeight > 50;

    if (inputArea && inputArea.style.display !== 'none') {
      if (hasKeyboard) {
        inputArea.style.marginBottom = kbHeight + 'px';
        if (mobileNav) mobileNav.style.opacity = '0';
      } else {
        inputArea.style.marginBottom = '';
        if (mobileNav) mobileNav.style.opacity = '';
      }
      const focused = document.activeElement;
      if (focused && focused.id === 'chat-input-bottom') {
        setTimeout(() => focused.scrollIntoView({ block: 'nearest' }), 50);
      }
    } else {
      if (mobileNav) mobileNav.style.opacity = '';
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

// ---------------------------------------------------------------------------
// 컨텍스트 대화 시작 (주제/내담자 선택 직후 AI 첫 마디)
// ---------------------------------------------------------------------------

async function startContextChat() {
  const isMyRecords = state.view === 'myrecords';
  const topic   = isMyRecords ? state.myTopics.find(t => t.id === state.selTopic) : null;
  const student = !isMyRecords ? state.students.find(s => s.id === state.selStudent) : null;

  const aiRole  = topic?.aiPrompt || '따뜻하게 경청하고 공감하는 친구처럼';
  const sysPrompt = isMyRecords
    ? `당신은 ${aiRole} 역할입니다. 주제는 '${topic?.title || '나의 기록'}'입니다. 한국어 존댓말 사용.`
    : `당신은 학교상담 슈퍼바이저입니다. 내담자: ${student?.alias || '?'} (${student?.grade || ''}). 한국어 존댓말 사용.`;

  const startMsg = isMyRecords
    ? '대화를 자연스럽게 시작해주세요. 판단 없이 들어주는 첫 마디를 해주세요.'
    : `${student?.alias || '내담자'} 학생의 상담을 시작하겠습니다. 첫 인삿말을 해주세요.`;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        system: [{ type: 'text', text: sysPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: startMsg }],
      }),
    });
    const data = await res.json();
    const text = data.content?.map(c => c.text || '').join('').trim();
    if (text) appendMessage('ai', text);
  } catch (e) {
    appendMessage('ai', '안녕하세요. 오늘 어떤 이야기를 나눠볼까요?');
  }
}
