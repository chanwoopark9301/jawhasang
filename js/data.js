/* =============================================
   自畵像 — 데이터 영속성
   의존성: state.js, utils.js

   수정 (버그픽스):
   - exportData(): try/finally로 URL.revokeObjectURL 보장
   ============================================= */

// ---------------------------------------------------------------------------
// 서버 ↔ 로컬 동기화
// ---------------------------------------------------------------------------

async function loadData() {
  try {
    const res = await fetch('/api/data');
    if (res.ok) {
      const data = await res.json();
      state.students  = data.students  && data.students.length  ? data.students  : SAMPLE_STUDENTS;
      state.sessions  = data.sessions  && data.sessions.length  ? data.sessions  : SAMPLE_SESSIONS;
      state.myTopics  = data.my_topics  && data.my_topics.length  ? data.my_topics  : SAMPLE_TOPICS;
      state.myRecords = data.my_records && data.my_records.length ? data.my_records : SAMPLE_RECORDS;
      if (!data.students || !data.students.length) saveData();
    } else {
      _useSampleData();
      saveData();
    }
  } catch {
    _useSampleData();
  }
  render();
  showHome();
}

function _useSampleData() {
  state.students  = SAMPLE_STUDENTS;
  state.sessions  = SAMPLE_SESSIONS;
  state.myTopics  = SAMPLE_TOPICS;
  state.myRecords = SAMPLE_RECORDS;
}

function saveData() {
  fetch('/api/data', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      students:   state.students,
      sessions:   state.sessions,
      my_topics:  state.myTopics,
      my_records: state.myRecords,
    }),
  }).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }).catch(e => {
    console.error('저장 실패:', e);
    // 상단에 잠깐 표시되는 저장 실패 알림
    _showSaveError();
  });
}

function _showSaveError() {
  const existing = document.getElementById('save-error-toast');
  if (existing) return; // 이미 표시 중이면 중복 방지
  const toast = document.createElement('div');
  toast.id = 'save-error-toast';
  toast.textContent = '저장 실패 — 서버 연결을 확인해주세요';
  toast.style.cssText = [
    'position:fixed', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
    'background:#b91c1c', 'color:#fff', 'padding:8px 16px',
    'border-radius:8px', 'font-size:12px', 'z-index:9999',
    'box-shadow:0 2px 8px rgba(0,0,0,.2)',
  ].join(';');
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ---------------------------------------------------------------------------
// JSON 백업 내보내기
// ---------------------------------------------------------------------------

function exportData() {
  const data = {
    exportedAt:  new Date().toISOString(),
    students:    state.students,
    sessions:    state.sessions,
    my_topics:   state.myTopics,
    my_records:  state.myRecords,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `자화상_백업_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
