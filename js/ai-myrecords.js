/* =============================================
   自畵像 — AI 나의 기록 (보고서 + 대화)
   의존성: state.js, utils.js, data.js

   수정 (버그픽스):
   - runMyAI(): try/finally로 state.myAiLoading 항상 초기화
   - sendMyChatMessage(): try/finally로 state.myChatLoading 항상 초기화
   ============================================= */

// ---------------------------------------------------------------------------
// 나의 기록 AI 보고서 생성
// ---------------------------------------------------------------------------

function setMyPeriod(period) {
  state.myPeriod = period;
  renderAIPanel();
}

async function runMyAI() {
  if (!state.selTopic || !state.selRecord) {
    alert('기록을 먼저 선택해주세요.');
    return;
  }
  if (state.myAiLoading) return;

  const topic = state.myTopics.find(t => t.id === state.selTopic);
  if (!topic) return;

  const today = new Date().toISOString().split('T')[0];
  let periodStart = null;
  if (state.myPeriod === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
    periodStart = d.toISOString().split('T')[0];
  } else if (state.myPeriod === 'month') {
    const now = new Date();
    periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }

  const records = state.myRecords
    .filter(r => r.topicId === state.selTopic)
    .filter(r => !periodStart || r.date >= periodStart)
    .filter(r => r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!records.length) { alert('선택한 기간에 기록이 없습니다.'); return; }

  const prevReport = state.myRecords
    .filter(r => r.topicId === state.selTopic && r.analysis && (!periodStart || r.date < periodStart))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const prevSummary = prevReport ? prevReport.analysis.overall : null;

  const aiRole      = topic.aiPrompt || '따뜻하게 경청하고 성찰을 돕는 코치';
  const periodLabel = periodStart ? `${periodStart} ~ ${today}` : `전체 ~ ${today}`;
  const recordsText = records.map(r =>
    `${r.recordNum}번째 기록 (${r.date}):\n${r.content}${r.memo ? '\n메모: ' + r.memo : ''}`
  ).join('\n\n');

  const prompt = `당신은 ${aiRole} 역할입니다.

'${topic.title}' 주제의 기록을 분석해 보고서를 작성하세요.
${prevSummary ? `이전 분석 요약: ${prevSummary}\n` : ''}
기간: ${periodLabel}

【기록 내용】
${recordsText}

보고서 작성 규칙:
1. 당신의 역할(${aiRole})에 맞게 보고서 항목명과 구성을 자유롭게 결정하세요.
   - 감정 일기 코치라면: "감정_흐름", "핵심_패턴", "성장_지점", "다음_질문" 등
   - 헬스/운동 코치라면: "운동_패턴", "잘된_점", "개선_포인트", "다음_목표" 등
   - 학습/공부 코치라면: "학습_패턴", "이해도", "취약_영역", "다음_전략" 등
   - 업무/진로 코치라면: "업무_패턴", "강점", "개선_과제", "다음_액션" 등
2. 항목 수는 4~6개, 항목명은 한국어로, 밑줄(_) 대신 공백 사용 가능
3. "overall" 항목은 반드시 포함 (종합 평가 및 다음 방향)
4. 각 항목: 2~4문장으로 간결하게, 실제 기록 내용을 근거로 인용
5. JSON으로만 응답 (다른 텍스트 없이)

JSON 예시 (역할에 맞게 항목명 변경 필수):
{
  "항목명1": "내용...",
  "항목명2": "내용...",
  "항목명3": "내용...",
  "항목명4": "내용...",
  "overall": "종합 평가와 다음 방향...",
  "savedAt": "${today}",
  "period": "${periodLabel}"
}`;

  state.myAiLoading = true;
  renderAIPanel();

  try {
    const text = await streamAnalyze(
      { model: 'claude-sonnet-4-6', max_tokens: 6000,
        messages: [{ role: 'user', content: prompt }] },
      (acc) => {
        const lbl = document.querySelector('#ai-content .ai-loading-label');
        if (lbl) lbl.textContent = `작성 중... ${acc.length}자`;
      }
    );
    const result   = parseJSON(text);
    // AI가 포함하지 않은 경우 보장
    result.savedAt = result.savedAt || today;
    result.period  = result.period  || periodLabel;
    const record   = state.myRecords.find(r => r.id === state.selRecord);
    if (record) {
      record.analysis = result;
      saveData();
      state.myTab = 'report';
    }
  } catch (e) {
    console.error('보고서 생성 오류:', e);
    alert('보고서 생성 오류:\n' + e.message);
  } finally {
    state.myAiLoading = false;
  }
  render();
}

