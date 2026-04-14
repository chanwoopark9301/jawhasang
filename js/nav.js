/* =============================================
   自畵像 — 네비게이션 및 모바일 레이아웃
   의존성: state.js
   ============================================= */

// ---------------------------------------------------------------------------
// 뷰 전환
// ---------------------------------------------------------------------------

function setView(view) {
  state.view       = view;
  state.selStudent = null;
  state.selSession = null;
  state.mode       = 'welcome';
  state.filterTags = [];
  state.searchQuery = '';
  const searchEl = document.getElementById('sidebar-search');
  if (searchEl) searchEl.value = '';

  // 3-버튼 nav 활성 상태 갱신
  document.getElementById('btn-sv')?.classList.toggle('active', view === 'student');
  document.getElementById('btn-dv')?.classList.toggle('active', view === 'myrecords');
  document.getElementById('btn-cal')?.classList.toggle('active', view === 'calendar');

  // 컨텍스트 영역: 캘린더 뷰에서는 목록 숨김
  const ctx = document.getElementById('sidebar-context');
  if (ctx) ctx.style.display = view === 'calendar' ? 'none' : '';

  // 추가 버튼 텍스트
  const addBtn = document.getElementById('add-btn');
  if (addBtn) addBtn.textContent =
    view === 'student'    ? '+ 새 내담자' :
    view === 'myrecords'  ? '+ 새 주제'   : '';

  logger.info('뷰 전환: %s', view);
  render();
}

function handleAdd() {
  if (state.view === 'myrecords') state.myMode = 'new-topic';
  else                            state.mode   = 'new-student';
  closePanels();
  render();
}

// ---------------------------------------------------------------------------
// 상담 기록 네비게이션
// ---------------------------------------------------------------------------

function selectStudent(id) {
  state.selStudent = id;
  state.selSession = null;
  state.mode       = 'list';
  state.filterTags = [];
  closePanels();
  render();
}

function selectSession(id) {
  state.selSession  = id;
  state.mode        = 'detail';
  state.sessionTab  = 'verbatim';
  closePanels();
  render();
}

function selectDateSession(sessionId) {
  const s = state.sessions.find(s => s.id === sessionId);
  if (!s) return;
  state.selSession = sessionId;
  state.selStudent = s.studentId;
  state.mode       = 'detail';
  state.sessionTab = 'verbatim';
  closePanels();
  render();
}

function showNewSessionForm() {
  state.mode = 'new-session';
  closePanels();
  render();
}

function handleNsBtn() {
  if (state.view === 'myrecords') showNewRecordForm();
  else                            showNewSessionForm();
}

function cancelForm() {
  _resetVtEditor();
  state.mode = state.selStudent ? 'list' : 'welcome';
  render();
}

function backFromDetail() {
  _resetVtEditor();
  state.vtInlineEdit = false;
  state.selSession   = null;
  state.mode         = state.view === 'student' ? 'list' : 'welcome';
  render();
}

function setSessionTab(tab) {
  if (state.vtInlineEdit) { _resetVtEditor(); state.vtInlineEdit = false; }
  state.sessionTab = tab;
  renderMain();
  renderAIPanel();
  if (tab === 'dialogue') {
    requestAnimationFrame(() => {
      const el = document.getElementById('chat-messages');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}

// ---------------------------------------------------------------------------
// 나의 기록 네비게이션
// ---------------------------------------------------------------------------

function selectTopic(id) {
  state.selTopic   = id;
  state.selRecord  = null;
  state.myMode     = 'list';
  state.filterTags = [];
  closePanels();
  render();
}

function selectRecord(id) {
  state.selRecord = id;
  state.myMode    = 'detail';
  state.myTab     = 'content';
  closePanels();
  render();
}

function showNewRecordForm() {
  state.myMode = 'new-record';
  closePanels();
  render();
}

function cancelMyForm() {
  state.myMode = state.selTopic ? 'list' : 'welcome';
  render();
}

function backFromMyDetail() {
  state.selRecord = null;
  state.myMode    = 'list';
  render();
}

function setMyTab(tab) {
  state.myTab = tab;
  renderMain();
  renderAIPanel();
}

// ---------------------------------------------------------------------------
// 캘린더 네비게이션
// ---------------------------------------------------------------------------

function selectCalDate(date) {
  openCalPopup(date);
}

function navCal(dir) {
  state.calMonth += dir;
  if (state.calMonth < 0)  { state.calMonth = 11; state.calYear--; }
  if (state.calMonth > 11) { state.calMonth = 0;  state.calYear++; }
  renderMain();
}

// ---------------------------------------------------------------------------
// 모바일 레이아웃 (오버레이 방식으로 통합)
// ---------------------------------------------------------------------------

function setMobilePanel(panel) {
  // 하위 호환 — 새 방식으로 위임
  if (panel === 'sidebar') toggleSidebar();
  else if (panel === 'ai') toggleAIPanel();
  else closePanels();
}

function updateMobileLayout() {
  // 새 오버레이 방식에서는 resize.js의 _updateMobileNavActive()가 담당
  _updateMobileNavActive();
}
