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
한국어 존댓말 사용. 질문은 한 번에 하나만.`;
  } else {
    const student_ = student;
    return `당신은 학교상담 임상 슈퍼바이저입니다.
내담자: ${student_?.alias || '?'} (${student_?.grade || ''}${student_?.gender ? ' · ' + student_.gender : ''})
가정: ${student_?.family || '정보 없음'} / 교우: ${student_?.peers || '정보 없음'}
한국어 존댓말 사용. 판단보다 질문으로 안내.`;
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

  appendSystemMessage('대화 준비가 되었어요!');
}