// ---------------------------------------------------------------------------
// 나의 기록 AI 대화
// ---------------------------------------------------------------------------

function buildMyRecordContext(record, topic) {
  const aiRole = topic?.aiPrompt || '따뜻하게 경청하고 성찰을 돕는 코치';
  let reportPart = '';
  if (record.analysis) {
    const a = record.analysis;
    reportPart = `\n【분석 보고서 요약】\n- 패턴: ${a.pattern}\n- 잘 된 것: ${a.strengths}\n- 개선점: ${a.improvements}\n- 종합: ${a.overall}`;
  }
  return `당신은 ${aiRole} 역할입니다.

아래는 '${topic?.title || '기록'}' 주제로 작성된 기록입니다.
날짜: ${record.date}

【기록 본문】
${record.content}
${record.memo ? `\n【메모】\n${record.memo}` : ''}
${reportPart}

대화 원칙:
- 상대방의 말을 충분히 듣고 반영하기
- 판단하지 않기
- 스스로 답을 찾도록 질문으로 안내하기
- 한국어 존댓말 사용`;
}

async function startMyChat() {
  const record = state.myRecords.find(r => r.id === state.selRecord);
  if (!record || state.myChatLoading) return;

  record.aiChat     = [];
  state.myChatLoading = true;
  renderMain();

  const topic  = state.myTopics.find(t => t.id === record.topicId);
  const sysCtx = buildMyRecordContext(record, topic);

  try {
    const aiRole = topic?.aiPrompt || '따뜻하게 경청하고 성찰을 돕는 코치';
    const startMsg = `기록을 읽었어요. 당신은 "${aiRole}" 역할입니다. 이 역할에 맞게 자연스럽게 대화를 시작해주세요. 판단하지 말고, 상대방이 스스로 생각하거나 느끼도록 유도하는 첫 마디를 해주세요.`;
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 600,
        system: [{ type: 'text', text: sysCtx, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: startMsg }],
      }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const text = data.content.map(c => c.text || '').join('').trim();
    record.aiChat = [{ role: 'ai', text }];
    saveData();
  } catch (e) {
    console.error('대화 시작 오류:', e);
    record.aiChat = [{ role: 'ai', text: '오류가 발생했습니다. 다시 시도해주세요.' }];
  } finally {
    state.myChatLoading = false;
  }
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('my-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

async function sendMyChatMessage() {
  const input = document.getElementById('my-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || state.myChatLoading) return;

  const record = state.myRecords.find(r => r.id === state.selRecord);
  if (!record) return;

  input.value = '';
  if (!record.aiChat) record.aiChat = [];
  record.aiChat.push({ role: 'user', text });

  state.myChatLoading = true;
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('my-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });

  const topic    = state.myTopics.find(t => t.id === record.topicId);
  const sysCtx   = buildMyRecordContext(record, topic);
  const messages = record.aiChat.map(m => ({
    role:    m.role === 'ai' ? 'assistant' : 'user',
    content: m.text,
  }));

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 600,
        system: [{ type: 'text', text: sysCtx, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data   = await res.json();
    const aiText = data.content.map(c => c.text || '').join('').trim();
    record.aiChat.push({ role: 'ai', text: aiText });
    saveData();
  } catch (e) {
    console.error('대화 오류:', e);
    record.aiChat.push({ role: 'ai', text: '오류가 발생했습니다. 다시 시도해주세요.' });
  } finally {
    state.myChatLoading = false;
  }
  renderMain();
  requestAnimationFrame(() => {
    const el = document.getElementById('my-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function clearMyChat() {
  if (!confirm('대화를 초기화할까요?')) return;
  const record = state.myRecords.find(r => r.id === state.selRecord);
  if (!record) return;
  record.aiChat = [];
  saveData();
  renderMain();
}
