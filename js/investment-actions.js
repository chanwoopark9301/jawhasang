/* =============================================
   투자 파트너 — 폼 액션/저장
   의존성: state.js, data.js, investment-api.js, market-data.js, investment-rules.js, investment-portfolio.js
   ============================================= */

async function addInvestmentPositionFromForm(event) {
  event.preventDefault();
  const assetType = document.getElementById('ip-asset-type')?.value || 'stock';
  let symbol = normalizeInvestmentMarketSymbol(document.getElementById('ip-symbol')?.value);
  if (assetType === 'cash' && !symbol) symbol = 'CASH';
  if (!symbol) return showToast('종목 코드를 입력해주세요.');
  const button = document.getElementById('investment-add-position');
  if (button) {
    button.disabled = true;
    button.textContent = '현재가 조회 중';
  }

  const editId = document.getElementById('ip-id')?.value || '';
  const existing = editId ? state.investment.positions.find(p => String(p.id) === String(editId)) : null;
  const position = {
    ...(existing || {}),
    id: editId || ('ip' + (state.investment.positions.length + 1)),
    assetType,
    symbol,
    name: document.getElementById('ip-name')?.value.trim() || (assetType === 'cash' ? '현금' : symbol),
    shares: parseInvestmentNumber(document.getElementById('ip-shares')?.value),
    avgPrice: parseInvestmentNumber(document.getElementById('ip-avg')?.value),
    currentPrice: existing?.currentPrice ?? null,
    manualPrice: existing?.manualPrice || false,
    targetPrice: parseInvestmentNumber(document.getElementById('ip-target')?.value),
    stopPrice: parseInvestmentNumber(document.getElementById('ip-stop')?.value),
    longTerm: !!document.getElementById('ip-longterm')?.checked,
    thesis: document.getElementById('ip-thesis')?.value.trim() || '',
    addRule: document.getElementById('ip-add-rule')?.value.trim() || '',
    marketSource: '',
  };
  if (assetType === 'cash') {
    position.shares = parseInvestmentNumber(document.getElementById('ip-shares')?.value);
    position.avgPrice = 1;
    position.currentPrice = 1;
    position.cashAmount = position.shares;
    position.manualPrice = true;
    position.currency = 'USD';
  }
  if (existing) {
    state.investment.positions = state.investment.positions.map(p => String(p.id) === String(position.id) ? position : p);
  } else {
    state.investment.positions.push(position);
  }
  state.selInvestmentPosition = position.id;
  let hasQuote = false;
  try {
    if (assetType !== 'cash') {
      const quotes = await fetchMarketQuotes([symbol]);
      applyInvestmentQuotes(quotes);
      hasQuote = quotes.some(q => String(q.symbol || '').toUpperCase() === symbol);
    } else {
      hasQuote = true;
    }
  } catch (e) {
    logger.warn('종목 등록 현재가 조회 실패', e);
  }
  const latestPosition = state.investment.positions.find(p => String(p.id) === String(position.id)) || position;
  if (button) button.textContent = 'DB 저장 중';
  const saved = await apiSaveInvestmentPosition(latestPosition, 3);
  if (!saved?.ok) {
    state.investment.positions = existing
      ? state.investment.positions.map(p => String(p.id) === String(existing.id) ? existing : p)
      : state.investment.positions.filter(p => p.id !== position.id);
    logger.error('투자 종목 등록 실패', { symbol, error: saved?.error });
    showToast(saved?.error || '서버 저장에 실패했어요. 잠시 후 다시 저장해주세요.');
    if (button) {
      button.disabled = false;
      button.textContent = '종목 등록';
    }
    render();
    return;
  }
  if (saved.investment) state.investment = mergeInvestmentAfterPositionSave(state.investment, saved.investment);
  showToast(assetType === 'cash' ? '현금 보유액을 포트폴리오에 반영했어요.' : hasQuote ? '보유 종목을 등록하고 현재가를 가져왔어요.' : '종목은 등록했지만 현재가를 찾지 못했어요. 티커를 확인해주세요.');
  if (state.activeModal === 'investment-portfolio') {
    openModal('investment-portfolio');
  } else {
    closeModal();
    render();
  }
}

async function syncKisBrokerData() {
  const buttons = document.querySelectorAll('#investment-sync-kis, #investment-modal-sync-kis');
  buttons.forEach(btn => {
    btn.disabled = true;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = '동기화 중';
  });
  try {
    const data = await apiSyncKisBroker(30);
    if (data.investment) state.investment = normalizeInvestmentState(data.investment);
    showToast(`KIS 잔고 ${data.positionsSynced || 0}개, 매매 기록 ${data.tradesSynced || 0}건을 동기화했어요.`);
    render();
    if (state.activeModal === 'investment-portfolio') openModal('investment-portfolio');
  } catch (e) {
    logger.warn('KIS 동기화 실패', e);
    showToast(e.message || 'KIS 동기화에 실패했어요. API 키 설정을 확인해주세요.');
  } finally {
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || 'KIS 동기화';
    });
  }
}

