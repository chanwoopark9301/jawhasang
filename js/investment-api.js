/* =============================================
   Investment API client
   Keeps investment server calls out of render code.
   ============================================= */

async function apiSaveInvestmentPosition(position, retries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      logger.info('투자 종목 저장 요청', {
        symbol: position?.symbol,
        attempt: attempt + 1,
        maxAttempts: retries + 1,
      });

      const res = await fetch('/api/investment/positions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position }),
      });

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : {};
      } catch (parseError) {
        throw new Error(`HTTP ${res.status} non-json response: ${text.slice(0, 160)}`);
      }

      if (!res.ok || !data.ok) {
        const detail = data?.error || text || `HTTP ${res.status}`;
        const requestId = data?.requestId ? ` requestId=${data.requestId}` : '';
        const diagnostic = [
          data?.errorType,
          data?.storageType ? `storage=${data.storageType}` : '',
          data?.errorDetail,
        ].filter(Boolean).join(' | ');
        throw new Error(`investment position save failed: ${detail}${requestId}${diagnostic ? ` | ${diagnostic}` : ''}`);
      }

      logger.info('투자 종목 저장 완료', {
        symbol: data.position?.symbol,
        id: data.position?.id,
        requestId: data.requestId,
      });
      return data;
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        logger.warn('투자 종목 저장 재시도 %d/%d', attempt + 1, retries, e);
        await _delay(350 * (attempt + 1));
      }
    }
  }
  logger.error('투자 종목 서버 저장 실패', lastError);
  return { ok: false, error: lastError?.message || '투자 종목 서버 저장 실패' };
}

async function apiFetchInvestmentNews(symbols, limit = 3, queries = []) {
  const clean = [...new Set((symbols || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean))];
  const cleanQueries = [...new Set((queries || []).map(q => String(q || '').trim()).filter(Boolean))];
  if (!clean.length && !cleanQueries.length) return { news: [], requested: [], requestedQueries: [] };
  const params = new URLSearchParams({ limit: String(limit) });
  if (clean.length) params.set('symbols', clean.join(','));
  if (cleanQueries.length) params.set('query', cleanQueries.join('||'));

  const res = await fetch(`/api/investment/news?${params.toString()}`, {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' },
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    logger.error('투자 뉴스 API 비 JSON 응답', { status: res.status, body: text.slice(0, 160) });
    throw new Error(`investment news failed: ${res.status}`);
  }

  if (!res.ok) {
    logger.error('투자 뉴스 API 실패', { status: res.status, data });
    throw new Error(data?.error || `investment news failed: ${res.status}`);
  }

  return data;
}

async function apiCompareInvestmentAI(payload) {
  const res = await fetch('/api/investment/ai-compare', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`AI compare returned non-json: ${res.status}`);
  }
  if (!res.ok) throw new Error(data?.error || `AI compare failed: ${res.status}`);
  return data;
}

async function apiCreateInvestmentOrderIntent(payload) {
  const res = await fetch('/api/investment/order-intent', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data?.error || `order intent failed: ${res.status}`);
  return data;
}

async function apiEvaluateInvestmentTradeGate(payload) {
  const res = await fetch('/api/investment/trade-gate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`investment trade gate returned non-json: ${res.status}`);
  }
  if (!res.ok || !data.ok) throw new Error(data?.error || `investment trade gate failed: ${res.status}`);
  return data;
}

async function apiCreateInvestmentTransaction(transaction) {
  const res = await fetch('/api/investment/transactions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`investment transaction returned non-json: ${res.status}`);
  }
  if (!res.ok || !data.ok) throw new Error(data?.error || `investment transaction failed: ${res.status}`);
  return data;
}

async function apiFetchInvestmentLedgerSnapshot() {
  const res = await fetch('/api/investment/ledger', {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`investment ledger returned non-json: ${res.status}`);
  }
  if (!res.ok || !data.ok) throw new Error(data?.error || `investment ledger failed: ${res.status}`);
  return data;
}

async function apiBuildInvestmentDeskEngine(payload = {}) {
  const res = await fetch('/api/investment/desk/engine', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`investment desk engine returned non-json: ${res.status}`);
  }
  if (!res.ok || !data.ok) throw new Error(data?.error || `investment desk engine failed: ${res.status}`);
  return data;
}

async function apiSyncKisBroker(days = 30) {
  const res = await fetch('/api/investment/broker/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`KIS sync returned non-json: ${res.status}`);
  }
  if (!res.ok || !data.ok) {
    const missing = Array.isArray(data?.missing) ? ` (${data.missing.join(', ')})` : '';
    throw new Error(`${data?.message || data?.error || `KIS sync failed: ${res.status}`}${missing}`);
  }
  return data;
}

async function apiSyncInvestmentCalendar(days = 45) {
  const res = await fetch('/api/investment/calendar/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`investment calendar sync returned non-json: ${res.status}`);
  }
  if (!res.ok || !data.ok) throw new Error(data?.error || `investment calendar sync failed: ${res.status}`);
  return data;
}

async function apiSyncInvestmentXSignals(watchlist = null) {
  const payload = Array.isArray(watchlist) ? { watchlist } : {};
  const res = await fetch('/api/investment/x/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`X signal sync returned non-json: ${res.status}`);
  }
  if (!res.ok || !data.ok) {
    const missing = Array.isArray(data?.missing) ? ` (${data.missing.join(', ')})` : '';
    throw new Error(`${data?.message || data?.error || `X signal sync failed: ${res.status}`}${missing}`);
  }
  return data;
}
