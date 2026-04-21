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
  if (state.aiLoading) return;

  // selSession이 있으면 기존 회기, 없으면 attachedVerbatim 사용
  const session  = state.sessions.find(s => s.id === state.selSession);
  const verbatim = session?.verbatim || state.attachedVerbatim;
  if (!verbatim?.trim()) {
    showToast('축어록을 먼저 첨부해주세요 (+ → 축어록 첨부)');
    return;
  }

  const student = session
    ? state.students.find(s => s.id === session.studentId)
    : state.students.find(s => s.id === state.selStudent);

  // attachedVerbatim 전용 임시 세션 객체
  const workSession = session || {
    id: null, sessionNum: 1, verbatim, memo: '',
    date: new Date().toISOString().split('T')[0],
    verbatimSummary: null,
  };

  const isLong = workSession.verbatim.length >= LONG_VERBATIM_THRESHOLD;

  logger.info('슈퍼비전 보고서 생성 시작: %s %d회기 (%d자)',
    student?.alias, workSession.sessionNum, workSession.verbatim.length);

  state.aiLoading = true;
  renderAIPanel();
  showToast('보고서 생성 중이에요. 자유롭게 이용하세요 :)');

  // 백그라운드 실행 — 완료 시 액션 토스트 알림
  (async () => {
    try {
      let verbatimSummary = workSession.verbatimSummary || null;

      // ── 1단계: 긴 축어록이면 먼저 요약 ──────────────────────────────────
      if (isLong && !verbatimSummary) {
        logger.info('1단계: 긴 축어록 핵심 추출 (%d자)', workSession.verbatim.length);
        verbatimSummary = await streamAnalyze(
          { model: 'claude-sonnet-4-6', max_tokens: 600,
            messages: [{ role: 'user', content: buildSummaryPrompt(workSession, student) }] },
          () => {}
        );
        if (session) session.verbatimSummary = verbatimSummary;
        logger.info('1단계 완료: 요약 %d자', verbatimSummary.length);
      }

      // ── 2단계: 보고서 생성 ────────────────────────────────────────────────
      logger.info('보고서 생성 중 (isLong=%s)', isLong);
      const text = await streamAnalyze(
        { model: 'claude-sonnet-4-6', max_tokens: 2000,
          messages: [{ role: 'user', content: buildReportPrompt(workSession, student, verbatimSummary) }] },
        () => {}
      );

      const result   = parseJSON(text);
      result.savedAt = new Date().toISOString().split('T')[0];

      if (session) {
        session.analysis = result;
        saveData();
      }

      logger.info('슈퍼비전 보고서 생성 완료: %s', student?.alias);
      showToast('슈퍼비전 보고서 완성!', {
        btnLabel: '지금 보기',
        action: () => openModal('report', { analysis: result }),
      });
    } catch (e) {
      logger.error('슈퍼비전 보고서 생성 실패', e);
      showToast('보고서 생성 오류: ' + e.message);
    } finally {
      state.aiLoading = false;
      renderAIPanel();
    }
  })();
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

async function sendChatMessage(textParam) {
  let text = textParam;
  if (!text) {
    const input = document.getElementById('chat-input-bottom');
    text = input?.value.trim();
    if (input) input.value = '';
  }
  if (!text || state.chatLoading) return;

  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session) return;

  logger.debug('슈퍼비전 메시지 전송 (%d자)', text.length);
  if (!session.supervisionChat) session.supervisionChat = [];
  session.supervisionChat.push({ role: 'user', text });
  state.currentChatMessages.push({ role: 'user', text });

  state.chatLoading = true;
  renderChatView();
  scrollChatToBottom();

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
    state.currentChatMessages.push({ role: 'ai', text: aiText });
    saveData();
    logger.debug('슈퍼비전 AI 응답 수신 (%d자)', aiText.length);
  } catch (e) {
    logger.error('슈퍼비전 메시지 전송 실패', e);
    const errMsg = '오류가 발생했습니다. 다시 시도해주세요.';
    session.supervisionChat.push({ role: 'ai', text: errMsg });
    state.currentChatMessages.push({ role: 'ai', text: errMsg });
  } finally {
    state.chatLoading = false;
  }
  renderChatView();
  scrollChatToBottom();
}

// ---------------------------------------------------------------------------
// 상담 기록 — 심층 질문 (슈퍼비전 성찰 질문)
// ---------------------------------------------------------------------------