async function syncInvestmentCalendarData() {
  const buttons = document.querySelectorAll('#investment-sync-calendar, #investment-hub-calendar-sync');
  buttons.forEach(btn => {
    btn.disabled = true;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = '일정 동기화 중';
  });
  try {
    await saveData({ retries: 1 });
    const data = await apiSyncInvestmentCalendar(45);
    if (data.investment) {
      state.investment = typeof _mergeIncomingInvestmentState === 'function'
        ? _mergeIncomingInvestmentState(data.investment)
        : normalizeInvestmentState(data.investment);
    }
    const missing = Array.isArray(data.missingProviders) && data.missingProviders.length
      ? ` 필요한 키: ${data.missingProviders.join(', ')}`
      : '';
    showToast(`투자 일정 ${data.eventsSynced || 0}개를 캘린더에 반영했어요.${missing}`);
    await saveData({ retries: 1 });
    render();
    if (state.activeModal === 'investment-desk') openModal('investment-desk');
  } catch (e) {
    logger.warn('투자 일정 동기화 실패', e);
    showToast(e.message || '투자 일정 동기화에 실패했어요.');
  } finally {
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '일정 동기화';
    });
  }
}

async function addInvestmentSignalFromForm(event) {
  event.preventDefault();
  state.investment = normalizeInvestmentState(state.investment);
  const date = document.getElementById('is-date')?.value || new Date().toISOString().split('T')[0];
  const symbol = normalizeInvestmentMarketSymbol(document.getElementById('is-symbol')?.value || '');
  const handle = (document.getElementById('is-handle')?.value || '').trim().replace(/^@/, '');
  const title = (document.getElementById('is-title')?.value || '').trim() || (handle ? `@${handle} signal` : 'Market signal');
  const body = (document.getElementById('is-body')?.value || '').trim();
  const sourceUrl = (document.getElementById('is-url')?.value || '').trim();
  if (!body && !sourceUrl) return showToast('X link or signal note is required.');

  state.investment.events.push({
    id: `x-manual-${Date.now()}`,
    date,
    type: 'signal',
    severity: 'watch',
    symbol,
    title,
    body: [
      handle ? `@${handle}` : '',
      body,
      sourceUrl ? `[source](${sourceUrl})` : '',
      'Rule: treat this as a watch signal until confirmed by official filings, company IR, or trusted financial news.',
    ].filter(Boolean).join('\n\n'),
    source: 'x-manual',
    sourceUrl,
    handle,
  });
  const persisted = await saveData();
  if (!persisted) return showToast('Server save failed. Please try again.');
  showToast('Market signal saved.');
  openModal('investment-signals');
  render();
}

async function addInvestmentSignalAccountFromForm(event) {
  event.preventDefault();
  state.investment = normalizeInvestmentState(state.investment);
  const handle = (document.getElementById('isw-handle')?.value || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return showToast('Enter a valid X handle.');
  const watchlist = state.investment.signals.watchlist || [];
  if (watchlist.some(a => String(a.handle || '').toLowerCase() === handle.toLowerCase())) {
    return showToast('This account is already in the watchlist.');
  }
  watchlist.push({
    handle,
    label: (document.getElementById('isw-label')?.value || '').trim() || handle,
    theme: (document.getElementById('isw-theme')?.value || '').trim() || 'market signal',
    trust: document.getElementById('isw-trust')?.value || 'narrative',
  });
  state.investment.signals.watchlist = watchlist;
  const persisted = await saveData();
  if (!persisted) return showToast('Server save failed. Please try again.');
  showToast('X watch account saved.');
  openModal('investment-signals');
}

async function removeInvestmentSignalAccount(handle) {
  state.investment = normalizeInvestmentState(state.investment);
  const target = String(handle || '').toLowerCase();
  state.investment.signals.watchlist = (state.investment.signals.watchlist || [])
    .filter(a => String(a.handle || '').toLowerCase() !== target);
  const persisted = await saveData();
  if (!persisted) return showToast('Server save failed. Please try again.');
  showToast('X watch account removed.');
  openModal('investment-signals');
}

async function syncInvestmentXSignals() {
  state.investment = normalizeInvestmentState(state.investment);
  const button = document.getElementById('investment-x-sync');
  if (button) {
    button.disabled = true;
    button.dataset.originalText = button.dataset.originalText || button.textContent;
    button.textContent = 'Syncing...';
  }
  try {
    const data = await apiSyncInvestmentXSignals(state.investment.signals.watchlist || []);
    if (data.investment) state.investment = normalizeInvestmentState(data.investment);
    const count = data.signalsSynced || 0;
    showToast(`X signal sync complete: ${count} new.`);
    if (count > 0) notifyInvestmentSignal('Investment signal synced', `${count} new X market signal(s) were saved.`);
    render();
    if (state.activeModal === 'investment-signals') openModal('investment-signals');
  } catch (e) {
    logger.warn('X signal sync failed', e);
    showToast(e.message || 'X signal sync failed. Check X_BEARER_TOKEN.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = button.dataset.originalText || 'Sync X';
    }
  }
}

async function requestInvestmentNotifications() {
  if (!('Notification' in window)) return showToast('이 브라우저는 알림을 지원하지 않아요.');
  const permission = await Notification.requestPermission();
  state.investment = normalizeInvestmentState(state.investment);
  state.investment.notifications.enabled = permission === 'granted';
  if (permission === 'granted') {
    state.investment.notifications.lastPermissionAt = new Date().toISOString();
    scheduleInvestmentDeskNotifications();
    sendInvestmentDeskNotification({ force: true, reason: 'enabled' });
  }
  saveData({ retries: 0 });
  showToast(permission === 'granted' ? '투자 알림을 켰어요.' : '알림 권한이 허용되지 않았어요.');
}

function notifyInvestmentSignal(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (navigator.serviceWorker?.ready) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, { body, tag: 'investment-signal' }))
      .catch(() => new Notification(title, { body }));
    return;
  }
  new Notification(title, { body });
}

