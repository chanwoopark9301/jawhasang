/* =============================================
   自畵像 — CRUD (생성/수정/삭제)
   의존성: state.js, utils.js, data.js, nav.js

   참고:
   - 생성/수정 폼: modal.js의 modalSave*/modalUpdate* 함수 사용
   - 삭제: 아래 delete* 함수 사용
   ============================================= */

// ---------------------------------------------------------------------------
// 상담 기록 — 학생 삭제
// ---------------------------------------------------------------------------

function deleteStudent(id) {
  const s = state.students.find(s => s.id === id);
  if (!confirm(`'${s ? s.alias : '내담자'}'와 모든 회기 기록을 삭제할까요?`)) return;
  state.students = state.students.filter(s => s.id !== id);
  state.sessions = state.sessions.filter(s => s.studentId !== id);
  if (state.selStudent === id) {
    state.selStudent = null; state.selSession = null; state.mode = 'welcome';
  }
  saveData(); render();
}

// ---------------------------------------------------------------------------
// 상담 기록 — 회기 삭제
// ---------------------------------------------------------------------------

function deleteSession(id) {
  if (!confirm('이 회기 기록을 삭제할까요?')) return;
  state.sessions = state.sessions.filter(s => s.id !== id);
  if (state.selSession === id) {
    state.selSession = null;
    state.mode       = state.selStudent ? 'list' : 'welcome';
  }
  saveData(); render();
}

// ---------------------------------------------------------------------------
// 나의 기록 — 주제 삭제
// ---------------------------------------------------------------------------

function deleteTopic(id) {
  const t = state.myTopics.find(t => t.id === id);
  if (!confirm(`'${t ? t.title : '주제'}'와 모든 기록을 삭제할까요?`)) return;
  state.myTopics  = state.myTopics.filter(t => t.id !== id);
  state.myRecords = state.myRecords.filter(r => r.topicId !== id);
  if (state.selTopic === id) {
    state.selTopic  = null;
    state.selRecord = null;
    state.myMode    = 'welcome';
  }
  saveData(); render();
}

// ---------------------------------------------------------------------------
// 나의 기록 — 기록 삭제
// ---------------------------------------------------------------------------

function deleteRecord(id) {
  if (!confirm('이 기록을 삭제할까요?')) return;
  state.myRecords = state.myRecords.filter(r => r.id !== id);
  if (state.selRecord === id) {
    state.selRecord = null;
    state.myMode    = state.selTopic ? 'list' : 'welcome';
  }
  saveData(); render();
}

// ---------------------------------------------------------------------------
// 검색
// ---------------------------------------------------------------------------

function setSearchQuery(q) {
  state.searchQuery = q;
  renderSidebar();
}
