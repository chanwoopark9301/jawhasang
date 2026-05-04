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

  // 1단계: localStorage 캐시로 즉시 렌더 (체감 속도 개선)
  const cached = _loadFromLocalCache();
  if (cached) {
    state.students  = cached.students  || [];
    state.sessions  = cached.sessions  || [];
    state.myTopics  = cached.my_topics  || [];
    state.myRecords = cached.my_records || [];
    state.investment = normalizeInvestmentState(cached.investment);
    logger.info('로컬 캐시로 즉시 렌더 (학생 %d명)', state.students.length);
  } else {
    _useSampleData();
  }
  render(); // 초기 상태가 이미 welcome이므로 홈 화면이 그대로 표시됨
  _hideSplash(); // 첫 render() 완료 후 스플래시 제거

  // 2단계: 서버에서 최신 데이터 백그라운드 수신 후 재렌더
  try {
    const res = await fetch('/api/data', {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin',
    });
    if (res.ok) {
      let data;
      try {
        if (!_isJSONResponse(res)) throw new Error('non-json response');
        data = await res.json();
      } catch (parseErr) {
        logger.warn('서버 데이터 응답이 JSON이 아님 — 로컬 캐시 유지', parseErr);
        return;
      }

      const isNew = !data.students || !data.students.length;
      state.students  = data.students  && data.students.length  ? data.students  : SAMPLE_STUDENTS;
      state.sessions  = data.sessions  && data.sessions.length  ? data.sessions  : SAMPLE_SESSIONS;
      state.myTopics  = data.my_topics  && data.my_topics.length  ? data.my_topics  : SAMPLE_TOPICS;
      state.myRecords = data.my_records && data.my_records.length ? data.my_records : SAMPLE_RECORDS;
      state.investment = normalizeInvestmentState(data.investment);

      logger.info('서버 데이터 수신 완료 (학생 %d명, 회기 %d건)', state.students.length, state.sessions.length);
      _saveToLocalCache();

      if (isNew) {
        logger.info('신규 사용자 — 샘플 데이터 저장');
        saveData();
      }
      render(); // 최신 데이터로 재렌더
    } else {
      logger.warn('서버 데이터 수신 생략: HTTP %d', res.status);
    }
  } catch (e) {
    logger.warn('서버 연결 실패 — 캐시 데이터 유지', e);
    if (!cached) _useSampleData();
  }
}

const _CACHE_KEY = 'jip_data_cache';

function _loadFromLocalCache() {
  try {
    const raw = localStorage.getItem(_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function _saveToLocalCache() {
  try {
    localStorage.setItem(_CACHE_KEY, JSON.stringify({
      students:   state.students,
      sessions:   state.sessions,
      my_topics:  state.myTopics,
      my_records: state.myRecords,
      investment: state.investment,
    }));
    return true;
  } catch (e) {
    logger.warn('로컬 캐시 저장 실패', e);
    return false;
  }
}

function _useSampleData() {
  state.students  = SAMPLE_STUDENTS;
  state.sessions  = SAMPLE_SESSIONS;
  state.myTopics  = SAMPLE_TOPICS;
  state.myRecords = SAMPLE_RECORDS;
  state.investment = defaultInvestmentState();
}

async function saveData() {
  const payload = {
    students:   state.students,
    sessions:   state.sessions,
    my_topics:  state.myTopics,
    my_records: state.myRecords,
    investment: state.investment,
  };
  logger.debug('데이터 저장 요청 (학생 %d명, 회기 %d건)',
    payload.students.length, payload.sessions.length);

  // localStorage 캐시도 즉시 업데이트 (새로고침 시 삭제 데이터 복원 방지)
  const localSaved = _saveToLocalCache();

  try {
    const res = await fetch('/api/data', {
      method:  'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!_isJSONResponse(res)) throw new Error('non-json response');
    logger.debug('데이터 저장 완료');
    return true;
  } catch (e) {
    if (localSaved) {
      logger.warn('서버 동기화 실패 — 로컬 저장 유지', e);
      return false;
    }
    logger.error('데이터 저장 실패 — 로컬 저장도 실패', e);
    return false;
  }
}

function _isJSONResponse(res) {
  return (res.headers.get('content-type') || '').includes('application/json');
}

// FOUC 방지 스플래시 제거 — render() 호출 직후 실행
function _hideSplash() {
  const el = document.getElementById('app-splash');
  if (!el) return;
  el.classList.add('hiding');
  setTimeout(() => el.remove(), 260); // transition(0.25s) 후 DOM 제거
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
    investment:  state.investment,
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
