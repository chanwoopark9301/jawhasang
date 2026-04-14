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
  console.log('[chat] sendCurrentChat 호출됨');
  const input = document.getElementById('chat-input-bottom');
  console.log('[chat] input 요소:', input, '| 값:', input?.value);
  const text  = input?.value.trim();
  if (!text) { console.warn('[chat] 빈 입력 — 전송 중단'); return; }
  input.value = '';

  // 일기 변환 모드: AI 없이 혼자 쓰기
  if (state.chatMode === 'diary-convert') {
    appendMessage('user', text);
    return;
  }

  console.log('[chat] continueContextChat 호출, text=', text);
  continueContextChat(text);
}

async function continueContextChat(text) {
  console.log('[chat] continueContextChat 진입, _ctxChatLoading=', state._ctxChatLoading);
  if (!text || state._ctxChatLoading) {
    console.warn('[chat] 조기 리턴 — text:', text, '_ctxChatLoading:', state._ctxChatLoading);
    return;
  }
  state._ctxChatLoading = true;

  appendMessage('user', text);
  showTypingIndicator();

  const isMyRecords = state.view === 'myrecords';
  const topic   = isMyRecords ? state.myTopics.find(t => t.id === state.selTopic) : null;
  const student = !isMyRecords ? state.students.find(s => s.id === state.selStudent) : null;

  const aiRole = topic?.aiPrompt || '따뜻하게 경청하고 공감하는 친구처럼';
  const sysPrompt = isMyRecords
    ? `당신은 ${aiRole} 역할입니다. 주제는 '${topic?.title || '나의 기록'}'입니다. 한국어 존댓말 사용.`
    : `당신은 학교상담 슈퍼바이저입니다. 내담자: ${student?.alias || '?'} (${student?.grade || ''}). 한국어 존댓말 사용.`;

  // currentChatMessages → Anthropic messages 형식 변환
  // system 메시지 제외, hidden 메시지는 UI엔 안 보이지만 API context엔 포함
  const messages = state.currentChatMessages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));

  console.log('[chat] API 전송 직전 — messages:', JSON.stringify(messages));

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
    console.log('[chat] API 응답 status:', res.status, res.ok);
    const data = await res.json();
    console.log('[chat] API 응답 data:', JSON.stringify(data).slice(0, 300));
    const reply = data.content?.map(c => c.text || '').join('').trim();
    if (reply) appendMessage('ai', reply); // appendMessage가 renderChatView 호출 → 표시기 자동 제거
    else { hideTypingIndicator(); console.warn('[chat] reply 비어있음 — data.content:', data.content, 'data.error:', data.error); }
  } catch (e) {
    console.error('[chat] 예외 발생:', e);
    appendMessage('ai', '죄송해요, 오류가 발생했어요. 다시 시도해주세요.');
  } finally {
    state._ctxChatLoading = false;
  }
}

// ---------------------------------------------------------------------------
// 대화 내용 localStorage 저장/복원 (새로고침·탭 전환 후에도 유지)
// ---------------------------------------------------------------------------

function _chatStorageKey() {
  const id = state.selTopic || state.selStudent;
  return id ? `jip_chat_${id}` : null;
}

function saveChatHistory() {
  const key = _chatStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(state.currentChatMessages));
  } catch (e) { /* 용량 초과 무시 */ }
}

function loadChatHistory() {
  const key = _chatStorageKey();
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const msgs = JSON.parse(raw);
    if (Array.isArray(msgs) && msgs.length) {
      state.currentChatMessages = msgs;
      return true;
    }
  } catch (e) { /* 파싱 오류 무시 */ }
  return false;
}

// ---------------------------------------------------------------------------
// state.currentChatMessages 관리
// ---------------------------------------------------------------------------

function appendMessage(role, text) {
  state.currentChatMessages.push({ role, text });
  saveChatHistory();
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
  content.innerHTML = `<div class="chat-messages" id="chat-messages">
    ${state.currentChatMessages.map(m => renderChatBubble(m)).join('')}
  </div>`;
  scrollChatToBottom();
}

