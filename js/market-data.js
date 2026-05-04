/* =============================================
   投資 파트너 — 시장 데이터 연결
   의존성: state.js, data.js, investment-rules.js
   ============================================= */

const INVESTMENT_INDEX_SYMBOLS = ['^IXIC', '^GSPC'];

async function fetchMarketQuotes(symbols) {
  const data = await fetchMarketQuoteData(symbols);
  return data.quotes || [];
}

async function fetchMarketQuoteData(symbols) {
  const clean = [...new Set((symbols || [])
    .map(s => String(s || '').trim().toUpperCase())
    .filter(Boolean))];
  if (!clean.length) return { requested: [], quotes: [] };

  const res = await fetch(`/api/market/quote?symbols=${encodeURIComponent(clean.join(','))}`, {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`market quote failed: ${res.status}`);
  const data = await res.json();
  return { ...data, requested: data.requested || clean, quotes: data.quotes || [] };
}

async function refreshInvestmentMarketData() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const positionSymbols = inv.positions.map(p => p.symbol).filter(Boolean);
  const symbols = [...positionSymbols, ...INVESTMENT_INDEX_SYMBOLS];
  if (!symbols.length) {
    showToast('조회할 종목이 없습니다.');
    return;
  }

  try {
    const data = await fetchMarketQuoteData(symbols);
    applyInvestmentQuotes(data.quotes);
    saveData();
    const found = new Set((data.quotes || []).map(q => String(q.symbol || '').toUpperCase()));
    const missing = symbols.filter(sym => !found.has(String(sym).toUpperCase()));
    if (missing.length) {
      showToast(`현재가 일부만 갱신했어요: ${missing.join(', ')} 확인 필요`);
    } else {
      showToast('현재가와 위험 신호를 갱신했어요.');
    }
    render();
  } catch (e) {
    logger.warn('시장 데이터 갱신 실패', e);
    showToast('시장 데이터 갱신에 실패했어요.');
  }
}

function applyInvestmentQuotes(quotes) {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const map = {};
  (quotes || []).forEach(q => { if (q.symbol) map[String(q.symbol).toUpperCase()] = q; });

  inv.positions.forEach(p => {
    const q = map[String(p.symbol || '').toUpperCase()];
    if (!q) return;
    if (q.price != null) p.currentPrice = Number(q.price);
    if (q.previousClose != null) p.previousClose = Number(q.previousClose);
    if (q.changePercent != null) p.changePercent = Number(q.changePercent);
    p.marketUpdatedAt = new Date().toISOString();
    p.marketSource = 'yahoo-finance';
  });

  inv.market = {
    source: 'yahoo-finance',
    fetchedAt: new Date().toISOString(),
    indexes: INVESTMENT_INDEX_SYMBOLS
      .map(sym => map[sym])
      .filter(Boolean),
  };
  inv.alerts = buildInvestmentRiskAlerts(inv.positions, inv.rules);
}
