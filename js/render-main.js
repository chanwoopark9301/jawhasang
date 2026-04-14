/* =============================================
   自畵像 — 메인 콘텐츠 렌더링
   의존성: state.js, utils.js, modal.js
   ============================================= */

// ---------------------------------------------------------------------------
// 최상위 render()
// ---------------------------------------------------------------------------

// rAF 배치: 같은 프레임 내 중복 render() 호출을 한 번으로 합산
let _renderScheduled = false;

function render() {
  if (_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(_doRender);
}

function _doRender() {
  _renderScheduled = false;

  // plus-menu가 열려있으면 닫기
  if (typeof closePlusMenu === 'function') closePlusMenu();

  const aiHeaderEl = document.querySelector('.ai-header span:first-child');
  if (aiHeaderEl) aiHeaderEl.textContent = state.view === 'myrecords' ? '주제 정보' : '학생 정보';

  renderSidebar();
  renderMain();
  renderRightPanel();
  updateContextChip();
  updateInputArea();
  if (typeof updateMobileLayout === 'function') updateMobileLayout();
}

// ---------------------------------------------------------------------------
// 컨텍스트 칩 업데이트 (헤더)
// ---------------------------------------------------------------------------

function updateContextChip() {
  const chipLabel = document.getElementById('ctx-topic-label');
  const chipDot   = document.getElementById('ctx-dot');
  const roleLabel = document.getElementById('ctx-role-label');
  if (!chipLabel) return;

  if (state.view === 'myrecords' && state.selTopic) {
    const t = state.myTopics.find(t => t.id === state.selTopic);
    chipLabel.textContent = t ? t.title : '나의 기록';
    if (chipDot) chipDot.style.background = '#1D9E75';
    if (roleLabel) {
      const cnt = state.myRecords.filter(r => r.topicId === state.selTopic).length;
      roleLabel.textContent = cnt ? `${cnt}개 기록` : '';
    }
  } else if (state.view === 'student' && state.selStudent) {
    const s = state.students.find(s => s.id === state.selStudent);
    chipLabel.textContent = s ? s.alias : '상담 기록';
    if (chipDot) chipDot.style.background = '#8B7EC8';
    if (roleLabel) {
      const cnt = state.sessions.filter(ss => ss.studentId === state.selStudent).length;
      roleLabel.textContent = s ? `${esc(s.grade)} · ${cnt}회기` : '';
    }
  } else if (state.view === 'calendar') {
    chipLabel.textContent = '캘린더';
    if (chipDot) chipDot.style.background = '#EF9F27';
    if (roleLabel) roleLabel.textContent = '';
  } else {
    chipLabel.textContent = '自畵像';
    if (chipDot) chipDot.style.background = 'var(--color-text-tertiary)';
    if (roleLabel) roleLabel.textContent = '';
  }
}

// ---------------------------------------------------------------------------
// 하단 입력창 표시 여부
// ---------------------------------------------------------------------------

function updateInputArea() {
  const inputArea = document.getElementById('input-area');
  if (!inputArea) return;
  if (state.view === 'calendar') { inputArea.style.display = 'none'; return; }
  const isHome = !state.selTopic && !state.selStudent;
  const hasContext = (state.view === 'myrecords' && state.selTopic)
                  || (state.view === 'student' && state.selStudent);
  inputArea.style.display = (isHome || hasContext) ? '' : 'none';
}

// ---------------------------------------------------------------------------
// 메인 컨텐츠 renderMain()
// ---------------------------------------------------------------------------

function renderMain() {
  const titleEl = document.getElementById('main-title');
  const subEl   = document.getElementById('main-sub');
  const content = document.getElementById('main-content');
  const nsBtn   = document.getElementById('ns-btn');

  // ── 캘린더 뷰 ────────────────────────────────────────────────────────────
  if (state.view === 'calendar') {
    titleEl.textContent = '캘린더';
    subEl.textContent   = '';
    nsBtn.style.display = 'none';
    content.innerHTML   = renderCalendar();
    return;
  }

  // ── 오늘 화면 (welcome + 아무것도 선택 안 됨) ────────────────────────────
  if (state.mode === 'welcome' && state.myMode === 'welcome' &&
      !state.selStudent && !state.selTopic) {
    titleEl.textContent = '';
    subEl.textContent   = '';
    nsBtn.style.display = 'none';
    content.innerHTML   = renderTodayView();
    return;
  }

  // 폼 모드 → 모달로 위임
  if (['new-student','edit-student','new-session','edit-session'].includes(state.mode)) {
    openModal(state.mode);
  }
  if (['new-topic','new-record'].includes(state.myMode)) {
    const modalId = state.myMode === 'new-record' ? 'write' : 'new-topic';
    state.myMode = 'list';
    openModal(modalId);
  }

  // ── 나의 기록 뷰 ──────────────────────────────────────────────────────────

  if (state.view === 'myrecords') {
    if (!state.selTopic) {
      nsBtn.style.display = 'none';
      content.innerHTML = renderTodayView();
      return;
    }
    nsBtn.style.display = 'none';
    renderChatView();
    return;
  }

  // ── 상담 기록 뷰 ──────────────────────────────────────────────────────────

  if (state.view === 'student') {
    if (!state.selStudent) {
      nsBtn.style.display = 'none';
      content.innerHTML = renderTodayView();
      return;
    }
    nsBtn.style.display = 'none';
    renderChatView();
    return;
  }
}

