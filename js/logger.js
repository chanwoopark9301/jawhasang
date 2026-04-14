/* =============================================
   自畵像 — 브라우저 로거
   의존성: 없음 (가장 먼저 로드)

   사용법:
     logger.info('데이터 로드 완료', data)
     logger.warn('저장 재시도', attempt)
     logger.error('AI 호출 실패', error)
     logger.debug('상태 변경', state)   // DEBUG_MODE=true 시에만 출력

   디버그 모드 활성화:
     localStorage.setItem('jwhwa_debug', '1')  → 새로고침
     localStorage.removeItem('jwhwa_debug')    → 비활성화
   ============================================= */

const logger = (() => {
  const PREFIX   = '[自畵像]';
  const DEBUG_ON = !!localStorage.getItem('jwhwa_debug');

  // 로그 이력 (마지막 200개, 오류 보고 및 디버깅용)
  const _history = [];
  const MAX_HIST = 200;

  function _push(level, args) {
    _history.push({ level, ts: new Date().toISOString(), args });
    if (_history.length > MAX_HIST) _history.shift();
  }

  function _fmt(level) {
    return `${PREFIX}[${level}]`;
  }

  return {
    /** 일반 정보 로그 */
    info(msg, ...args) {
      _push('INFO', [msg, ...args]);
      console.info(_fmt('INFO'), msg, ...args);
    },

    /** 경고 (처리는 됐지만 주의 필요) */
    warn(msg, ...args) {
      _push('WARN', [msg, ...args]);
      console.warn(_fmt('WARN'), msg, ...args);
    },

    /** 오류 (사용자 동작에 영향) */
    error(msg, ...args) {
      _push('ERROR', [msg, ...args]);
      console.error(_fmt('ERROR'), msg, ...args);
    },

    /** 디버그 (localStorage.jwhwa_debug=1 시에만 출력) */
    debug(msg, ...args) {
      _push('DEBUG', [msg, ...args]);
      if (DEBUG_ON) console.debug(_fmt('DEBUG'), msg, ...args);
    },

    /** 최근 로그 이력 반환 (디버깅용) */
    getHistory() {
      return [..._history];
    },

    /** 오류 로그만 필터링 */
    getErrors() {
      return _history.filter(e => e.level === 'ERROR');
    },
  };
})();
