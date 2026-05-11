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
  const startedAt = performance.now();

  const cached = _loadFromLocalCache();
  if (cached) {
    state.students  = cached.students  || [];
    state.sessions  = cached.sessions  || [];
    state.myTopics  = cached.my_topics  || [];
    state.myRecords = cached.my_records || [];
    state.investment = normalizeInvestmentState(cached.investment);
    state.appSettings = normalizeAppSettings(cached.app_settings);
    logger.info('로컬 캐시로 즉시 렌더 (학생 %d명)', state.students.length);
  } else {
    _useSampleData();
  }

  const beforeServerSignature = _dataSignature();
  render();
  _hideSplash();

  try {
    const res = await _fetchDataFromServer();
    if (res.ok) {
      let data;
      try {
        data = await _readDataResponse(res);
      } catch (parseErr) {
        logger.warn('서버 데이터 응답이 JSON이 아님 → 로컬 캐시 유지', parseErr);
        return;
      }

      const isNew = !data.students || !data.students.length;
      _applyServerData(data);
      logger.info('서버 데이터 수신 완료 (학생 %d명, 회기 %d건)', state.students.length, state.sessions.length);
      _saveToLocalCache();

      if (isNew) {
        logger.info('신규 사용자 샘플 데이터 저장');
        saveData();
      }
      if (beforeServerSignature !== _dataSignature()) render();
    } else {
      logger.warn('서버 데이터 수신 생략: HTTP %d', res.status);
    }
  } catch (e) {
    logger.warn('서버 연결 실패 → 캐시 데이터 유지', e);
    if (!cached) _useSampleData();
  } finally {
    logger.info('초기 데이터 로드 완료: %dms', Math.round(performance.now() - startedAt));
    if (typeof scheduleInvestmentDeskNotifications === 'function') {
      scheduleInvestmentDeskNotifications();
    }
    if (typeof scheduleRecordReminderNotifications === 'function') {
      scheduleRecordReminderNotifications();
    }
    if (typeof maybeFinalizeInvestmentMarketChatSession === 'function') {
      maybeFinalizeInvestmentMarketChatSession();
    }
    if (typeof handleLaunchParams === 'function') {
      handleLaunchParams();
    }
  }
}

const _CACHE_KEY = 'jip_data_cache';
let _lastSyncAt = 0;
let _syncInFlight = false;
let _saveQueue = Promise.resolve();

async function refreshDataFromServer(options = {}) {
  const minInterval = Number.isFinite(options.minInterval) ? options.minInterval : 5000;
  const now = Date.now();
  if (_syncInFlight) return false;
  if (!options.force && now - _lastSyncAt < minInterval) return false;
  _syncInFlight = true;
  _lastSyncAt = now;

  try {
    const before = _dataSignature();
    const res = await _fetchDataFromServer();
    if (!res.ok) {
      logger.warn('서버 동기화 생략: HTTP %d', res.status);
      return false;
    }
    const data = await _readDataResponse(res);
    _applyServerData(data);
    _saveToLocalCache();
    const changed = before !== _dataSignature();
    if (changed && options.render !== false) render();
    if (changed && typeof scheduleInvestmentDeskNotifications === 'function') scheduleInvestmentDeskNotifications();
    if (changed && typeof scheduleRecordReminderNotifications === 'function') scheduleRecordReminderNotifications();
    if (changed) logger.info('서버 최신 데이터로 동기화 완료');
    return changed;
  } catch (e) {
    logger.warn('서버 동기화 실패', e);
    return false;
  } finally {
    _syncInFlight = false;
  }
}

function setupDataAutoSync() {
  const sync = () => refreshDataFromServer({ minInterval: 15000 }).catch(() => {});
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync();
  });
}

