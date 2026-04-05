/* =============================================
   自畵像 — 사이드바 렌더링
   의존성: state.js, utils.js
   ============================================= */

function renderSidebar() {
  const el    = document.getElementById('sidebar-list');
  const query = state.searchQuery.toLowerCase().trim();

  if (state.view === 'myrecords') {
    const topics = query
      ? state.myTopics.filter(t => t.title.toLowerCase().includes(query))
      : state.myTopics;
    if (!topics.length) {
      el.innerHTML = query
        ? '<p class="ai-placeholder">검색 결과 없음</p>'
        : '<p class="ai-placeholder">주제가 없어요<br><span style="font-size:10px;opacity:.6;">+ 새 주제 추가로 시작하세요</span></p>';
      return;
    }
    el.innerHTML = topics.map(t => {
      const cnt    = state.myRecords.filter(r => r.topicId === t.id).length;
      const active = state.selTopic === t.id;
      return `<div class="list-item${active ? ' active my-active' : ''}">
        <div class="list-item-info" onclick="selectTopic('${t.id}')">
          <div class="list-item-name">${esc(t.title)}</div>
          <div class="list-item-sub">${cnt}개 기록</div>
        </div>
        <div class="list-item-actions">
          <button class="list-item-edit" onclick="event.stopPropagation();editTopic('${t.id}')" title="수정">✎</button>
          <button class="list-item-del" onclick="event.stopPropagation();deleteTopic('${t.id}')" title="삭제">×</button>
        </div>
      </div>`;
    }).join('');
    return;
  }

  // view === 'student'
  const students = query
    ? state.students.filter(st =>
        st.alias.toLowerCase().includes(query) ||
        st.grade.toLowerCase().includes(query) ||
        (st.situation || '').toLowerCase().includes(query)
      )
    : state.students;

  if (!students.length) {
    el.innerHTML = query
      ? '<p class="ai-placeholder">검색 결과 없음</p>'
      : '<p class="ai-placeholder">내담자가 없어요</p>';
    return;
  }
  el.innerHTML = students.map(st => {
    const cnt    = state.sessions.filter(s => s.studentId === st.id).length;
    const active = state.selStudent === st.id;
    return `<div class="list-item${active ? ' active' : ''}">
      <div class="list-item-info" onclick="selectStudent('${st.id}')">
        <div class="list-item-name">${esc(st.alias)}</div>
        <div class="list-item-sub">${esc(st.grade)} · ${cnt}회기</div>
      </div>
      <div class="list-item-actions">
        <button class="list-item-edit" onclick="event.stopPropagation();editStudent('${st.id}')" title="수정">✎</button>
        <button class="list-item-del" onclick="event.stopPropagation();deleteStudent('${st.id}')" title="삭제">×</button>
      </div>
    </div>`;
  }).join('');
}
