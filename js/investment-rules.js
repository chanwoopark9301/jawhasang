/* =============================================
   投資 파트너 — 룰 엔진
   의존성: state.js
   ============================================= */

function investmentTotals(positions) {
  const list = Array.isArray(positions) ? positions : [];
  const totalValue = list.reduce((sum, p) => {
    return sum + (Number(p.shares) || 0) * (Number(p.currentPrice) || 0);
  }, 0);
  return { totalValue };
}

function evaluateInvestmentDecision({ position, rules, totals, action, context, reason }) {
  const p = position || {};
  const r = { ...defaultInvestmentState().rules, ...(rules || {}) };
  const t = totals || investmentTotals(state.investment?.positions || []);
  const findings = [];
  let score = 0;

  const avg = Number(p.avgPrice) || 0;
  const cur = Number(p.currentPrice) || 0;
  const shares = Number(p.shares) || 0;
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
