/* =============================================
   自畵像 — 왼쪽 작업 메뉴 렌더링
   의존성: state.js, utils.js, modal.js
   ============================================= */

function renderSidebar() {
  document.getElementById('nav-my')?.classList.toggle('active', state.view === 'myrecords');
  document.getElementById('nav-sv')?.classList.toggle('active', state.view === 'student');
  document.getElementById('nav-invest')?.classList.toggle('active', state.view === 'investment');

  setSidebarSection('sub-my', state.view === 'myrecords' ? renderMyRecordActions() : '');
  setSidebarSection('sub-sv', state.view === 'student' ? renderCounselingActions() : '');
  setSidebarSection('sub-invest', state.view === 'investment' ? renderInvestmentActions() : '');
}

function setSidebarSection(id, html) {
  const el = document.getElementById(id);
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

function renderMyRecordActions() {
  const recordCount = Array.isArray(state.myRecords) ? state.myRecords.length : 0;
  const topicCount = Array.isArray(state.myTopics) ? state.myTopics.length : 0;
  return `
    <button class="sub-action-btn primary" onclick="openModal('write')">오늘 기록 쓰기</button>
    <button class="sub-action-btn" onclick="openModal('new-topic')">새 주제 만들기</button>
    <button class="sub-action-btn" onclick="openTopicPicker()">주제 선택</button>
    <button class="sub-action-btn" onclick="openModal('reminder-settings')">기록 알림</button>
    <div class="sub-action-note">${topicCount}개 주제 · ${recordCount}개 기록</div>
  `;
}

function renderCounselingActions() {
  const sessionCount = Array.isArray(state.sessions) ? state.sessions.length : 0;
  const studentCount = Array.isArray(state.students) ? state.students.length : 0;
  return `
    <button class="sub-action-btn primary" onclick="openModal('new-session')">상담 회기 추가</button>
    <button class="sub-action-btn" onclick="openModal('new-student')">내담자 추가</button>
    <button class="sub-action-btn" onclick="openTopicPicker()">상담 선택</button>
    <button class="sub-action-btn" onclick="runCurrentPattern()">패턴 분석</button>
    <div class="sub-action-note">${studentCount}명 · ${sessionCount}개 회기</div>
  `;
}

function renderInvestmentActions() {
  const inv = normalizeInvestmentState(state.investment);
  const positions = (inv.positions || []).filter(p => !isCashInvestmentPosition(p));
  const cash = (inv.positions || [])
    .filter(p => isCashInvestmentPosition(p))
    .reduce((sum, p) => sum + investmentPositionValue(p, 'currentPrice'), 0);
  return `
    <button class="sub-action-btn primary" id="investment-menu-desk" onclick="openModal('investment-desk')">오늘의 데스크</button>
    <button class="sub-action-btn" id="investment-menu-portfolio" onclick="openModal('investment-portfolio')">계좌·포트폴리오</button>
    <button class="sub-action-btn" id="investment-menu-timeline" onclick="openModal('investment-timeline')">투자 타임라인</button>
    <div class="sub-action-note">${positions.length}종목 · 현금 ${formatMoney(cash)}</div>
  `;
}
