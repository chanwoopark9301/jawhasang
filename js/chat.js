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
  // 투자 파트너는 대화가 메인 기능이므로 기본적으로 AI가 응답한다.
  if ((state.replyMode || 'dictation') === 'dictation' && state.view !== 'investment') {
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
    dictation: '정리 안 된 말 그대로 적어도 돼요',
    question:  '묻고 싶은 걸 그대로 적어주세요',
    summary:   '여기까지 정리해달라고 말해도 좋아요',
    advice:    '의견이 필요한 상황을 적어주세요',
  };
  const input = document.getElementById('chat-input-bottom');
  if (input) input.placeholder = modes[state.replyMode] || modes.dictation;
}

async function continueContextChat(text) {
  if (!text || state._ctxChatLoading) return;
  state._ctxChatLoading = true;

  appendMessage('user', text);
  showTypingIndicator();

  const isMyRecords = state.view === 'myrecords';
  const isInvestment = state.view === 'investment';
  const topic   = isMyRecords ? state.myTopics.find(t => t.id === state.selTopic) : null;
  const student = (!isMyRecords && !isInvestment) ? state.students.find(s => s.id === state.selStudent) : null;

  const investmentNewsContext = isInvestment ? await fetchInvestmentNewsContext(text) : '';

  // AI 역할: state.currentRole → AI_ROLE_PRESETS에서 prompt 조회. 없으면 topic.aiPrompt 폴백
  const sysPrompt = _buildChatSysPrompt(isMyRecords, topic, student, investmentNewsContext);

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
    if (reply) {
      appendMessage('ai', reply);
      saveSummaryReplyAsRecord(reply);
      saveInvestmentChatArtifacts(text, reply);
    } else {
      hideTypingIndicator();
    }
  } catch (e) {
    appendMessage('ai', '죄송해요, 오류가 발생했어요. 다시 시도해주세요.');
  } finally {
    state._ctxChatLoading = false;
  }
}

function saveSummaryReplyAsRecord(text) {
  if (state.replyMode !== 'summary') return;
  if (state.view !== 'myrecords' || !state.selTopic) return;
  const content = (text || '').trim();
  if (!content) return;

  const record = {
    id: 'r' + Date.now(),
    topicId:   state.selTopic,
    date:      new Date().toISOString().split('T')[0],
    recordNum: getNextRecordNum(state.selTopic),
    content,
    memo:      '대화 정리',
    tags:      [],
    analysis:  null,
    aiChat:    [...(state.currentChatMessages || [])],
  };
  state.myRecords.push(record);
  saveData();
  showToast('정리해서 기록으로 저장했어요.');
  renderRightPanel();
  renderSidebar();
}

function saveInvestmentChatArtifacts(userText, aiText) {
  if (state.view !== 'investment') return;
  const ask = (userText || '').trim();
  const content = (aiText || '').trim();
  if (!ask || !content) return;
  const today = new Date().toISOString().split('T')[0];

  if (ask.includes('뉴스 동향') && (ask.includes('기록') || ask.includes('저장'))) {
    state.investment.events.push({
      id: 'ie' + Date.now(),
      date: today,
      type: 'news',
      symbol: inferInvestmentSymbol(ask),
      title: `${inferInvestmentSymbol(ask) || '투자'} 뉴스 동향`,
      body: content,
      severity: 'info',
      linkedDecisionId: null,
      linkedRecordId: null,
    });
    saveData();
    showToast('뉴스 동향에 기록했어요.');
    renderRightPanel();
    return;
  }

  if (ask.includes('투자 원칙') && (ask.includes('설정') || ask.includes('세워') || ask.includes('저장') || ask.includes('정해'))) {
    const prev = state.investment.rules.coreRules || '';
    state.investment.rules.coreRules = [prev, content].filter(Boolean).join('\n\n');
    saveData();
    showToast('투자 원칙에 반영했어요.');
    renderRightPanel();
  }
}

function inferInvestmentSymbol(text) {
  const known = (state.investment?.positions || []).find(p =>
    p.symbol && text.toUpperCase().includes(String(p.symbol).toUpperCase())
  );
  if (known) return known.symbol;
  const m = (text || '').match(/\b[A-Z]{1,5}\b/);
  return m ? m[0] : '';
}

