/* =============================================
   自畵像 — AI 텍스트 변환
   의존성: state.js, utils.js, data.js, render-aipanel.js
   ============================================= */

// ---------------------------------------------------------------------------
// 진입점 — AI 패널 "축어록 AI 정리 ↗" 버튼
// ---------------------------------------------------------------------------

async function handleTransform() {
  if (state.view === 'myrecords') {
    _handleDiaryTransform();
    return;
  }
  _handleVerbatimTransform();
}

// ---------------------------------------------------------------------------
// 축어록 정리 (mode: verbatim)
// ---------------------------------------------------------------------------

async function _handleVerbatimTransform() {
  const session = state.selSession ? state.sessions.find(s => s.id === state.selSession) : null;
  if (!session || !session.verbatim?.trim()) return;

  if (!confirm('AI가 축어록 서식을 정리합니다.\n내용·발화는 변경하지 않고 화자 표기와 문단만 정돈합니다.\n계속할까요?')) return;

  state.transformLoading = true;
  renderAIPanel();
  logger.info('축어록 AI 정리 시작: %d자', session.verbatim.length);

  try {
    const resp = await fetch('/api/transform-text', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: 'verbatim', text: session.verbatim }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(err.error || `서버 오류 ${resp.status}`);
    }
    const data = await resp.json();
    if (!data.result) throw new Error('빈 응답');
    logger.info('축어록 AI 정리 완료: %d자', data.result.length);
    _showTransformModal('축어록 AI 정리 결과', data.result, () => _applyVerbatimResult(session, data.result));
  } catch (e) {
    logger.error('축어록 정리 실패: %s', e.message);
    alert('변환 실패: ' + e.message);
  } finally {
    state.transformLoading = false;
    renderAIPanel();
  }
}

function _applyVerbatimResult(session, result) {
  session.verbatim = result;
  saveData();
  closeDiaryDraft();
  renderMain();
  renderAIPanel();
  logger.info('축어록 정리 결과 적용 완료');
}

// ---------------------------------------------------------------------------
// 일기 변환 (mode: diary) — 현재 대화 내용(currentChatMessages) 기반
// ---------------------------------------------------------------------------

async function _handleDiaryTransform() {
  const msgs = state.currentChatMessages.filter(m => m.role !== 'system');
  if (!msgs.length) {
    showToast('변환할 대화 내용이 없어요. 먼저 대화를 나눠보세요.');
    return;
  }

  if (!state.selTopic) {
    showToast('주제를 먼저 선택해주세요.');
    return;
  }

  const topic = state.myTopics.find(t => t.id === state.selTopic);
  const aiRole = topic?.aiPrompt || '따뜻하게 경청하고 성찰을 돕는 코치';

  state.transformLoading = true;
  renderAIPanel();
  logger.info('일기 변환 시작: 대화 %d건', msgs.length);

  try {
    const chatText = msgs.map(m =>
      `${m.role === 'user' ? '나' : 'AI'}: ${m.text}`
    ).join('\n\n');

    const prompt = `당신은 ${aiRole} 역할입니다.
아래는 '${topic?.title || '기록'}' 주제로 나눈 대화입니다.

${chatText}

이 대화를 **일기 형식**으로 변환해주세요.
규칙:
- 1인칭 시점으로 작성
- 대화를 그대로 나열하지 말고, 핵심 감정·생각·통찰을 자연스럽게 녹인 일기로 작성
- 구어체가 아닌 글말로 정돈
- 마크다운 없이 순수 텍스트
- 300~600자 내외
결과 텍스트만 반환 (다른 설명 없이).`;

    const res = await fetch('/api/analyze', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
    const data = await res.json();
    const result = data.content?.map(c => c.text || '').join('').trim();
    if (!result) throw new Error('빈 응답');

    logger.info('일기 변환 완료: %d자', result.length);
    openModal('diary-result', {
      draft: result,
      date:  new Date().toISOString().split('T')[0],
    });
  } catch (e) {
    logger.error('일기 변환 실패: %s', e.message);
    showToast('변환 실패: ' + e.message);
  } finally {
    state.transformLoading = false;
    renderAIPanel();
  }
}

function _applyDiaryResult(record, result) {
  record.content = (record.content ? record.content + '\n\n---\n\n' : '') + result;
  saveData();
  closeDiaryDraft();
  renderMain();
  logger.info('일기 변환 결과 기록에 추가 완료');
}

// ---------------------------------------------------------------------------
// 결과 모달
// ---------------------------------------------------------------------------

function _showTransformModal(title, text, onApply) {
  const overlay = document.getElementById('diary-draft-overlay');
  const modal   = document.getElementById('diary-draft-modal');
  if (!overlay || !modal) return;

  modal.innerHTML = `
    <div class="diary-draft-header">
      <span class="diary-draft-title">${esc(title)}</span>
      <button class="diary-draft-close" onclick="closeDiaryDraft()">×</button>
    </div>
    <div class="diary-draft-body">
      <pre class="diary-draft-text">${esc(text)}</pre>
    </div>
    <div class="diary-draft-footer">
      <button class="btn-secondary" onclick="closeDiaryDraft()">닫기</button>
      <button class="btn-primary" id="diary-apply-btn">적용하기</button>
    </div>`;

  overlay.style.display = '';
  modal.style.display   = '';

  // 적용 버튼에 콜백 바인딩 (클로저로 최신 데이터 참조)
  document.getElementById('diary-apply-btn').addEventListener('click', onApply);
}

function closeDiaryDraft() {
  state.diaryDraft = null;
  const overlay = document.getElementById('diary-draft-overlay');
  const modal   = document.getElementById('diary-draft-modal');
  if (overlay) overlay.style.display = 'none';
  if (modal)   modal.style.display   = 'none';
}
