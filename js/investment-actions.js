/* =============================================
   투자 파트너 — 폼 액션/저장
   의존성: state.js, data.js, investment-api.js, market-data.js, investment-rules.js, investment-portfolio.js
   ============================================= */

async function addInvestmentPositionFromForm(event) {
  event.preventDefault();
  const assetType = document.getElementById('ip-asset-type')?.value || 'stock';
  let symbol = normalizeInvestmentMarketSymbol(document.getElementById('ip-symbol')?.value);
  if (assetType === 'cash' && !symbol) symbol = 'CASH';
  if (!symbol) return showToast('종목 코드를 입력해주세요.');
  const button = document.getElementById('investment-add-position');
  if (button) {
    button.disabled = true;
    button.textContent = '현재가 조회 중';
  }

  const editId = document.getElementById('ip-id')?.value || '';
  const existing = editId ? state.investment.positions.find(p => String(p.id) === String(editId)) : null;
  const position = {
    ...(existing || {}),
    id: editId || ('ip' + (state.investment.positions.length + 1)),
    assetType,
    symbol,
    name: document.getElementById('ip-name')?.value.trim() || (assetType === 'cash' ? '현금' : symbol),
    shares: parseInvestmentNumber(document.getElementById('ip-shares')?.value),
    avgPrice: parseInvestmentNumber(document.getElementById('ip-avg')?.value),
    currentPrice: existing?.currentPrice ?? null,
    manualPrice: existing?.manualPrice || false,
    targetPrice: parseInvestmentNumber(document.getElementById('ip-target')?.value),
    stopPrice: parseInvestmentNumber(document.getElementById('ip-stop')?.value),
    longTerm: !!document.getElementById('ip-longterm')?.checked,
    thesis: document.getElementById('ip-thesis')?.value.trim() || '',
    addRule: document.getElementById('ip-add-rule')?.value.trim() || '',
    marketSource: '',
  };
  if (assetType === 'cash') {
    position.shares = parseInvestmentNumber(document.getElementById('ip-shares')?.value);
    position.avgPrice = 1;
    position.currentPrice = 1;
    position.cashAmount = position.shares;
    position.manualPrice = true;
    position.currency = 'USD';
  }
  if (existing) {
    state.investment.positions = state.investment.positions.map(p => String(p.id) === String(position.id) ? position : p);
  } else {
    state.investment.positions.push(position);
  }
  state.selInvestmentPosition = position.id;
  let hasQuote = false;
  try {
    if (assetType !== 'cash') {
      const quotes = await fetchMarketQuotes([symbol]);
      applyInvestmentQuotes(quotes);
      hasQuote = quotes.some(q => String(q.symbol || '').toUpperCase() === symbol);
    } else {
      hasQuote = true;
    }
  } catch (e) {
    logger.warn('종목 등록 현재가 조회 실패', e);
  }
  const latestPosition = state.investment.positions.find(p => String(p.id) === String(position.id)) || position;
  if (button) button.textContent = 'DB 저장 중';
  const saved = await apiSaveInvestmentPosition(latestPosition, 3);
  if (!saved?.ok) {
    state.investment.positions = existing
      ? state.investment.positions.map(p => String(p.id) === String(existing.id) ? existing : p)
      : state.investment.positions.filter(p => p.id !== position.id);
    logger.error('투자 종목 등록 실패', { symbol, error: saved?.error });
    showToast(saved?.error || '서버 저장에 실패했어요. 잠시 후 다시 저장해주세요.');
    if (button) {
      button.disabled = false;
      button.textContent = '종목 등록';
    }
    render();
    return;
  }
  if (saved.investment) state.investment = mergeInvestmentAfterPositionSave(state.investment, saved.investment);
  showToast(assetType === 'cash' ? '현금 보유액을 포트폴리오에 반영했어요.' : hasQuote ? '보유 종목을 등록하고 현재가를 가져왔어요.' : '종목은 등록했지만 현재가를 찾지 못했어요. 티커를 확인해주세요.');
  if (state.activeModal === 'investment-portfolio') {
    openModal('investment-portfolio');
  } else {
    closeModal();
    render();
  }
}

