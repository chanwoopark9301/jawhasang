/* =============================================
   自畵像 — 오른쪽 패널 렌더링
   의존성: state.js, utils.js
   ============================================= */

// ---------------------------------------------------------------------------
// 최상위 진입점 — render()에서 호출
// ---------------------------------------------------------------------------

function renderRightPanel() {
  _updateRpTopic();
  _updateRpRolePills();
  _updateRpPeriod();
  _updateRpContent();
  _ensureInvestmentSignalMenu();
  _updateRpButtons();
}

function _ensureInvestmentSignalMenu() {
  if (state.view !== 'investment') return;
  const menu = document.querySelector('.investment-side-menu');
  if (!menu || document.getElementById('investment-menu-signals')) return;
  menu.insertAdjacentHTML(
    'beforeend',
    "<button id=\"investment-menu-signals\" onclick=\"openModal('investment-signals')\">Search signals</button>"
  );
}

// 하위 호환 alias (setSessionTab, setMyTab, setMyPeriod 등에서 호출)
function renderAIPanel() { renderRightPanel(); }

// ---------------------------------------------------------------------------
// 현재 주제/내담자 표시
// ---------------------------------------------------------------------------

function _updateRpTopic() {
  const el = document.getElementById('rp-topic');
  if (!el) return;
  el.onclick = openTopicPicker;
  el.title = '이동';

  if (state.view === 'myrecords' && state.selTopic) {
    const t = state.myTopics.find(t => t.id === state.selTopic);
    el.textContent = t ? t.title : '주제 없음';
  } else if (state.view === 'student' && state.selStudent) {
    const s = state.students.find(s => s.id === state.selStudent);
    el.textContent = s ? s.alias : '내담자 없음';
  } else if (state.view === 'investment') {
    const inv = state.investment || defaultInvestmentState();
    el.textContent = `${inv.positions.length}개 종목`;
    el.onclick = () => openModal('investment-portfolio');
    el.title = '포트폴리오 / 종목 관리';
  } else {
    el.textContent = '선택 없음';
  }
}

// ---------------------------------------------------------------------------
// AI 역할 pills (나의 기록 전용)
// ---------------------------------------------------------------------------

function _updateRpRolePills() {
  const section = document.getElementById('rp-role-section');
  const pills   = document.getElementById('rp-role-pills');
  if (!section || !pills) return;

  const showRoles = state.view === 'myrecords' && !!state.selTopic;
  section.style.display = showRoles ? '' : 'none';
  if (!showRoles) return;

  const topic = state.myTopics.find(t => t.id === state.selTopic);
  const newHtml = AI_ROLE_PRESETS.map(p =>
    `<button class="role-pill${topic?.selectedRole === p.id ? ' active' : ''}"
      onclick="selectRole('${p.id}')" title="${esc(p.desc)}">
      ${esc(p.label)}
    </button>`
  ).join('');
  if (pills.innerHTML !== newHtml) pills.innerHTML = newHtml;
}

// ---------------------------------------------------------------------------
// 보고서 기간 선택 (나의 기록 전용)
// ---------------------------------------------------------------------------

function _updateRpPeriod() {
  const section = document.getElementById('rp-period-section');
  const btns    = document.getElementById('rp-period-btns');
  if (!section || !btns) return;

  const show = state.view === 'myrecords' && !!state.selRecord;
  section.style.display = show ? '' : 'none';
  if (!show) return;

  const periods = [
    { key: 'week',  label: '이번 주' },
    { key: 'month', label: '이번 달' },
    { key: 'all',   label: '전체'    },
  ];
  btns.innerHTML = periods.map(p =>
    `<button class="period-btn${state.myPeriod === p.key ? ' active' : ''}" onclick="setMyPeriod('${p.key}')">${p.label}</button>`
  ).join('');
}

// ---------------------------------------------------------------------------
// ai-content 영역 (학생 컨텍스트 정보)
// ---------------------------------------------------------------------------

