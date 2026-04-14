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
  const showInput =
    (state.view === 'myrecords' && state.myTab === 'dialogue' && state.selRecord) ||
    (state.view === 'student'   && state.sessionTab === 'dialogue' && state.selSession);
  inputArea.style.display = showInput ? '' : 'none';
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

  // 상담 기록 — 회기 상세
  if (state.mode === 'detail' && state.selSession) {
    const session = state.sessions.find(s => s.id === state.selSession);
    if (session) {
      const st  = state.students.find(s => s.id === session.studentId);
      const all = state.sessions.filter(s => s.studentId === session.studentId);
      titleEl.textContent = st ? esc(st.alias) : '';
      subEl.textContent   = st ? `${esc(st.grade)} · ${all.length}회기` : '';
      nsBtn.style.display = 'block';
      content.innerHTML   = renderSessionDetail(session, all.length);
      return;
    }
  }

  // ── 나의 기록 뷰 ──────────────────────────────────────────────────────────

  if (state.view === 'myrecords') {
    // 폼 모드 → 모달로 위임
    if (['new-topic','edit-topic','new-record','edit-record'].includes(state.myMode)) {
      openModal(state.myMode);
    }
    // 기록 상세
    if (state.myMode === 'detail' && state.selRecord) {
      const rec = state.myRecords.find(r => r.id === state.selRecord);
      if (rec) {
        const t   = state.myTopics.find(t => t.id === rec.topicId);
        const all = state.myRecords.filter(r => r.topicId === rec.topicId);
        titleEl.textContent = t ? esc(t.title) : '';
        subEl.textContent   = `${all.length}개 기록`;
        nsBtn.style.display = 'block';
        nsBtn.textContent   = '+ 기록 추가';
        content.innerHTML   = renderRecordDetail(rec, all.length);
        return;
      }
    }
    // 주제 없이 welcome
    if (!state.selTopic) {
      titleEl.textContent = '나의 기록';
      subEl.textContent   = '';
      nsBtn.style.display = 'none';
      content.innerHTML   = '<div class="empty-state">왼쪽에서 주제를 선택하거나<br>새 주제를 추가해보세요</div>';
      return;
    }
    // 주제 선택 → 기록 목록
    const t   = state.myTopics.find(t => t.id === state.selTopic);
    const all = state.myRecords.filter(r => r.topicId === state.selTopic)
      .sort((a, b) => b.date.localeCompare(a.date));
    titleEl.textContent = t ? esc(t.title) : '';
    subEl.textContent   = `${all.length}개 기록`;
    nsBtn.style.display = 'block';
    nsBtn.textContent   = '+ 기록 추가';
    if (!all.length) {
      content.innerHTML = `<div class="empty-state">아직 기록이 없어요<br><br>
        <button class="btn-primary-my" onclick="showNewRecordForm()">첫 기록 쓰기</button>
      </div>`;
      return;
    }
    // 태그 필터 바
    const allRecordTags = [...new Set(all.flatMap(r => r.tags || []))];
    const recordTagBar  = allRecordTags.length ? `
      <div class="tag-filter-bar my-tag-filter-bar">
        ${state.filterTags.length ? `<button class="tag-filter-clear my-tag-filter-clear" onclick="clearFilterTags()">× 필터 해제</button>` : ''}
        ${allRecordTags.map(tag => `<button class="tag-filter-btn my-tag-filter-btn${state.filterTags.includes(tag) ? ' active my-active' : ''}"
          onclick="toggleFilterTag('${esc(tag)}')">${esc(tag)}</button>`).join('')}
      </div>` : '';

    const filteredRecs = state.filterTags.length
      ? all.filter(r => state.filterTags.every(ft => (r.tags || []).includes(ft)))
      : all;

    const recCardsHTML = filteredRecs.length
      ? filteredRecs.map(r => {
          const firstLine = r.content ? r.content.split('\n')[0].substring(0, 60) : '';
          const hasRpt    = !!r.analysis;
          const hasDlg    = r.aiChat && r.aiChat.length > 0;
          const tagsHTML  = (r.tags && r.tags.length)
            ? `<div class="card-tags">${r.tags.map(tag => `<span class="tag-badge my-tag-badge">${esc(tag)}</span>`).join('')}</div>` : '';
          return `<div class="record-card${r.id === state.selRecord ? ' active' : ''}" onclick="selectRecord('${r.id}')">
            <div class="session-meta">
              <span class="record-num">${r.recordNum}번째</span>
              <span style="display:flex;gap:5px;align-items:center;">
                ${hasRpt ? '<span class="session-badge my-badge">보고서</span>' : ''}
                ${hasDlg ? '<span class="session-badge my-badge-dlg">대화</span>' : ''}
                <span class="session-date">${r.date}</span>
              </span>
            </div>
            <div class="session-preview">${esc(firstLine || r.memo || '—')}</div>
            ${tagsHTML}
          </div>`;
        }).join('')
      : '<div class="empty-state" style="padding:30px 0;">해당 태그의 기록이 없습니다</div>';

    content.innerHTML = recordTagBar + recCardsHTML;
    return;
  }

  // ── 상담 기록 뷰 ──────────────────────────────────────────────────────────

  if (!state.selStudent) {
    titleEl.textContent = '상담 기록';
    subEl.textContent   = '';
    nsBtn.style.display = 'none';
    content.innerHTML   = '<div class="empty-state">왼쪽에서 내담자를 선택하거나<br>새 내담자를 추가해보세요</div>';
    return;
  }

  const st  = state.students.find(s => s.id === state.selStudent);
  const all = state.sessions.filter(s => s.studentId === state.selStudent)
    .sort((a, b) => b.date.localeCompare(a.date));

  titleEl.textContent = st ? esc(st.alias) : '';
  subEl.textContent   = st ? `${esc(st.grade)} · ${all.length}회기` : '';
  nsBtn.style.display = 'block';

  if (!all.length) {
    content.innerHTML = `<div class="empty-state">아직 상담 기록이 없어요<br><br>
      <button class="btn-secondary" onclick="showNewSessionForm()">첫 회기 기록하기</button>
    </div>`;
    return;
  }

  // 태그 필터 바
  const allTags = [...new Set(all.flatMap(s => s.tags || []))];
  const tagFilterBar = allTags.length ? `
    <div class="tag-filter-bar">
      ${state.filterTags.length ? `<button class="tag-filter-clear" onclick="clearFilterTags()">× 필터 해제</button>` : ''}
      ${allTags.map(tag => `<button class="tag-filter-btn${state.filterTags.includes(tag) ? ' active' : ''}"
        onclick="toggleFilterTag('${esc(tag)}')">${esc(tag)}</button>`).join('')}
    </div>` : '';

  const filtered = state.filterTags.length
    ? all.filter(s => state.filterTags.every(ft => (s.tags || []).includes(ft)))
    : all;

  const cardsHTML = filtered.length
    ? filtered.map(s => {
        const firstLine = s.verbatim ? s.verbatim.split('\n')[0].substring(0, 60) : '';
        const hasRpt    = !!s.analysis;
        const hasDlg    = s.supervisionChat && s.supervisionChat.length > 0;
        const tagsHTML  = (s.tags && s.tags.length)
          ? `<div class="card-tags">${s.tags.map(tag => `<span class="tag-badge">${esc(tag)}</span>`).join('')}</div>` : '';
        return `<div class="session-card${s.id === state.selSession ? ' active' : ''}" onclick="selectSession('${s.id}')">
          <div class="session-meta">
            <span class="session-num">${s.sessionNum}회기</span>
            <span style="display:flex;gap:5px;align-items:center;">
              ${hasRpt ? '<span class="session-badge">보고서</span>' : ''}
              ${hasDlg ? '<span class="session-badge session-badge-dialogue">대화</span>' : ''}
              <span class="session-date">${s.date}</span>
            </span>
          </div>
          <div class="session-preview">${esc(firstLine || s.memo || '—')}</div>
          ${tagsHTML}
        </div>`;
      }).join('')
    : '<div class="empty-state" style="padding:30px 0;">해당 태그의 회기가 없습니다</div>';

  content.innerHTML = tagFilterBar + cardsHTML;
}
