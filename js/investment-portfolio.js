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

function getTradableInvestmentSlices(positions) {
  return getInvestmentPortfolioSlices(positions)
    .filter(p => !isCashInvestmentPosition(p) && parseInvestmentNumber(p.shares) > 0);
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
    .filter(p => !isCashInvestmentPosition(p) && parseInvestmentNumber(p.shares) > 0 && investmentPositionValue(p, 'currentPrice') <= 0);
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
  state.investment = normalizeInvestmentState(state.investment);
  const idx = state.investment.positions.findIndex(p => String(p.id) === String(positionId));
  if (idx < 0) return;
  const p = state.investment.positions[idx];
  const oldShares = parseInvestmentNumber(p.shares);
  const oldAvg = parseInvestmentNumber(p.avgPrice);
  const oldCost = oldShares * oldAvg;
  const hadCash = hasInvestmentCashPosition();
  const accountTotal = getInvestmentAccountTotalAtExecution(positionId, tradePrice);
  let nextShares = oldShares;
  let nextAvg = oldAvg;

  if (action === 'buy' || action === 'add') {
    nextShares = oldShares + tradeShares;
    nextAvg = nextShares ? (oldCost + tradeShares * tradePrice) / nextShares : tradePrice;
  } else if (action === 'sell') {
    const appliedShares = Math.min(tradeShares, oldShares);
    if (appliedShares <= 0) return;
    nextShares = Math.max(0, oldShares - appliedShares);
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
  if (action === 'sell' || hadCash || parseInvestmentNumber(state.investment.account?.totalCapital) > 0) {
    rebalanceInvestmentCashToAccountTotal(accountTotal);
  }
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
}

function hasInvestmentCashPosition() {
  return (state.investment.positions || []).some(p => isCashInvestmentPosition(p) && String(p.currency || 'USD').toUpperCase() === 'USD');
}

function getInvestmentAccountTotalAtExecution(positionId, tradePrice) {
  const executionPrice = parseInvestmentNumber(tradePrice);
  return (state.investment.positions || []).reduce((sum, position) => {
    if (String(position.id) === String(positionId) && executionPrice > 0) {
      return sum + parseInvestmentNumber(position.shares) * executionPrice;
    }
    return sum + investmentPositionValue(position, 'currentPrice');
  }, 0);
}

function rebalanceInvestmentCashToAccountTotal(accountTotal) {
  const targetTotal = parseInvestmentNumber(accountTotal);
  if (targetTotal <= 0) return null;
  const nonCashValue = (state.investment.positions || [])
    .filter(p => !isCashInvestmentPosition(p))
    .reduce((sum, p) => sum + investmentPositionValue(p, 'currentPrice'), 0);
  const cashAmount = Math.max(0, targetTotal - nonCashValue);
  const cash = setInvestmentCashAmount(cashAmount);
  state.investment.account = {
    ...(state.investment.account || {}),
    totalCapital: targetTotal,
    baseCurrency: 'USD',
    lastRebalancedAt: new Date().toISOString(),
  };
  return cash;
}

function setInvestmentCashAmount(amount) {
  const cashAmount = Math.max(0, parseInvestmentNumber(amount));
  const idx = state.investment.positions.findIndex(p => isCashInvestmentPosition(p) && String(p.currency || 'USD').toUpperCase() === 'USD');
  const now = new Date().toISOString();
  if (cashAmount <= 0 && idx >= 0 && (state.investment.positions[idx].id === 'ip-cash-auto' || state.investment.positions[idx].autoTradeCash)) {
    state.investment.positions.splice(idx, 1);
    return null;
  }
  const previous = idx >= 0 ? state.investment.positions[idx] : {};
  const next = {
    ...previous,
    id: previous.id || 'ip-cash-auto',
    assetType: 'cash',
    symbol: previous.symbol || 'CASH',
    name: previous.name || '현금',
    shares: cashAmount,
    avgPrice: 1,
    currentPrice: 1,
    cashAmount,
    autoTradeCash: previous.autoTradeCash || previous.id === 'ip-cash-auto' || idx < 0,
    manualPrice: true,
    currency: 'USD',
    marketUpdatedAt: now,
  };
  if (idx >= 0) state.investment.positions[idx] = next;
  else state.investment.positions.push(next);
  return next;
}

function applyTradeCashDelta(delta) {
  const amount = parseInvestmentNumber(delta);
  if (!amount) return null;
  state.investment = normalizeInvestmentState(state.investment);
  const idx = state.investment.positions.findIndex(p => isCashInvestmentPosition(p) && String(p.currency || 'USD').toUpperCase() === 'USD');
  const now = new Date().toISOString();
  if (idx >= 0) {
    const p = state.investment.positions[idx];
    const next = Math.max(0, parseInvestmentNumber(p.cashAmount ?? p.shares) + amount);
    state.investment.positions[idx] = {
      ...p,
      assetType: 'cash',
      symbol: p.symbol || 'CASH',
      name: p.name || '현금',
      shares: next,
      avgPrice: 1,
      currentPrice: 1,
      cashAmount: next,
      autoTradeCash: p.autoTradeCash || p.id === 'ip-cash-auto',
      manualPrice: true,
      currency: 'USD',
      marketUpdatedAt: now,
    };
    return state.investment.positions[idx];
  }
  if (amount < 0) return null;
  const cash = {
    id: 'ip-cash-auto',
    assetType: 'cash',
    symbol: 'CASH',
    name: '현금',
    shares: amount,
    avgPrice: 1,
    currentPrice: 1,
    cashAmount: amount,
    autoTradeCash: true,
    manualPrice: true,
    currency: 'USD',
    marketUpdatedAt: now,
  };
  state.investment.positions.push(cash);
  return cash;
}

function reconcileCashFromAppliedSellDecisions() {
  state.investment = normalizeInvestmentState(state.investment);
  repairOverSoldPositionsFromResidualDecisions();
  const cashIdx = state.investment.positions.findIndex(p => isCashInvestmentPosition(p) && (p.id === 'ip-cash-auto' || p.autoTradeCash));
  const sells = (state.investment.decisions || []).filter(d =>
    d && d.portfolioApplied && d.action === 'sell' &&
    parseInvestmentNumber(d.tradeShares) > 0 && parseInvestmentNumber(d.tradePrice) > 0
  );
  if (!sells.length) return false;
  const total = dedupeInvestmentSellDecisions(sells)
    .reduce((sum, d) => sum + parseInvestmentNumber(d.tradeShares) * parseInvestmentNumber(d.tradePrice), 0);
  if (total <= 0) return false;
  if (cashIdx >= 0) {
    const cash = state.investment.positions[cashIdx];
    if (Math.abs(parseInvestmentNumber(cash.cashAmount ?? cash.shares) - total) < 0.01) {
      sells.forEach(d => { d.cashApplied = true; });
      return false;
    }
    state.investment.positions[cashIdx] = {
      ...cash,
      assetType: 'cash',
      symbol: cash.symbol || 'CASH',
      name: cash.name || '현금',
      shares: total,
      avgPrice: 1,
      currentPrice: 1,
      cashAmount: total,
      autoTradeCash: true,
      manualPrice: true,
      currency: 'USD',
      marketUpdatedAt: new Date().toISOString(),
    };
  } else {
    applyTradeCashDelta(total);
  }
  sells.forEach(d => { d.cashApplied = true; });
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
  return true;
}

function dedupeInvestmentSellDecisions(sells) {
  const seen = new Set();
  return (Array.isArray(sells) ? sells : []).filter(d => {
    const key = [
      String(d.symbol || '').toUpperCase(),
      parseInvestmentNumber(d.tradeShares).toFixed(4),
      parseInvestmentNumber(d.tradePrice).toFixed(2),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function repairOverSoldPositionsFromResidualDecisions() {
  let changed = false;
  (state.investment.positions || []).forEach(position => {
    if (isCashInvestmentPosition(position)) return;
    if (parseInvestmentNumber(position.shares) > 0) return;
    const symbol = String(position.symbol || '').toUpperCase();
    if (!symbol) return;
    const residualDecision = (state.investment.decisions || [])
      .slice()
      .reverse()
      .find(d => String(d.symbol || '').toUpperCase() === symbol && d.action === 'sell' && extractResidualShares(d.summary || d.reason || '') > 0);
    if (!residualDecision) return;
    const residual = extractResidualShares(residualDecision.summary || residualDecision.reason || '');
    if (residual <= 0) return;
    const avg = extractInvestmentNumberNearLabel(residualDecision.summary || '', /(?:평단|avg|average)/i) || parseInvestmentNumber(position.avgPrice);
    const current = extractInvestmentNumberNearLabel(residualDecision.summary || '', /(?:현재|잔여 평가액|current)/i) || parseInvestmentNumber(residualDecision.tradePrice) || parseInvestmentNumber(position.currentPrice);
    position.shares = residual;
    position.avgPrice = avg || position.avgPrice || 0;
    position.currentPrice = current || position.currentPrice || 0;
    position.manualPrice = true;
    position.marketUpdatedAt = new Date().toISOString();
    changed = true;
  });
  return changed;
}

function extractInvestmentNumberNearLabel(text, labelPattern) {
  const raw = String(text || '');
  const line = raw.split(/\r?\n/).find(item => labelPattern.test(item));
  if (!line) return 0;
  const match = line.match(/[$]?\s*([0-9][0-9,.]*)/);
  return match ? parseInvestmentNumber(match[1]) : 0;
}
