/* =============================================
   自畵像 — 홈/인삿말 화면 렌더링
   의존성: state.js, utils.js, nav.js
   ============================================= */

// ---------------------------------------------------------------------------
// 공개 진입점 — renderMain()에서 호출
// ---------------------------------------------------------------------------

function renderTodayView() {
  // 주제가 선택된 경우: 해당 주제 인삿말
  if (state.selTopic && state.view === 'myrecords') {
    return renderTopicGreeting();
  }
  // 기본 홈 인삿말
  return renderHomeGreeting();
}

// ---------------------------------------------------------------------------
// 기본 홈 인삿말
// ---------------------------------------------------------------------------

function renderHomeGreeting() {
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const now  = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${DAYS[now.getDay()]}요일)`;

  const today = now.toISOString().split('T')[0];
  const todayCnt = state.sessions.filter(s => s.date === today).length
                 + state.myRecords.filter(r => r.date === today).length;
  const countNote = todayCnt
    ? `<div style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px;">오늘 ${todayCnt}개의 기록이 있어요</div>`
    : '';

  return `
    <div class="greeting-screen">
      <div class="greeting-title">自畵像</div>
      <div class="greeting-sub">
        ${dateStr}<br>
        오늘 하루를 그저 떠오르는 대로 써봐요.
      </div>
      <div class="quick-cards">
        <div class="quick-card" onclick="handleHomeMyRecords()">
          <div class="quick-card-icon">✎</div>
          <div class="quick-card-title">일상</div>
          <div>생각·감정 기록</div>
        </div>
        <div class="quick-card" onclick="handleHomeCounseling()">
          <div class="quick-card-icon">◎</div>
          <div class="quick-card-title">상담</div>
          <div>회기 기록·슈퍼비전</div>
        </div>
        <div class="quick-card" onclick="setView('investment')">
          <div class="quick-card-icon">☰</div>
          <div class="quick-card-title">투자</div>
          <div>원칙·뉴스·매매 점검</div>
        </div>
        <div class="quick-card" id="home-reminder-settings" onclick="openModal('reminder-settings')">
          <div class="quick-card-icon">⏰</div>
          <div class="quick-card-title">알림</div>
          <div>일상·상담 기록 루틴</div>
        </div>
      </div>
      ${countNote}
      ${_renderRecentItems()}
    </div>`;
}

// ---------------------------------------------------------------------------
// 주제 선택 시 인삿말
// ---------------------------------------------------------------------------

function renderTopicGreeting() {
  const topic = state.myTopics.find(t => t.id === state.selTopic);
  if (!topic) return renderHomeGreeting();

  const role    = topic.aiPrompt || '당신의 이야기를 들을게요';
  const records = state.myRecords.filter(r => r.topicId === topic.id);

  return `
    <div class="greeting-screen">
      <div class="greeting-title">${esc(topic.title)}</div>
      <div class="greeting-sub">${esc(role.length > 70 ? role.substring(0, 70) + '...' : role)}</div>

      <div class="quick-cards">
        <div class="quick-card" onclick="showNewRecordForm()">
          <div class="quick-card-icon">✎</div>
          <div class="quick-card-title">직접 쓰기</div>
          <div>자유롭게 시작</div>
        </div>
        <div class="quick-card" onclick="selectRecord('${records.length ? records[records.length - 1].id : ''}');if(!state.selRecord)showNewRecordForm();">
          <div class="quick-card-icon">○</div>
          <div class="quick-card-title">최근 기록</div>
          <div>${records.length ? records.length + '개 기록' : '아직 없음'}</div>
        </div>
        <div class="quick-card" onclick="setView('calendar')">
          <div class="quick-card-icon">☰</div>
          <div class="quick-card-title">캘린더</div>
          <div>날짜별 보기</div>
        </div>
      </div>

      ${records.length ? `
        <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px;">
          총 ${records.length}개의 기록이 있어요
        </div>` : `
        <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px;">
          아직 기록이 없어요. 첫 기록을 시작해보세요.
        </div>`}
    </div>`;
}

// ---------------------------------------------------------------------------
// 최근 7일 기록 (홈 화면 하단)
// ---------------------------------------------------------------------------

function _renderRecentItems() {
  const today   = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0];

  const items = [
    ...state.sessions
      .filter(s => s.date >= weekAgo && s.date <= today)
      .map(s => ({ type: 'session', date: s.date, item: s })),
    ...state.myRecords
      .filter(r => r.date >= weekAgo && r.date <= today)
      .map(r => ({ type: 'record',  date: r.date, item: r })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  if (!items.length) return '';

  const rows = items.map(({ type, date, item }) => {
    if (type === 'session') {
      const st = state.students.find(s => s.id === item.studentId);
      return `<div class="home-recent-item" onclick="calPopupGoSession('${item.id}')">
        <span class="home-recent-date">${_shortDate(date)}</span>
        <span class="home-recent-dot home-recent-dot-session">●</span>
        <span class="home-recent-label">${st ? esc(st.alias) : '?'} · ${item.sessionNum}회기</span>
      </div>`;
    } else {
      const topic = state.myTopics.find(t => t.id === item.topicId);
      return `<div class="home-recent-item" onclick="calPopupGoRecord('${item.id}')">
        <span class="home-recent-date">${_shortDate(date)}</span>
        <span class="home-recent-dot home-recent-dot-record">●</span>
        <span class="home-recent-label">${topic ? esc(topic.title) : '?'} · ${item.recordNum}번째</span>
      </div>`;
    }
  }).join('');

  return `
    <div class="home-recent-section" style="width:100%;max-width:460px;margin-top:20px;">
      <div class="home-recent-title">최근 7일</div>
      <div class="home-recent-list">${rows}</div>
    </div>`;
}

function _shortDate(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

// ---------------------------------------------------------------------------
// 홈 → 자동 세팅 흐름
// ---------------------------------------------------------------------------

function handleHomeMyRecords() {
  const firstTopic = state.myTopics[0];
  if (!firstTopic) { openModal('new-topic'); return; }
  state.selTopic    = firstTopic.id;
  state.view        = 'myrecords';
  state.myMode      = 'list';
  state.chatMode    = 'general';
  state.currentRole = firstTopic.selectedRole || 'listener';
  state.currentChatMessages = [];
  state.filterTags  = [];
  render();
  startContextChat();
}

function handleHomeCounseling() {
  const firstStudent = state.students[0];
  if (!firstStudent) { openModal('new-student'); return; }
  state.selStudent = firstStudent.id;
  state.view       = 'student';
  state.mode       = 'list';
  state.chatMode   = 'general';
  state.currentChatMessages = [];
  state.filterTags = [];
  render();
  startContextChat();
}
