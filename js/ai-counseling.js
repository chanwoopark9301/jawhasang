/* =============================================
   自畵像 — AI 슈퍼비전 (상담 기록)
   의존성: state.js, utils.js, data.js, logger.js

   수정 (버그픽스):
   - runAI(): try/finally로 state.aiLoading 항상 초기화
   - sendChatMessage(): try/finally로 state.chatLoading 항상 초기화
   ============================================= */

// ---------------------------------------------------------------------------
// 슈퍼비전 보고서 생성
// ---------------------------------------------------------------------------

const LONG_VERBATIM_THRESHOLD = 3000; // 이 글자수 이상이면 2단계 처리

function buildSummaryPrompt(session, student) {
  const alias     = student?.alias     || '내담자';
  const grade     = student?.grade     || '';
  const family    = student?.family    || '정보 없음';
  const peers     = student?.peers     || '정보 없음';
  const situation = student?.situation || '정보 없음';

  return `당신은 학교상담 임상 슈퍼바이저입니다.
아래 ${session.sessionNum}회기 축어록(${session.verbatim.length}자)에서 슈퍼비전에 필요한 핵심만 추출하세요.

【내담 학생 (익명)】 ${alias} (${grade}) | 가정: ${family} | 교우: ${peers} | 상황: ${situation}

【축어록】
${session.verbatim}
${session.memo ? `\n【메모】 ${session.memo}` : ''}

아래 항목을 800자 이내 산문으로 추출하세요:
1. 내담자 감정 흐름 (시작 → 전환점 → 마지막)
2. 상담자 주요 개입 3-5개 (발화 인용 포함)
3. 가장 임상적으로 의미 있는 순간 1개
4. 미완결된 주제 또는 저항 순간

텍스트만 반환 (JSON 아님). 이 요약이 보고서와 슈퍼비전 대화의 기반이 됩니다.`;
}

function buildReportPrompt(session, student, verbatimSummary = null) {
  const alias     = student?.alias     || '내담자';
  const grade     = student?.grade     || '';
  const family    = student?.family    || '정보 없음';
  const peers     = student?.peers     || '정보 없음';
  const situation = student?.situation || '정보 없음';

  const verbatimPart = verbatimSummary
    ? `【축어록 핵심 요약 (원본 ${session.verbatim.length}자)】\n${verbatimSummary}`
    : `【${session.sessionNum}회기 축어록 (${session.date})】\n${session.verbatim}`;

  return `당신은 학교상담 임상 슈퍼바이저입니다. 아래 내용을 검토하고 슈퍼비전 보고서를 JSON으로 작성하세요.

【내담 학생 (익명)】 ${alias} (${grade}) | 가정: ${family} | 교우: ${peers} | 상황: ${situation}

${verbatimPart}
${session.memo ? `\n【메모】 ${session.memo}` : ''}

규칙:
- 각 항목은 핵심만 2문장 이내로 간결하게 (전체 400단어 이내)
- 발화 인용은 꼭 필요한 것 1개만
- 번호 목록 앞에 \\n 포함
- JSON으로만 응답 (다른 텍스트 없이)

{
  "clientState": "내담자 감정·방어기제·핵심 호소를 2문장으로. 발화 1개 인용.",
  "techniques": "사용 기법과 임상적 적절성을 2문장으로.",
  "strengths": "\\n1) 잘한 개입 첫 번째\\n2) 잘한 개입 두 번째\\n3) 잘한 개입 세 번째",
  "improvements": "\\n1) 장면 인용 + 문제점 + 대안 응답\\n2) 장면 인용 + 문제점 + 대안 응답",
  "overall": "전반적 평가와 다음 회기 핵심 과제를 2문장으로."
}`;
}

function setAIStageLabel(msg) {
  const lbl = document.querySelector('#ai-content .ai-loading-label');
  if (lbl) lbl.textContent = msg;
}

