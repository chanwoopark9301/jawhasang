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

  // 받아쓰기 모드: 사용자가 쭉 말할 수 있도록 AI가 매 턴 끼어들지 않는다.
  if ((state.replyMode || 'dictation') === 'dictation') {
    appendMessage('user', text);
    return;
  }

  console.log('[chat] continueContextChat 호출, text=', text);
  continueContextChat(text);
}

function setReplyMode(mode) {
  const allowed = ['dictation', 'question', 'summary', 'advice'];
  state.replyMode = allowed.includes(mode) ? mode : 'dictation';
  updateReplyModeUI();
}

function selectReplyModeFromModal(mode) {
  setReplyMode(mode);
  closeModal();
}

function updateReplyModeUI() {
  const modes = {
    dictation: { label: '받아쓰기 중', hint: 'AI는 끼어들지 않아요', placeholder: '정리 안 된 말 그대로 적어도 돼요' },
    question:  { label: '질문 하나',   hint: '보내면 질문 하나만 받을게요', placeholder: '질문 받고 싶은 지점을 적어주세요' },
    summary:   { label: '정리',        hint: '보내면 여기까지 정리해요', placeholder: '여기까지 정리해달라고 말해도 좋아요' },
    advice:    { label: '조언',        hint: '보내면 짧게 의견을 줄게요', placeholder: '의견이 필요한 상황을 적어주세요' },
  };
  const current = modes[state.replyMode] || modes.dictation;
  const chip = document.getElementById('reply-mode-chip');
  const hint = document.getElementById('reply-mode-hint');
  const input = document.getElementById('chat-input-bottom');
  if (chip) chip.textContent = current.label;
  if (hint) hint.textContent = current.hint;
  if (input) input.placeholder = current.placeholder;
}

async function continueContextChat(text) {
  if (!text || state._ctxChatLoading) return;
  state._ctxChatLoading = true;

  appendMessage('user', text);
  showTypingIndicator();

  const isMyRecords = state.view === 'myrecords';
  const topic   = isMyRecords ? state.myTopics.find(t => t.id === state.selTopic) : null;
  const student = !isMyRecords ? state.students.find(s => s.id === state.selStudent) : null;

  // AI 역할: state.currentRole → AI_ROLE_PRESETS에서 prompt 조회. 없으면 topic.aiPrompt 폴백
  const sysPrompt = _buildChatSysPrompt(isMyRecords, topic, student);

  // 슬라이딩 윈도우: 최근 20개만 전송 (토큰 절약)
  // 장기 맥락은 topic.patternAnalysis(사용자가 저장한 분석)가 시스템 프롬프트로 대체
  const WINDOW = 20;
  const messages = state.currentChatMessages
    .filter(m => m.role !== 'system')
    .slice(-WINDOW)
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
    else hideTypingIndicator();
  } catch (e) {
    appendMessage('ai', '죄송해요, 오류가 발생했어요. 다시 시도해주세요.');
  } finally {
    state._ctxChatLoading = false;
  }
}

// AI 대화용 시스템 프롬프트 생성 (현재 역할 기준으로 매 메시지마다 최신 반영)
function _buildChatSysPrompt(isMyRecords, topic, student) {
  const modePrompt = _replyModePrompt(state.replyMode || 'dictation');
  if (isMyRecords) {
    // currentRole → preset 조회, 없으면 topic.aiPrompt, 없으면 기본값
    let rolePrompt = '따뜻하게 경청하고 공감하는 친구처럼';
    const preset = AI_ROLE_PRESETS.find(p => p.id === state.currentRole);
    if (preset && preset.id !== 'custom' && preset.prompt) {
      rolePrompt = preset.prompt;
    } else if (topic?.aiPrompt) {
      rolePrompt = topic.aiPrompt;
    }
    return `당신은 다음 역할입니다: ${rolePrompt}

주제: '${topic?.title || '나의 기록'}'
한국어 존댓말 사용.

${modePrompt}`;
  } else {
    const student_ = student;
    return `당신은 학교상담 임상 슈퍼바이저입니다.
내담자: ${student_?.alias || '?'} (${student_?.grade || ''}${student_?.gender ? ' · ' + student_.gender : ''})
가정: ${student_?.family || '정보 없음'} / 교우: ${student_?.peers || '정보 없음'}
한국어 존댓말 사용.

${modePrompt}`;
  }
}

function _replyModePrompt(mode) {
  const shared = `공통 원칙:
- 사용자의 말을 끊거나 대화를 억지로 이어가지 않는다.
- 사용자가 요청하지 않으면 분석, 조언, 해석을 길게 하지 않는다.
- 응답은 기본적으로 1~3문장으로 짧게 한다.
- 한국어 존댓말을 사용한다.`;

  if (mode === 'question') {
    return `${shared}

현재 응답 모드: 질문 하나
- 사용자가 생각을 이어갈 수 있도록 질문은 정확히 하나만 한다.
- 질문 전에 사용자의 핵심을 한 문장으로 짚는다.
- 질문 뒤에 추가 설명이나 두 번째 질문을 붙이지 않는다.`;
  }
  if (mode === 'summary') {
    return `${shared}

현재 응답 모드: 정리
- 지금까지 사용자가 말한 내용을 기록으로 남길 수 있게 정리한다.
- 제목 후보, 핵심 감정/생각, 남겨둘 문장을 간결하게 제안한다.
- 후속 질문을 하지 않는다.`;
  }
  if (mode === 'advice') {
    return `${shared}

현재 응답 모드: 조언
- 사용자가 조언을 원하는 것으로 보고, 조심스럽지만 분명한 의견을 준다.
- 가능한 다음 행동은 하나만 제안한다.
- 조언 뒤에 대화를 이어가려는 질문을 붙이지 않는다.`;
  }
  return `${shared}

현재 응답 모드: 받아쓰기
- 당신은 대화를 이어가기 위해 질문하는 챗봇이 아니라, 사용자의 말을 받아 적고 핵심을 짧게 붙잡는 기록 조력자다.
- 사용자가 요청하지 않으면 후속 질문을 하지 않는다.
- 사용자의 말을 기록 가능한 핵심 표현으로 1~2문장만 정리한다.
- "더 말해볼까요?", "어떤 기분이었나요?" 같은 자동 질문을 피한다.
- 필요하면 "기록해둘게요", "핵심은 ~로 남겨둘 수 있어요"처럼 반응한다.`;
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
  // main-content가 실제 스크롤 컨테이너 (chat-messages는 내부 flex 요소)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const container = document.getElementById('main-content');
      if (container) container.scrollTop = container.scrollHeight;
    });
  });
}

// ---------------------------------------------------------------------------
// 대화창 렌더링 (currentChatMessages 기반)
// ---------------------------------------------------------------------------

function renderChatView() {
  // 상세 뷰가 열려있으면 chat이 덮어쓰지 않음 (레이스 컨디션 방지)
  if (state.selRecord || state.selSession) return;
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
  // 들여쓰기 없이 인라인 — white-space:pre-wrap 이 템플릿 공백을 그대로 렌더링하므로
  return `<div class="chat-bubble-wrap ${isUser ? 'user' : 'ai'}"><div class="chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-ai'}">${esc(m.text)}</div></div>`;
}

// ---------------------------------------------------------------------------
// 입력 중 표시 (점 3개 애니메이션)
// ---------------------------------------------------------------------------

function showTypingIndicator() {
  if (state.selRecord || state.selSession) return;
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

function startContextChat() {
  const isMyRecords = state.view === 'myrecords';

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
  renderChatView();
}
