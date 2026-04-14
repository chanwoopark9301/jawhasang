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
// 일기 변환 (mode: diary) — 나의 기록, 블록 에디터 연동
// ---------------------------------------------------------------------------

async function _handleDiaryTransform() {
  const blocks = state.selectedBlocks;
  if (!blocks || !blocks.length) {
    alert('변환할 블록을 선택하세요.');
    return;
  }

  const record = state.selRecord ? state.myRecords.find(r => r.id === state.selRecord) : null;
  if (!record) return;

  state.transformLoading = true;
  renderAIPanel();
  logger.info('일기 변환 시작: 블록 %d개', blocks.length);

  try {
    const resp = await fetch('/api/transform-text', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: 'diary', blocks }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(err.error || `서버 오류 ${resp.status}`);
    }
    const data = await resp.json();
    if (!data.result) throw new Error('빈 응답');
    logger.info('일기 변환 완료: %d자', data.result.length);
    state.diaryDraft = data.result;
    // 통합 모달(modal.js)로 결과 표시
    openModal('diary-result', {
      draft: data.result,
      date:  new Date().toISOString().split('T')[0],
    });
  } catch (e) {
    logger.error('일기 변환 실패: %s', e.message);
    alert('변환 실패: ' + e.message);
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