async function runAI() {
  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session || state.aiLoading) return;

  const student  = state.students.find(s => s.id === session.studentId);
  const isLong   = session.verbatim.length >= LONG_VERBATIM_THRESHOLD;

  logger.info('슈퍼비전 보고서 생성 시작: %s %d회기 (%d자)',
    student?.alias, session.sessionNum, session.verbatim.length);

  state.aiLoading = true;
  renderAIPanel();

  try {
    let verbatimSummary = session.verbatimSummary || null;

    // ── 1단계: 긴 축어록이면 먼저 요약 ──────────────────────────────────
    if (isLong && !verbatimSummary) {
      logger.info('1단계: 긴 축어록 핵심 추출 (%d자)', session.verbatim.length);
      setAIStageLabel('1단계: 핵심 장면 추출 중...');
      verbatimSummary = await streamAnalyze(
        { model: 'claude-sonnet-4-6', max_tokens: 600,
          messages: [{ role: 'user', content: buildSummaryPrompt(session, student) }] },
        (acc) => setAIStageLabel(`1단계: 핵심 추출 중... ${acc.length}자`)
      );
      session.verbatimSummary = verbatimSummary;
      logger.info('1단계 완료: 요약 %d자', verbatimSummary.length);
    }

    // ── 2단계: 보고서 생성 ────────────────────────────────────────────────
    const stageLabel = isLong ? '2단계: 보고서 작성 중...' : '보고서 작성 중...';
    logger.info('보고서 생성 중 (isLong=%s)', isLong);
    setAIStageLabel(stageLabel);

    const text = await streamAnalyze(
      { model: 'claude-sonnet-4-6', max_tokens: 2000,
        messages: [{ role: 'user', content: buildReportPrompt(session, student, verbatimSummary) }] },
      (acc) => setAIStageLabel(`${stageLabel} ${acc.length}자`)
    );

    const result   = parseJSON(text);
    result.savedAt = new Date().toISOString().split('T')[0];
    session.analysis  = result;
    saveData();
    state.sessionTab  = 'report';
    logger.info('슈퍼비전 보고서 생성 완료: %s %d회기', student?.alias, session.sessionNum);
  } catch (e) {
    logger.error('슈퍼비전 보고서 생성 실패', e);
    alert('보고서 생성 오류:\n' + e.message);
  } finally {
    state.aiLoading = false;
  }
  render();
}

// ---------------------------------------------------------------------------
// 슈퍼비전 대화
// ---------------------------------------------------------------------------

function buildSupervisorContext(session, student) {
  const alias     = student?.alias     || '내담자';
  const grade     = student?.grade     || '';
  const family    = student?.family    || '정보 없음';
  const peers     = student?.peers     || '정보 없음';
  const situation = student?.situation || '정보 없음';

  const prevSessions = state.sessions
    .filter(s => s.studentId === session.studentId && s.id !== session.id && s.analysis)
    .sort((a, b) => a.sessionNum - b.sessionNum)
    .map(s => `${s.sessionNum}회기(${s.date}): ${s.analysis.overall}`);

  const prevPart = prevSessions.length
    ? `\n【이전 회기 흐름】\n${prevSessions.join('\n')}`
    : '';

  let reportPart = '';
  if (session.analysis) {
    const a = session.analysis;
    reportPart = `
【슈퍼비전 보고서 (${a.savedAt})】
- 내담자 상태: ${a.clientState}
- 기법 평가: ${a.techniques}
- 강점: ${a.strengths}
- 개선 필요: ${a.improvements}
- 종합: ${a.overall}`;
  }

  const verbatimPart = session.verbatimSummary
    ? `【축어록 핵심 요약 — ${session.sessionNum}회기 (${session.date}, 원본 ${session.verbatim.length}자)】\n${session.verbatimSummary}`
    : `【상담 축어록 — ${session.sessionNum}회기 (${session.date})】\n${session.verbatim}`;

  return `당신은 20년 경력의 학교상담 임상 슈퍼바이저입니다.
인간중심, 인지행동, 정신역동, 해결중심 등 다양한 이론에 정통하며, 실제 임상 원전에 근거해 슈퍼비전합니다.

【내담 학생 배경 (익명)】
- 식별: ${alias} (${grade})
- 가족/가정: ${family}
- 교우관계: ${peers}
- 현재 상황: ${situation}

${verbatimPart}
${session.memo ? `\n【상담사 메모】\n${session.memo}` : ''}
${prevPart}
${reportPart}

【슈퍼비전 대화 원칙】
- 상담자의 성찰을 이끄는 질문 중심
- 구체적인 축어록 장면을 인용하며 대화
- 이론은 자연스럽게, 시험 공부가 아닌 임상적 이해를 위해
- 답을 주기보다 상담자 스스로 발견하도록 안내
- 따뜻하되 날카로운 임상적 시각 유지
- 한국어 존댓말 사용`;
}

