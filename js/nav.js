/* =============================================
   自畵像 — 네비게이션 및 모바일 레이아웃
   의존성: state.js
   ============================================= */

// ---------------------------------------------------------------------------
// 뷰 전환
// ---------------------------------------------------------------------------

function setView(view) {
  const prevView = state.view;
  state.view       = view;
  state.selStudent = null;
  state.selSession = null;
  state.selInvestmentPosition = null;
  state.mode       = 'welcome';
  state.filterTags = [];
  state.searchQuery = '';
  if (view === 'investment') {
    if (prevView !== 'investment') {
      state.currentChatMessages = [];
      loadChatHistory();
    }
    if ((state.replyMode || 'dictation') === 'dictation') state.replyMode = 'question';
  }

  logger.info('뷰 전환: %s', view);
  render();
}

function handleAdd() {
  if (state.view === 'myrecords') state.myMode = 'new-topic';
  else if (state.view === 'investment') state.view = 'investment';
  else                            state.mode   = 'new-student';
  closePanels();
  render();
}

// ---------------------------------------------------------------------------
// 상담 기록 네비게이션
// ---------------------------------------------------------------------------

function selectStudent(id) {
  // 같은 학생 재선택이면 대화 유지 (초기화 안 함)
  const isSame = state.selStudent === id;
  state.selStudent = id;
  state.selSession = null;
  state.mode       = 'list';
  state.filterTags = [];
  state.view       = 'student';
  closePanels();
  if (!isSame) {
    // 다른 학생으로 전환: localStorage에서 복원 시도
    state.currentChatMessages = [];
    const restored = loadChatHistory();
    render();
    if (!restored) startContextChat();
    else renderChatView();
  } else {
    render();
  }
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
  // 같은 주제 재선택이면 대화 유지 (초기화 안 함)
  const isSame = state.selTopic === id;
  state.selTopic   = id;
  state.selRecord  = null;
  state.myMode     = 'list';
  state.filterTags = [];
  // 해당 주제의 저장된 AI 역할 복원 (없으면 listener 기본값)
  const topic = state.myTopics.find(t => t.id === id);
  state.currentRole = topic?.selectedRole || 'listener';
  closePanels();
  if (!isSame) {
    // 다른 주제로 전환: localStorage에서 복원 시도
    state.currentChatMessages = [];
    const restored = loadChatHistory();
    render();
    if (!restored) startContextChat();
    else renderChatView();
  } else {
    render();
  }
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

  const investment = normalizeInvestmentState(state.investment);
  const investRows = investment.positions.length
    ? investment.positions.slice(0, 6).map(p => `
      <div class="picker-sub-row">
        <span>${esc(p.symbol || p.name || '종목')}</span>
        <small>${esc(p.assetType === 'cash' ? '현금' : p.assetType === 'crypto' ? '코인' : '주식')}</small>
      </div>`).join('')
    : '<div class="picker-empty">등록된 종목 없음</div>';

  modal.innerHTML = `
    <div class="picker-title">이동</div>

    <div class="picker-section-label">기본</div>
    <div class="picker-row" onclick="showHome();closeNewChatModal();">
      <span style="color:#EF9F27;font-size:9px;">●</span>
      <div><strong>캘린더</strong><small>일상 · 상담 · 투자 이벤트 허브</small></div>
    </div>

    <div class="picker-section-label">일상</div>
    ${state.myTopics.map(t => `
      <div class="picker-row"
        onclick="selectTopic('${t.id}');closeNewChatModal();">
        <span style="color:#1D9E75;font-size:9px;">●</span>
        <div><strong>${esc(t.title)}</strong><small>${state.myRecords.filter(r => r.topicId === t.id).length}개 기록</small></div>
      </div>
    `).join('')}
    <div class="picker-row picker-add"
      onclick="closeNewChatModal();openModal('new-topic');">
      + 새 주제 만들기
    </div>

    <div class="picker-section-label">상담</div>
    ${state.students.map(s => `
      <div class="picker-row"
        onclick="selectStudent('${s.id}');closeNewChatModal();">
        <span style="color:#8B7EC8;font-size:9px;">●</span>
        <div><strong>${esc(s.alias)}</strong><small>${state.sessions.filter(ss => ss.studentId === s.id).length}회기</small></div>
      </div>
    `).join('')}
    <div class="picker-row picker-add"
      onclick="closeNewChatModal();openModal('new-student');">
      + 새 내담자 추가
    </div>

    <div class="picker-section-label">투자</div>
    <div class="picker-row" onclick="setView('investment');closeNewChatModal();">
      <span style="color:#2563EB;font-size:9px;">●</span>
      <div><strong>투자 파트너</strong><small>${investment.positions.length}개 종목 · ${investment.decisions.length}개 판단</small></div>
    </div>
    <div class="picker-invest-list">${investRows}</div>
    <div class="picker-row picker-add" onclick="setView('investment');closeNewChatModal();openModal('investment-portfolio');">
      포트폴리오 / 종목 관리
    </div>

    <button class="picker-close" onclick="closeNewChatModal()">
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
  // 나의 기록 보고서 버튼은 UI에서 제거 — 상담 기록 전용
  if (state.view === 'student') runAI();
}

function runCurrentPattern() {
  if (state.view === 'myrecords') runMyPatternAnalysis();
  else                            runPatternAnalysis();
}

function runDeepQuestion() {
  if (state.view === 'myrecords') runMyDeepQuestion();
  else if (state.view === 'student') runCounselingDeepQuestion();
}

function runGrowthTimeline() {
  if (state.view === 'myrecords') runMyGrowthTimeline();
  else if (state.view === 'student') runCounselingGrowthTimeline();
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
