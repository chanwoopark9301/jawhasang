/* =============================================
   기록 루틴 알림 (일상/상담)
   의존: state.js, utils.js, data.js
   ============================================= */

let _recordReminderTimer = null;

async function requestRecordReminderNotifications() {
  if (!('Notification' in window)) return showToast('이 브라우저는 알림을 지원하지 않아요.');
  const permission = await Notification.requestPermission();
  state.appSettings = normalizeAppSettings(state.appSettings);
  state.appSettings.reminders.enabled = permission === 'granted';
  if (permission === 'granted') {
    state.appSettings.reminders.lastPermissionAt = new Date().toISOString();
    scheduleRecordReminderNotifications();
    sendRecordReminderNotification({ force: true, reason: 'enabled' });
  }
  saveData({ retries: 0 });
  showToast(permission === 'granted' ? '기록 알림을 켰어요.' : '알림 권한이 허용되지 않았어요.');
  if (state.activeModal === 'reminder-settings') openModal('reminder-settings');
}

function updateRecordReminderSetting(field, value) {
  state.appSettings = normalizeAppSettings(state.appSettings);
  if (field === 'dailyTime') {
    state.appSettings.reminders.dailyTime = value || '21:30';
  } else {
    state.appSettings.reminders[field] = Boolean(value);
  }
  saveData({ retries: 0 });
  scheduleRecordReminderNotifications();
}

function scheduleRecordReminderNotifications() {
  if (_recordReminderTimer) {
    clearTimeout(_recordReminderTimer);
    _recordReminderTimer = null;
  }
  state.appSettings = normalizeAppSettings(state.appSettings);
  const prefs = state.appSettings.reminders || {};
  if (!prefs.enabled || !('Notification' in window) || Notification.permission !== 'granted') return false;

  const delay = nextRecordReminderDelay(prefs.dailyTime || '21:30');
  _recordReminderTimer = setTimeout(() => {
    sendRecordReminderNotification({ reason: 'daily' });
    scheduleRecordReminderNotifications();
  }, delay);
  return true;
}

function nextRecordReminderDelay(timeText) {
  const [hRaw, mRaw] = String(timeText || '21:30').split(':');
  const hour = Math.min(23, Math.max(0, parseInt(hRaw, 10) || 21));
  const minute = Math.min(59, Math.max(0, parseInt(mRaw, 10) || 30));
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

function sendRecordReminderNotification(options = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  state.appSettings = normalizeAppSettings(state.appSettings);
  const prefs = state.appSettings.reminders || {};
  if (!prefs.enabled && !options.force) return false;
  const today = localDateString();
  if (!options.force && prefs.lastSentDate === today) return false;

  const payload = buildRecordReminderNotificationPayload();
  if (!payload) return false;
  showRecordReminderNotification(payload.title, payload.body, {
    tag: `record-reminder-${today}`,
    data: { url: '/?modal=reminder-settings', reason: options.reason || 'manual' },
  });
  state.appSettings.reminders.lastSentDate = today;
  state.appSettings.reminders.lastSentAt = new Date().toISOString();
  saveData({ retries: 0 });
  return true;
}

function sendRecordReminderTestNotification() {
  state.appSettings = normalizeAppSettings(state.appSettings);
  if (!state.appSettings.reminders.enabled) {
    requestRecordReminderNotifications();
    return;
  }
  const sent = sendRecordReminderNotification({ force: true, reason: 'test' });
  showToast(sent ? '기록 알림을 보냈어요.' : '알림을 보낼 수 없어요.');
}

function buildRecordReminderNotificationPayload() {
  state.appSettings = normalizeAppSettings(state.appSettings);
  const prefs = state.appSettings.reminders || {};
  const today = localDateString();
  const myCount = (state.myRecords || []).filter(r => r.date === today).length;
  const sessionCount = (state.sessions || []).filter(s => s.date === today).length;
  const wantsMy = prefs.remindMyRecords !== false;
  const wantsCounseling = prefs.remindCounseling !== false;
  const missing = [];
  if (wantsMy && myCount === 0) missing.push('일상');
  if (wantsCounseling && sessionCount === 0) missing.push('상담');

  if (prefs.onlyWhenEmpty && !missing.length) return null;
  if (missing.length) {
    return {
      title: '오늘 기록하실 거 없나요?',
      body: `${missing.join('·')} 기록이 아직 비어 있어요. 짧게 한 줄만 남겨도 오늘의 흐름이 이어져요.`,
    };
  }
  return {
    title: '오늘 기록을 정리할 시간이에요',
    body: `오늘 일상 ${myCount}개, 상담 ${sessionCount}개가 쌓였어요. 필요한 것만 가볍게 보완해보세요.`,
  };
}

function showRecordReminderNotification(title, body, options = {}) {
  const payload = {
    body,
    tag: options.tag || 'record-reminder',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: options.data || { url: '/?modal=reminder-settings' },
  };
  if (navigator.serviceWorker?.ready) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, payload))
      .catch(() => new Notification(title, payload));
    return;
  }
  new Notification(title, payload);
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
