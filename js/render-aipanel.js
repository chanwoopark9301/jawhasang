/* =============================================
   自畵像 — AI 패널 렌더링
   의존성: state.js, utils.js
   ============================================= */

// ---------------------------------------------------------------------------
// 나의 기록 — AI 패널
// ---------------------------------------------------------------------------

function renderMyAIPanel() {
  const content      = document.getElementById('ai-content');
  const analyzeBtn   = document.getElementById('analyze-btn');
  const transformBtn = document.getElementById('transform-btn');

  analyzeBtn.style.background = '#1D9E75';
  analyzeBtn.setAttribute('onclick', 'runMyAI()');

  // 나의 기록에서는 축어록 정리 버튼 숨김
  if (transformBtn) transformBtn.style.display = 'none';

  const record = state.selRecord ? state.myRecords.find(r => r.id === state.selRecord) : null;
  const topic  = record
    ? state.myTopics.find(t => t.id === record.topicId)
    : (state.selTopic ? state.myTopics.find(t => t.id === state.selTopic) : null);

  if (state.myAiLoading) {
    analyzeBtn.disabled    = true;
    analyzeBtn.textContent = '분석 중...';
    content.innerHTML = `<div class="ai-loading">
      <div class="ai-loading-label">보고서 작성 중...</div>
      <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    </div>`;
    return;
  }

  analyzeBtn.disabled    = !record;
  analyzeBtn.textContent = record?.analysis ? '보고서 재생성 ↗' : '보고서 생성 ↗';

  if (!topic) {
    content.innerHTML = '<p class="ai-placeholder">주제를 선택하면<br>정보가 표시됩니다</p>';
    return;
  }

  const periods = [
    { key: 'week',  label: '이번 주' },
    { key: 'month', label: '이번 달' },
    { key: 'all',   label: '전체'    },
  ];
  const periodBtns = periods.map(p =>
    `<button class="period-btn${state.myPeriod === p.key ? ' active' : ''}" onclick="setMyPeriod('${p.key}')">${p.label}</button>`
  ).join('');

  const topicRecordCount = state.myRecords.filter(r => r.topicId === topic.id).length;
  const myPatternBtnHTML = topicRecordCount > 0 ? `
    <div class="pattern-section" style="border-top-color:rgba(29,158,117,.2);">
      <button class="pattern-analysis-btn" style="background:#1D9E75;" onclick="runMyPatternAnalysis()" ${state.myPatternLoading ? 'disabled' : ''}>
        ${state.myPatternLoading ? '분석 중...' : '전체 패턴 분석 ↗'}
      </button>
      ${topic.patternAnalysis
        ? `<div class="pattern-last">마지막 분석: ${esc(topic.patternAnalysis.savedAt)}
            <button class="pattern-view-btn" style="color:#1D9E75;" onclick="viewLastMyPatternAnalysis()">보기</button></div>`
        : ''}
    </div>` : '';

  content.innerHTML = `
    <div class="ctx-alias" style="color:#1D9E75;">${esc(topic.title)}</div>
    <div class="ctx-meta">${topicRecordCount}개 기록</div>
    ${topic.aiPrompt ? `<div class="ctx-block">
      <div class="ctx-lbl">AI 역할</div>
      <div class="ctx-txt">${esc(topic.aiPrompt)}</div>
    </div>` : `<div class="ctx-block">
      <div class="ctx-lbl">AI 역할</div>
      <div class="ctx-txt" style="color:var(--color-text-tertiary);">기본 성찰 코치</div>
    </div>`}
    ${record ? `<div class="ctx-done" style="background:#e0f5ec;color:#0F6E56;">${record.recordNum}번째 기록 · ${record.date}</div>` : ''}
    <div class="ctx-block" style="margin-top:10px;">
      <div class="ctx-lbl">보고서 기간</div>
      <div class="period-btns">${periodBtns}</div>
    </div>
    ${myPatternBtnHTML}`;
}

// ---------------------------------------------------------------------------
// 상담 기록 — AI 패널
// ---------------------------------------------------------------------------