function _fetchDataFromServer() {
  return fetch('/api/data', {
    headers: { 'Accept': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
}

async function _readDataResponse(res) {
  if (!_isJSONResponse(res)) throw new Error('non-json response');
  return res.json();
}

function _applyServerData(data) {
  state.students  = data.students  && data.students.length  ? data.students  : SAMPLE_STUDENTS;
  state.sessions  = data.sessions  && data.sessions.length  ? data.sessions  : SAMPLE_SESSIONS;
  state.myTopics  = data.my_topics  && data.my_topics.length  ? data.my_topics  : SAMPLE_TOPICS;
  state.myRecords = data.my_records && data.my_records.length ? data.my_records : SAMPLE_RECORDS;
  state.investment = _mergeIncomingInvestmentState(data.investment);
  state.appSettings = normalizeAppSettings(data.app_settings);
}

function _mergeIncomingInvestmentState(incomingInvestment) {
  const current = normalizeInvestmentState(state.investment);
  const incoming = normalizeInvestmentState(incomingInvestment);
  const merged = { ...incoming };
  merged.positions = _mergeInvestmentPositionsForServerRefresh(current.positions, incoming.positions);

  if ((current.chat || []).length > (incoming.chat || []).length) {
    merged.chat = current.chat;
  }
  if ((current.chatSessions || []).length > (incoming.chatSessions || []).length) {
    merged.chatSessions = current.chatSessions;
    merged.activeChatSessionId = current.activeChatSessionId;
  }
  if ((current.decisions || []).length > (incoming.decisions || []).length) {
    merged.decisions = current.decisions;
    merged.positions = current.positions;
  }
  if ((current.events || []).length > (incoming.events || []).length) {
    merged.events = current.events;
  }

  return normalizeInvestmentState(merged);
}

function _mergeInvestmentPositionsForServerRefresh(currentPositions, incomingPositions) {
  const current = Array.isArray(currentPositions) ? currentPositions : [];
  const incoming = Array.isArray(incomingPositions) ? incomingPositions : [];
  const currentTradable = current.filter(p =>
    !isCashInvestmentPosition(p) &&
    (parseInvestmentNumber(p.shares) > 0 || parseInvestmentNumber(p.currentPrice) > 0 || parseInvestmentNumber(p.avgPrice) > 0)
  );
  const incomingHasTradable = incoming.some(p =>
    !isCashInvestmentPosition(p) &&
    (parseInvestmentNumber(p.shares) > 0 || parseInvestmentNumber(p.currentPrice) > 0 || parseInvestmentNumber(p.avgPrice) > 0)
  );
  if (incomingHasTradable || !currentTradable.length) return incoming;

  const merged = [...incoming];
  const preserved = [];
  currentTradable.forEach(position => {
    const symbol = String(position.symbol || '').toUpperCase();
    const id = String(position.id || '');
    const alreadyPresent = merged.some(item =>
      (id && String(item.id || '') === id) ||
      (symbol && String(item.symbol || '').toUpperCase() === symbol)
    );
    if (!alreadyPresent) {
      merged.push(position);
      preserved.push(symbol || id || 'position');
    }
  });
  if (preserved.length) {
    logger.warn('서버 투자 상태가 현금만 포함해 로컬 보유 종목을 보존함', {
      preserved,
      incomingPositions: incoming.length,
      currentPositions: current.length,
    });
  }
  return merged;
}

function _dataSignature() {
  const lastOf = (arr, pick) => {
    const list = Array.isArray(arr) ? arr : [];
    if (!list.length) return '';
    return pick(list[list.length - 1]);
  };
  const inv = state.investment || {};
  return [
    state.students.length,
    state.sessions.length,
    state.myTopics.length,
    state.myRecords.length,
    inv.positions?.length || 0,
    inv.events?.length || 0,
    inv.decisions?.length || 0,
    inv.chat?.length || 0,
    state.appSettings?.reminders?.enabled ? 1 : 0,
    state.appSettings?.reminders?.dailyTime || '',
    state.appSettings?.reminders?.lastSentDate || '',
    lastOf(state.students, s => s.id || s.createdAt || ''),
    lastOf(state.sessions, s => s.id || s.date || ''),
    lastOf(state.myTopics, t => t.id || t.createdAt || ''),
    lastOf(state.myRecords, r => r.id || r.date || ''),
    (inv.positions || []).map(p => `${p.id || ''}:${p.symbol || ''}:${p.shares || ''}:${p.avgPrice || ''}:${p.currentPrice || ''}`).join(','),
    lastOf(inv.events, e => e.id || e.date || ''),
    lastOf(inv.decisions, d => d.id || d.createdAt || ''),
    lastOf(inv.chat, m => `${m.role || ''}:${m.text || ''}`),
  ].join('|');
}

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
      app_settings: state.appSettings,
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
  state.appSettings = defaultAppSettings();
}

async function saveData(options = {}) {
  _saveQueue = _saveQueue
    .catch(() => {})
    .then(() => _saveDataNow(options));
  return _saveQueue;
}

async function _saveDataNow(options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 2;
  const payload = {
    students:   state.students,
    sessions:   state.sessions,
    my_topics:  state.myTopics,
    my_records: state.myRecords,
    investment: state.investment,
    app_settings: state.appSettings,
  };
  logger.debug('데이터 저장 요청 (학생 %d명, 회기 %d건)',
    payload.students.length, payload.sessions.length);

  // localStorage 캐시도 즉시 업데이트 (새로고침 시 삭제 데이터 복원 방지)
  const localSaved = _saveToLocalCache();
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
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
      lastError = e;
      if (attempt < retries) {
        logger.warn('서버 동기화 재시도 %d/%d', attempt + 1, retries, e);
        await _delay(350 * (attempt + 1));
      }
    }
  }

  if (localSaved) {
    logger.warn('서버 동기화 실패 — 로컬 저장 유지', lastError);
    return false;
  }
  logger.error('데이터 저장 실패 — 로컬 저장도 실패', lastError);
  return false;
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _isJSONResponse(res) {
  return (res.headers.get('content-type') || '').includes('application/json');
}

// FOUC 방지 스플래시 제거 — render() 호출 직후 실행
function _hideSplash() {
  if (typeof window.__hideBootSplash === 'function') {
    window.__hideBootSplash();
    return;
  }
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
    app_settings: state.appSettings,
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