function _updateRpContent() {
  const content = document.getElementById('ai-content');
  if (!content) return;

  // 로딩 중
  if (state.aiLoading || state.myAiLoading) {
    const label = state.view === 'myrecords' ? '보고서 작성 중...' : '슈퍼비전 보고서 작성 중...';
    content.innerHTML = `<div class="ai-loading">
      <div class="ai-loading-label">${label}</div>
      <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    </div>`;
    return;
  }

  // 나의 기록 뷰
  if (state.view === 'myrecords') {
    const record = state.selRecord ? state.myRecords.find(r => r.id === state.selRecord) : null;
    const topic  = record
      ? state.myTopics.find(t => t.id === record.topicId)
      : (state.selTopic ? state.myTopics.find(t => t.id === state.selTopic) : null);

    if (!topic) {
      content.innerHTML = '<p class="ai-placeholder">주제를 선택하면<br>정보가 표시됩니다</p>';
      return;
    }

    const cnt = state.myRecords.filter(r => r.topicId === topic.id).length;
    content.innerHTML = `
      <div class="ctx-alias" style="color:#1D9E75;">${esc(topic.title)}</div>
      <div class="ctx-meta">${cnt}개 기록</div>
      ${topic.aiPrompt
        ? `<div class="ctx-block"><div class="ctx-lbl">AI 역할</div><div class="ctx-txt">${esc(topic.aiPrompt)}</div></div>`
        : `<div class="ctx-block"><div class="ctx-lbl">AI 역할</div><div class="ctx-txt" style="color:var(--color-text-tertiary);">기본 성찰 코치</div></div>`}
      ${record ? `<div class="ctx-done" style="background:#e0f5ec;color:#0F6E56;">${record.recordNum}번째 기록 · ${record.date}</div>` : ''}
      ${_myPatternSection(topic)}`;
    return;
  }

  if (state.view === 'investment') {
    const inv = state.investment || defaultInvestmentState();
    const last = inv.decisions.at(-1);
    content.innerHTML = `
      <div class="ctx-alias" style="color:#2563EB;">투자</div>
      <div class="ctx-meta">${inv.positions.length}개 종목 · ${inv.decisions.length}개 판단</div>
      <div class="investment-side-menu">
        <button id="investment-menu-portfolio" onclick="openModal('investment-portfolio')">포트폴리오</button>
        <button id="investment-menu-rules" onclick="openModal('investment-rules')">투자 원칙</button>
        <button id="investment-menu-decisions" onclick="openModal('investment-decisions')">매매 기록</button>
        <button id="investment-menu-news" onclick="openModal('investment-news')">뉴스 동향</button>
        <button id="investment-menu-timeline" onclick="openModal('investment-timeline')">타임라인</button>
        <button id="investment-menu-calendar-sync" onclick="syncInvestmentCalendarData()">일정 동기화</button>
        <button id="investment-menu-ai-compare" onclick="openModal('investment-ai-compare')">AI 비교</button>
      </div>
      <div class="ctx-block">
        <div class="ctx-lbl">역할</div>
        <div class="ctx-txt">종목 추천이 아니라 사전에 정한 원칙 위반 여부를 점검합니다.</div>
      </div>
      <div class="ctx-block">
        <div class="ctx-lbl">원칙</div>
        <div class="ctx-txt">최대 비중 ${esc(inv.rules.maxPositionWeight)}% · 쿨다운 ${esc(inv.rules.cooldownMinutes)}분</div>
      </div>
      ${inv.alerts?.length ? `<div class="ctx-block">
        <div class="ctx-lbl">위험 신호</div>
        <div class="ctx-txt">${esc(inv.alerts[0].title)}${inv.alerts.length > 1 ? ` 외 ${inv.alerts.length - 1}건` : ''}</div>
      </div>` : ''}
      ${last ? `<div class="ctx-done" style="background:#EAF1FF;color:#1D4ED8;">마지막 판단 · ${esc(last.label)}</div>` : ''}`;
    return;
  }

  // 상담 기록 뷰
  const session = state.selSession ? state.sessions.find(s => s.id === state.selSession) : null;
  const student = session ? state.students.find(s => s.id === session.studentId) : null;

  if (!session || !student) {
    const cur = state.selStudent ? state.students.find(s => s.id === state.selStudent) : null;
    if (cur) {
      const cnt = state.sessions.filter(s => s.studentId === cur.id).length;
      content.innerHTML = `
        <div class="ctx-alias">${esc(cur.alias)}</div>
        <div class="ctx-meta">${esc(cur.grade)}${cur.gender ? ' · ' + esc(cur.gender) : ''}</div>
        <p class="ai-placeholder" style="margin-top:12px;">회기를 선택하면<br>보고서를 생성할 수 있어요</p>
        ${cnt > 0 ? _patternSection(cur) : ''}`;
    } else {
      content.innerHTML = '<p class="ai-placeholder">항목을 선택하면<br>정보가 표시됩니다</p>';
    }
    return;
  }

  const studentSessions = state.sessions.filter(s => s.studentId === student.id);
  content.innerHTML = `
    <div class="ctx-alias">${esc(student.alias)}</div>
    <div class="ctx-meta">${esc(student.grade)}${student.gender ? ' · ' + esc(student.gender) : ''}</div>
    ${student.family    ? `<div class="ctx-block"><div class="ctx-lbl">가족/가정</div><div class="ctx-txt">${esc(student.family)}</div></div>`    : ''}
    ${student.peers     ? `<div class="ctx-block"><div class="ctx-lbl">교우관계</div><div class="ctx-txt">${esc(student.peers)}</div></div>`     : ''}
    ${student.situation ? `<div class="ctx-block"><div class="ctx-lbl">현재 상황</div><div class="ctx-txt">${esc(student.situation)}</div></div>` : ''}
    ${student.notes     ? `<div class="ctx-block"><div class="ctx-lbl">메모</div><div class="ctx-txt">${esc(student.notes)}</div></div>`          : ''}
    ${session.analysis  ? `<div class="ctx-done">보고서 작성됨 · ${esc(session.analysis.savedAt)}</div>` : ''}
    ${studentSessions.length > 0 ? _patternSection(student) : ''}`;
}

