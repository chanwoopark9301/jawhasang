/* =============================================
   投資 파트너 — 화면 렌더링 및 액션
   의존성: state.js, utils.js, data.js, investment-rules.js
   ============================================= */

function renderInvestmentView() {
  const inv = normalizeInvestmentState(state.investment);
  state.investment = inv;
  const totals = investmentTotals(inv.positions);
  const last = inv.decisions.at(-1);
  const messages = state.currentChatMessages || [];
  const alerts = inv.alerts || buildInvestmentRiskAlerts(inv.positions, inv.rules);

  return `<div class="investment-view" id="investment-view">
    <section class="investment-hero" id="investment-portfolio-summary">
      <div>
        <div class="investment-kicker">투자 기록 기반 행동 통제</div>
        <h2>포트폴리오 요약</h2>
      </div>
      <div class="investment-total">
        <span>포트폴리오</span>
        <strong>${formatMoney(totals.totalValue)}</strong>
        <button class="investment-refresh-btn" id="investment-refresh-market" onclick="refreshInvestmentMarketData()">현재가 갱신</button>
      </div>
    </section>

    ${renderInvestmentIndexes(inv.market?.indexes || [])}

    <section class="investment-summary-grid">
      <div class="investment-summary-card">
        <span>보유 종목</span>
        <strong>${inv.positions.length}</strong>
      </div>
      <div class="investment-summary-card">
        <span>투자 원칙</span>
        <strong>${inv.rules.coreRules ? '설정됨' : '초안 필요'}</strong>
      </div>
      <div class="investment-summary-card">
        <span>매매 기록</span>
        <strong>${inv.decisions.length}</strong>
      </div>
      <div class="investment-summary-card">
        <span>뉴스 동향</span>
        <strong>${inv.events.filter(e => e.type === 'news').length}</strong>
      </div>
      <div class="investment-summary-card">
        <span>위험 신호</span>
        <strong>${alerts.length}</strong>
      </div>
    </section>

    ${renderInvestmentAlerts(alerts)}
    ${renderInvestmentPositions(inv.positions, totals)}
    ${last ? renderInvestmentVerdict(last) : ''}

    <section class="investment-chat-surface">
      ${messages.length
        ? `<div class="chat-messages" id="chat-messages">${messages.map(m => renderChatBubble(m)).join('')}</div>`
        : '<div class="empty-state">대화를 시작해보세요</div>'}
    </section>
  </div>`;
}

function renderInvestmentIndexes(indexes) {
  const list = Array.isArray(indexes) ? indexes : [];
  if (!list.length) return '';
  return `<section class="investment-index-strip">
    ${list.map(q => `<div class="investment-index">
      <span>${esc(q.symbol === '^IXIC' ? 'NASDAQ' : q.symbol === '^GSPC' ? 'S&P 500' : q.symbol)}</span>
      <strong>${formatMoney(q.price)}</strong>
      <em class="${Number(q.changePercent) >= 0 ? 'up' : 'down'}">${formatPercent(q.changePercent)}</em>
    </div>`).join('')}
  </section>`;
}

function renderInvestmentAlerts(alerts) {
  const list = Array.isArray(alerts) ? alerts : [];
  if (!list.length) return '';
  return `<section class="investment-alerts">
    <div class="investment-section-head">
      <h3>오늘의 위험 신호</h3>
      <span>${list.length}건</span>
    </div>
    ${list.map(a => `<div class="investment-alert ${esc(a.severity || 'watch')}">
      <strong>${esc(a.title)}</strong>
      <p>${esc(a.body)}</p>
    </div>`).join('')}
  </section>`;
}