let _investmentNotificationTimer = null;
let _investmentDeskPrepareTimer = null;
let _investmentDeskPreparing = false;

function scheduleDailyInvestmentDeskPreparation() {
  if (_investmentDeskPrepareTimer) {
    clearTimeout(_investmentDeskPrepareTimer);
    _investmentDeskPrepareTimer = null;
  }
  state.investment = normalizeInvestmentState(state.investment);
  const prefs = state.investment.desk || {};
  if (prefs.autoPrepare === false) return false;

  const today = new Date().toISOString().slice(0, 10);
  const delay = nextInvestmentNotificationDelay(prefs.prepareTime || '09:00');
  const now = new Date();
  const [hRaw, mRaw] = String(prefs.prepareTime || '09:00').split(':');
  const threshold = new Date(now);
  threshold.setHours(Math.min(23, Math.max(0, parseInt(hRaw, 10) || 9)), Math.min(59, Math.max(0, parseInt(mRaw, 10) || 0)), 0, 0);

  if (now >= threshold && prefs.lastPreparedDate !== today) {
    setTimeout(() => prepareDailyInvestmentDesk({ force: false, silent: true, reason: 'startup-after-prepare-time' }), 1200);
  }
  _investmentDeskPrepareTimer = setTimeout(() => {
    prepareDailyInvestmentDesk({ force: true, silent: true, reason: 'scheduled' })
      .finally(() => scheduleDailyInvestmentDeskPreparation());
  }, delay);
  return true;
}

async function prepareDailyInvestmentDesk(options = {}) {
  if (_investmentDeskPreparing) return false;
  state.investment = normalizeInvestmentState(state.investment);
  const today = new Date().toISOString().slice(0, 10);
  if (!options.force && state.investment.desk?.lastPreparedDate === today) return false;

  _investmentDeskPreparing = true;
  const steps = [];
  const errors = [];
  const markStep = (name, ok, detail = '') => {
    steps.push({ name, ok: !!ok, detail, at: new Date().toISOString() });
    if (!ok && detail) errors.push(`${name}: ${detail}`);
  };
  const originalActiveModal = state.activeModal;
  state.investment.desk = {
    ...(state.investment.desk || {}),
    status: 'running',
    lastRunReason: options.reason || 'manual',
    steps,
    errors,
  };
  if (!options.silent) {
    showToast('오늘의 투자 데스크를 준비하고 있어요.');
    render();
    if (originalActiveModal === 'investment-desk') openModal('investment-desk');
  }

  try {
    try {
      const changed = await refreshDataFromServer({ force: true, minInterval: 0, render: false });
      state.investment = normalizeInvestmentState(state.investment);
      markStep('server-ledger-sync', true, changed ? 'server state merged' : 'already fresh');
    } catch (e) {
      markStep('server-ledger-sync', false, e.message || 'server sync failed');
    }

    try {
      await saveData({ retries: 1 });
      markStep('ledger-save-before-batch', true, 'latest local ledger pushed');
    } catch (e) {
      markStep('ledger-save-before-batch', false, e.message || 'save failed');
    }

    try {
      const broker = state.investment.broker || {};
      if (String(broker.provider || '').toLowerCase() === 'kis' || broker.status === 'connected') {
        const data = await apiSyncKisBroker(30);
        if (data.investment) state.investment = normalizeInvestmentState(data.investment);
        markStep('broker-sync', true, `${data.positionsSynced || 0} positions, ${data.tradesSynced || 0} trades`);
      } else {
        markStep('broker-sync', true, 'skipped: broker not connected');
      }
    } catch (e) {
      markStep('broker-sync', false, e.message || 'broker sync failed');
    }

    try {
      const symbols = investmentDeskMarketSymbols();
      if (symbols.length) {
        const data = await fetchMarketQuoteData(symbols);
        applyInvestmentQuotes(data.quotes || [], { forceCurrentPrice: true });
        const fx = (data.quotes || []).find(q => String(q.symbol || '').toUpperCase() === 'USDKRW=X');
        if (fx?.price) state.investment.usdKrwRate = Number(fx.price);
        markStep('market-quote-sync', true, `${(data.quotes || []).length}/${symbols.length} quotes`);
      } else {
        markStep('market-quote-sync', true, 'no symbols');
      }
    } catch (e) {
      markStep('market-quote-sync', false, e.message || 'market quote failed');
    }

    try {
      const data = await apiSyncInvestmentCalendar(45);
      if (data.investment) {
        state.investment = typeof _mergeIncomingInvestmentState === 'function'
          ? _mergeIncomingInvestmentState(data.investment)
          : normalizeInvestmentState(data.investment);
      }
      markStep('calendar-sync', true, `${data.eventsSynced || 0} events`);
    } catch (e) {
      markStep('calendar-sync', false, e.message || 'calendar sync failed');
    }

    try {
      const result = await syncDailyInvestmentDeskNews();
      markStep('news-signal-sync', true, `${result.added || 0} saved / ${result.fetched || 0} fetched`);
    } catch (e) {
      markStep('news-signal-sync', false, e.message || 'news sync failed');
    }

    state.investment = normalizeInvestmentState(state.investment);
    state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
    state.investment.desk = {
      ...(state.investment.desk || {}),
      autoPrepare: state.investment.desk?.autoPrepare !== false,
      prepareTime: state.investment.desk?.prepareTime || '09:00',
      lastPreparedDate: today,
      lastPreparedAt: new Date().toISOString(),
      status: errors.length ? 'partial' : 'ready',
      steps,
      errors,
    };
    await saveData({ retries: 1 });
    if (!options.silent) {
      showToast(errors.length ? '오늘의 데스크를 일부만 준비했어요. 로그를 확인해주세요.' : '오늘의 데스크를 준비했어요.');
    }
    logger.info('오늘의 투자 데스크 준비 완료', { status: state.investment.desk.status, steps, errors });
    render();
    if (originalActiveModal === 'investment-desk' || state.activeModal === 'investment-desk') openModal('investment-desk');
    return true;
  } finally {
    _investmentDeskPreparing = false;
  }
}