async function runCounselingDeepQuestion() {
  const session = state.selSession ? state.sessions.find(s => s.id === state.selSession) : null;
  if (!session?.verbatim?.trim()) {
    showToast('축어록을 먼저 첨부해주세요.');
    return;
  }
  const student = state.students.find(s => s.id === session.studentId);

  const btn = document.getElementById('rp-deepq-btn');
  if (btn) { btn.disabled = true; btn.textContent = '질문 생성 중...'; }

  const sysPrompt = `당신은 20년 경력의 학교상담 임상 슈퍼바이저입니다.`;
  const userMsg = `아래 회기 축어록을 읽고, 상담자가 스스로 성찰할 수 있도록 돕는 슈퍼비전 질문 3개를 제안하세요.

【내담자】 ${student?.alias || '내담자'} (${student?.grade || ''})
【${session.sessionNum}회기 축어록】
${session.verbatim.slice(0, 3000)}${session.verbatim.length > 3000 ? '\n...(이하 생략)' : ''}
${session.memo ? `\n【메모】 ${session.memo}` : ''}

규칙:
- 질문은 상담자 자신의 감정·개입·판단에 대한 성찰을 유도하는 것
- 구체적인 축어록 장면을 인용하거나 지목하는 질문 포함
- 답을 제시하지 말 것, 오직 탐색을 돕는 질문만
- 번호나 기호 없이 질문 텍스트만, 각 줄에 하나씩 (3줄)
- 한국어 존댓말`;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        system: [{ type: 'text', text: sysPrompt }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    const data = await res.json();
    const text = data.content?.map(c => c.text || '').join('').trim();
    if (!text) throw new Error('빈 응답');
    const label = `${student?.alias || '내담자'} · ${session.sessionNum}회기`;
    showDeepQuestionModal(text, label, session.date);
  } catch (e) {
    showToast('질문 생성 중 오류가 발생했어요.');
  } finally {
    renderRightPanel();
  }
}

// ---------------------------------------------------------------------------
// 상담 기록 — 성장 타임라인 (내담자 회기별 변화 흐름)
// ---------------------------------------------------------------------------

async function runCounselingGrowthTimeline() {
  const student = state.selStudent ? state.students.find(s => s.id === state.selStudent) : null;
  if (!student) return;

  const sessions = state.sessions
    .filter(s => s.studentId === state.selStudent)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sessions.length < 2) {
    showToast('타임라인을 보려면 회기가 2개 이상 필요해요.');
    return;
  }

  const btn = document.getElementById('rp-timeline-btn');
  if (btn) { btn.disabled = true; btn.textContent = '타임라인 생성 중...'; }

  // 축어록 전체 대신 analysis.overall → verbatimSummary → verbatim 순 폴백 (토큰 절약)
  const sessionsText = sessions.map(s =>
    `${s.sessionNum}회기 (${s.date}): ${
      s.analysis?.overall
      || s.verbatimSummary
      || (s.verbatim || '').slice(0, 200) + (s.verbatim?.length > 200 ? '...' : '')
    }`
  ).join('\n\n');

  const sysPrompt = `당신은 학교상담 임상 슈퍼바이저입니다.`;
  const userMsg = `아래는 ${student.alias} (${student.grade || ''}) 내담자의 전체 ${sessions.length}회기 흐름입니다.

${sessionsText}

회기 경과에 따른 내담자 변화를 JSON으로 정리해주세요.

규칙:
- 총 400단어 이내
- JSON으로만 응답 (다른 텍스트 없이)

{
  "start": "초기 회기에서 내담자의 주요 호소와 상태를 2문장으로",
  "journey": "중간 회기에서 눈에 띄는 변화나 전환점을 2~3문장으로",
  "now": "최근 회기 기준 현재 상태와 변화를 2문장으로",
  "highlight": "전체 기간 중 임상적으로 가장 의미 있는 변화 한 가지",
  "overall": "종합적인 진전 평가와 향후 방향"
}`;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 800,
        system: [{ type: 'text', text: sysPrompt }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    const data = await res.json();
    const raw  = data.content?.map(c => c.text || '').join('').trim();
    if (!raw) throw new Error('빈 응답');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (!result) throw new Error('JSON 파싱 실패');

    const today = new Date().toISOString().split('T')[0];
    showTimelineModal(result, student.alias, today, false);
  } catch (e) {
    showToast('타임라인 생성 중 오류가 발생했어요.');
  } finally {
    renderRightPanel();
  }
}