async function startSupervisionChat() {
  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session) return;

  const student = state.students.find(s => s.id === session.studentId);
  logger.info('슈퍼비전 대화 시작: %s %d회기', student?.alias, session.sessionNum);

  session.supervisionChat = [];
  state.chatLoading = true;
  renderMain();

  const sysCtx = buildSupervisorContext(session, student);

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 700,
        system: [{ type: 'text', text: sysCtx, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: '슈퍼비전을 시작해주세요. 이 회기에서 가장 탐색할 가치가 있는 순간을 하나 선택해서, 상담자가 자신의 개입을 성찰할 수 있는 첫 번째 질문을 해주세요.' }],
      }),
    });
    if (!res.ok) throw new Error(`서버 오류 HTTP ${res.status}`);
    const data = await res.json();
    const text = data.content?.map(c => c.text || '').join('').trim();
    if (!text) throw new Error('AI 응답이 비어 있습니다');
    session.supervisionChat = [{ role: 'ai', text }];
    saveData();
    logger.info('슈퍼비전 대화 시작 완료');
  } catch (e) {
    logger.error('슈퍼비전 대화 시작 실패', e);
    session.supervisionChat = [{ role: 'ai', text: '오류가 발생했습니다. 다시 시도해주세요.' }];
  } finally {
    state.chatLoading = false;
  }
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function sendChatMessage(textParam) {
  // 통합 입력창(chat.js)에서 text를 직접 받거나, 기존 chat-input에서 읽기
  let text = textParam;
  if (!text) {
    const input = document.getElementById('chat-input');
    if (!input) return;
    text = input.value.trim();
    if (input) input.value = '';
  }
  if (!text || state.chatLoading) return;

  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session) return;

  logger.debug('슈퍼비전 메시지 전송 (%d자)', text.length);
  if (!session.supervisionChat) session.supervisionChat = [];
  session.supervisionChat.push({ role: 'user', text });

  state.chatLoading = true;
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });

  const student  = state.students.find(s => s.id === session.studentId);
  const sysCtx   = buildSupervisorContext(session, student);
  const messages = session.supervisionChat.map(m => ({
    role:    m.role === 'ai' ? 'assistant' : 'user',
    content: m.text,
  }));

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 800,
        system: [{ type: 'text', text: sysCtx, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    if (!res.ok) throw new Error(`서버 오류 HTTP ${res.status}`);
    const data   = await res.json();
    const aiText = data.content?.map(c => c.text || '').join('').trim();
    if (!aiText) throw new Error('AI 응답이 비어 있습니다');
    session.supervisionChat.push({ role: 'ai', text: aiText });
    saveData();
    logger.debug('슈퍼비전 AI 응답 수신 (%d자)', aiText.length);
  } catch (e) {
    logger.error('슈퍼비전 메시지 전송 실패', e);
    session.supervisionChat.push({ role: 'ai', text: '오류가 발생했습니다. 다시 시도해주세요.' });
  } finally {
    state.chatLoading = false;
  }
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function clearSupervisionChat() {
  if (!confirm('슈퍼비전 대화를 초기화할까요?')) return;
  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session) return;
  session.supervisionChat = [];
  saveData();
  renderMain();
}