function shouldFetchInvestmentNews(text) {
  const ask = (text || '').toLowerCase();
  return /뉴스|최신|동향|news|headline/.test(ask);
}

function inferInvestmentNewsSymbols(text) {
  const inv = state.investment || defaultInvestmentState();
  const raw = (text || '').toUpperCase();
  const known = (inv.positions || [])
    .map(p => String(p.symbol || '').toUpperCase())
    .filter(Boolean);
  const mentioned = known.filter(sym => raw.includes(sym));
  if (mentioned.length) return mentioned;
  const explicit = [...raw.matchAll(/\b[A-Z][A-Z0-9.\-]{0,7}\b/g)]
    .map(m => m[0])
    .filter(sym => !['AI', 'API', 'ETF', 'USD', 'NEWS'].includes(sym));
  if (explicit.length) return [...new Set(explicit)].slice(0, 5);
  if (/보유|내\s*주식|포트폴리오/.test(text || '')) return known.slice(0, 8);
  return known.slice(0, 5);
}

async function fetchInvestmentNewsContext(text) {
  if (!shouldFetchInvestmentNews(text)) return '';
  const symbols = inferInvestmentNewsSymbols(text);
  if (!symbols.length) return '';
  const today = new Date().toISOString().split('T')[0];
  try {
    const data = await apiFetchInvestmentNews(symbols, 3);
    const items = Array.isArray(data.news) ? data.news : [];
    if (!items.length) return `\n\n실시간 뉴스 검색 결과:\n- 조회 기준일: ${today}\n- ${symbols.join(', ')} 관련 최신 뉴스가 조회되지 않았습니다.`;
    return `\n\n실시간 뉴스 검색 결과 (${data.source || 'news'}):\n조회 기준일: ${today}\n${items.map(item =>
      `- [${item.symbol}] ${item.title}${item.published ? ` (발행/공시일: ${item.published})` : ''}${item.source ? ` / 출처: ${item.source}` : ''}${item.kind ? ` / 유형: ${item.kind}` : ''}${item.summary ? `: ${item.summary}` : ''}${item.link ? `\n  링크: ${item.link}` : ''}`
    ).join('\n')}\n\n뉴스 답변 규칙:\n- 조회 기준일은 ${today}이다. 발행/공시일을 오늘 날짜라고 바꿔 말하지 않는다.\n- SEC EDGAR는 공식 원천 자료이고, 뉴스 흐름이 아니라 공시 원문으로 해석한다.\n- 위 검색 결과를 바탕으로만 최신 뉴스라고 말한다.\n- "실시간 인터넷 검색 기능이 없다"거나 사용자가 직접 검색하라고 답하지 않는다.\n- 투자 판단은 추천이 아니라 원칙 위반 여부와 리스크 체크 중심으로 정리한다.`;
  } catch (e) {
    logger.warn('투자 뉴스 검색 실패', e);
    return `\n\n실시간 뉴스 검색 결과:\n- 뉴스 조회에 실패했습니다. 실패 사실만 짧게 알리고, 기존 기록 기준으로 해석 가능한 범위만 답하세요.`;
  }
}

