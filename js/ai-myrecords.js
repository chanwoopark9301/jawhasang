/* =============================================
   自畵像 — AI 나의 기록 (보고서 + 대화)
   의존성: state.js, utils.js, data.js, logger.js

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
  if (!state.selTopic) {
    showToast('주제를 먼저 선택해주세요.');
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
1. 기록의 **성격**을 먼저 파악하고, 그에 맞는 항목 구성을 결정하세요.

   ▸ 기록이 개인 성찰·감정·습관·학습 진행 등 자기 자신에 관한 것이라면:
     → 패턴/성장/개선/질문 등 자기계발 구조로 작성
     예: "감정 흐름", "핵심 패턴", "성장 지점", "다음 질문"

   ▸ 기록이 외부 정보 수집에 관한 것이라면 (인터뷰 메모, 강의 노트, 책 정리, 전문가 발화 등):
     → 지식 정리 구조로 작성. "잘한 점/개선점" 같은 자기평가 항목은 쓰지 말 것
     예: "핵심 인사이트", "주요 개념 정리", "인상적인 발화", "활용 방안", "의문점"

2. 역할(${aiRole})에 맞게 항목명과 구성을 자유롭게 결정하세요.
3. 항목 수는 4~6개, 항목명은 한국어로
4. "overall" 항목은 반드시 포함 (종합 평가 및 다음 방향)
5. 각 항목: 2~4문장으로 간결하게, 실제 기록 내용을 근거로 인용
6. JSON으로만 응답 (다른 텍스트 없이)

JSON 예시:
{
  "항목명1": "내용...",
  "항목명2": "내용...",
  "항목명3": "내용...",
  "항목명4": "내용...",
  "overall": "종합 평가와 다음 방향...",
  "savedAt": "${today}",
  "period": "${periodLabel}"
}`;

  logger.info('나의 기록 AI 보고서 생성 시작: 주제=%s, 기간=%s, 기록 %d건',
    topic.title, periodLabel, records.length);

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
    // topic에 패턴 분석 결과 저장
    topic.patternAnalysis = result;
    saveData();
    logger.info('나의 기록 AI 보고서 완료: 주제=%s', topic.title);
    // 결과를 모달로 표시
    openModal('pattern', { result });
  } catch (e) {
    logger.error('나의 기록 보고서 생성 실패', e);
    showToast('보고서 생성 오류: ' + e.message);
  } finally {
    state.myAiLoading = false;
  }
  renderAIPanel();
}

// ---------------------------------------------------------------------------
// 나의 기록 AI 대화
// ---------------------------------------------------------------------------

function buildMyRecordContext(record, topic) {
  const aiRole = topic?.aiPrompt || '따뜻하게 경청하고 성찰을 돕는 코치';
  let reportPart = '';
  if (record.analysis) {
    const a = record.analysis;
    const skip = new Set(['savedAt', 'period']);
    const parts = Object.entries(a)
      .filter(([k, v]) => !skip.has(k) && v)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    if (parts) reportPart = `\n【분석 보고서】\n${parts}`;
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

  const topic = state.myTopics.find(t => t.id === record.topicId);
  logger.info('나의 기록 AI 대화 시작: 주제=%s, 기록=%s', topic?.title, record.date);

  record.aiChat     = [];
  state.myChatLoading = true;
  renderMain();

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
    if (!res.ok) throw new Error(`서버 오류 HTTP ${res.status}`);
    const data = await res.json();
    const text = data.content?.map(c => c.text || '').join('').trim();
    if (!text) throw new Error('AI 응답이 비어 있습니다');
    record.aiChat = [{ role: 'ai', text }];
    saveData();
    logger.info('나의 기록 AI 대화 시작 완료');
  } catch (e) {
    logger.error('나의 기록 대화 시작 실패', e);
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

async function sendMyChatMessage(textParam) {
  // 통합 입력창(chat.js)에서 text를 직접 받거나, 기존 my-chat-input에서 읽기
  let text = textParam;
  if (!text) {
    const input = document.getElementById('my-chat-input');
    if (!input) return;
    text = input.value.trim();
    if (input) input.value = '';
  }
  if (!text || state.myChatLoading) return;

  const record = state.myRecords.find(r => r.id === state.selRecord);
  if (!record) return;

  logger.debug('나의 기록 AI 메시지 전송 (%d자)', text.length);
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
    if (!res.ok) throw new Error(`서버 오류 HTTP ${res.status}`);
    const data   = await res.json();
    const aiText = data.content?.map(c => c.text || '').join('').trim();
    if (!aiText) throw new Error('AI 응답이 비어 있습니다');
    record.aiChat.push({ role: 'ai', text: aiText });
    saveData();
    logger.debug('나의 기록 AI 응답 수신 (%d자)', aiText.length);
  } catch (e) {
    logger.error('나의 기록 메시지 전송 실패', e);
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