function investmentDeskMarketSymbols() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const positionSymbols = (inv.positions || [])
    .filter(p => !isCashInvestmentPosition(p))
    .map(p => p.symbol)
    .filter(Boolean);
  return [...new Set([...positionSymbols, ...INVESTMENT_INDEX_SYMBOLS, 'USDKRW=X'].map(normalizeInvestmentMarketSymbol).filter(Boolean))];
}

async function syncDailyInvestmentDeskNews() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const symbols = [...new Set((inv.positions || [])
    .filter(p => !isCashInvestmentPosition(p))
    .map(p => String(p.symbol || '').toUpperCase())
    .filter(Boolean))];
  const queries = buildDailyInvestmentDeskNewsQueries(symbols, inv);
  if (!symbols.length && !queries.length) return { fetched: 0, added: 0 };
  const data = await apiFetchInvestmentNews(symbols, 3, queries);
  const news = Array.isArray(data.news) ? data.news.slice(0, 18) : [];
  const before = inv.events.length;
  news.forEach(item => saveDailyInvestmentDeskNewsEvent(item));
  return { fetched: news.length, added: inv.events.length - before };
}

function buildDailyInvestmentDeskNewsQueries(symbols, investment) {
  const inv = investment ? normalizeInvestmentState(investment) : normalizeInvestmentState(state.investment);
  const set = new Set();
  const positions = (inv.positions || []).filter(p => !isCashInvestmentPosition(p));
  const has = symbol => symbols.includes(symbol);
  const add = query => {
    const clean = String(query || '').replace(/\s+/g, ' ').trim();
    if (clean) set.add(clean);
  };
  if (has('CRCL') || has('ETH-USD') || has('ETH') || has('IREN')) {
    add('Digital Asset Market Structure Clarity Act markup');
    add('GENIUS Act stablecoin bill stablecoin issuer USDC');
    add('crypto market structure bill Senate House markup');
  }
  positions.forEach(position => {
    const symbol = String(position.symbol || '').toUpperCase();
    if (!symbol) return;
    const name = String(position.name || '').trim();
    const label = name && name.toUpperCase() !== symbol ? `${symbol} ${name}` : symbol;
    add(`${label} latest news earnings analyst price target`);
    add(`${label} investor relations SEC filings guidance`);
    const assetType = String(position.assetType || '').toLowerCase();
    const descriptor = `${symbol} ${name} ${assetType}`.toLowerCase();
    if (assetType === 'crypto' || /eth|btc|bitcoin|ethereum|solana|crypto|coin/.test(descriptor)) {
      add(`${label} crypto policy ETF flows on-chain market risk`);
    }
    if (/qqq|qld|tqqq|nasdaq|semiconductor|nvda|amd|avgo|tsm|soxx|smh|ai|chip/.test(descriptor)) {
      add(`${label} Nasdaq semiconductor AI capex valuation momentum`);
    }
    if (/energy|oil|lng|shipping|defense|uranium|commodity/.test(descriptor)) {
      add(`${label} commodity geopolitics supply demand risk`);
    }
    if (/bank|financial|fintech|payment|circle|stablecoin|usdc/.test(descriptor)) {
      add(`${label} regulation reserves interest income business model`);
    }
    if (/miner|mining|data center|datacenter|cloud|gpu|bitcoin|iren/.test(descriptor)) {
      add(`${label} AI data center contract funding dilution bitcoin sensitivity`);
    }
  });
  if (has('CRCL')) add('Circle Internet Group earnings USDC reserves interest income');
  if (has('IREN')) add('IREN AI cloud Microsoft contract earnings funding dilution');
  if (has('ETH-USD') || has('ETH')) add('Ethereum ETF crypto market flows regulation');
  if (symbols.some(s => ['NVDA', 'AMD', 'AVGO', 'TSM', 'SMH', 'SOXX', 'QQQ', 'QQQM', 'QLD', 'TQQQ'].includes(s))) {
    add('semiconductor AI capex Nasdaq momentum valuation');
  }
  (inv.events || []).slice(-12).forEach(event => {
    const text = [event.title, event.symbol, event.body].filter(Boolean).join(' ');
    if (text) add(`${text} market impact`);
  });
  add('CPI Powell Fed rates market expectations this week');
  add('geopolitical oil shipping risk inflation markets this week');
  add('US China trade summit semiconductor AI supply chain market');
  return [...set].slice(0, 8);
}

