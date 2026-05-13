/* =============================================
   Investment Ledger Engine
   Single write gate for portfolio/cash/quote mutations.
   ============================================= */

const INVESTMENT_LEDGER_SOURCE_AUTHORITY = {
  broker: 100,
  user_confirmed: 90,
  user_form: 85,
  trade_fill: 80,
  market_data: 50,
  imported_file: 45,
  ai_extract: 20,
  ai_reply: 10,
  rendered_view: 0,
};

function investmentLedgerSourceAuthority(source) {
  const key = String(source || '').trim() || 'unknown';
  return INVESTMENT_LEDGER_SOURCE_AUTHORITY[key] ?? 0;
}

function applyInvestmentLedgerCommand(investment, command = {}) {
  const inv = normalizeInvestmentState(investment || {});
  const type = String(command.type || '').trim();
  const authority = investmentLedgerSourceAuthority(command.source);
  const result = {
    ok: false,
    rejected: false,
    reason: '',
    investment: inv,
    changes: [],
    symbols: [],
  };

  if (!type) return { ...result, rejected: true, reason: 'missing_command_type' };
  if (type === 'quoteUpdate') return applyInvestmentLedgerQuoteUpdate(inv, command, result);
  if (type === 'portfolioSnapshot') {
    if (authority < INVESTMENT_LEDGER_SOURCE_AUTHORITY.user_confirmed) {
      return { ...result, rejected: true, reason: 'insufficient_authority_for_snapshot' };
    }
    return applyInvestmentLedgerPortfolioSnapshot(inv, command, result);
  }
  if (type === 'setCash') {
    if (authority < INVESTMENT_LEDGER_SOURCE_AUTHORITY.user_confirmed) {
      return { ...result, rejected: true, reason: 'insufficient_authority_for_cash' };
    }
    return applyInvestmentLedgerSetCash(inv, command, result);
  }
  return { ...result, rejected: true, reason: 'unknown_command_type' };
}

