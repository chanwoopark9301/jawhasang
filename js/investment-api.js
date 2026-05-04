/* =============================================
   投資 API 클라이언트
   투자 화면의 서버 호출을 렌더링 코드와 분리한다.
   ============================================= */

async function apiSaveInvestmentPosition(position, retries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch('/api/investment/positions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'investment position save failed');
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
  return null;
}

async function apiFetchInvestmentNews(symbols, limit = 3) {
  const clean = [...new Set((symbols || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean))];
  if (!clean.length) return { news: [], requested: [] };
  const res = await fetch(`/api/investment/news?symbols=${encodeURIComponent(clean.join(','))}&limit=${limit}`, {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`investment news failed: ${res.status}`);
  return res.json();
}
