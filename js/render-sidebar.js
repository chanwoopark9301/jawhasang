/* =============================================
   自畵像 — 사이드바 렌더링 (新 nav-item/sub-items 구조)
   의존성: state.js, utils.js
   ============================================= */

function renderSidebar() {
  // ── nav-item 활성 상태 ──────────────────────────────────────────────────
  document.getElementById('nav-my')?.classList.toggle('active', state.view === 'myrecords');
  document.getElementById('nav-sv')?.classList.toggle('active', state.view === 'student');
  document.getElementById('nav-cal')?.classList.toggle('active', state.view === 'calendar');

  // ── 나의 기록 서브 항목 ─────────────────────────────────────────────────
  const subMy = document.getElementById('sub-my');
  if (subMy) {
    const query = state.searchQuery.toLowerCase().trim();
    const topics = query
      ? state.myTopics.filter(t => t.title.toLowerCase().includes(query))
      : state.myTopics;

    const newMyHtml = topics.map(t => {
      const active = state.selTopic === t.id;
      // 선택된 주제면 하위 기록 목록 펼침
      const childHtml = active ? _renderRecordChildren(t.id) : '';
      return `<div class="sub-item${active ? ' active' : ''}"
        oncontextmenu="event.preventDefault();openModal('edit-topic',{id:'${t.id}'})">
        <span class="sub-item-label" onclick="selectTopic('${t.id}')" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">${esc(t.title)}</span>
        <span class="sub-item-actions">
          <button class="sub-item-btn" onclick="event.stopPropagation();openModal('edit-topic',{id:'${t.id}'})" title="수정">✎</button>
          <button class="sub-item-btn sub-item-del" onclick="event.stopPropagation();deleteTopic('${t.id}')" title="삭제">×</button>
        </span>
      </div>${childHtml}`;
    }).join('') + `<div class="sub-item sub-item-add" onclick="openModal('new-topic')">+ 새 주제</div>`;
    if (subMy.innerHTML !== newMyHtml) subMy.innerHTML = newMyHtml;
  }

  // ── 상담 기록 서브 항목 ─────────────────────────────────────────────────
  const subSv = document.getElementById('sub-sv');
  if (subSv) {
    const query = state.searchQuery.toLowerCase().trim();
    const students = query
      ? state.students.filter(st =>
          st.alias.toLowerCase().includes(query) ||
          st.grade.toLowerCase().includes(query)
        )
      : state.students;

    const newSvHtml = students.map(st => {
      const active = state.selStudent === st.id;
      const childHtml = active ? _renderSessionChildren(st.id) : '';
      return `<div class="sub-item${active ? ' active' : ''}"
        oncontextmenu="event.preventDefault();openModal('edit-student',{id:'${st.id}'})">
        <span class="sub-item-label" onclick="selectStudent('${st.id}')" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">${esc(st.alias)}</span>
        <span class="sub-item-actions">
          <button class="sub-item-btn" onclick="event.stopPropagation();openModal('edit-student',{id:'${st.id}'})" title="수정">✎</button>
          <button class="sub-item-btn sub-item-del" onclick="event.stopPropagation();deleteStudent('${st.id}')" title="삭제">×</button>
        </span>
      </div>${childHtml}`;
    }).join('') + `<div class="sub-item sub-item-add" onclick="openModal('new-student')">+ 새 내담자</div>`;
    if (subSv.innerHTML !== newSvHtml) subSv.innerHTML = newSvHtml;
  }
}

// ---------------------------------------------------------------------------
// 하위 기록 목록 (나의 기록)
// ---------------------------------------------------------------------------

function _renderRecordChildren(topicId) {
  const records = state.myRecords
    .filter(r => r.topicId === topicId)
    .sort((a, b) => b.date.localeCompare(a.date));

  const items = records.map(r => {
    return `<div class="sub-child">
      <span class="sub-child-label" onclick="openModal('record-detail',{id:'${r.id}'})">${_sbDate(r.date)} · ${r.recordNum}번째</span>
      <span class="sub-child-actions">
        <button class="sub-item-btn sub-item-del" onclick="deleteRecord('${r.id}')" title="삭제">×</button>
      </span>
    </div>`;
  }).join('');

  return `<div class="sub-children">
    ${items}
    <div class="sub-child sub-child-add" onclick="openModal('write')">+ 새 기록</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// 하위 회기 목록 (상담 기록)
// ---------------------------------------------------------------------------

function _renderSessionChildren(studentId) {
  const sessions = state.sessions
    .filter(s => s.studentId === studentId)
    .sort((a, b) => b.date.localeCompare(a.date));

  const items = sessions.map(s => {
    return `<div class="sub-child">
      <span class="sub-child-label" onclick="openModal('session-detail',{id:'${s.id}'})">${_sbDate(s.date)} · ${s.sessionNum}회기</span>
      <span class="sub-child-actions">
        <button class="sub-item-btn sub-item-del" onclick="deleteSession('${s.id}')" title="삭제">×</button>
      </span>
    </div>`;
  }).join('');

  return `<div class="sub-children">
    ${items}
    <div class="sub-child sub-child-add" onclick="openModal('new-session')">+ 새 회기</div>
  </div>`;
}

function _sbDate(dateStr) {
  const [, m, d] = (dateStr || '').split('-');
  return m && d ? `${parseInt(m)}/${parseInt(d)}` : dateStr;
}
