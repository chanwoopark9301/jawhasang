/* =============================================
   自畵像 — 오늘 화면 렌더링 (홈 대시보드)
   의존성: state.js, utils.js, nav.js
   ============================================= */

function renderTodayView() {
  const today     = new Date().toISOString().split('T')[0];
  const weekAgo   = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0];

  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const now  = new Date();
  const dayLabel = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${DAYS[now.getDay()]}요일)`;

  // 오늘 기록
  const todaySessions = state.sessions.filter(s => s.date === today);
  const todayRecords  = state.myRecords.filter(r => r.date === today);

  // 최근 7일 (오늘 제외, 최대 8개)
  const recentItems = [
    ...state.sessions
      .filter(s => s.date >= weekAgo && s.date < today)
      .map(s => ({ type: 'session', date: s.date, item: s })),
    ...state.myRecords
      .filter(r => r.date >= weekAgo && r.date < today)
      .map(r => ({ type: 'record',  date: r.date, item: r })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  // 오늘 카드 HTML
  const todayCards = _buildTodayCards(todaySessions, todayRecords);

  // 최근 기록 HTML
  const fixedRecentHTML = recentItems.length
    ? recentItems.map(({ type, date, item }) => {
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
      }).join('')
    : '<div class="home-recent-empty">최근 7일 기록이 없어요</div>';

  return `
    <div class="home-today">
      <!-- 날짜 헤더 -->
      <div class="home-today-header">
        <div class="home-today-date">${dayLabel}</div>
        <div class="home-today-sub">오늘의 기록</div>
      </div>

      <!-- 오늘 기록 카드 -->
      <div class="home-cards-wrap">
        ${todayCards}
      </div>

      <!-- 최근 7일 -->
      ${recentItems.length ? `
      <div class="home-recent-section">
        <div class="home-recent-title">최근 7일</div>
        <div class="home-recent-list">${fixedRecentHTML}</div>
      </div>` : ''}

      <!-- CTA 버튼 -->
      <div class="home-cta">
        <button class="home-cta-btn home-cta-my" onclick="setView('myrecords');handleAdd()">
          + 나의 기록 시작
        </button>
        <button class="home-cta-btn home-cta-counsel" onclick="setView('student');handleAdd()">
          + 상담 기록 시작
        </button>
      </div>
    </div>`;
}

function _buildTodayCards(sessions, records) {
  if (!sessions.length && !records.length) {
    return `<div class="home-no-today">오늘 기록이 없어요.<br>아래 버튼으로 시작해보세요.</div>`;
  }

  const sessionCards = sessions.map(s => {
    const st = state.students.find(st => st.id === s.studentId);
    return `<div class="home-card home-card-session" onclick="calPopupGoSession('${s.id}')">
      <div class="home-card-type">상담 기록</div>
      <div class="home-card-title">${st ? esc(st.alias) : '?'}</div>
      <div class="home-card-meta">${s.sessionNum}회기 · ${s.date}</div>
      ${s.analysis ? '<div class="home-card-badge">보고서 있음</div>' : ''}
    </div>`;
  }).join('');

  const recordCards = records.map(r => {
    const topic = state.myTopics.find(t => t.id === r.topicId);
    const preview = r.content ? r.content.split('\n')[0].substring(0, 50) : '';
    return `<div class="home-card home-card-record" onclick="calPopupGoRecord('${r.id}')">
      <div class="home-card-type">나의 기록</div>
      <div class="home-card-title">${topic ? esc(topic.title) : '?'}</div>
      <div class="home-card-meta">${r.recordNum}번째 · ${r.date}</div>
      ${preview ? `<div class="home-card-preview">${esc(preview)}</div>` : ''}
    </div>`;
  }).join('');

  return sessionCards + recordCards;
}

function _shortDate(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}
