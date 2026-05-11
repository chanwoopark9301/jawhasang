/* =============================================
   投資 파트너 — 룰 엔진
   의존성: state.js
   ============================================= */

function parseInvestmentNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).trim().replace(/,/g, '');
  const parsed = Number(cleaned);
  if (Number.isFinite(parsed)) return parsed;
  const firstNumber = cleaned.match(/-?\d+(?:\.\d+)?/);
  const fallback = firstNumber ? Number(firstNumber[0]) : 0;
  return Number.isFinite(fallback) ? fallback : 0;
}

function isCashInvestmentPosition(position) {
  return String(position?.assetType || '').toLowerCase() === 'cash';
}

function investmentPositionValue(position, priceKey = 'currentPrice') {
  if (isCashInvestmentPosition(position)) {
    const cash = parseInvestmentNumber(position?.cashAmount ?? position?.shares);
    return String(position?.currency || '').toUpperCase() === 'KRW'
      ? cash / (parseInvestmentNumber(state?.investment?.usdKrwRate) || 1350)
      : cash;
  }
  const shares = parseInvestmentNumber(position?.shares);
  const price = parseInvestmentNumber(position?.[priceKey]);
  const value = shares * price;
  return String(position?.currency || '').toUpperCase() === 'KRW'
    ? value / (parseInvestmentNumber(state?.investment?.usdKrwRate) || 1350)
    : value;
}

function investmentTotals(positions) {
  const list = Array.isArray(positions) ? positions : [];
  const totalValue = list.reduce((sum, p) => sum + investmentPositionValue(p, 'currentPrice'), 0);
  const totalCost = list.reduce((sum, p) => sum + investmentPositionValue(p, 'avgPrice'), 0);
  const totalGain = totalValue - totalCost;
  const totalGainPercent = totalCost ? (totalGain / totalCost) * 100 : 0;
  return { totalValue, totalCost, totalGain, totalGainPercent };
}

function buildInvestmentRiskAlerts(positions, rules) {
  const list = Array.isArray(positions) ? positions : [];
  const r = { ...defaultInvestmentState().rules, ...(rules || {}) };
  const totals = investmentTotals(list);
  const alerts = [];

  list.forEach(p => {
    if (isCashInvestmentPosition(p)) return;
    const symbol = p.symbol || '종목';
    const price = parseInvestmentNumber(p.currentPrice);
    const target = parseInvestmentNumber(p.targetPrice);
    const stop = parseInvestmentNumber(p.stopPrice);
    const change = parseInvestmentNumber(p.changePercent);
    const value = investmentPositionValue(p, 'currentPrice');
    const weight = totals.totalValue ? (value / totals.totalValue) * 100 : 0;

    if (target > 0 && price >= target * 0.97) {
      alerts.push({
        id: `target-${symbol}`,
        type: 'target',
        severity: price >= target ? 'block' : 'watch',
        symbol,
        title: `${symbol} 목표가 근접`,
        body: `현재가 ${formatPriceForRule(price)}가 목표가 ${formatPriceForRule(target)}의 3% 이내입니다. 익절 미루기인지 점검하세요.`,
      });
    }

    if (stop > 0 && price <= stop * 1.05) {
      alerts.push({
        id: `stop-${symbol}`,
        type: 'stop',
        severity: price <= stop ? 'block' : 'watch',
        symbol,
        title: `${symbol} 손절가 근접`,
        body: `현재가 ${formatPriceForRule(price)}가 손절가 ${formatPriceForRule(stop)}의 5% 이내입니다. 투자 논리 훼손 여부를 먼저 확인하세요.`,
      });
    }

    if (change <= -Math.abs(Number(r.dailyLossLimit) || 3)) {
      alerts.push({
        id: `drop-${symbol}`,
        type: 'drop',
        severity: 'watch',
        symbol,
        title: `${symbol} 급락 주의`,
        body: `오늘 ${change.toFixed(2)}% 하락했습니다. 공포 매도나 감정적 물타기를 분리해서 보세요.`,
      });
    }

    if (change >= Math.abs(Number(r.chaseLimit) || 5)) {
      alerts.push({
        id: `rally-${symbol}`,
        type: 'rally',
        severity: 'watch',
        symbol,
        title: `${symbol} 추격매수 주의`,
        body: `오늘 ${change.toFixed(2)}% 상승했습니다. 추가매수는 추격매수 제한 기준과 비교하세요.`,
      });
    }

    const maxWeight = Number(r.maxPositionWeight) || 30;
    if (weight > maxWeight) {
      alerts.push({
        id: `weight-${symbol}`,
        type: 'weight',
        severity: 'block',
        symbol,
        title: `${symbol} 비중 초과`,
        body: `현재 비중 ${weight.toFixed(1)}%가 한도 ${maxWeight}%를 넘었습니다.`,
      });
    }
  });

  return alerts;
}

