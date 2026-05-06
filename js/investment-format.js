/* =============================================
   투자 파트너 — 표시 포맷터
   의존성: state.js, investment-rules.js
   ============================================= */

function formatMoney(value) {
  const n = parseInvestmentNumber(value);
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMoneySigned(value) {
  const n = parseInvestmentNumber(value);
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function investmentUsdKrwRate() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  return parseInvestmentNumber(inv.usdKrwRate) || 1350;
}

function formatKrwApprox(value, signed = false) {
  const n = parseInvestmentNumber(value);
  if (!n) return '';
  const sign = signed ? (n > 0 ? '+' : n < 0 ? '-' : '') : '';
  const amount = Math.round(Math.abs(n) * investmentUsdKrwRate()).toLocaleString('ko-KR');
  return `<small class="investment-krw-approx">약 ${sign}₩${amount}</small>`;
}

function formatKrwApproxText(value, signed = false) {
  const n = parseInvestmentNumber(value);
  if (!n) return '약 ₩0';
  const sign = signed ? (n > 0 ? '+' : n < 0 ? '-' : '') : '';
  const amount = Math.round(Math.abs(n) * investmentUsdKrwRate()).toLocaleString('ko-KR');
  return `약 ${sign}₩${amount}`;
}

function formatShares(value) {
  const n = parseInvestmentNumber(value);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatDateTimeShort(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const n = parseInvestmentNumber(value);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function investmentActionLabel(action) {
  return ({ buy: '매수', add: '추가매수', sell: '매도', hold: '보유' })[action] || action;
}

function investmentSetupLabel(setup) {
  return ({
    planned: '계획 셋업',
    breakout: '돌파',
    pullback: '눌림목',
    earnings: '실적/이벤트',
    rebalance: '리밸런싱',
    impulse: '충동 의심',
  })[setup] || '셋업';
}

function investmentTimeframeLabel(timeframe) {
  return ({
    intraday: '당일',
    swing: '수일~수주',
    position: '수개월',
    long: '장기',
  })[timeframe] || '시간축';
}

function investmentSliceColor(index) {
  return [
    '#2563EB', '#1D9E75', '#EF9F27', '#DC2626', '#7C3AED',
    '#0891B2', '#65A30D', '#DB2777', '#4F46E5', '#EA580C',
  ][index % 10];
}