function renderAIPanel() {
  if (state.view === 'myrecords') { renderMyAIPanel(); return; }

  const content      = document.getElementById('ai-content');
  const analyzeBtn   = document.getElementById('analyze-btn');
  const transformBtn = document.getElementById('transform-btn');

  analyzeBtn.style.background = '';
  analyzeBtn.setAttribute('onclick', 'runAI()');

  const session     = state.selSession ? state.sessions.find(s => s.id === state.selSession) : null;
  const student     = session ? state.students.find(s => s.id === session.studentId) : null;
  const hasVerbatim = !!(session?.verbatim?.trim());

  analyzeBtn.disabled    = !hasVerbatim || state.aiLoading;
  analyzeBtn.textContent = state.aiLoading ? '분석 중...'
    : (session?.analysis ? '보고서 재생성 ↗' : '슈퍼비전 보고서 생성 ↗');

  // 축어록 정리 버튼 상태
  if (transformBtn) {
    transformBtn.style.display  = '';
    transformBtn.textContent    = state.transformLoading ? '정리 중...' : '축어록 AI 정리 ↗';
    transformBtn.disabled       = !hasVerbatim || state.aiLoading || state.transformLoading;
  }

  if (state.aiLoading) {
    content.innerHTML = `<div class="ai-loading">
      <div class="ai-loading-label">슈퍼비전 보고서 작성 중...</div>
      <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    </div>`;
    return;
  }

  if (!session || !student) {
    const curStudent = state.selStudent ? state.students.find(s => s.id === state.selStudent) : null;
    if (curStudent) {
      const curSessions = state.sessions.filter(s => s.studentId === curStudent.id);
      content.innerHTML = `
        <div class="ctx-alias">${esc(curStudent.alias)}</div>
        <div class="ctx-meta">${esc(curStudent.grade)}${curStudent.gender ? ' · ' + esc(curStudent.gender) : ''}</div>
        <p class="ai-placeholder" style="margin-top:12px;">회기를 선택하면<br>보고서를 생성할 수 있어요</p>
        ${curSessions.length > 0 ? `<div class="pattern-section">
          <button class="pattern-analysis-btn" onclick="runPatternAnalysis()" ${state.patternLoading ? 'disabled' : ''}>
            ${state.patternLoading ? '분석 중...' : '전체 패턴 분석 ↗'}
          </button>
          ${curStudent.patternAnalysis
            ? `<div class="pattern-last">마지막 분석: ${esc(curStudent.patternAnalysis.savedAt)}
                <button class="pattern-view-btn" onclick="viewLastPatternAnalysis()">보기</button></div>`
            : ''}
        </div>` : ''}`;
      return;
    }
    content.innerHTML = '<p class="ai-placeholder">회기를 선택하면<br>내담자 정보가 표시됩니다</p>';
    return;
  }

  const studentSessions = state.sessions.filter(s => s.studentId === student.id);
  const patternBtnHTML  = studentSessions.length > 0 ? `
    <div class="pattern-section">
      <button class="pattern-analysis-btn" onclick="runPatternAnalysis()" ${state.patternLoading ? 'disabled' : ''}>
        ${state.patternLoading ? '분석 중...' : '전체 패턴 분석 ↗'}
      </button>
      ${student.patternAnalysis
        ? `<div class="pattern-last">마지막 분석: ${esc(student.patternAnalysis.savedAt)}
            <button class="pattern-view-btn" onclick="viewLastPatternAnalysis()">보기</button></div>`
        : ''}
    </div>` : '';

  content.innerHTML = `
    <div class="ctx-alias">${esc(student.alias)}</div>
    <div class="ctx-meta">${esc(student.grade)}${student.gender ? ' · ' + esc(student.gender) : ''}</div>
    ${student.family    ? `<div class="ctx-block"><div class="ctx-lbl">가족/가정</div><div class="ctx-txt">${esc(student.family)}</div></div>`    : ''}
    ${student.peers     ? `<div class="ctx-block"><div class="ctx-lbl">교우관계</div><div class="ctx-txt">${esc(student.peers)}</div></div>`     : ''}
    ${student.situation ? `<div class="ctx-block"><div class="ctx-lbl">현재 상황</div><div class="ctx-txt">${esc(student.situation)}</div></div>` : ''}
    ${student.notes     ? `<div class="ctx-block"><div class="ctx-lbl">메모</div><div class="ctx-txt">${esc(student.notes)}</div></div>`          : ''}
    ${session.analysis  ? `<div class="ctx-done">보고서 작성됨 · ${esc(session.analysis.savedAt)}</div>` : ''}
    ${patternBtnHTML}`;
}
