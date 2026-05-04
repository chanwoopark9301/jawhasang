/* =============================================
   自畵像 — 캘린더 & 팝업 렌더링
   의존성: state.js, utils.js, nav.js
   ============================================= */

// ---------------------------------------------------------------------------
// 캘린더
// ---------------------------------------------------------------------------

function renderCalendar() {
  const year  = state.calYear;
  const month = state.calMonth;
  const today = new Date().toISOString().split('T')[0];
  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();

  const sessionCnt = {};
  state.sessions.forEach(s => { sessionCnt[s.date] = (sessionCnt[s.date] || 0) + 1; });
  const recordCnt = {};
  state.myRecords.forEach(r => { recordCnt[r.date] = (recordCnt[r.date] || 0) + 1; });
  const investCnt = {};
  (state.investment?.events || []).forEach(e => { investCnt[e.date] = (investCnt[e.date] || 0) + 1; });

  const days = [];
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i, m2 = month === 0 ? 11 : month - 1, y2 = month === 0 ? year - 1 : year;
    days.push({ day: d, ds: `${y2}-${String(m2+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ day: d, ds: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: false });
  }
  const rem = 42 - days.length;
  for (let d = 1; d <= rem; d++) {
    const m2 = month === 11 ? 0 : month + 1, y2 = month === 11 ? year + 1 : year;
    days.push({ day: d, ds: `${y2}-${String(m2+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: true });
  }

  const daysHTML = days.map(d => {
    const sc = sessionCnt[d.ds] || 0;
    const rc = recordCnt[d.ds]  || 0;
    const ic = investCnt[d.ds]  || 0;
    let dotsHTML = '';
    if (sc > 0 || rc > 0 || ic > 0) {
      const rDots  = Array(Math.min(rc, 3)).fill('<div class="cal-dot cal-dot-record"></div>').join('');
      const rExtra = rc > 3 ? `<span class="cal-dot-extra">+${rc-3}</span>` : '';
      const sDots  = Array(Math.min(sc, 3)).fill('<div class="cal-dot cal-dot-session"></div>').join('');
      const sExtra = sc > 3 ? `<span class="cal-dot-extra">+${sc-3}</span>` : '';
      const iDots  = Array(Math.min(ic, 3)).fill('<div class="cal-dot cal-dot-invest"></div>').join('');
      const iExtra = ic > 3 ? `<span class="cal-dot-extra">+${ic-3}</span>` : '';
      dotsHTML = `<div class="cal-day-dots">${rDots}${rExtra}${sDots}${sExtra}${iDots}${iExtra}</div>`;
    }
    return `<div class="cal-day${d.other?' other-month':''}${d.ds===today?' today':''}${d.ds===state.calDate?' selected':''}"
      onclick="openCalPopup('${d.ds}')">
      <div class="cal-day-num">${d.day}</div>${dotsHTML}
    </div>`;
  }).join('');

  return `<div class="calendar">
    <div class="calendar-hub">
      <button class="calendar-hub-card hub-daily" onclick="setView('myrecords')">
        <span>일상</span>
      </button>
      <button class="calendar-hub-card hub-counseling" onclick="setView('student')">
        <span>상담</span>
      </button>
      <button class="calendar-hub-card hub-invest" onclick="setView('investment')">
        <span>투자</span>
      </button>
    </div>
    <div class="cal-header">
      <button class="cal-nav" onclick="navCal(-1)">‹</button>
      <span class="cal-title">${year}년 ${MONTHS[month]}</span>
      <button class="cal-nav" onclick="navCal(1)">›</button>
    </div>
    <div class="cal-weekdays">${['일','월','화','수','목','금','토'].map(d=>`<div class="cal-weekday">${d}</div>`).join('')}</div>
    <div class="cal-grid">${daysHTML}</div>
  </div>`;
}

function showHome() {
  // v3: 오버레이 대신 메인 콘텐츠에 오늘 화면 표시
  state.selStudent = null;
  state.selSession = null;
  state.selTopic   = null;
  state.selRecord  = null;
  state.mode       = 'welcome';
  state.myMode     = 'welcome';
  render();
}

function hideHome() {
  // v3: no-op (오버레이 방식 폐기)
}

function renderHomeCalendar() {
  // v3: 캘린더 뷰 전환으로 대체 — 하위 호환 유지
  const wrap = document.getElementById('home-cal-wrap');
  if (wrap) wrap.innerHTML = renderCalendar();
}

// ---------------------------------------------------------------------------
// 캘린더 팝업
// ---------------------------------------------------------------------------

function openCalPopup(date) {
  state.calDate  = date;
  state.calPopup = date;
  const overlay = document.getElementById('cal-popup-overlay');
  const modal   = document.getElementById('cal-popup-modal');
  if (!overlay || !modal) return;
  modal.innerHTML = buildCalPopupHTML(date);
  overlay.style.display = '';
  modal.style.display   = '';
}

function closeCalPopup() {
  state.calPopup = null;
  const overlay = document.getElementById('cal-popup-overlay');
  const modal   = document.getElementById('cal-popup-modal');
  if (overlay) overlay.style.display = 'none';
  if (modal)   modal.style.display   = 'none';
}

function buildCalPopupHTML(date) {
  const [, m, d]    = date.split('-');
  const label       = `${parseInt(m)}월 ${parseInt(d)}일`;
  const daySessions = state.sessions.filter(s => s.date === date);
  const dayRecords  = state.myRecords.filter(r => r.date === date);
  const dayInvests  = (state.investment?.events || []).filter(e => e.date === date);

  const sDots  = Array(Math.min(daySessions.length, 3)).fill('<span class="popup-dot popup-dot-session"></span>').join('');
  const rDots  = Array(Math.min(dayRecords.length,  3)).fill('<span class="popup-dot popup-dot-record"></span>').join('');
  const sExtra = daySessions.length > 3 ? `<span class="popup-dot-extra">+${daySessions.length-3}</span>` : '';
  const rExtra = dayRecords.length  > 3 ? `<span class="popup-dot-extra">+${dayRecords.length-3}</span>`  : '';
  const iDots  = Array(Math.min(dayInvests.length,  3)).fill('<span class="popup-dot popup-dot-invest"></span>').join('');
  const iExtra = dayInvests.length  > 3 ? `<span class="popup-dot-extra">+${dayInvests.length-3}</span>`  : '';

  const sessionItems = daySessions.length
    ? daySessions.map(s => {
        const st = state.students.find(st => st.id === s.studentId);
        return `<div class="popup-item popup-item-session" onclick="calPopupGoSession('${s.id}')">· ${st ? esc(st.alias) : '?'} · ${s.sessionNum}회기</div>`;
      }).join('')
    : '<div class="popup-item-empty">없음</div>';

  const recordItems = dayRecords.length
    ? dayRecords.map(r => {
        const topic = state.myTopics.find(t => t.id === r.topicId);
        return `<div class="popup-item popup-item-record" onclick="calPopupGoRecord('${r.id}')">· &lt;${topic ? esc(topic.title) : '?'}&gt; ${r.recordNum}번째</div>`;
      }).join('')
    : '<div class="popup-item-empty">없음</div>';

  const investItems = dayInvests.length
    ? dayInvests.map(e => `<div class="popup-item popup-item-invest" onclick="calPopupGoInvestment('${e.id}')">· ${esc(e.symbol || '')} ${esc(e.title || '투자 이벤트')}</div>`).join('')
    : '<div class="popup-item-empty">없음</div>';

  return `
    <div class="popup-header">
      <span class="popup-date-label">${label}</span>
      <button class="popup-close-btn" onclick="closeCalPopup()">×</button>
    </div>
    <div class="popup-legend">
      <div class="popup-legend-item popup-legend-record">일상&nbsp;${rDots}${rExtra}</div>
      <div class="popup-legend-item popup-legend-session">상담&nbsp;${sDots}${sExtra}</div>
      <div class="popup-legend-item popup-legend-invest">투자&nbsp;${iDots}${iExtra}</div>
    </div>
    <div class="popup-body">
      <div class="popup-col">
        <div class="popup-col-label">일상</div>
        ${recordItems}
      </div>
      <div class="popup-col">
        <div class="popup-col-label">상담</div>
        ${sessionItems}
      </div>
      <div class="popup-col">
        <div class="popup-col-label">투자</div>
        ${investItems}
      </div>
    </div>
    <div class="popup-footer">
      <button class="popup-add-btn popup-add-record" onclick="calPopupAddRecord('${date}')">+ 일상</button>
      <button class="popup-add-btn popup-add-session" onclick="calPopupAddSession('${date}')">+ 상담</button>
      <button class="popup-add-btn popup-add-invest" onclick="calPopupAddInvestment('${date}')">+ 투자 점검</button>
    </div>`;
}

function calPopupGoSession(id) {
  closeCalPopup();
  const s = state.sessions.find(s => s.id === id);
  if (!s) return;
  state.view       = 'student';
  state.selStudent = s.studentId;
  state.selSession = id;
  state.mode       = 'detail';
  state.sessionTab = 'verbatim';
  _syncNavButtons('student');
  render();
}

function calPopupGoRecord(id) {
  closeCalPopup();
  const r = state.myRecords.find(r => r.id === id);
  if (!r) return;
  state.view      = 'myrecords';
  state.selTopic  = r.topicId;
  state.selRecord = id;
  state.myMode    = 'detail';
  state.myTab     = 'content';
  _syncNavButtons('myrecords');
  render();
}

function calPopupGoInvestment(id) {
  closeCalPopup();
  state.view = 'investment';
  const event = (state.investment?.events || []).find(e => e.id === id);
  state.selInvestmentPosition = event?.symbol || null;
  _syncNavButtons('investment');
  render();
}

function calPopupAddSession(date) {
  closeCalPopup();
  state.view = 'student';
  state.mode = 'new-session';
  _syncNavButtons('student');
  render();
  requestAnimationFrame(() => {
    const el = document.getElementById('fd');
    if (el) el.value = date;
  });
}

// Fix: selTopic이 있으면 new-record로, 없으면 new-topic으로
function calPopupAddRecord(date) {
  closeCalPopup();
  state.view   = 'myrecords';
  state.myMode = state.selTopic ? 'new-record' : 'new-topic';
  _syncNavButtons('myrecords');
  render();
  if (state.selTopic) {
    requestAnimationFrame(() => {
      const el = document.getElementById('fr-date');
      if (el) el.value = date;
    });
  }
}

function calPopupAddInvestment(date) {
  closeCalPopup();
  state.view = 'investment';
  _syncNavButtons('investment');
  render();
}

/** 3-버튼 nav 활성 상태 동기화 헬퍼 */
function _syncNavButtons(view) {
  document.getElementById('btn-sv')?.classList.toggle('active', view === 'student');
  document.getElementById('btn-dv')?.classList.toggle('active', view === 'myrecords');
  document.getElementById('btn-cal')?.classList.toggle('active', view === 'calendar');
  document.getElementById('nav-invest')?.classList.toggle('active', view === 'investment');
  const addBtn = document.getElementById('add-btn');
  if (addBtn) addBtn.textContent =
    view === 'student'   ? '+ 새 내담자' :
    view === 'myrecords' ? '+ 새 주제'   :
    view === 'investment' ? '' : '';
  const ctx = document.getElementById('sidebar-context');
  if (ctx) ctx.style.display = (view === 'calendar' || view === 'investment') ? 'none' : '';
}
