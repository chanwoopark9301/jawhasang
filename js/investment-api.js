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

async function apiFetchInvestmentNews(symbols, limit = 3) {
  const clean = [...new Set((symbols || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean))];
  if (!clean.length) return { news: [], requested: [] };

  const res = await fetch(`/api/investment/news?symbols=${encodeURIComponent(clean.join(','))}&limit=${limit}`, {
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