function clearInvestmentPositionForm() {
  ['ip-id', 'ip-symbol', 'ip-name', 'ip-shares', 'ip-avg', 'ip-target', 'ip-stop', 'ip-thesis', 'ip-add-rule'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const assetType = document.getElementById('ip-asset-type');
  if (assetType) assetType.value = 'stock';
  const longTerm = document.getElementById('ip-longterm');
  if (longTerm) longTerm.checked = false;
  const btn = document.getElementById('investment-add-position');
  if (btn) btn.textContent = '종목 저장';
  syncInvestmentPositionAssetType();
}

function editInvestmentPosition(id) {
  const p = normalizeInvestmentState(state.investment).positions.find(item => String(item.id) === String(id));
  if (!p) return;
  const set = (field, value) => {
    const el = document.getElementById(field);
    if (el) el.value = value ?? '';
  };
  const assetType = document.getElementById('ip-asset-type');
  if (assetType) assetType.value = p.assetType || 'stock';
  set('ip-id', p.id);
  set('ip-symbol', p.symbol || '');
  set('ip-name', p.name || '');
  set('ip-shares', isCashInvestmentPosition(p) ? (p.cashAmount ?? p.shares ?? '') : (p.shares || ''));
  set('ip-avg', p.avgPrice || '');
  set('ip-target', p.targetPrice || '');
  set('ip-stop', p.stopPrice || '');
  set('ip-thesis', p.thesis || '');
  set('ip-add-rule', p.addRule || '');
  const longTerm = document.getElementById('ip-longterm');
  if (longTerm) longTerm.checked = !!p.longTerm;
  const btn = document.getElementById('investment-add-position');
  if (btn) btn.textContent = '종목 수정 저장';
  syncInvestmentPositionAssetType();
  const tools = document.getElementById('investment-manage-tools');
  if (tools) tools.open = true;
  document.getElementById('investment-position-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function syncInvestmentPositionAssetType() {
  const type = document.getElementById('ip-asset-type')?.value || 'stock';
  const symbol = document.getElementById('ip-symbol');
  const name = document.getElementById('ip-name');
  const shares = document.getElementById('ip-shares');
  const avg = document.getElementById('ip-avg');
  const target = document.getElementById('ip-target');
  const stop = document.getElementById('ip-stop');
  const longTerm = document.getElementById('ip-longterm');
  if (symbol) {
    symbol.placeholder = type === 'crypto' ? 'ETH, BTC, ETH-USD' : type === 'cash' ? 'CASH' : '종목 코드';
    symbol.disabled = type === 'cash';
    if (type === 'cash' && !symbol.value) symbol.value = 'CASH';
  }
  if (name) {
    name.placeholder = type === 'cash' ? '현금' : '종목명';
    if (type === 'cash' && !name.value) name.value = '현금';
  }
  if (shares) shares.placeholder = type === 'cash' ? '현금 보유액 ($)' : '수량';
  if (avg) {
    avg.placeholder = type === 'cash' ? '자동 1달러' : '평균 단가 ($)';
    avg.disabled = type === 'cash';
    if (type === 'cash') avg.value = '1';
  }
  [target, stop].forEach(el => { if (el) el.disabled = type === 'cash'; });
  if (longTerm) longTerm.disabled = type === 'cash';
}

async function deleteInvestmentPosition(id) {
  const p = state.investment.positions.find(item => String(item.id) === String(id));
  if (!p) return;
  if (!confirm(`${p.symbol || '종목'}을 포트폴리오에서 삭제할까요?`)) return;
  state.investment.positions = state.investment.positions.filter(item => String(item.id) !== String(id));
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
  const persisted = await saveData();
  if (!persisted) return showToast('서버 저장에 실패했어요. 잠시 후 다시 시도해주세요.');
  showToast('종목을 삭제했어요.');
  openModal('investment-portfolio');
}

async function saveInvestmentRulesFromForm(event) {
  event.preventDefault();
  state.investment.rules = {
    ...state.investment.rules,
    tradingStyle: document.getElementById('ir-style')?.value || 'swing',
    riskPerTrade: Number(document.getElementById('ir-risk-trade')?.value) || 1,
    dailyLossLimit: Number(document.getElementById('ir-daily-loss')?.value) || 3,
    maxDailyTrades: Number(document.getElementById('ir-max-trades')?.value) || 3,
    maxPositionWeight: Number(document.getElementById('ir-max-weight')?.value) || 30,
    minRiskReward: Number(document.getElementById('ir-min-rr')?.value) || 2,
    cooldownMinutes: Number(document.getElementById('ir-cooldown')?.value) || 30,
    chaseLimit: Number(document.getElementById('ir-chase')?.value) || 5,
    noTradeAfterLoss: !!document.getElementById('ir-no-loss')?.checked,
    strictMode: !!document.getElementById('ir-strict')?.checked,
    longTermBias: !!document.getElementById('ir-longterm')?.checked,
    antiAveraging: !!document.getElementById('ir-anti-avg')?.checked,
    entryChecklist: document.getElementById('ir-entry')?.value.trim() || '',
    exitChecklist: document.getElementById('ir-exit')?.value.trim() || '',
    bannedSetups: document.getElementById('ir-banned')?.value.trim() || '',
    coreRules: document.getElementById('ir-core')?.value.trim() || '',
    reviewRoutine: document.getElementById('ir-review')?.value.trim() || '',
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
  const setup = document.getElementById('ig-setup')?.value || 'planned';
  const timeframe = document.getElementById('ig-timeframe')?.value || 'swing';
  const reason = document.getElementById('ig-reason')?.value.trim() || '';
  const tradeShares = parseInvestmentNumber(document.getElementById('ig-shares')?.value);
  const tradePrice = parseInvestmentNumber(document.getElementById('ig-price')?.value);
  const plannedStop = parseInvestmentNumber(document.getElementById('ig-stop')?.value);
  const plannedTarget = parseInvestmentNumber(document.getElementById('ig-target')?.value);
  const riskReward = parseInvestmentNumber(document.getElementById('ig-risk-reward')?.value);
  const orderType = document.getElementById('ig-order-type')?.value || 'limit';
  const invalidation = document.getElementById('ig-invalidation')?.value.trim() || '';
  const checklist = {
    thesis: !!document.getElementById('ig-check-thesis')?.checked,
    risk: !!document.getElementById('ig-check-risk')?.checked,
    size: !!document.getElementById('ig-check-size')?.checked,
    cooldown: !!document.getElementById('ig-check-cooldown')?.checked,
  };
  const verdict = evaluateInvestmentDecision({
    position,
    rules: state.investment.rules,
    totals: investmentTotals(state.investment.positions),
    action,
    context,
    reason: [reason, invalidation, setup === 'impulse' ? '충동 의심' : ''].filter(Boolean).join('\n'),
  });
  enrichInvestmentVerdict(verdict, { setup, riskReward, plannedStop, plannedTarget, checklist, rules: state.investment.rules });

  const decision = {
    id: 'id' + Date.now(),
    createdAt: new Date().toISOString(),
    symbol: position.symbol,
    action,
    context,
    setup,
    timeframe,
    reason,
    invalidation,
    plannedStop,
    plannedTarget,
    riskReward,
    orderType,
    checklist,
    verdict: verdict.status,
    label: verdict.label,
    summary: verdict.summary,
    findings: verdict.findings,
    nextSteps: verdict.nextSteps,
    tradeShares,
    tradePrice,
  };
  state.investment.decisions.push(decision);
  if (decision.verdict === 'allow' && tradeShares > 0 && tradePrice > 0) {
    applyTradeToPortfolio(position.id, action, tradeShares, tradePrice);
    decision.summary = `${decision.summary} 포트폴리오에 ${formatShares(tradeShares)}주 @ ${formatMoney(tradePrice)} 체결을 반영했습니다.`;
    try {
      const intentRes = await apiCreateInvestmentOrderIntent({
        symbol: position.symbol,
        action,
        quantity: tradeShares,
        orderType,
        price: tradePrice,
        source: 'investment-gate',
        reason,
      });
      if (intentRes.intent) {
        state.investment.orderIntents = [...(state.investment.orderIntents || []), intentRes.intent];
        decision.orderIntentId = intentRes.intent.id;
        decision.summary += ' 주문 연동용 초안도 생성했습니다.';
      }
      if (intentRes.investment) state.investment = normalizeInvestmentState({ ...state.investment, ...intentRes.investment });
    } catch (e) {
      logger.warn('주문 의도 초안 생성 실패', e);
      decision.summary += ' 주문 초안 생성은 실패했지만 매매 기록은 저장합니다.';
    }
  }
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

function fillInvestmentAICompareExample(text) {
  const input = document.getElementById('iac-question');
  if (input) input.value = text;
}

async function runInvestmentAICompare(event) {
  event.preventDefault();
  const input = document.getElementById('iac-question');
  const result = document.getElementById('investment-ai-compare-result');
  const button = document.getElementById('iac-run');
  const question = (input?.value || '').trim();
  if (!question) return showToast('비교할 투자 질문을 입력해주세요.');
  if (button) {
    button.disabled = true;
    button.textContent = '비교 중';
  }
  if (result) result.innerHTML = '<div class="investment-empty">두 모델의 답변을 기다리는 중입니다.</div>';

  try {
    const newsContext = await fetchInvestmentNewsContext(question);
    const systemText = typeof _buildChatSysPrompt === 'function'
      ? _buildChatSysPrompt(false, null, null, newsContext)
      : 'You are an investment behavior-control partner. Do not recommend or guarantee returns.';
    const data = await apiCompareInvestmentAI({
      max_tokens: 700,
      system: [{ type: 'text', text: systemText }],
      messages: [{ role: 'user', content: question }],
    });
    if (result) result.innerHTML = renderInvestmentAICompareResult(data.results || []);
  } catch (e) {
    logger.error('AI 비교 실패', e);
    if (result) result.innerHTML = `<div class="investment-empty">AI 비교에 실패했습니다. ${esc(e.message || '')}</div>`;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '두 모델 비교';
    }
  }
}

function renderInvestmentAICompareResult(results) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return '<div class="investment-empty">비교 결과가 없습니다.</div>';
  return `<div class="investment-ai-compare-grid">
    ${list.map(r => `<article class="investment-ai-card ${r.ok ? 'ok' : 'error'}">
      <header>
        <strong>${esc(r.provider === 'openai' ? 'OpenAI' : 'Claude')}</strong>
        <small>${esc(r.model || (r.ok ? 'model' : 'not configured'))}</small>
      </header>
      ${r.ok
        ? `<div class="chat-markdown">${renderMarkdownBasic(r.text || '')}</div>`
        : `<p class="investment-ai-error">${esc(r.error || '응답 실패')}</p>`}
    </article>`).join('')}
  </div>
  <div class="investment-modal-note">좋은 답변의 기준: 매수/매도 단정이 아니라 원칙 위반, 빠진 정보, 리스크, 다음 확인 행동을 분명히 말하는지 확인하세요.</div>`;
}
