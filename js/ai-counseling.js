/* =============================================
   自畵像 — AI 슈퍼비전 (상담 기록)
   의존성: state.js, utils.js, data.js

   수정 (버그픽스):
   - runAI(): try/finally로 state.aiLoading 항상 초기화
   - sendChatMessage(): try/finally로 state.chatLoading 항상 초기화
   ============================================= */

// ---------------------------------------------------------------------------
// 슈퍼비전 보고서 생성
// ---------------------------------------------------------------------------

function buildReportPrompt(session, student) {
  const alias     = student?.alias     || '내담자';
  const grade     = student?.grade     || '';
  const family    = student?.family    || '정보 없음';
  const peers     = student?.peers     || '정보 없음';
  const situation = student?.situation || '정보 없음';

  return `당신은 학교상담 임상 슈퍼바이저입니다. 아래 축어록을 검토하고 슈퍼비전 보고서를 JSON으로 작성하세요.

【내담 학생 (익명)】 ${alias} (${grade}) | 가정: ${family} | 교우: ${peers} | 상황: ${situation}

【${session.sessionNum}회기 축어록 (${session.date})】
${session.verbatim}
${session.memo ? `\n【메모】 ${session.memo}` : ''}

규칙:
- 각 항목은 핵심만 2-4문장으로 간결하게
- 발화 인용은 꼭 필요한 것 1개만
- 번호 목록 앞에 \\n 포함
- JSON으로만 응답 (다른 텍스트 없이)

{
  "clientState": "내담자 감정·방어기제·핵심 호소를 2-3문장으로 요약. 발화 1개 인용.",
  "techniques": "사용 기법과 임상적 적절성을 2-3문장으로.",
  "strengths": "\\n1) 잘한 개입 첫 번째\\n2) 잘한 개입 두 번째\\n3) 잘한 개입 세 번째",
  "improvements": "\\n1) 장면 인용 + 문제점 + 대안 응답\\n2) 장면 인용 + 문제점 + 대안 응답",
  "overall": "전반적 평가와 다음 회기 핵심 과제를 2-3문장으로."
}`;
}

async function runAI() {
  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session || state.aiLoading) return;

  const student = state.students.find(s => s.id === session.studentId);

  state.aiLoading = true;
  renderAIPanel();

  try {
    const text = await streamAnalyze(
      { model: 'claude-sonnet-4-6', max_tokens: 8000,
        messages: [{ role: 'user', content: buildReportPrompt(session, student) }] },
      (acc) => {
        const lbl = document.querySelector('#ai-content .ai-loading-label');
        if (lbl) lbl.textContent = `작성 중... ${acc.length}자`;
      }
    );
    const result   = parseJSON(text);
    result.savedAt = new Date().toISOString().split('T')[0];
    session.analysis  = result;
    saveData();
    state.sessionTab  = 'report';
  } catch (e) {
    console.error('보고서 생성 오류:', e);
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

  return `당신은 20년 경력의 학교상담 임상 슈퍼바이저입니다.
인간중심, 인지행동, 정신역동, 해결중심 등 다양한 이론에 정통하며, 실제 임상 원전에 근거해 슈퍼비전합니다.

【내담 학생 배경 (익명)】
- 식별: ${alias} (${grade})
- 가족/가정: ${family}
- 교우관계: ${peers}
- 현재 상황: ${situation}

【상담 축어록 — ${session.sessionNum}회기 (${session.date})】
${session.verbatim}
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

  session.supervisionChat = [];
  state.chatLoading = true;
  renderMain();

  const student = state.students.find(s => s.id === session.studentId);
  const sysCtx  = buildSupervisorContext(session, student);

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
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const text = data.content.map(c => c.text || '').join('').trim();
    session.supervisionChat = [{ role: 'ai', text }];
    saveData();
  } catch (e) {
    console.error('대화 시작 오류:', e);
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

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || state.chatLoading) return;

  const session = state.sessions.find(s => s.id === state.selSession);
  if (!session) return;

  input.value = '';
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
    if (!res.ok) throw new Error(`${res.status}`);
    const data   = await res.json();
    const aiText = data.content.map(c => c.text || '').join('').trim();
    session.supervisionChat.push({ role: 'ai', text: aiText });
    saveData();
  } catch (e) {
    console.error('대화 오류:', e);
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