function applyInvestmentLedgerPortfolioSnapshot(inv, command, result) {
  const now = new Date().toISOString();
  const snapshots = Array.isArray(command.positions) ? command.positions : [];
  const handled = new Set();

  snapshots.forEach(snapshot => {
    const symbol = String(snapshot.symbol || '').trim().toUpperCase();
    if (!symbol || symbol === 'CASH') return;
    const shares = parseInvestmentNumber(snapshot.shares);
    const avgPrice = parseInvestmentNumber(snapshot.avgPrice);
    const marketValueUsd = parseInvestmentNumber(snapshot.marketValueUsd);
    let currentPrice = parseInvestmentNumber(snapshot.currentPrice);
    if (shares <= 0 && avgPrice <= 0 && currentPrice <= 0 && marketValueUsd <= 0) return;

    const idx = (inv.positions || []).findIndex(p =>
      !isCashInvestmentPosition(p) && String(p.symbol || '').toUpperCase() === symbol
    );
    const previous = idx >= 0 ? inv.positions[idx] : {};
    const effectiveShares = shares > 0 ? shares : parseInvestmentNumber(previous.shares);
    if (currentPrice <= 0 && marketValueUsd > 0 && effectiveShares > 0) {
      currentPrice = Math.round((marketValueUsd / effectiveShares) * 10000) / 10000;
    }
    const next = {
      ...previous,
      id: previous.id || `ip-${symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
      assetType: previous.assetType || snapshot.assetType || (isInvestmentCryptoSymbol(symbol) ? 'crypto' : 'stock'),
      symbol,
      name: previous.name || snapshot.name || symbol,
      shares: effectiveShares,
      avgPrice: avgPrice > 0 ? avgPrice : parseInvestmentNumber(previous.avgPrice),
      currentPrice: currentPrice > 0 ? currentPrice : parseInvestmentNumber(previous.currentPrice),
      manualPrice: currentPrice > 0 ? true : previous.manualPrice,
      marketUpdatedAt: currentPrice > 0 ? now : previous.marketUpdatedAt,
      ledgerSource: command.source || 'user_confirmed',
      ledgerUpdatedAt: now,
    };
    if (idx >= 0) inv.positions[idx] = next;
    else inv.positions.push(next);
    handled.add(symbol);
    result.changes.push(`${symbol} ${[
      shares > 0 ? `shares=${shares}` : '',
      avgPrice > 0 ? `avgPrice=${avgPrice}` : '',
      currentPrice > 0 ? `currentPrice=${currentPrice}` : '',
    ].filter(Boolean).join(', ')}`);
  });

  if (command.cashUsd != null && parseInvestmentNumber(command.cashUsd) >= 0) {
    investmentLedgerSetCashPosition(inv, parseInvestmentNumber(command.cashUsd), command.source || 'user_confirmed');
    result.changes.push(`CASH ${formatMoney(parseInvestmentNumber(command.cashUsd))}`);
    handled.add('CASH');
  }
  if (command.usdKrwRate != null && parseInvestmentNumber(command.usdKrwRate) > 0) {
    inv.usdKrwRate = parseInvestmentNumber(command.usdKrwRate);
    inv.usdKrwUpdatedAt = now;
    inv.usdKrwSource = command.source || 'user_confirmed';
    result.changes.push(`USD/KRW ${inv.usdKrwRate}`);
  }

  const onlySymbols = Array.isArray(command.onlySymbols)
    ? new Set(command.onlySymbols.map(symbol => String(symbol || '').toUpperCase()).filter(Boolean))
    : null;
  if (onlySymbols?.size) {
    handled.forEach(symbol => { if (symbol !== 'CASH') onlySymbols.add(symbol); });
    const before = inv.positions.length;
    inv.positions = inv.positions.filter(position =>
      isCashInvestmentPosition(position) || onlySymbols.has(String(position.symbol || '').toUpperCase())
    );
    if (inv.positions.length !== before) {
      result.changes.push(`positions rebuilt: ${[...onlySymbols].sort().join(', ')}`);
    }
  }

  inv.alerts = buildInvestmentRiskAlerts(inv.positions, inv.rules);
  return {
    ...result,
    ok: result.changes.length > 0,
    symbols: [...handled],
  };
}

function applyInvestmentLedgerQuoteUpdate(inv, command, result) {
  const now = new Date().toISOString();
  const quotes = Array.isArray(command.quotes) ? command.quotes : [];
  const handled = new Set();
  quotes.forEach(quote => {
    const symbol = String(quote.symbol || '').trim().toUpperCase();
    if (!symbol) return;
    if (symbol === 'USDKRW=X' && parseInvestmentNumber(quote.price) > 0) {
      inv.usdKrwRate = parseInvestmentNumber(quote.price);
      inv.usdKrwUpdatedAt = now;
      inv.usdKrwSource = command.source || 'market_data';
      result.changes.push(`USD/KRW ${inv.usdKrwRate}`);
      handled.add(symbol);
      return;
    }
    const position = (inv.positions || []).find(p =>
      !isCashInvestmentPosition(p) && String(p.symbol || '').toUpperCase() === symbol
    );
    if (!position) return;
    const price = parseInvestmentNumber(quote.price);
    if (price <= 0) return;
    if (position.manualPrice && !command.forceCurrentPrice) {
      position.lastMarketPrice = price;
      position.lastMarketUpdatedAt = now;
      if (quote.changePercent != null) position.changePercent = parseInvestmentNumber(quote.changePercent);
      result.changes.push(`${symbol} lastMarketPrice=${price}`);
      handled.add(symbol);
      return;
    }
    position.currentPrice = price;
    if (quote.previousClose != null) position.previousClose = parseInvestmentNumber(quote.previousClose);
    if (quote.changePercent != null) position.changePercent = parseInvestmentNumber(quote.changePercent);
    position.marketUpdatedAt = now;
    position.marketSource = command.source || 'market_data';
    result.changes.push(`${symbol} currentPrice=${price}`);
    handled.add(symbol);
  });
  inv.alerts = buildInvestmentRiskAlerts(inv.positions, inv.rules);
  return {
    ...result,
    ok: result.changes.length > 0,
    symbols: [...handled],
  };
}

function applyInvestmentLedgerSetCash(inv, command, result) {
  const amount = parseInvestmentNumber(command.amount);
  if (amount < 0) return { ...result, rejected: true, reason: 'invalid_cash_amount' };
  investmentLedgerSetCashPosition(inv, amount, command.source || 'user_confirmed');
  inv.alerts = buildInvestmentRiskAlerts(inv.positions, inv.rules);
  return {
    ...result,
    ok: true,
    changes: [`CASH ${formatMoney(amount)}`],
    symbols: ['CASH'],
  };
}

function investmentLedgerSetCashPosition(inv, amount, source = 'user_confirmed') {
  const cashAmount = Math.max(0, parseInvestmentNumber(amount));
  const now = new Date().toISOString();
  const idx = (inv.positions || []).findIndex(p =>
    isCashInvestmentPosition(p) && String(p.currency || 'USD').toUpperCase() === 'USD'
  );
  if (cashAmount <= 0 && idx >= 0 && (inv.positions[idx].id === 'ip-cash-auto' || inv.positions[idx].autoTradeCash)) {
    inv.positions.splice(idx, 1);
    return null;
  }
  const previous = idx >= 0 ? inv.positions[idx] : {};
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
    ledgerSource: source,
    ledgerUpdatedAt: now,
  };
  if (idx >= 0) inv.positions[idx] = next;
  else inv.positions.push(next);
  return next;
}