function renderChatBubble(m) {
  if (m.hidden) return '';
  if (m.role === 'system') {
    return `<div class="chat-system-msg">${esc(m.text)}</div>`;
  }
  const isUser = m.role === 'user';
  return `<div class="chat-bubble-wrap ${isUser ? 'user' : 'ai'}">
    <div class="chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-ai'}">
      ${esc(m.text)}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 입력 중 표시 (점 3개 애니메이션)
// ---------------------------------------------------------------------------

function showTypingIndicator() {
  let msgs = document.getElementById('chat-messages');
  if (!msgs) {
    // 첫 메시지 전 상태 — 컨테이너 생성
    const content = document.getElementById('main-content');
    if (!content) return;
    content.innerHTML = '<div class="chat-messages" id="chat-messages"></div>';
    msgs = document.getElementById('chat-messages');
  }
  document.getElementById('chat-typing-indicator')?.remove();
  const el = document.createElement('div');
  el.id = 'chat-typing-indicator';
  el.className = 'chat-bubble-wrap ai';
  el.innerHTML = `<div class="chat-bubble chat-bubble-ai chat-typing">
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  </div>`;
  msgs.appendChild(el);
  scrollChatToBottom();
}

function hideTypingIndicator() {
  document.getElementById('chat-typing-indicator')?.remove();
}

// ---------------------------------------------------------------------------
// 컨텍스트 대화 시작 (주제/내담자 선택 직후 AI 첫 마디)
// ---------------------------------------------------------------------------

async function startContextChat() {
  const isMyRecords = state.view === 'myrecords';
  const topic   = isMyRecords ? state.myTopics.find(t => t.id === state.selTopic) : null;
  const student = !isMyRecords ? state.students.find(s => s.id === state.selStudent) : null;

  // 상담 기록 — 기존 슈퍼비전 대화 이력 복원
  if (!isMyRecords && state.selSession) {
    const session = state.sessions.find(s => s.id === state.selSession);
    if (session?.supervisionChat?.length) {
      state.currentChatMessages = session.supervisionChat.map(m => ({
        role: m.role, text: m.text,
      }));
      renderChatView();
      return;
    }
  }

  // 나의 기록 — 최근 기록 컨텍스트
  const recentRecords = isMyRecords
    ? state.myRecords
        .filter(r => r.topicId === state.selTopic)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3)
    : [];
  const isFirstRecord = recentRecords.length === 0;
  const recentRecordContext = isFirstRecord
    ? '이 주제의 첫 번째 대화입니다.'
    : `최근 기록 ${recentRecords.length}개:\n` +
      recentRecords.map(r =>
        `[${r.date}] ${r.content.substring(0, 150)}`
      ).join('\n\n');

  // 상담 기록 — 최근 회기 컨텍스트
  const recentSessions = !isMyRecords
    ? state.sessions
        .filter(s => s.studentId === state.selStudent)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 2)
    : [];
  const isFirstSession = recentSessions.length === 0;
  const recentSessionContext = isFirstSession
    ? '첫 번째 상담입니다.'
    : `최근 회기:\n` +
      recentSessions.map(s =>
        `[${s.date} · ${s.sessionNum}회기] ${
          s.analysis?.overall || s.verbatim?.substring(0, 150) || '기록 없음'
        }`
      ).join('\n\n');

  const aiRole = topic?.aiPrompt || '따뜻하게 경청하고 공감하는 친구처럼';

  const sysPrompt = isMyRecords
    ? `당신은 ${aiRole} 역할입니다.
주제: '${topic?.title || '나의 기록'}'

${recentRecordContext}

대화 원칙:
- 처음 만난 사람처럼 대하지 말 것. 이 사람의 흐름을 알고 있는 사람처럼.
- 칭찬보다 관심. 조언보다 공감이 먼저.
- 구체적인 내용을 언급할 것. "기록하셨군요"가 아니라 최근 기록의 구체적 내용을 언급.
- ${isFirstRecord
    ? '첫 기록이니 어떤 계기로 시작했는지 자연스럽게 물어볼 것.'
    : '가장 최근 기록에서 자연스럽게 이어받을 것.'}
- 질문은 한 번에 하나만. 짧고 자연스럽게.
- 한국어 존댓말 사용.`
    : `당신은 학교상담 임상 슈퍼바이저입니다.
내담자: ${student?.alias || '?'} (${student?.grade || ''}${student?.gender ? ' · ' + student.gender : ''})
가정: ${student?.family || '정보 없음'}
교우: ${student?.peers || '정보 없음'}
상황: ${student?.situation || '정보 없음'}

${recentSessionContext}

대화 원칙:
- 상담사의 감각과 경험을 먼저 물어볼 것. 정보 수집보다 성찰이 먼저.
- ${isFirstSession
    ? '첫 회기이니 이 내담자를 맡게 된 배경이나 첫인상을 물어볼 것.'
    : '직전 회기에서 자연스럽게 이어받을 것.'}
- 판단하지 말고, 상담사가 스스로 발견하도록 질문으로 안내.
- 질문은 한 번에 하나만.
- 한국어 존댓말 사용.`;

  const startMsg = isMyRecords
    ? (isFirstRecord
        ? '지금 이 주제로 첫 대화를 시작합니다. 자연스럽게 첫 마디를 해주세요.'
        : '최근 기록을 바탕으로 자연스럽게 대화를 이어받아 첫 마디를 해주세요. 요약하거나 정리하지 말고, 그냥 이어서 대화하듯이.')
    : (isFirstSession
        ? '첫 회기입니다. 자연스럽게 첫 인삿말을 해주세요.'
        : '직전 회기를 바탕으로 자연스럽게 이어받아 첫 마디를 해주세요.');

  // hidden trigger — Anthropic API first-message-must-be-user 준수
  state.currentChatMessages.push({ role: 'user', text: startMsg, hidden: true });
  showTypingIndicator();

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
    else hideTypingIndicator();
  } catch (e) {
    hideTypingIndicator();
    appendMessage('ai', '안녕하세요. 오늘 어떤 이야기를 나눠볼까요?');
  }
}
