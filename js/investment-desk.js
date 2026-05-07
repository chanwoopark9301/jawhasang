/* =============================================
   Investment Daily Desk
   Depends on state.js, investment-rules.js, investment-portfolio.js
   ============================================= */

function buildDailyInvestmentDesk(investment = state.investment, date = new Date()) {
  const inv = normalizeInvestmentState(investment);
  const today = toInvestmentDeskDate(date);
  const totals = investmentTotals(inv.positions);
  const slices = getInvestmentPortfolioSlices(inv.positions).sort((a, b) => b.value - a.value);
  const tradable = slices.filter(p => !isCashInvestmentPosition(p));
  const cashValue = slices
    .filter(p => isCashInvestmentPosition(p))
    .reduce((sum, p) => sum + p.value, 0);
  const top = tradable[0] || null;
  const maxWeight = Number(inv.rules?.maxPositionWeight) || 30;
  const alerts = buildInvestmentRiskAlerts(inv.positions, inv.rules);
  const events = Array.isArray(inv.events) ? inv.events : [];
  const todayEvents = events
    .filter(e => String(e.date || '') === today)
    .sort(sortInvestmentDeskEvents);
  const upcomingEvents = events
    .filter(e => e.date && String(e.date) >= today && ['earnings', 'macro', 'analyst', 'news', 'signal'].includes(e.type))
    .sort(sortInvestmentDeskEvents)
    .slice(0, 8);
  const recentDecisions = (Array.isArray(inv.decisions) ? inv.decisions : [])
    .slice()
    .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')))
    .slice(0, 8);
  const recentSellDecisions = recentDecisions.filter(d => {
    const action = String(d.action || '').toLowerCase();
    return action === 'sell' && (d.portfolioApplied || d.cashApplied || parseInvestmentNumber(d.tradeShares) > 0);
  });

  const riskSignals = [];
  const forbiddenActions = [];
  const allowedActions = [];
  const checklist = [];

  alerts.forEach(alert => {
    const severity = normalizeInvestmentDeskSeverity(alert.severity);
    riskSignals.push({
      id: `alert-${alert.id || alert.title}`,
      severity,
      symbol: alert.symbol || '',
      title: alert.title || '투자 원칙 경고',
      body: alert.body || '',
      source: 'rule-engine',
      evidence: alert.type || 'rule',
    });
    if (alert.symbol && severity === 'block') {
      forbiddenActions.push({
        id: `no-add-${alert.symbol}`,
        symbol: alert.symbol,
        action: 'buy/add',
        label: `${alert.symbol} 추가매수 금지`,
        reason: alert.title || '투자 원칙 경고',
      });
    }
  });

  if (top && top.weight > maxWeight) {
    riskSignals.push({
      id: `desk-concentration-${top.symbol}`,
      severity: top.weight >= 50 ? 'block' : 'watch',
      symbol: top.symbol,
      title: `${top.symbol} 비중 과다`,
      body: `현재 ${top.symbol} 비중은 ${top.weight.toFixed(1)}%입니다. 기본 한도 ${maxWeight}%를 넘으면 추가매수보다 축소/보유/시나리오 점검이 우선입니다.`,
      source: 'daily-desk',
      evidence: `weight=${top.weight.toFixed(1)} max=${maxWeight}`,
    });
    forbiddenActions.push({
      id: `desk-no-add-concentration-${top.symbol}`,
      symbol: top.symbol,
      action: 'buy/add',
      label: `${top.symbol} 추가매수 금지`,
      reason: `비중 ${top.weight.toFixed(1)}%가 한도 ${maxWeight}%를 초과`,
    });
  }

  todayEvents.forEach(event => {
    const symbol = event.symbol || '';
    const eventType = investmentDeskEventTypeLabel(event.type);
    const title = event.title || eventType;
    riskSignals.push({
      id: `event-${event.id || event.date || today}-${symbol}-${title}`,
      severity: event.type === 'earnings' || event.type === 'macro' ? 'block' : 'watch',
      symbol,
      title: `오늘 이벤트: ${symbol ? `${symbol} ` : ''}${title}`,
      body: `${eventType} 일정이 오늘 있습니다. 매수/추가매수보다 발표 전후 행동 조건을 먼저 정해야 합니다.`,
      source: 'calendar',
      evidence: event.body || event.source || '',
    });
    if (event.type === 'earnings' || event.type === 'macro') {
      forbiddenActions.push({
        id: `desk-no-impulse-event-${symbol || event.type}`,
        symbol,
        action: 'buy/add',
        label: `${symbol ? `${symbol} ` : ''}이벤트 전 충동 매수 금지`,
        reason: `${eventType} 발표 전에는 시나리오별 행동표가 먼저 필요`,
      });
    }
  });

  recentSellDecisions.forEach(decision => {
    const symbol = decision.symbol || '';
    const proceeds = parseInvestmentNumber(decision.tradeShares) * parseInvestmentNumber(decision.tradePrice);
    riskSignals.push({
      id: `recent-sell-${decision.id || symbol}`,
      severity: 'watch',
      symbol,
      title: `${symbol || '최근'} 매도 후 재진입 주의`,
      body: `최근 매도/익절 기록이 있습니다. 현금은 바로 다시 넣을 돈이 아니라 세금 예비금과 재진입 규칙으로 분리해야 합니다.`,
      source: 'trade-history',
      evidence: proceeds ? `estimated_proceeds=${proceeds.toFixed(2)}` : decision.summary || '',
    });
    if (symbol) {
      forbiddenActions.push({
        id: `desk-no-reentry-${symbol}`,
        symbol,
        action: 're-entry',
        label: `${symbol} 즉시 재진입 금지`,
        reason: '최근 매도 후 FOMO 재매수 위험',
      });
    }
  });

  if (cashValue > 0) {
    const cashWeight = totals.totalValue ? (cashValue / totals.totalValue) * 100 : 0;
    allowedActions.push({
      id: 'cash-reserve',
      action: 'reserve',
      label: `현금 ${formatMoney(cashValue)} 유지`,
      reason: `현금 비중 ${cashWeight.toFixed(1)}%. 세금 예비금/재진입 대기 자금으로 분리`,
    });
    checklist.push('매도 이익에서 세금 예비금을 먼저 분리했는지 확인');
  }

  checklist.push('오늘 새 매수 전에 금지 행동 목록을 먼저 확인');
  checklist.push('실적/경제지표 이벤트가 있으면 발표 전·후 행동 기준을 한 줄로 작성');
  checklist.push('포트폴리오 비중이 원칙을 넘는 종목은 추가매수보다 축소 조건을 먼저 논의');

  if (!riskSignals.length) {
    riskSignals.push({
      id: 'desk-no-major-risk',
      severity: 'allow',
      symbol: '',
      title: '큰 위험 신호 없음',
      body: '현재 기록된 포트폴리오와 일정 기준으로 즉시 차단할 위험은 크지 않습니다. 그래도 새 매수 전에는 이유와 손절 조건을 남기세요.',
      source: 'daily-desk',
      evidence: '',
    });
  }

  if (!allowedActions.length) {
    allowedActions.push({
      id: 'scenario-first',
      action: 'plan',
      label: '시나리오 작성',
      reason: '매수/매도 전에 상승·중립·하락별 행동 기준을 먼저 정리',
    });
  }

  return {
    date: today,
    generatedAt: new Date().toISOString(),
    accountSnapshot: {
      totalValue: totals.totalValue,
      totalCost: totals.totalCost,
      totalGain: totals.totalGain,
      totalGainPercent: totals.totalGainPercent,
      cashValue,
      cashWeight: totals.totalValue ? (cashValue / totals.totalValue) * 100 : 0,
      positionCount: tradable.length,
      topSymbol: top?.symbol || '',
      topWeight: top?.weight || 0,
    },
    riskSignals: dedupeInvestmentDeskItems(riskSignals).sort(sortInvestmentDeskSignals),
    forbiddenActions: dedupeInvestmentDeskItems(forbiddenActions),
    allowedActions: dedupeInvestmentDeskItems(allowedActions),
    todayEvents,
    upcomingEvents,
    recentDecisions,
    checklist: Array.from(new Set(checklist)),
  };
}

