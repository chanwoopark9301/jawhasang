/* =============================================
   自畵像 — 데이터 영속성
   의존성: state.js, utils.js, logger.js

   수정 (버그픽스):
   - exportData(): try/finally로 URL.revokeObjectURL 보장
   ============================================= */

// ---------------------------------------------------------------------------
// 서버 ↔ 로컬 동기화
// ---------------------------------------------------------------------------

async function loadData() {
  logger.info('데이터 로드 시작');
  try {
    const res = await fetch('/api/data');
    if (res.ok) {
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        logger.error('서버 응답 JSON 파싱 실패', parseErr);
        _useSampleData();
        render();
        showHome();
        return;
      }

      state.students  = data.students  && data.students.length  ? data.students  : SAMPLE_STUDENTS;
      state.sessions  = data.sessions  && data.sessions.length  ? data.sessions  : SAMPLE_SESSIONS;
      state.myTopics  = data.my_topics  && data.my_topics.length  ? data.my_topics  : SAMPLE_TOPICS;
      state.myRecords = data.my_records && data.my_records.length ? data.my_records : SAMPLE_RECORDS;

      const isNew = !data.students || !data.students.length;
      logger.info('데이터 로드 완료 (학생 %d명, 회기 %d건, 주제 %d개)',
        state.students.length, state.sessions.length, state.myTopics.length);
      if (isNew) {
        logger.info('신규 사용자 — 샘플 데이터 저장');
        saveData();
      }
    } else {
      logger.warn('서버 데이터 응답 오류: HTTP %d — 샘플 데이터 사용', res.status);
      _useSampleData();
      saveData();
    }
  } catch (e) {
    logger.warn('서버 연결 실패 — 샘플 데이터로 시작', e);
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
  const payload = {
    students:   state.students,
    sessions:   state.sessions,
    my_topics:  state.myTopics,
    my_records: state.myRecords,
  };
  logger.debug('데이터 저장 요청 (학생 %d명, 회기 %d건)',
    payload.students.length, payload.sessions.length);

  fetch('/api/data', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    logger.debug('데이터 저장 완료');
  }).catch(e => {
    logger.error('데이터 저장 실패', e);
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
  logger.info('데이터 내보내기 시작');
  const data = {
    exportedAt:  new Date().toISOString(),
    students:    state.students,
    sessions:    state.sessions,
    my_topics:   state.myTopics,
    my_records:  state.myRecords,
  };
  let url;
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `자화상_백업_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    try {
      a.click();
      logger.info('데이터 내보내기 완료');
    } finally {
      document.body.removeChild(a);
    }
  } catch (e) {
    logger.error('데이터 내보내기 실패', e);
    alert('내보내기 실패: ' + e.message);
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
