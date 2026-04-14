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

  const streak    = _getStreak();
  const monthStats = _getMonthStats();
  const question  = _getTodayQuestion();
  const quickStart = _getQuickStartBtn();

  return `
    <div class="greeting-screen">
      <div class="greeting-title">自畵像</div>
      <div class="greeting-sub">
        ${dateStr}<br>
        오늘 하루를 그저 떠오르는 대로 써봐요.
      </div>

      ${streak >= 2 ? `<div class="streak-badge">🔥 ${streak}일 연속 기록 중</div>` : ''}

      ${quickStart}

      <div class="quick-cards">
        <div class="quick-card" onclick="handleHomeMyRecords()">
          <div class="quick-card-icon">✎</div>
          <div class="quick-card-title">나의 기록</div>
          <div>생각·감정 기록</div>
        </div>
        <div class="quick-card" onclick="handleHomeCounseling()">
          <div class="quick-card-icon">◎</div>
          <div class="quick-card-title">상담 기록</div>
          <div>회기 기록·슈퍼비전</div>
        </div>
        <div class="quick-card" onclick="setView('calendar')">
          <div class="quick-card-icon">☰</div>
          <div class="quick-card-title">캘린더</div>
          <div>기록 한눈에 보기</div>
        </div>
      </div>

      ${monthStats.total > 0 ? `
      <div class="home-stats-bar">
        <div class="home-stat"><span class="home-stat-num" style="color:#1D9E75;">${monthStats.records}</span><span class="home-stat-lbl">나의 기록</span></div>
        <div class="home-stat-divider"></div>
        <div class="home-stat"><span class="home-stat-num" style="color:#EF9F27;">${monthStats.sessions}</span><span class="home-stat-lbl">상담 기록</span></div>
        <div class="home-stat-divider"></div>
        <div class="home-stat"><span class="home-stat-num">${monthStats.total}</span><span class="home-stat-lbl">이번 달 합계</span></div>
      </div>` : ''}

      <div class="home-question-card" onclick="handleHomeMyRecords()">
        <div class="home-question-label">오늘의 성찰 질문</div>
        <div class="home-question-text">${esc(question)}</div>
      </div>

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
// 연속 기록 스트릭 계산
// ---------------------------------------------------------------------------

function _getStreak() {
  const allDates = new Set([
    ...state.sessions.map(s => s.date),
    ...state.myRecords.map(r => r.date),
  ]);
  if (!allDates.size) return 0;

  let streak = 0;
  const d = new Date();
  // 오늘 기록 없으면 어제부터 체크
  const today = d.toISOString().split('T')[0];
  if (!allDates.has(today)) d.setDate(d.getDate() - 1);

  while (true) {
    const key = d.toISOString().split('T')[0];
    if (!allDates.has(key)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ---------------------------------------------------------------------------
// 이번 달 통계
// ---------------------------------------------------------------------------

function _getMonthStats() {
  const now   = new Date();
  const ym    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const records  = state.myRecords.filter(r => r.date.startsWith(ym)).length;
  const sessions = state.sessions.filter(s => s.date.startsWith(ym)).length;
  return { records, sessions, total: records + sessions };
}

// ---------------------------------------------------------------------------
// 오늘의 성찰 질문 (날짜 기반 순환)
// ---------------------------------------------------------------------------

const _DAILY_QUESTIONS = [
  '오늘 가장 오래 머문 감정은 무엇이었나요?',
  '오늘 나를 가장 힘들게 한 것은 무엇인가요?',
  '오늘 잘 해냈다고 느낀 순간이 있었나요?',
  '지금 이 순간 가장 마음에 걸리는 것은 무엇인가요?',
  '오늘 누군가에게 고마운 마음이 들었나요?',
  '오늘 회피했거나 미룬 것이 있나요?',
  '지금 나에게 필요한 것은 무엇인가요?',
  '이번 주 상담에서 가장 인상 깊었던 장면은 무엇인가요?',
  '요즘 나를 소진시키는 것과 채우는 것은 각각 무엇인가요?',
  '한 달 뒤의 나에게 한 마디를 남긴다면?',
  '오늘 내담자와의 대화에서 나는 어떤 상담자였나요?',
  '지금 하고 있는 공부에서 가장 막히는 부분은 어디인가요?',
  '오늘 나는 나 자신에게 친절했나요?',
  '요즘 반복되는 생각이나 패턴이 있나요?',
  '내가 상담사로 성장하고 있다고 느낄 때는 언제인가요?',
];

function _getTodayQuestion() {
  const now = new Date();
  const idx = (now.getFullYear() * 366 + now.getMonth() * 31 + now.getDate()) % _DAILY_QUESTIONS.length;
  return _DAILY_QUESTIONS[idx];
}

// ---------------------------------------------------------------------------
// 이어서 쓰기 버튼 (마지막으로 사용한 주제)
// ---------------------------------------------------------------------------

function _getQuickStartBtn() {
  // 가장 최근 기록이 있는 주제 찾기
  const lastRecord = [...state.myRecords].sort((a, b) => b.date.localeCompare(a.date))[0];
  const lastTopic  = lastRecord ? state.myTopics.find(t => t.id === lastRecord.topicId) : state.myTopics[0];
  if (!lastTopic) return '';

  return `<button class="home-quick-start" onclick="selectTopic('${lastTopic.id}')">
    이어서 쓰기 — ${esc(lastTopic.title)} ›
  </button>`;
}

// ---------------------------------------------------------------------------
// 홈 → 자동 세팅 흐름
// ---------------------------------------------------------------------------

function handleHomeMyRecords() {
  const firstTopic = state.myTopics[0];
  if (!firstTopic) {
    openModal('new-topic');
    return;
  }
  state.selTopic    = firstTopic.id;
  state.view        = 'myrecords';
  state.myMode      = 'list';
  state.chatMode    = 'general';
  state.currentRole = firstTopic.selectedRole || 'listener';
  state.currentChatMessages = [];
  state.filterTags  = [];
  const restored = loadChatHistory();
  render();
  if (!restored) startContextChat();
}

function handleHomeCounseling() {
  const firstStudent = state.students[0];
  if (!firstStudent) {
    openModal('new-student');
    return;
  }
  state.selStudent = firstStudent.id;
  state.view       = 'student';
  state.mode       = 'list';
  state.chatMode   = 'general';
  state.currentChatMessages = [];
  state.filterTags = [];
  const restored = loadChatHistory();
  render();
  if (!restored) startContextChat();
}