function saveDailyInvestmentDeskNewsEvent(item) {
  state.investment = normalizeInvestmentState(state.investment);
  const title = String(item?.title || '').trim();
  const link = String(item?.link || item?.url || '').trim();
  if (!title && !link) return false;
  const key = normalizeDailyDeskEventKey(link || title);
  const exists = (state.investment.events || []).some(e => normalizeDailyDeskEventKey(e.sourceUrl || e.url || e.title) === key);
  if (exists) return false;
  const symbol = normalizeInvestmentMarketSymbol(item.symbol || item.topic || '');
  const published = String(item.published || item.publishedAt || '').slice(0, 10);
  const body = [
    item.summary || item.description || '',
    link ? `[source](${link})` : '',
    'Desk rule: official filings, company IR, trusted financial media, and price/volume must confirm before acting.',
  ].filter(Boolean).join('\n\n');
  state.investment.events.push({
    id: `desk-news-${new Date().toISOString().slice(0, 10)}-${key.slice(0, 48)}`,
    date: /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : new Date().toISOString().slice(0, 10),
    type: item.kind === 'general-news' ? 'signal' : 'news',
    severity: 'watch',
    symbol: symbol || '',
    title: title || 'Market signal',
    body,
    source: item.source || 'daily-desk-news',
    sourceUrl: link,
    deskPrepared: true,
  });
  return true;
}

function normalizeDailyDeskEventKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9가-힣:/?&.= -]/g, '').slice(0, 160);
}

function scheduleInvestmentDeskNotifications() {
  if (_investmentNotificationTimer) {
    clearTimeout(_investmentNotificationTimer);
    _investmentNotificationTimer = null;
  }
  state.investment = normalizeInvestmentState(state.investment);
  const prefs = state.investment.notifications || {};
  if (!prefs.enabled || !('Notification' in window) || Notification.permission !== 'granted') return false;

  const delay = nextInvestmentNotificationDelay(prefs.dailyTime || '08:30');
  _investmentNotificationTimer = setTimeout(() => {
    sendInvestmentDeskNotification({ reason: 'daily' });
    scheduleInvestmentDeskNotifications();
  }, delay);
  return true;
}

function nextInvestmentNotificationDelay(timeText) {
  const [hRaw, mRaw] = String(timeText || '08:30').split(':');
  const hour = Math.min(23, Math.max(0, parseInt(hRaw, 10) || 8));
  const minute = Math.min(59, Math.max(0, parseInt(mRaw, 10) || 30));
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

function sendInvestmentDeskNotification(options = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  state.investment = normalizeInvestmentState(state.investment);
  const prefs = state.investment.notifications || {};
  if (!prefs.enabled && !options.force) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (!options.force && prefs.lastDeskNotifiedDate === today) return false;

  const payload = buildInvestmentDeskNotificationPayload();
  if (!payload) return false;
  showInvestmentNotification(payload.title, payload.body, {
    tag: `investment-desk-${today}`,
    data: { url: '/?view=investment&modal=investment-desk', reason: options.reason || 'manual' },
  });
  state.investment.notifications.lastDeskNotifiedDate = today;
  state.investment.notifications.lastSentAt = new Date().toISOString();
  saveData({ retries: 0 });
  return true;
}

function sendInvestmentDeskTestNotification() {
  state.investment = normalizeInvestmentState(state.investment);
  if (!state.investment.notifications.enabled) {
    requestInvestmentNotifications();
    return;
  }
  const sent = sendInvestmentDeskNotification({ force: true, reason: 'test' });
  showToast(sent ? '오늘의 데스크 알림을 보냈어요.' : '알림을 보낼 수 없어요.');
}

function buildInvestmentDeskNotificationPayload() {
  const desk = buildDailyInvestmentDesk(state.investment);
  const prefs = state.investment.notifications || {};
  const risk = prefs.notifyRisks ? (desk.riskSignals || [])[0] : null;
  const event = prefs.notifyEvents ? (desk.todayEvents || [])[0] : null;
  const forbidden = (desk.forbiddenActions || []).length;
  if (risk) {
    return {
      title: `오늘의 데스크: ${risk.title || '위험 신호'}`,
      body: [risk.body, forbidden ? `금지 행동 ${forbidden}개를 먼저 확인하세요.` : '매수 전 원칙을 확인하세요.']
        .filter(Boolean)
        .join(' '),
    };
  }
  if (event) {
    return {
      title: `오늘 투자 일정: ${event.symbol || ''} ${event.title || investmentDeskEventTypeLabel(event.type)}`.trim(),
      body: event.body || '발표 전후 행동 기준을 먼저 정하세요.',
    };
  }
  if (prefs.notifyDesk !== false) {
    const briefing = desk.marketBriefing || {};
    return {
      title: '오늘의 투자 데스크',
      body: briefing.headline || `오늘 시장 변수와 보유 종목 노출을 먼저 확인하세요. 금지 행동 ${forbidden}개 · 오늘 일정 ${(desk.todayEvents || []).length}개`,
    };
  }
  return null;
}

function showInvestmentNotification(title, body, options = {}) {
  const payload = {
    body,
    tag: options.tag || 'investment-desk',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: options.data || { url: '/?view=investment&modal=investment-desk' },
  };
  if (navigator.serviceWorker?.ready) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, payload))
      .catch(() => new Notification(title, payload));
    return;
  }
  new Notification(title, payload);
}

