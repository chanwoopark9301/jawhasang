/* =============================================
   투자 파트너 — 포트폴리오 계산/병합
   의존성: state.js, investment-rules.js, investment-format.js
   ============================================= */

function getInvestmentPortfolioSlices(positions) {
  const rows = (Array.isArray(positions) ? positions : [])
    .map((p, index) => ({
      ...p,
      shares: parseInvestmentNumber(p.shares),
      avgPrice: parseInvestmentNumber(p.avgPrice),
      currentPrice: parseInvestmentNumber(p.currentPrice),
      cost: investmentPositionValue(p, 'avgPrice'),
      value: investmentPositionValue(p, 'currentPrice'),
      color: investmentSliceColor(index),
    }))
    .filter(p => p.value > 0);
  const total = rows.reduce((sum, p) => sum + p.value, 0);
  return rows.map(p => ({ ...p, weight: total ? (p.value / total) * 100 : 0, total }));
}

function getInvestmentUnpricedPositions(positions) {
  return (Array.isArray(positions) ? positions : [])
    .map(p => ({
      ...p,
      shares: parseInvestmentNumber(p.shares),
      avgPrice: parseInvestmentNumber(p.avgPrice),
      currentPrice: p.currentPrice == null ? null : parseInvestmentNumber(p.currentPrice),
      cost: investmentPositionValue(p, 'avgPrice'),
    }))
    .filter(p => !isCashInvestmentPosition(p) && investmentPositionValue(p, 'currentPrice') <= 0);
}

function mergeInvestmentAfterPositionSave(currentInvestment, savedInvestment) {
  const current = normalizeInvestmentState(currentInvestment);
  const saved = normalizeInvestmentState(savedInvestment);
  const merged = [...current.positions];
  saved.positions.forEach(incoming => {
    const idx = merged.findIndex(item =>
      String(item.id || '') === String(incoming.id || '') ||
      (item.symbol && incoming.symbol && String(item.symbol).toUpperCase() === String(incoming.symbol).toUpperCase())
    );
    if (idx >= 0) merged[idx] = { ...merged[idx], ...incoming };
    else merged.push(incoming);
  });
  return normalizeInvestmentState({ ...current, ...saved, positions: merged });
}

function applyTradeToPortfolio(positionId, action, tradeShares, tradePrice) {
  const idx = state.investment.positions.findIndex(p => String(p.id) === String(positionId));
  if (idx < 0) return;
  const p = state.investment.positions[idx];
  const oldShares = parseInvestmentNumber(p.shares);
  const oldAvg = parseInvestmentNumber(p.avgPrice);
  const oldCost = oldShares * oldAvg;
  let nextShares = oldShares;
  let nextAvg = oldAvg;

  if (action === 'buy' || action === 'add') {
    nextShares = oldShares + tradeShares;
    nextAvg = nextShares ? (oldCost + tradeShares * tradePrice) / nextShares : tradePrice;
  } else if (action === 'sell') {
    nextShares = Math.max(0, oldShares - tradeShares);
    nextAvg = nextShares > 0 ? oldAvg : 0;
  } else {
    return;
  }

  state.investment.positions[idx] = {
    ...p,
    shares: nextShares,
    avgPrice: nextAvg,
    currentPrice: tradePrice,
    manualPrice: true,
    marketUpdatedAt: new Date().toISOString(),
  };
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
}
