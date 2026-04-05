/* =============================================
   自畵像 — CRUD (생성/수정/삭제)
   의존성: state.js, utils.js, data.js, nav.js

   수정 (버그픽스):
   - sessionNum/recordNum: 삭제 후 재추가 시 번호 중복 방지
     (length+1 대신 max+1 사용)
   ============================================= */

// ---------------------------------------------------------------------------
// 상담 기록 — 학생 CRUD
// ---------------------------------------------------------------------------

function saveStudent() {
  const alias = document.getElementById('falias').value.trim();
  if (!alias) { alert('식별 코드를 입력해주세요'); return; }

  const student = {
    id: 's' + Date.now(), alias,
    grade:     document.getElementById('fg').value,
    gender:    document.getElementById('fgd').value,
    family:    document.getElementById('ffamily').value.trim(),
    peers:     document.getElementById('fpeers').value.trim(),
    situation: document.getElementById('fsituation').value.trim(),
    notes:     document.getElementById('fnotes').value.trim(),
    createdAt: new Date().toISOString().split('T')[0],
  };

  state.students.push(student);
  state.selStudent = student.id;
  state.mode       = 'list';
  saveData(); render();
}

function editStudent(id) {
  state.editingId = id;
  state.mode      = 'edit-student';
  mobilePanel     = 'main';
  render();
}

function updateStudent() {
  const st = state.students.find(s => s.id === state.editingId);
  if (!st) return;
  const alias = document.getElementById('falias').value.trim();
  if (!alias) { alert('식별 코드를 입력해주세요'); return; }
  st.alias     = alias;
  st.grade     = document.getElementById('fg').value;
  st.gender    = document.getElementById('fgd').value;
  st.family    = document.getElementById('ffamily').value.trim();
  st.peers     = document.getElementById('fpeers').value.trim();
  st.situation = document.getElementById('fsituation').value.trim();
  st.notes     = document.getElementById('fnotes').value.trim();
  state.editingId = null;
  state.mode      = 'list';
  saveData(); render();
}

function cancelEditStudent() {
  state.editingId = null;
  state.mode      = state.selStudent ? 'list' : 'welcome';
  render();
}

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
// 상담 기록 — 회기 CRUD
// ---------------------------------------------------------------------------

function saveSession() {
  const date     = document.getElementById('fd').value;
  const verbatim = document.getElementById('fv').value.trim();
  if (!date || !verbatim) { alert('날짜와 축어록을 입력해주세요'); return; }

  let studentId = state.selStudent;
  if (!studentId) {
    const el = document.getElementById('fst');
    if (el) studentId = el.value;
  }
  if (!studentId) { alert('내담자를 선택해주세요'); return; }

  const tagsEl  = document.getElementById('ftags');
  const tagsStr = tagsEl ? tagsEl.value.trim() : '';

  const session = {
    id: 'ss' + Date.now(), studentId, date,
    sessionNum:      getNextSessionNum(studentId),
    verbatim,
    memo:            document.getElementById('fmemo').value.trim(),
    tags:            tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [],
    analysis:        null,
    supervisionChat: [],
  };

  state.sessions.push(session);
  state.selSession = session.id;
  state.selStudent = studentId;
  state.mode       = 'detail';
  state.sessionTab = 'verbatim';
  saveData(); render();
}

function editSession(id) {
  state.editingId = id;
  state.mode      = 'edit-session';
  mobilePanel     = 'main';
  render();
}

function updateSession() {
  const session = state.sessions.find(s => s.id === state.editingId);
  if (!session) return;
  const date     = document.getElementById('fd').value;
  const verbatim = document.getElementById('fv').value.trim();
  if (!date || !verbatim) { alert('날짜와 축어록을 입력해주세요'); return; }
  session.date     = date;
  session.verbatim = verbatim;
  session.memo     = document.getElementById('fmemo').value.trim();
  const tagsEl     = document.getElementById('ftags');
  const tagsStr    = tagsEl ? tagsEl.value.trim() : '';
  session.tags     = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
  state.editingId  = null;
  state.selSession = session.id;
  state.mode       = 'detail';
  state.sessionTab = 'verbatim';
  saveData(); render();
}

function cancelEditSession() {
  state.editingId = null;
  state.mode      = state.selSession ? 'detail' : (state.selStudent ? 'list' : 'welcome');
  render();
}