function _patternSection(student) {
  return `<div class="pattern-section">
    <button class="pattern-analysis-btn" id="rp-pattern-inner" onclick="runPatternAnalysis()" ${state.patternLoading ? 'disabled' : ''}>
      ${state.patternLoading ? '분석 중...' : '전체 패턴 분석 ↗'}
    </button>
    ${student.patternAnalysis
      ? `<div class="pattern-last">마지막 분석: ${esc(student.patternAnalysis.savedAt)}
          <button class="pattern-view-btn" onclick="viewLastPatternAnalysis()">보기</button></div>`
      : ''}
  </div>`;
}

function _myPatternSection(topic) {
  const cnt = state.myRecords.filter(r => r.topicId === topic.id).length;
  if (!cnt) return '';
  return `<div class="pattern-section" style="border-top-color:rgba(29,158,117,.2);">
    <button class="pattern-analysis-btn" style="background:#1D9E75;" onclick="runMyPatternAnalysis()" ${state.myPatternLoading ? 'disabled' : ''}>
      ${state.myPatternLoading ? '요약 중...' : '대화 요약·저장 ↗'}
    </button>
    ${topic.patternAnalysis
      ? `<div class="pattern-last">마지막 분석: ${esc(topic.patternAnalysis.savedAt)}
          <button class="pattern-view-btn" style="color:#1D9E75;" onclick="viewLastMyPatternAnalysis()">보기</button></div>`
      : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// 도구 버튼 상태 업데이트
// ---------------------------------------------------------------------------

function _updateRpButtons() {
  const reportBtn    = document.getElementById('rp-report-btn');
  const transformBtn = document.getElementById('rp-transform-btn');
  const patternBtn   = document.getElementById('rp-pattern-btn');
  const deepqBtn     = document.getElementById('rp-deepq-btn');
  const timelineBtn  = document.getElementById('rp-timeline-btn');

  const isLoading = state.aiLoading || state.myAiLoading || state.transformLoading
                  || state.patternLoading || state.myPatternLoading;

  // ── 슈퍼비전 보고서 버튼 (상담 기록 전용) ──
  if (reportBtn) {
    if (state.view === 'student') {
      reportBtn.style.display = '';
      const session = state.selSession ? state.sessions.find(s => s.id === state.selSession) : null;
      const hasVt   = !!(session?.verbatim?.trim()) || !!(state.attachedVerbatim?.trim());
      reportBtn.disabled    = !hasVt || isLoading;
      reportBtn.textContent = state.aiLoading ? '분석 중...'
        : (session?.analysis ? '보고서 재생성 ↗' : '슈퍼비전 보고서 ↗');
    } else {
      // 나의 기록 — 보고서 버튼 숨김
      reportBtn.style.display = 'none';
    }
  }

  // ── 축어록 AI 정리 버튼 (상담 기록 전용) ──
  if (transformBtn) {
    if (state.view === 'student') {
      transformBtn.style.display = '';
      const session = state.selSession ? state.sessions.find(s => s.id === state.selSession) : null;
      const hasVt   = !!(session?.verbatim?.trim()) || !!(state.attachedVerbatim?.trim());
      transformBtn.disabled    = !hasVt || isLoading;
      transformBtn.textContent = state.transformLoading ? '정리 중...' : '축어록 AI 정리 ↗';
    } else {
      transformBtn.style.display = 'none';
    }
  }

  // ── 패턴 분석 버튼 (공통, 뷰별 텍스트/조건 분기) ──
  if (patternBtn) {
    if (state.view === 'myrecords') {
      const hasMsgs = state.currentChatMessages.filter(m => m.role !== 'system').length > 0;
      patternBtn.disabled    = !hasMsgs || isLoading;
      patternBtn.textContent = state.myPatternLoading ? '요약 중...' : '대화 요약·저장 ↗';
    } else if (state.view === 'student') {
      patternBtn.disabled    = !state.selStudent || isLoading;
      patternBtn.textContent = state.patternLoading ? '분석 중...' : '전체 패턴 분석 ↗';
    } else {
      patternBtn.disabled = true;
    }
  }

  // ── 심층 질문 버튼 (공통) ──
  if (deepqBtn) {
    if (state.view === 'myrecords') {
      const myRecordCount = state.myRecords.filter(r => r.topicId === state.selTopic).length;
      deepqBtn.disabled = !(state.selTopic && myRecordCount > 0) || isLoading;
    } else if (state.view === 'student') {
      const session = state.selSession ? state.sessions.find(s => s.id === state.selSession) : null;
      deepqBtn.disabled = !(session?.verbatim?.trim()) || isLoading;
    } else {
      deepqBtn.disabled = true;
    }
    deepqBtn.textContent = '심층 질문 ↗';
  }

  // ── 성장 타임라인 버튼 (공통) ──
  if (timelineBtn) {
    if (state.view === 'myrecords') {
      const myRecordCount = state.myRecords.filter(r => r.topicId === state.selTopic).length;
      timelineBtn.disabled = !(state.selTopic && myRecordCount >= 2) || isLoading;
    } else if (state.view === 'student') {
      const sessionCount = state.sessions.filter(s => s.studentId === state.selStudent).length;
      timelineBtn.disabled = !(state.selStudent && sessionCount >= 2) || isLoading;
    } else {
      timelineBtn.disabled = true;
    }
    timelineBtn.textContent = '성장 타임라인 ↗';
  }
}

// ---------------------------------------------------------------------------
// AI 역할 선택 즉시 적용
// ---------------------------------------------------------------------------

function selectRole(presetId) {
  // 직접 입력: 팝업 모달로 처리
  if (presetId === 'custom') {
    openModal('custom-role');
    return;
  }

  const prevRole = state.currentRole;
  state.currentRole = presetId;

  const topic = state.myTopics.find(t => t.id === state.selTopic);
  if (topic) {
    const preset = AI_ROLE_PRESETS.find(p => p.id === presetId);
    if (preset) topic.aiPrompt = preset.prompt;
    topic.selectedRole = presetId;
    saveData();
  }

  // 대화 중 역할 변경 시 시스템 메시지로 구분선 표시
  if (prevRole !== presetId && state.currentChatMessages.length > 0) {
    const preset = AI_ROLE_PRESETS.find(p => p.id === presetId);
    const label  = preset ? preset.label : presetId;
    appendSystemMessage(`— AI 역할이 '${label}'(으)로 변경되었습니다 —`);
  }

  renderRightPanel();
  updateContextChip();
}

// ---------------------------------------------------------------------------
// 하위 호환 — 기존 코드에서 개별 패널 렌더를 호출하는 경우
// ---------------------------------------------------------------------------

function renderMyAIPanel() { renderRightPanel(); }
