/* =============================================
   投資 파트너 — 시장 데이터 연결
   의존성: state.js, data.js, investment-rules.js
   ============================================= */

const INVESTMENT_INDEX_SYMBOLS = ['^IXIC', '^GSPC'];
const INVESTMENT_SYMBOL_ALIASES = {
  CIRCLE: 'CRCL',
  CIRCLEINTERNETGROUP: 'CRCL',
  CRCL: 'CRCL',
  '써클': 'CRCL',
  '써클인터넷그룹': 'CRCL',
  ETH: 'ETH-USD',
  ETHEREUM: 'ETH-USD',
  '이더리움': 'ETH-USD',
  BTC: 'BTC-USD',
  BITCOIN: 'BTC-USD',
  '비트코인': 'BTC-USD',
  SOL: 'SOL-USD',
  SOLANA: 'SOL-USD',
  XRP: 'XRP-USD',
  USDKRW: 'USDKRW=X',
  'USD/KRW': 'USDKRW=X',
  'USDKRW=X': 'USDKRW=X',
  KRW: 'USDKRW=X',
};

function normalizeInvestmentMarketSymbol(symbol) {
  const raw = String(symbol || '').trim();
  if (!raw) return '';
  const parenthesized = raw.match(/\(([A-Za-z0-9.\-^=]{1,16})\)/);
  const candidate = parenthesized ? parenthesized[1] : raw;
  const compact = candidate.replace(/\s+/g, '');
  const upper = compact.toUpperCase();
  return INVESTMENT_SYMBOL_ALIASES[upper] || INVESTMENT_SYMBOL_ALIASES[compact] || upper;
}

async function fetchMarketQuotes(symbols) {
  const data = await fetchMarketQuoteData(symbols);
  return data.quotes || [];
}

async function fetchMarketQuoteData(symbols) {
  const clean = [...new Set((symbols || [])
    .map(s => normalizeInvestmentMarketSymbol(s))
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
  const buttons = document.querySelectorAll('#investment-refresh-market, #investment-modal-refresh-market');
  buttons.forEach(btn => {
    btn.disabled = true;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = '갱신 중';
  });
  const positionSymbols = inv.positions
    .filter(p => !isCashInvestmentPosition(p))
    .map(p => p.symbol)
    .filter(Boolean);
  const symbols = [...positionSymbols, ...INVESTMENT_INDEX_SYMBOLS, 'USDKRW=X'];
  if (!symbols.length) {
    showToast('조회할 종목이 없습니다.');
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '현재가 갱신';
    });
    return;
  }

  try {
    const data = await fetchMarketQuoteData(symbols);
    applyInvestmentQuotes(data.quotes, { forceCurrentPrice: true });
    await saveData();
    const found = new Set((data.quotes || []).map(q => String(q.symbol || '').toUpperCase()));
    const missing = symbols.filter(sym => !found.has(String(sym).toUpperCase()));
    if (missing.length) {
      showToast(`현재가 일부만 갱신했어요: ${missing.join(', ')} 확인 필요`);
    } else {
      showToast('현재가와 위험 신호를 갱신했어요.');
    }
    render();
    if (state.activeModal === 'investment-portfolio') openModal('investment-portfolio');
  } catch (e) {
    logger.warn('시장 데이터 갱신 실패', e);
    showToast('시장 데이터 갱신에 실패했어요.');
  } finally {
    buttons.forEach(btn => {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '현재가 갱신';
    });
  }
}

function applyInvestmentQuotes(quotes, options = {}) {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const map = {};
  (quotes || []).forEach(q => { if (q.symbol) map[String(q.symbol).toUpperCase()] = q; });
  const result = applyInvestmentLedgerCommand(inv, {
    type: 'quoteUpdate',
    source: 'market_data',
    quotes,
    forceCurrentPrice: !!options.forceCurrentPrice,
  });
  state.investment = result.investment;
  const target = state.investment;
  target.market = {
    source: 'yahoo-finance',
    fetchedAt: new Date().toISOString(),
    indexes: INVESTMENT_INDEX_SYMBOLS
      .map(sym => map[sym])
      .filter(Boolean),
  };
  target.alerts = buildInvestmentRiskAlerts(target.positions, target.rules);
}
