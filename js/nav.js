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
  document.getElementById('btn-sv').classList.toggle('active', view === 'student');
  document.getElementById('btn-dv').classList.toggle('active', view === 'myrecords');
  document.getElementById('add-btn').textContent =
    view === 'student' ? '+ 새 내담자 추가' : '+ 새 주제';
  render();
}

function handleAdd() {
  if (state.view === 'myrecords') state.myMode = 'new-topic';
  else                            state.mode   = 'new-student';
  mobilePanel = 'main';
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
  mobilePanel      = 'main';
  render();
}

function selectSession(id) {
  state.selSession  = id;
  state.mode        = 'detail';
  state.sessionTab  = 'verbatim';
  mobilePanel       = 'main';
  render();
}

function selectDateSession(sessionId) {
  const s = state.sessions.find(s => s.id === sessionId);
  if (!s) return;
  state.selSession = sessionId;
  state.selStudent = s.studentId;
  state.mode       = 'detail';
  state.sessionTab = 'verbatim';
  mobilePanel      = 'main';
  render();
}

function showNewSessionForm() {
  state.mode  = 'new-session';
  mobilePanel = 'main';
  render();
}

function handleNsBtn() {
  if (state.view === 'myrecords') showNewRecordForm();
  else                            showNewSessionForm();
}

function cancelForm() {
  state.mode  = state.selStudent ? 'list' : 'welcome';
  mobilePanel = state.selStudent ? 'main' : 'sidebar';
  render();
}

function backFromDetail() {
  state.selSession = null;
  state.mode       = state.view === 'student' ? 'list' : 'welcome';
  mobilePanel      = 'main';
  render();
}

function setSessionTab(tab) {
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
  mobilePanel      = 'main';
  render();
}

function selectRecord(id) {
  state.selRecord = id;
  state.myMode    = 'detail';
  state.myTab     = 'content';
  mobilePanel     = 'main';
  render();
}

function showNewRecordForm() {
  state.myMode = 'new-record';
  mobilePanel  = 'main';
  render();
}

function cancelMyForm() {
  state.myMode = state.selTopic ? 'list' : 'welcome';
  mobilePanel  = state.selTopic ? 'main' : 'sidebar';
  render();
}

function backFromMyDetail() {
  state.selRecord = null;
  state.myMode    = 'list';
  mobilePanel     = 'main';
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
  const hv = document.getElementById('home-view');
  if (hv && hv.style.display !== 'none') renderHomeCalendar();
  else renderMain();
}

// ---------------------------------------------------------------------------
// 모바일 레이아웃
// ---------------------------------------------------------------------------

function setMobilePanel(panel) {
  mobilePanel = panel;
  updateMobileLayout();
}

function updateMobileLayout() {
  const map = { sidebar: 'sidebar', main: 'main', ai: 'ai-panel' };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('mobile-active', key === mobilePanel);
  });
  ['mnav-list', 'mnav-main', 'mnav-ai'].forEach((id, i) => {
    const key = ['sidebar', 'main', 'ai'][i];
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('active', key === mobilePanel);
  });
}