function clearInvestmentPositionForm() {
  ['ip-id', 'ip-symbol', 'ip-name', 'ip-shares', 'ip-avg', 'ip-target', 'ip-stop', 'ip-thesis', 'ip-add-rule'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const assetType = document.getElementById('ip-asset-type');
  if (assetType) assetType.value = 'stock';
  const longTerm = document.getElementById('ip-longterm');
  if (longTerm) longTerm.checked = false;
  const btn = document.getElementById('investment-add-position');
  if (btn) btn.textContent = '종목 저장';
  syncInvestmentPositionAssetType();
}

function editInvestmentPosition(id) {
  const p = normalizeInvestmentState(state.investment).positions.find(item => String(item.id) === String(id));
  if (!p) return;
  const set = (field, value) => {
    const el = document.getElementById(field);
    if (el) el.value = value ?? '';
  };
  const assetType = document.getElementById('ip-asset-type');
  if (assetType) assetType.value = p.assetType || 'stock';
  set('ip-id', p.id);
  set('ip-symbol', p.symbol || '');
  set('ip-name', p.name || '');
  set('ip-shares', isCashInvestmentPosition(p) ? (p.cashAmount ?? p.shares ?? '') : (p.shares || ''));
  set('ip-avg', p.avgPrice || '');
  set('ip-target', p.targetPrice || '');
  set('ip-stop', p.stopPrice || '');
  set('ip-thesis', p.thesis || '');
  set('ip-add-rule', p.addRule || '');
  const longTerm = document.getElementById('ip-longterm');
  if (longTerm) longTerm.checked = !!p.longTerm;
  const btn = document.getElementById('investment-add-position');
  if (btn) btn.textContent = '종목 수정 저장';
  syncInvestmentPositionAssetType();
  const tools = document.getElementById('investment-manage-tools');
  if (tools) tools.open = true;
  document.getElementById('investment-position-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function syncInvestmentPositionAssetType() {
  const type = document.getElementById('ip-asset-type')?.value || 'stock';
  const symbol = document.getElementById('ip-symbol');
  const name = document.getElementById('ip-name');
  const shares = document.getElementById('ip-shares');
  const avg = document.getElementById('ip-avg');
  const target = document.getElementById('ip-target');
  const stop = document.getElementById('ip-stop');
  const longTerm = document.getElementById('ip-longterm');
  if (symbol) {
    symbol.placeholder = type === 'crypto' ? 'ETH, BTC, ETH-USD' : type === 'cash' ? 'CASH' : '종목 코드';
    symbol.disabled = type === 'cash';
    if (type === 'cash' && !symbol.value) symbol.value = 'CASH';
  }
  if (name) {
    name.placeholder = type === 'cash' ? '현금' : '종목명';
    if (type === 'cash' && !name.value) name.value = '현금';
  }
  if (shares) shares.placeholder = type === 'cash' ? '현금 보유액 ($)' : '수량';
  if (avg) {
    avg.placeholder = type === 'cash' ? '자동 1달러' : '평균 단가 ($)';
    avg.disabled = type === 'cash';
    if (type === 'cash') avg.value = '1';
  }
  [target, stop].forEach(el => { if (el) el.disabled = type === 'cash'; });
  if (longTerm) longTerm.disabled = type === 'cash';
}

async function deleteInvestmentPosition(id) {
  const p = state.investment.positions.find(item => String(item.id) === String(id));
  if (!p) return;
  if (!confirm(`${p.symbol || '종목'}을 포트폴리오에서 삭제할까요?`)) return;
  state.investment.positions = state.investment.positions.filter(item => String(item.id) !== String(id));
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
  const persisted = await saveData();
  if (!persisted) return showToast('서버 저장에 실패했어요. 잠시 후 다시 시도해주세요.');
  showToast('종목을 삭제했어요.');
  openModal('investment-portfolio');
}

async function saveInvestmentRulesFromForm(event) {
  event.preventDefault();
  state.investment.rules = {
    ...state.investment.rules,
    tradingStyle: document.getElementById('ir-style')?.value || 'swing',
    riskPerTrade: Number(document.getElementById('ir-risk-trade')?.value) || 1,
    dailyLossLimit: Number(document.getElementById('ir-daily-loss')?.value) || 3,
    maxDailyTrades: Number(document.getElementById('ir-max-trades')?.value) || 3,
    maxPositionWeight: Number(document.getElementById('ir-max-weight')?.value) || 30,
    minRiskReward: Number(document.getElementById('ir-min-rr')?.value) || 2,
    cooldownMinutes: Number(document.getElementById('ir-cooldown')?.value) || 30,
    chaseLimit: Number(document.getElementById('ir-chase')?.value) || 5,
    noTradeAfterLoss: !!document.getElementById('ir-no-loss')?.checked,
    strictMode: !!document.getElementById('ir-strict')?.checked,
    longTermBias: !!document.getElementById('ir-longterm')?.checked,
    antiAveraging: !!document.getElementById('ir-anti-avg')?.checked,
    entryChecklist: document.getElementById('ir-entry')?.value.trim() || '',
    exitChecklist: document.getElementById('ir-exit')?.value.trim() || '',
    bannedSetups: document.getElementById('ir-banned')?.value.trim() || '',
    coreRules: document.getElementById('ir-core')?.value.trim() || '',
    reviewRoutine: document.getElementById('ir-review')?.value.trim() || '',
  };
  const persisted = await saveData();
  if (!persisted) return showToast('서버 저장에 실패했어요. 잠시 후 다시 저장해주세요.');
  showToast('투자 원칙을 저장했어요.');
  closeModal();
  render();
}

async function runInvestmentGateFromForm(event) {
  event.preventDefault();
  const positionId = document.getElementById('ig-position')?.value;
  const position = state.investment.positions.find(p => p.id === positionId);
  if (!position) return showToast('점검할 종목을 선택해주세요.');

  const action = document.getElementById('ig-action')?.value || 'buy';
  const context = document.getElementById('ig-context')?.value || 'normal';
  const setup = document.getElementById('ig-setup')?.value || 'planned';
  const timeframe = document.getElementById('ig-timeframe')?.value || 'swing';
  const reason = document.getElementById('ig-reason')?.value.trim() || '';
  const tradeShares = parseInvestmentNumber(document.getElementById('ig-shares')?.value);
  const tradePrice = parseInvestmentNumber(document.getElementById('ig-price')?.value);
  const plannedStop = parseInvestmentNumber(document.getElementById('ig-stop')?.value);
  const plannedTarget = parseInvestmentNumber(document.getElementById('ig-target')?.value);
  const riskReward = parseInvestmentNumber(document.getElementById('ig-risk-reward')?.value);
  const orderType = document.getElementById('ig-order-type')?.value || 'limit';
  const invalidation = document.getElementById('ig-invalidation')?.value.trim() || '';
  const checklist = {
    thesis: !!document.getElementById('ig-check-thesis')?.checked,
    risk: !!document.getElementById('ig-check-risk')?.checked,
    size: !!document.getElementById('ig-check-size')?.checked,
    cooldown: !!document.getElementById('ig-check-cooldown')?.checked,
  };
  const verdict = evaluateInvestmentDecision({
    position,
    rules: state.investment.rules,
    totals: investmentTotals(state.investment.positions),
    action,
    context,
    reason: [reason, invalidation, setup === 'impulse' ? '충동 의심' : ''].filter(Boolean).join('\n'),
  });
  enrichInvestmentVerdict(verdict, { setup, riskReward, plannedStop, plannedTarget, checklist, rules: state.investment.rules });

  const decision = {
    id: 'id' + Date.now(),
    createdAt: new Date().toISOString(),
    symbol: position.symbol,
    action,
    context,
    setup,
    timeframe,
    reason,
    invalidation,
    plannedStop,
    plannedTarget,
    riskReward,
    orderType,
    checklist,
    verdict: verdict.status,
    label: verdict.label,
    summary: verdict.summary,
    findings: verdict.findings,
    nextSteps: verdict.nextSteps,
    tradeShares,
    tradePrice,
    tradeKey: typeof buildInvestmentTradeArtifactKey === 'function'
      ? buildInvestmentTradeArtifactKey(position.symbol, action, tradeShares, tradePrice)
      : '',
  };
  if (typeof isDuplicateInvestmentTradeArtifact === 'function' && isDuplicateInvestmentTradeArtifact(position.symbol, action, tradeShares, tradePrice, [reason, verdict.summary].join('\n'))) {
    closeModal();
    showToast('이미 반영된 매매 기록이라 중복 적용하지 않았어요.');
    render();
    return;
  }
  state.investment.decisions.push(decision);
  if (decision.verdict === 'allow' && tradeShares > 0 && tradePrice > 0) {
    const tradeResult = applyTradeToPortfolio(position.id, action, tradeShares, tradePrice);
    decision.cashApplied = true;
    decision.realizedGain = tradeResult?.realizedGain || 0;
    decision.cashDelta = tradeResult?.cashDelta || 0;
    decision.proceeds = tradeResult?.proceeds || 0;
    const cashLine = action === 'sell'
      ? `예수금 ${formatMoneySigned(tradeResult?.proceeds || 0)} · 실현손익 ${formatMoneySigned(tradeResult?.realizedGain || 0)}`
      : `예수금 ${formatMoneySigned(tradeResult?.cashDelta || 0)}`;
    decision.summary = `${decision.summary} 포트폴리오에 ${formatShares(tradeResult?.appliedShares || tradeShares)}주 @ ${formatMoney(tradePrice)} 체결을 반영했습니다. ${cashLine}`;
    try {
      const intentRes = await apiCreateInvestmentOrderIntent({
        symbol: position.symbol,
        action,
        quantity: tradeShares,
        orderType,
        price: tradePrice,
        source: 'investment-gate',
        reason,
      });
      if (intentRes.intent) {
        state.investment.orderIntents = [...(state.investment.orderIntents || []), intentRes.intent];
        decision.orderIntentId = intentRes.intent.id;
        decision.summary += ' 주문 연동용 초안도 생성했습니다.';
      }
      if (intentRes.investment) {
        state.investment = normalizeInvestmentState({
          ...intentRes.investment,
          positions: state.investment.positions,
          decisions: state.investment.decisions,
          events: state.investment.events,
          orderIntents: state.investment.orderIntents,
          account: state.investment.account,
        });
      }
    } catch (e) {
      logger.warn('주문 의도 초안 생성 실패', e);
      decision.summary += ' 주문 초안 생성은 실패했지만 매매 기록은 저장합니다.';
    }
  }
  const persisted = await saveData();
  if (!persisted) return showToast('서버 저장에 실패했어요. 잠시 후 다시 저장해주세요.');
  showToast('판단 기록을 저장했어요.');
  closeModal();
  render();
}

async function addInvestmentNewsFromForm(event) {
  event.preventDefault();
  const symbol = document.getElementById('in-symbol')?.value.trim().toUpperCase() || '';
  const title = document.getElementById('in-title')?.value.trim() || '뉴스 동향';
  const body = document.getElementById('in-body')?.value.trim() || '';
  const date = document.getElementById('in-date')?.value || new Date().toISOString().split('T')[0];
  if (!body) return showToast('뉴스 내용을 입력해주세요.');
  state.investment.events.push({
    id: 'ie' + Date.now(),
    date,
    type: 'news',
    symbol,
    title,
    body,
    severity: 'info',
    linkedDecisionId: null,
    linkedRecordId: null,
  });
  const persisted = await saveData();
  if (!persisted) return showToast('서버 저장에 실패했어요. 잠시 후 다시 저장해주세요.');
  showToast('뉴스 동향에 저장했어요.');
  closeModal();
  render();
}

function fillInvestmentAICompareExample(text) {
  const input = document.getElementById('iac-question');
  if (input) input.value = text;
}

async function runInvestmentAICompare(event) {
  event.preventDefault();
  const input = document.getElementById('iac-question');
  const result = document.getElementById('investment-ai-compare-result');
  const button = document.getElementById('iac-run');
  const question = (input?.value || '').trim();
  if (!question) return showToast('비교할 투자 질문을 입력해주세요.');
  if (button) {
    button.disabled = true;
    button.textContent = '비교 중';
  }
  if (result) result.innerHTML = '<div class="investment-empty">두 모델의 답변을 기다리는 중입니다.</div>';

  try {
    const newsContext = await fetchInvestmentNewsContext(question);
    const systemText = typeof _buildChatSysPrompt === 'function'
      ? _buildChatSysPrompt(false, null, null, newsContext)
      : 'You are an investment behavior-control partner. Do not recommend or guarantee returns.';
    const data = await apiCompareInvestmentAI({
      max_tokens: 700,
      system: [{ type: 'text', text: systemText }],
      messages: [{ role: 'user', content: question }],
    });
    if (result) result.innerHTML = renderInvestmentAICompareResult(data.results || []);
  } catch (e) {
    logger.error('AI 비교 실패', e);
    if (result) result.innerHTML = `<div class="investment-empty">AI 비교에 실패했습니다. ${esc(e.message || '')}</div>`;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '두 모델 비교';
    }
  }
}

function renderInvestmentAICompareResult(results) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return '<div class="investment-empty">비교 결과가 없습니다.</div>';
  return `<div class="investment-ai-compare-grid">
    ${list.map(r => `<article class="investment-ai-card ${r.ok ? 'ok' : 'error'}">
      <header>
        <strong>${esc(r.provider === 'openai' ? 'OpenAI' : 'Claude')}</strong>
        <small>${esc(r.model || (r.ok ? 'model' : 'not configured'))}</small>
      </header>
      ${r.ok
        ? `<div class="chat-markdown">${renderMarkdownBasic(r.text || '')}</div>`
        : `<p class="investment-ai-error">${esc(r.error || '응답 실패')}</p>`}
    </article>`).join('')}
  </div>
  <div class="investment-modal-note">좋은 답변의 기준: 매수/매도 단정이 아니라 원칙 위반, 빠진 정보, 리스크, 다음 확인 행동을 분명히 말하는지 확인하세요.</div>`;
}