function renderDailyDeskBrief(desk) {
  if (!desk) return 'Daily Investment Desk: unavailable';
  const snapshot = desk.accountSnapshot || {};
  const risks = (desk.riskSignals || []).slice(0, 5)
    .map(r => `- [${r.severity}] ${r.symbol ? `${r.symbol}: ` : ''}${r.title} | ${r.body}`)
    .join('\n') || '- no major risk';
  const blocked = (desk.forbiddenActions || []).slice(0, 6)
    .map(a => `- ${a.symbol ? `${a.symbol}: ` : ''}${a.label} (${a.reason})`)
    .join('\n') || '- none';
  const allowed = (desk.allowedActions || []).slice(0, 4)
    .map(a => `- ${a.label}: ${a.reason}`)
    .join('\n') || '- scenario planning only';
  const events = (desk.todayEvents || []).slice(0, 5)
    .map(e => `- ${e.date} [${e.type}] ${e.symbol || ''} ${e.title || ''}`)
    .join('\n') || '- none';
  return `Daily Investment Desk (${desk.date})
Account:
- totalValue=${Number(snapshot.totalValue || 0).toFixed(2)}
- cash=${Number(snapshot.cashValue || 0).toFixed(2)} (${Number(snapshot.cashWeight || 0).toFixed(1)}%)
- top=${snapshot.topSymbol || 'none'} ${Number(snapshot.topWeight || 0).toFixed(1)}%
Risk signals:
${risks}
Forbidden actions:
${blocked}
Allowed actions:
${allowed}
Today events:
${events}`;
}

function toInvestmentDeskDate(date) {
  if (typeof date === 'string') return date.slice(0, 10);
  if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function sortInvestmentDeskEvents(a, b) {
  return String(a.date || '').localeCompare(String(b.date || '')) ||
    String(a.symbol || '').localeCompare(String(b.symbol || '')) ||
    String(a.title || '').localeCompare(String(b.title || ''));
}

function sortInvestmentDeskSignals(a, b) {
  const rank = { block: 0, watch: 1, allow: 2 };
  return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) ||
    String(a.symbol || '').localeCompare(String(b.symbol || ''));
}

function normalizeInvestmentDeskSeverity(severity) {
  return severity === 'block' ? 'block' : severity === 'allow' ? 'allow' : 'watch';
}

function investmentDeskEventTypeLabel(type) {
  const labels = {
    earnings: '실적 발표',
    macro: '경제 지표',
    analyst: '애널리스트 업데이트',
    news: '뉴스',
    signal: '시장 신호',
  };
  return labels[type] || '투자 일정';
}

function dedupeInvestmentDeskItems(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter(item => {
    const key = item.id || `${item.symbol || ''}-${item.action || ''}-${item.title || item.label || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