function deleteSession(id) {
  if (!confirm('이 회기 기록을 삭제할까요?')) return;
  state.sessions = state.sessions.filter(s => s.id !== id);
  if (state.selSession === id) {
    state.selSession = null;
    state.mode       = state.selStudent ? 'list' : 'welcome';
  }
  saveData(); render();
}

function loadVerbatimFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const el = document.getElementById('fv');
    if (el) el.value = e.target.result;
  };
  reader.readAsText(file, 'UTF-8');
}

// ---------------------------------------------------------------------------
// 나의 기록 — 주제 CRUD
// ---------------------------------------------------------------------------

function saveTopic() {
  const title = document.getElementById('ft-title').value.trim();
  if (!title) { alert('주제 이름을 입력해주세요'); return; }
  const topic = {
    id: 't' + Date.now(), title,
    aiPrompt:  document.getElementById('ft-prompt').value.trim(),
    createdAt: new Date().toISOString().split('T')[0],
  };
  state.myTopics.push(topic);
  state.selTopic = topic.id;
  state.myMode   = 'list';
  saveData(); render();
}

function editTopic(id) {
  state.editingId = id;
  state.myMode    = 'edit-topic';
  mobilePanel     = 'main';
  render();
}

function updateTopic() {
  const topic = state.myTopics.find(t => t.id === state.editingId);
  if (!topic) return;
  const title = document.getElementById('ft-title').value.trim();
  if (!title) { alert('주제 이름을 입력해주세요'); return; }
  topic.title    = title;
  topic.aiPrompt = document.getElementById('ft-prompt').value.trim();
  state.editingId = null;
  state.myMode    = 'list';
  saveData(); render();
}

function cancelEditTopic() {
  state.editingId = null;
  state.myMode    = state.selTopic ? 'list' : 'welcome';
  render();
}

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
// 나의 기록 — 기록 CRUD
// ---------------------------------------------------------------------------

function saveRecord() {
  const date    = document.getElementById('fr-date').value;
  const content = document.getElementById('fr-content').value.trim();
  if (!date || !content) { alert('날짜와 내용을 입력해주세요'); return; }

  const rTagsEl  = document.getElementById('fr-tags');
  const rTagsStr = rTagsEl ? rTagsEl.value.trim() : '';

  const record = {
    id: 'r' + Date.now(),
    topicId:   state.selTopic, date,
    recordNum: getNextRecordNum(state.selTopic),
    content,
    memo:  document.getElementById('fr-memo').value.trim(),
    tags:  rTagsStr ? rTagsStr.split(',').map(t => t.trim()).filter(Boolean) : [],
    analysis: null, aiChat: [],
  };
  state.myRecords.push(record);
  state.selRecord = record.id;
  state.myMode    = 'detail';
  state.myTab     = 'content';
  saveData(); render();
}

function editRecord(id) {
  state.editingId = id;
  state.myMode    = 'edit-record';
  mobilePanel     = 'main';
  render();
}

function updateRecord() {
  const record = state.myRecords.find(r => r.id === state.editingId);
  if (!record) return;
  const date    = document.getElementById('fr-date').value;
  const content = document.getElementById('fr-content').value.trim();
  if (!date || !content) { alert('날짜와 내용을 입력해주세요'); return; }
  record.date    = date;
  record.content = content;
  record.memo    = document.getElementById('fr-memo').value.trim();
  const tagsEl   = document.getElementById('fr-tags');
  const tagsStr  = tagsEl ? tagsEl.value.trim() : '';
  record.tags    = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
  state.editingId = null;
  state.selRecord = record.id;
  state.myMode    = 'detail';
  state.myTab     = 'content';
  saveData(); render();
}

function cancelEditRecord() {
  state.editingId = null;
  state.myMode    = state.selRecord ? 'detail' : (state.selTopic ? 'list' : 'welcome');
  render();
}

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
// 검색 / 태그 필터
// ---------------------------------------------------------------------------

function setSearchQuery(q) {
  state.searchQuery = q;
  renderSidebar();
}

function toggleFilterTag(tag) {
  const idx = state.filterTags.indexOf(tag);
  if (idx >= 0) state.filterTags.splice(idx, 1);
  else          state.filterTags.push(tag);
  renderMain();
}

function clearFilterTags() {
  state.filterTags = [];
  renderMain();
}