function renderInvestmentPositions(positions, totals) {
  if (!positions.length) {
    return '<div class="investment-empty">종목을 등록하면 매매 전 점검에서 원칙 위반 여부를 계산할 수 있어요.</div>';
  }
  return `<div class="investment-position-list">
    ${positions.map(p => {
      const value = (Number(p.shares) || 0) * (Number(p.currentPrice) || 0);
      const weight = totals.totalValue ? (value / totals.totalValue) * 100 : 0;
      const hasPrice = p.currentPrice != null && Number(p.currentPrice) > 0;
      return `<div class="investment-position">
        <div>
          <strong>${esc(p.symbol || '-')}</strong>
          <span>${esc(p.name || '')}${p.manualPrice ? ' · 수동 현재가' : ''}</span>
        </div>
        <div class="investment-position-meta">
          <span>${hasPrice ? formatMoney(value) : '현재가 미조회'}</span>
          <span>${hasPrice ? `${weight.toFixed(1)}% · ${formatPercent(p.changePercent)}` : '현재가 갱신 필요'}</span>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function getInvestmentPortfolioSlices(positions) {
  const rows = (Array.isArray(positions) ? positions : [])
    .map((p, index) => ({
      ...p,
      value: (Number(p.shares) || 0) * (Number(p.currentPrice) || 0),
      color: investmentSliceColor(index),
    }))
    .filter(p => p.value > 0);
  const total = rows.reduce((sum, p) => sum + p.value, 0);
  return rows.map(p => ({ ...p, weight: total ? (p.value / total) * 100 : 0, total }));
}

function renderModalInvestmentPortfolio() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const slices = getInvestmentPortfolioSlices(inv.positions);
  const total = slices.reduce((sum, p) => sum + p.value, 0);
  if (!slices.length) {
    return `
      <button class="modal-close" onclick="closeModal()">×</button>
      <div class="modal-title">포트폴리오</div>
      <div class="investment-empty">현재가와 수량이 있는 종목을 등록하면 원형 차트로 비중을 볼 수 있어요.</div>`;
  }

  let cursor = 0;
  const gradient = slices.map(p => {
    const start = cursor;
    const end = cursor + (p.weight / 100) * 360;
    cursor = end;
    return `${p.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
  }).join(', ');

  return `
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-title">포트폴리오</div>
    <div class="investment-portfolio-modal" id="investment-portfolio-modal">
      <div class="investment-pie-wrap">
        <div class="investment-pie-chart" style="background: conic-gradient(${gradient});">
          <div>
            <span>총 평가액</span>
            <strong>${formatMoney(total)}</strong>
          </div>
        </div>
      </div>
      <div class="investment-portfolio-list">
        ${slices.map(p => `<div class="investment-portfolio-row">
          <span class="investment-dot" style="background:${p.color}"></span>
          <div>
            <strong>${esc(p.symbol || p.name || '종목')}</strong>
            <small>${esc(p.name || '')}</small>
          </div>
          <em>${p.weight.toFixed(1)}%</em>
          <b>${formatMoney(p.value)}</b>
        </div>`).join('')}
      </div>
    </div>`;
}

function renderInvestmentPositionForm() {
  return `<form class="investment-form" id="investment-position-form" onsubmit="addInvestmentPositionFromForm(event)">
    <div class="investment-form-row">
      <input class="form-input" id="ip-symbol" placeholder="종목 코드" autocomplete="off">
      <input class="form-input" id="ip-name" placeholder="종목명" autocomplete="off">
    </div>
    <div class="investment-form-row">
      <input class="form-input" id="ip-shares" type="number" min="0" step="0.0001" placeholder="수량">
      <input class="form-input" id="ip-avg" type="number" min="0" step="0.01" placeholder="평균 단가">
      <input class="form-input" id="ip-current" type="number" min="0" step="0.01" placeholder="현재가(선택)">
    </div>
    <div class="investment-form-row">
      <input class="form-input" id="ip-target" type="number" min="0" step="0.01" placeholder="목표가">
      <input class="form-input" id="ip-stop" type="number" min="0" step="0.01" placeholder="손절가">
      <label class="investment-check"><input id="ip-longterm" type="checkbox"> 장기보유</label>
    </div>
    <textarea class="form-input investment-textarea" id="ip-thesis" placeholder="투자 논리"></textarea>
    <textarea class="form-input investment-textarea" id="ip-add-rule" placeholder="추가매수 조건"></textarea>
    <button class="btn-primary investment-primary" id="investment-add-position" type="submit">종목 등록</button>
  </form>`;
}

function renderModalInvestmentPositions() {
  const inv = state.investment;
  return `
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-title">종목 관리</div>
    ${renderInvestmentPositions(inv.positions, investmentTotals(inv.positions))}
    ${renderInvestmentPositionForm()}`;
}

function renderInvestmentRulesForm(rules) {
  return `<form class="investment-form" onsubmit="saveInvestmentRulesFromForm(event)">
    <label>하루 손실 한도<input class="form-input" id="ir-daily-loss" type="number" step="0.1" value="${esc(rules.dailyLossLimit)}"></label>
    <label>종목별 최대 비중<input class="form-input" id="ir-max-weight" type="number" step="0.1" value="${esc(rules.maxPositionWeight)}"></label>
    <label>쿨다운 시간<input class="form-input" id="ir-cooldown" type="number" step="1" value="${esc(rules.cooldownMinutes)}"></label>
    <label>추격매수 제한 기준<input class="form-input" id="ir-chase" type="number" step="0.1" value="${esc(rules.chaseLimit)}"></label>
    <label class="investment-check"><input id="ir-strict" type="checkbox" ${rules.strictMode ? 'checked' : ''}> 엄격 모드</label>
    <label class="investment-check"><input id="ir-longterm" type="checkbox" ${rules.longTermBias ? 'checked' : ''}> 장기보유 논리 우선</label>
    <label class="investment-check"><input id="ir-anti-avg" type="checkbox" ${rules.antiAveraging ? 'checked' : ''}> 감정적 물타기 제한</label>
    <textarea class="form-input investment-textarea" id="ir-core" placeholder="내 핵심 투자 원칙">${esc(rules.coreRules || '')}</textarea>
    <button class="btn-primary investment-primary" id="investment-save-rules" type="submit">원칙 저장</button>
  </form>`;
}

function renderModalInvestmentRules() {
  return `
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-title">투자 원칙</div>
    <div class="investment-modal-note">대화창에서 AI와 논의한 뒤 "이걸 투자 원칙으로 저장해줘"라고 말해도 반영됩니다.</div>
    ${renderInvestmentRulesForm(state.investment.rules)}`;
}

function renderInvestmentGateForm(positions) {
  return `<form class="investment-form" id="investment-gate-form" onsubmit="runInvestmentGateFromForm(event)">
    <select class="form-input" id="ig-position" ${positions.length ? '' : 'disabled'}>
      ${positions.length
        ? positions.map(p => `<option value="${esc(p.id)}">${esc(p.symbol || p.name || p.id)}</option>`).join('')
        : '<option value="">등록된 종목 없음</option>'}
    </select>
    <div class="investment-form-row">
      <select class="form-input" id="ig-action">
        <option value="buy">매수</option>
        <option value="add">추가매수</option>
        <option value="sell">매도</option>
        <option value="hold">보유</option>
      </select>
      <select class="form-input" id="ig-context">
        <option value="normal">일반</option>
        <option value="drop">급락</option>
        <option value="rally">급등</option>
        <option value="loss">손실 직후</option>
        <option value="target">목표가 근접</option>
      </select>
    </div>
    <textarea class="form-input investment-textarea" id="ig-reason" placeholder="지금 이 행동을 하려는 이유"></textarea>
    <button class="btn-primary investment-primary" id="investment-gate-run" type="submit" ${positions.length ? '' : 'disabled'}>점검하기</button>
  </form>`;
}

function renderModalInvestmentDecisions() {
  return `
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-title">매매 기록</div>
    <div class="investment-modal-note">매매 전 점검은 여기서 직접 실행하거나, 대화창에서 먼저 논의한 뒤 기록으로 남길 수 있어요.</div>
    ${renderInvestmentGateForm(state.investment.positions)}
    <div id="investment-result">${state.investment.decisions.length ? renderInvestmentVerdict(state.investment.decisions.at(-1)) : ''}</div>
    ${renderInvestmentDecisionList(state.investment.decisions)}`;
}

function renderModalInvestmentNews() {
  const news = state.investment.events.filter(e => e.type === 'news').slice().reverse();
  return `
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-title">뉴스 동향</div>
    <div class="investment-modal-note">대화창에서 "내 보유 주식 관련 최신 뉴스 있니?"라고 묻고, "뉴스 동향에 기록해줘"라고 말하면 여기에 저장됩니다.</div>
    <form class="investment-form" id="investment-news-form" onsubmit="addInvestmentNewsFromForm(event)">
      <div class="investment-form-row">
        <input class="form-input" id="in-symbol" placeholder="종목 코드" autocomplete="off">
        <input class="form-input" id="in-title" placeholder="뉴스 제목" autocomplete="off">
        <input class="form-input" id="in-date" type="date" value="${new Date().toISOString().split('T')[0]}">
      </div>
      <textarea class="form-input investment-textarea" id="in-body" placeholder="뉴스 내용과 나의 해석"></textarea>
      <button class="btn-primary investment-primary" type="submit">뉴스 저장</button>
    </form>
    <div class="investment-decision-list">
      ${news.length ? news.map(e => `<div class="investment-decision">
        <span class="investment-badge allow">뉴스</span>
        <strong>${esc(e.symbol || '투자')} · ${esc(e.title || '뉴스 동향')}</strong>
        <p>${esc(e.body || '')}</p>
        <small>${esc(e.date || '')}</small>
      </div>`).join('') : '<div class="investment-empty">저장된 뉴스 동향이 없습니다.</div>'}
    </div>`;
}

function renderInvestmentVerdict(decision) {
  const cls = decision.verdict || decision.status;
  const label = decision.label || (cls === 'block' ? '차단 권고' : cls === 'cooldown' ? '쿨다운 필요' : '진행 가능');
  const findings = decision.findings || [];
  const nextSteps = decision.nextSteps || [];
  return `<div class="investment-verdict ${esc(cls)}">
    <div class="investment-verdict-label">${esc(label)}</div>
    <div class="investment-verdict-summary">${esc(decision.summary || '')}</div>
    <ul>${findings.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    ${nextSteps.length ? `<div class="investment-next">${nextSteps.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
  </div>`;
}

function renderInvestmentDecisionList(decisions) {
  if (!decisions.length) return '<div class="investment-empty">아직 매매 전 점검 기록이 없습니다.</div>';
  return `<div class="investment-decision-list">
    ${decisions.slice().reverse().map(d => `<div class="investment-decision">
      <span class="investment-badge ${esc(d.verdict)}">${esc(d.label)}</span>
      <strong>${esc(d.symbol)} · ${investmentActionLabel(d.action)}</strong>
      <p>${esc(d.summary || '')}</p>
      <small>${esc((d.createdAt || '').slice(0, 16).replace('T', ' '))}</small>
    </div>`).join('')}
  </div>`;
}

async function addInvestmentPositionFromForm(event) {
  event.preventDefault();
  const symbol = document.getElementById('ip-symbol')?.value.trim().toUpperCase();
  if (!symbol) return showToast('종목 코드를 입력해주세요.');
  const manualCurrentRaw = document.getElementById('ip-current')?.value.trim() || '';
  const manualCurrent = manualCurrentRaw ? Number(manualCurrentRaw) : null;
  if (manualCurrentRaw && (!Number.isFinite(manualCurrent) || manualCurrent <= 0)) {
    return showToast('현재가는 0보다 큰 숫자로 입력해주세요.');
  }
  const button = document.getElementById('investment-add-position');
  if (button) {
    button.disabled = true;
    button.textContent = '현재가 조회 중';
  }

  const position = {
    id: 'ip' + (state.investment.positions.length + 1),
    symbol,
    name: document.getElementById('ip-name')?.value.trim() || symbol,
    shares: Number(document.getElementById('ip-shares')?.value) || 0,
    avgPrice: Number(document.getElementById('ip-avg')?.value) || 0,
    currentPrice: manualCurrent,
    manualPrice: manualCurrent != null,
    targetPrice: Number(document.getElementById('ip-target')?.value) || 0,
    stopPrice: Number(document.getElementById('ip-stop')?.value) || 0,
    longTerm: !!document.getElementById('ip-longterm')?.checked,
    thesis: document.getElementById('ip-thesis')?.value.trim() || '',
    addRule: document.getElementById('ip-add-rule')?.value.trim() || '',
    marketSource: manualCurrent != null ? 'manual' : '',
  };
  state.investment.positions.push(position);
  state.selInvestmentPosition = position.id;
  let hasQuote = false;
  if (manualCurrent == null) {
    try {
      const quotes = await fetchMarketQuotes([symbol]);
      applyInvestmentQuotes(quotes);
      hasQuote = quotes.some(q => String(q.symbol || '').toUpperCase() === symbol);
    } catch (e) {
      logger.warn('종목 등록 현재가 조회 실패', e);
    }
  }
  if (button) button.textContent = 'DB 저장 중';
  const persisted = await saveData();
  if (!persisted) {
    showToast('서버 저장에 실패했어요. 잠시 후 다시 저장해주세요.');
    if (button) {
      button.disabled = false;
      button.textContent = '종목 등록';
    }
    return;
  }
  showToast(manualCurrent != null ? '보유 종목을 수동 현재가로 등록했어요.' : hasQuote ? '보유 종목을 등록하고 현재가를 가져왔어요.' : '종목은 등록했지만 현재가를 찾지 못했어요. 티커를 확인해주세요.');
  closeModal();
  render();
}

async function saveInvestmentRulesFromForm(event) {
  event.preventDefault();
  state.investment.rules = {
    dailyLossLimit: Number(document.getElementById('ir-daily-loss')?.value) || 3,
    maxPositionWeight: Number(document.getElementById('ir-max-weight')?.value) || 30,
    cooldownMinutes: Number(document.getElementById('ir-cooldown')?.value) || 30,
    chaseLimit: Number(document.getElementById('ir-chase')?.value) || 5,
    strictMode: !!document.getElementById('ir-strict')?.checked,
    longTermBias: !!document.getElementById('ir-longterm')?.checked,
    antiAveraging: !!document.getElementById('ir-anti-avg')?.checked,
    coreRules: document.getElementById('ir-core')?.value.trim() || '',
  };
  const persisted = await saveData();
  if (!persisted) return showToast('서버 저장에 실패했어요. 잠시 후 다시 저장해주세요.');
  showToast('투자 원칙을 저장했어요.');
  closeModal();
  render();
}

async function runInvestmentGateFromForm(event) {
  event.preventDefault();
  const positionId = document.getElementById('ig-position')?.value;
  const position = state.investment.positions.find(p => p.id === positionId);
  if (!position) return showToast('점검할 종목을 선택해주세요.');

  const action = document.getElementById('ig-action')?.value || 'buy';
  const context = document.getElementById('ig-context')?.value || 'normal';
  const reason = document.getElementById('ig-reason')?.value.trim() || '';
  const verdict = evaluateInvestmentDecision({
    position,
    rules: state.investment.rules,
    totals: investmentTotals(state.investment.positions),
    action,
    context,
    reason,
  });

  const decision = {
    id: 'id' + Date.now(),
    createdAt: new Date().toISOString(),
    symbol: position.symbol,
    action,
    context,
    reason,
    verdict: verdict.status,
    label: verdict.label,
    summary: verdict.summary,
    findings: verdict.findings,
    nextSteps: verdict.nextSteps,
  };
  state.investment.decisions.push(decision);
  state.investment.events.push({
    id: 'ie' + Date.now(),
    date: new Date().toISOString().split('T')[0],
    type: decision.verdict === 'allow' ? 'trade' : 'alert',
    symbol: position.symbol,
    title: `${position.symbol} ${decision.label}`,
    body: decision.summary,
    severity: decision.verdict === 'block' ? 'block' : decision.verdict === 'cooldown' ? 'watch' : 'info',
    linkedDecisionId: decision.id,
    linkedRecordId: null,
  });
  const persisted = await saveData();
  if (!persisted) return showToast('서버 저장에 실패했어요. 잠시 후 다시 저장해주세요.');
  showToast('판단 기록을 저장했어요.');
  closeModal();
  render();
}

async function addInvestmentNewsFromForm(event) {
  event.preventDefault();
  const symbol = document.getElementById('in-symbol')?.value.trim().toUpperCase() || '';
  const title = document.getElementById('in-title')?.value.trim() || '뉴스 동향';
  const body = document.getElementById('in-body')?.value.trim() || '';
  const date = document.getElementById('in-date')?.value || new Date().toISOString().split('T')[0];
  if (!body) return showToast('뉴스 내용을 입력해주세요.');
  state.investment.events.push({
    id: 'ie' + Date.now(),
    date,
    type: 'news',
    symbol,
    title,
    body,
    severity: 'info',
    linkedDecisionId: null,
    linkedRecordId: null,
  });
  const persisted = await saveData();
  if (!persisted) return showToast('서버 저장에 실패했어요. 잠시 후 다시 저장해주세요.');
  showToast('뉴스 동향에 저장했어요.');
  closeModal();
  render();
}

function formatMoney(value) {
  const n = Number(value) || 0;
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function investmentActionLabel(action) {
  return ({ buy: '매수', add: '추가매수', sell: '매도', hold: '보유' })[action] || action;
}

function investmentSliceColor(index) {
  return [
    '#2563EB', '#1D9E75', '#EF9F27', '#DC2626', '#7C3AED',
    '#0891B2', '#65A30D', '#DB2777', '#4F46E5', '#EA580C',
  ][index % 10];
}