// AI 대화용 시스템 프롬프트 생성 (현재 역할 기준으로 매 메시지마다 최신 반영)
function _buildChatSysPrompt(isMyRecords, topic, student, extraContext = '') {
  const modePrompt = _replyModePrompt(state.replyMode || 'dictation');
  if (state.view === 'investment') {
    const inv = state.investment || defaultInvestmentState();
    const positions = inv.positions.map(p =>
      `- ${p.symbol || '?'}: 수량 ${p.shares || 0}, 평균 ${p.avgPrice || 0}, 현재 ${p.currentPrice || 0}, 목표 ${p.targetPrice || '-'}, 손절 ${p.stopPrice || '-'}, 논리 ${p.thesis || '없음'}`
    ).join('\n') || '- 등록된 보유 종목 없음';
    const recentNews = inv.events
      .filter(e => e.type === 'news')
      .slice(-5)
      .map(e => `- ${e.date} ${e.symbol || ''} ${e.title}: ${e.body}`)
      .join('\n') || '- 기록된 뉴스 없음';
    const recentDecisions = inv.decisions.slice(-5).map(d =>
      `- ${d.createdAt?.slice(0, 10) || ''} ${d.symbol} ${d.action}: ${d.label} — ${d.summary}`
    ).join('\n') || '- 기록된 매매 판단 없음';
    return `당신은 개인 투자자의 이성적 매매 통제 파트너입니다.
목표는 수익률 예측이나 종목 추천이 아니라, 사용자가 사전에 정한 원칙을 기억하고 감정적 매매를 줄이는 것입니다.
감정 상태를 묻지 말고, 원칙·숫자·기록·뉴스 해석을 기준으로 짧고 분명하게 돕습니다.
사용자가 "뉴스 동향에 기록", "투자 원칙으로 저장", "매매 기록으로 남겨"처럼 말하면 저장될 수 있게 제목과 본문을 정돈해서 답합니다.

투자 원칙:
- 하루 손실 한도: ${inv.rules.dailyLossLimit}%
- 종목별 최대 비중: ${inv.rules.maxPositionWeight}%
- 쿨다운: ${inv.rules.cooldownMinutes}분
- 추격매수 제한 기준: ${inv.rules.chaseLimit}%
- 핵심 원칙: ${inv.rules.coreRules || '아직 없음'}

보유 종목:
${positions}

최근 뉴스 동향:
${recentNews}

최근 매매 판단:
${recentDecisions}

${extraContext}

${modePrompt}`;
  }
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

현재 응답 모드: 답변
- 사용자의 질문에 바로 답한다.
- 되묻거나 대화를 이어가기 위한 질문을 하지 않는다.
- 사용자가 "딱 하나", "바로", "구체적으로"라고 요청하면 후보를 늘어놓지 말고 가장 효과적인 방법 하나만 제시한다.
- 답변은 짧게 시작하고, 바로 실행 가능한 첫 행동을 포함한다.
- 공감 문장으로 시간을 쓰지 말고 결론부터 말한다.`;
  }
  if (mode === 'summary') {
    return `${shared}

현재 응답 모드: 정리
- 지금까지 사용자가 말한 내용을 DB에 기록으로 저장될 본문처럼 정리한다.
- 이 응답은 그대로 '나의 기록'에 저장되므로 제목 후보, 핵심 내용, 남겨둘 문장을 읽기 좋은 기록 형태로 쓴다.
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
  if (state.view === 'investment') return 'jip_chat_v2_investment';
  return id ? `jip_chat_v2_${id}` : null;
}

function saveChatHistory() {
  const key = _chatStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(state.currentChatMessages));
    if (state.view === 'investment') {
      state.investment = normalizeInvestmentState(state.investment);
      state.investment.chat = [...state.currentChatMessages];
      saveData();
    }
  } catch (e) { /* 용량 초과 무시 */ }
}

function loadChatHistory() {
  const key = _chatStorageKey();
  if (!key) return false;
  if (state.view === 'investment') {
    state.investment = normalizeInvestmentState(state.investment);
    if (state.investment.chat.length) {
      state.currentChatMessages = _sanitizeChatHistory(state.investment.chat);
      return state.currentChatMessages.length > 0;
    }
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const msgs = JSON.parse(raw);
    if (Array.isArray(msgs) && msgs.length) {
      const sanitized = _sanitizeChatHistory(msgs);
      if (sanitized.length) {
        state.currentChatMessages = sanitized;
        if (sanitized.length !== msgs.length) saveChatHistory();
        return true;
      }
      localStorage.removeItem(key);
    }
  } catch (e) { /* 파싱 오류 무시 */ }
  return false;
}

function _sanitizeChatHistory(msgs) {
  const starterTexts = [
    '대화 준비가 되었어요!',
    '받아쓰기 모드예요. 정리 안 된 말 그대로 남겨도 괜찮아요.',
  ];
  const cleaned = msgs
    .filter(m => m && typeof m.text === 'string')
    .filter(m => !(m.role === 'system' && starterTexts.includes(m.text.trim())));
  while (cleaned.length && cleaned[0].role !== 'user') cleaned.shift();
  return cleaned;
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
  if (state.view === 'investment') {
    content.innerHTML = renderInvestmentView();
    scrollChatToBottom();
    return;
  }
  if (!state.currentChatMessages.length) {
    content.innerHTML = '<div class="chat-messages" id="chat-messages"><div class="empty-state">대화를 시작해보세요</div></div>';
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