function formatPriceForRule(value) {
  const n = Number(value) || 0;
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function evaluateInvestmentDecision({ position, rules, totals, action, context, reason }) {
  const p = position || {};
  const r = { ...defaultInvestmentState().rules, ...(rules || {}) };
  const t = totals || investmentTotals(state.investment?.positions || []);
  const findings = [];
  let score = 0;

  const avg = parseInvestmentNumber(p.avgPrice);
  const cur = parseInvestmentNumber(p.currentPrice);
  const shares = parseInvestmentNumber(p.shares);
  const ret = avg > 0 ? ((cur - avg) / avg) * 100 : 0;
  const value = shares * cur;
  const weight = t.totalValue ? (value / t.totalValue) * 100 : 0;
  const text = (reason || '').trim();
  const shortReason = text.length < 35;

  if (shortReason) {
    score += 2;
    findings.push('투자 근거가 짧습니다. 감정적 주문일 가능성이 있습니다.');
  }

  if (context === 'loss') {
    score += 3;
    findings.push(`손실 직후에는 ${Number(r.cooldownMinutes) || 30}분 쿨다운이 우선입니다.`);
  }

  if (context === 'rally' && (action === 'buy' || action === 'add')) {
    score += 3;
    findings.push(`급등 후 추격매수는 ${Number(r.chaseLimit) || 5}% 기준을 넘기면 제한합니다.`);
  }

  if (context === 'drop' && action === 'add' && r.antiAveraging) {
    score += 3;
    findings.push('급락 직후 추가매수는 계획된 분할매수와 감정적 물타기를 구분해야 합니다.');
  }

  if (action === 'add' && ret < 0 && !text.includes('조건') && !text.includes('논리')) {
    score += 2;
    findings.push('추가매수 근거에 사전 조건이나 투자 논리 유지 여부가 부족합니다.');
  }

  if (action === 'sell' && p.longTerm && r.longTermBias && context === 'drop') {
    score += 2;
    findings.push('장기보유 종목은 급락 즉시 매도보다 투자 논리 훼손 여부 확인이 먼저입니다.');
  }

  if (context === 'target' && action === 'hold') {
    score += 2;
    findings.push('목표 수익 도달 후 보유는 익절 미루기인지 확인해야 합니다.');
  }

  const maxWeight = Number(r.maxPositionWeight) || 30;
  if (weight > maxWeight && (action === 'buy' || action === 'add')) {
    score += 4;
    findings.push(`현재 비중 ${weight.toFixed(2)}%가 한도 ${maxWeight}%를 초과했습니다.`);
  }

  if (!findings.length) {
    findings.push('현재 입력만 보면 원칙 위반 신호가 크지 않습니다.');
  }

  let status = 'allow';
  if (score >= 6) status = 'block';
  else if (score >= 3) status = 'cooldown';

  return {
    status,
    label: status === 'block' ? '차단 권고' : status === 'cooldown' ? '쿨다운 필요' : '진행 가능',
    findings,
    nextSteps: getInvestmentNextSteps(status, r),
    summary: findings[0],
    score,
  };
}

function getInvestmentNextSteps(status, rules) {
  if (status === 'block') {
    return [
      '오늘은 주문하지 말고 판단 기록만 남깁니다.',
      `${Number(rules.cooldownMinutes) || 30}분 뒤 같은 근거가 유지되는지 다시 확인합니다.`,
      '사전에 적은 투자 논리와 조건을 먼저 보강합니다.',
    ];
  }
  if (status === 'cooldown') {
    return [
      `${Number(rules.cooldownMinutes) || 30}분 쿨다운 후 다시 점검합니다.`,
      '추가매수라면 계획된 분할매수 조건을 문장으로 확인합니다.',
    ];
  }
  return [
    '주문 전 가격, 비중, 손절 기준을 한 번 더 확인합니다.',
    '실행했다면 결과와 이유를 판단 기록에 남깁니다.',
  ];
}
