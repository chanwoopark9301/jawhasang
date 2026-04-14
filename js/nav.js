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
  state.view       = 'student';
  state.currentChatMessages = [];
  closePanels();
  render();
  startContextChat();
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
  state.view       = 'student';
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
  renderRightPanel();
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
  state.view       = 'myrecords';
  state.currentChatMessages = [];
  closePanels();
  render();
  startContextChat();
}

function selectRecord(id) {
  if (!id) return;
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
  renderRightPanel();
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
// 새 대화 모달 (주제/내담자 빠른 선택)
// ---------------------------------------------------------------------------

function openNewChatModal() {
  const overlay = document.getElementById('new-chat-overlay');
  const modal   = document.getElementById('new-chat-modal');
  if (!modal) return;

  modal.innerHTML = `
    <div style="font-size:15px;font-weight:500;margin-bottom:16px;">대화 시작</div>

    <div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">나의 기록</div>
    ${state.myTopics.map(t => `
      <div class="sub-item" style="font-size:13px;padding:8px 10px;margin-bottom:2px;"
        onclick="selectTopic('${t.id}');closeNewChatModal();">
        <span style="color:#1D9E75;font-size:9px;">●</span> ${esc(t.title)}
      </div>
    `).join('')}
    <div class="sub-item sub-item-add" style="font-size:13px;padding:8px 10px;"
      onclick="closeNewChatModal();openModal('new-topic');">
      + 새 주제 만들기
    </div>

    <div style="border-top:0.5px solid var(--color-border);margin:12px 0;"></div>

    <div style="font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">상담 기록</div>
    ${state.students.map(s => `
      <div class="sub-item" style="font-size:13px;padding:8px 10px;margin-bottom:2px;"
        onclick="selectStudent('${s.id}');closeNewChatModal();">
        <span style="color:#8B7EC8;font-size:9px;">●</span> ${esc(s.alias)}
      </div>
    `).join('')}
    <div class="sub-item sub-item-add" style="font-size:13px;padding:8px 10px;"
      onclick="closeNewChatModal();openModal('new-student');">
      + 새 내담자 추가
    </div>

    <button onclick="closeNewChatModal()"
      style="margin-top:16px;width:100%;padding:8px;border:0.5px solid var(--color-border);
             border-radius:var(--radius-md);background:transparent;cursor:pointer;font-size:13px;font-family:inherit;">
      닫기
    </button>`;

  if (overlay) overlay.style.display = '';
  modal.style.display = '';
}

function closeNewChatModal() {
  const overlay = document.getElementById('new-chat-overlay');
  const modal   = document.getElementById('new-chat-modal');
  if (overlay) overlay.style.display = 'none';
  if (modal)   modal.style.display   = 'none';
}

// 컨텍스트 칩 클릭 시 → 새 대화 모달 열기
function openTopicPicker() {
  openNewChatModal();
}

// ---------------------------------------------------------------------------
// AI 라우팅 (뷰에 따라 분기)
// ---------------------------------------------------------------------------

function runCurrentAI() {
  if (state.view === 'myrecords') runMyAI();
  else                            runAI();
}

function runCurrentPattern() {
  if (state.view === 'myrecords') runMyPatternAnalysis();
  else                            runPatternAnalysis();
}

// ---------------------------------------------------------------------------
// 모바일 레이아웃
// ---------------------------------------------------------------------------

function setMobilePanel(panel) {
  if (panel === 'sidebar') toggleSidebar();
  else if (panel === 'ai') toggleAIPanel();
  else closePanels();
}

// updateMobileLayout, sendCurrentChat, handleChatKey, selectRole → chat.js / render-aipanel.js
