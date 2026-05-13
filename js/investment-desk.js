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
  const positionReviews = buildInvestmentDeskPositionReviews(tradable, inv.rules, todayEvents, maxWeight);
  const dataGaps = buildInvestmentDeskDataGaps(inv.positions, inv.rules);
  const marketBriefing = buildInvestmentMarketBriefing(inv, {
    today,
    totals,
    tradable,
    cashValue,
    events,
    todayEvents,
    upcomingEvents,
    recentDecisions,
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

  dataGaps.forEach(gap => {
    riskSignals.push({
      id: `gap-${gap.id}`,
      severity: gap.severity || 'watch',
      symbol: gap.symbol || '',
      title: gap.title,
      body: gap.body,
      source: 'data-quality',
      evidence: gap.evidence || '',
    });
  });

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

  const primaryAction = buildInvestmentDeskPrimaryAction({
    snapshot: {
      totalValue: totals.totalValue,
      cashValue,
      cashWeight: totals.totalValue ? (cashValue / totals.totalValue) * 100 : 0,
      topSymbol: top?.symbol || '',
      topWeight: top?.weight || 0,
    },
    riskSignals: dedupeInvestmentDeskItems(riskSignals).sort(sortInvestmentDeskSignals),
    forbiddenActions: dedupeInvestmentDeskItems(forbiddenActions),
    recentSellDecisions,
    dataGaps,
  });

  const baseDesk = {
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
    marketBriefing,
    primaryAction,
    positionReviews,
    dataGaps,
    todayEvents,
    upcomingEvents,
    recentDecisions,
    checklist: Array.from(new Set(checklist)),
  };
  return applyInvestmentServerDeskEngine(baseDesk, inv);
}

function applyInvestmentServerDeskEngine(baseDesk, investment) {
  const engine = investment?.desk?.engine;
  if (!engine || String(engine.date || '') !== String(baseDesk.date || '')) return baseDesk;
  const view = engine.marketView || {};
  const controls = Array.isArray(engine.behaviorControls) ? engine.behaviorControls : [];
  const keyIssues = Array.isArray(view.keyIssues) ? view.keyIssues : [];
  const evidence = Array.isArray(view.evidence) ? view.evidence : [];
  const doNotDo = Array.isArray(view.doNotDo) ? view.doNotDo : [];
  const scenarios = Array.isArray(engine.scenarios) ? engine.scenarios : [];
  const marketRegime = engine.marketRegime || null;
  const allocationActions = Array.isArray(marketRegime?.allocation?.actions) ? marketRegime.allocation.actions : [];
  const allocationDoNotDo = Array.isArray(marketRegime?.allocation?.doNotDo) ? marketRegime.allocation.doNotDo : [];

  const riskSignals = controls.map(control => ({
    id: `server-control-${control.symbol}-${control.state}`,
    severity: control.severity || 'watch',
    symbol: control.symbol || '',
    title: `${control.symbol || 'Portfolio'} ${control.state || 'control'}`,
    body: (control.reasons || []).join(' '),
    source: 'python-desk-engine',
    evidence: (control.requiredBeforeAction || []).join(', '),
  }));
  const forbiddenActions = controls
    .filter(control => (control.blockedActions || []).length)
    .flatMap(control => (control.blockedActions || []).map(action => ({
      id: `server-block-${control.symbol}-${action}`,
      symbol: control.symbol || '',
      action,
      label: `${control.symbol || 'Portfolio'} ${action} blocked`,
      reason: (control.reasons || [])[0] || 'Python behavior-control engine blocked this action.',
    }))).concat(allocationActions.map(action => ({
      id: `server-allocation-${action.type || action.title || 'action'}`,
      symbol: '',
      action: action.type || 'allocation_control',
      label: action.title || action.type || 'Allocation control',
      reason: action.reason || allocationDoNotDo[0] || 'Market allocation engine is active.',
    })));

  const marketBriefing = {
    ...(baseDesk.marketBriefing || {}),
    headline: view.topLine || baseDesk.marketBriefing?.headline,
    macroItems: evidence.length ? evidence.slice(0, 6).map(item => ({
      id: item.id || `${item.symbol}-${item.title}`,
      title: `${item.evidenceLevel || 'E'} · ${item.title || item.type || 'market evidence'}`,
      body: `${item.date || ''} ${item.symbol || ''} ${item.type || ''}`.trim(),
      source: 'python-desk-engine',
    })) : baseDesk.marketBriefing?.macroItems,
    microItems: keyIssues.length ? keyIssues.map(item => ({
      id: `server-issue-${item.symbol}`,
      title: `${item.symbol} · ${item.profile || 'thesis'} · ${item.thesisStatus || 'unproven'}`,
      body: `${item.whyItMatters || item.view || ''} Pressure score: ${item.pressureScore ?? 0}.`,
      source: 'python-desk-engine',
    })) : baseDesk.marketBriefing?.microItems,
    portfolioImplications: keyIssues.length ? keyIssues.map(item => ({
      symbol: item.symbol,
      title: `${item.controlState || 'observe'} · ${item.thesisStatus || 'unproven'}`,
      body: [
        item.view || '',
        (() => {
          const scenario = scenarios.find(row => row.symbol === item.symbol);
          if (!scenario) return '';
          return `Scenario: bull=${scenario.bullCase?.action || '-'}, base=${scenario.baseCase?.action || '-'}, bear=${scenario.bearCase?.action || '-'}.`;
        })(),
      ].filter(Boolean).join(' '),
      tone: ['blocked', 'review', 'confirmation_wait'].includes(item.controlState) ? 'block' : 'watch',
    })) : baseDesk.marketBriefing?.portfolioImplications,
    dataRequests: (engine.researchQueue || []).slice(0, 6).map(item => `${item.symbol}: ${item.driver} - ${item.evidenceNeeded}`),
  };

  return {
    ...baseDesk,
    serverEngine: engine,
    marketRegime,
    marketBriefing,
    riskSignals: riskSignals.length ? riskSignals : baseDesk.riskSignals,
    forbiddenActions: forbiddenActions.length ? forbiddenActions : baseDesk.forbiddenActions,
    primaryAction: {
      tone: forbiddenActions.length ? 'block' : (riskSignals[0]?.severity || baseDesk.primaryAction?.tone || 'allow'),
      title: view.topLine || baseDesk.primaryAction?.title || 'Server desk engine ready',
      body: doNotDo[0] || baseDesk.primaryAction?.body || '',
    },
  };
}

function renderDailyDeskBrief(desk) {
  if (!desk) return 'Daily Investment Desk: unavailable';
  if (desk.serverEngine?.summary) {
    return `Daily Investment Desk (server engine)\n${desk.serverEngine.summary}`;
  }
  const snapshot = desk.accountSnapshot || {};
  const briefing = desk.marketBriefing || {};
  const risks = (desk.riskSignals || []).slice(0, 5)
    .map(r => `- [${r.severity}] ${r.symbol ? `${r.symbol}: ` : ''}${r.title} | ${r.body}`)
    .join('\n') || '- no major risk';
  const blocked = (desk.forbiddenActions || []).slice(0, 6)
    .map(a => `- ${a.symbol ? `${a.symbol}: ` : ''}${a.label} (${a.reason})`)
    .join('\n') || '- none';
  const allowed = (desk.allowedActions || []).slice(0, 4)
    .map(a => `- ${a.label}: ${a.reason}`)
    .join('\n') || '- scenario planning only';
  const reviews = (desk.positionReviews || []).slice(0, 6)
    .map(p => `- ${p.symbol}: ${p.mode} | weight=${Number(p.weight || 0).toFixed(1)}% | value=${Number(p.value || 0).toFixed(2)} | gain=${Number(p.gain || 0).toFixed(2)} | ${p.reason}`)
    .join('\n') || '- no positions';
  const gaps = (desk.dataGaps || []).slice(0, 6)
    .map(g => `- ${g.symbol ? `${g.symbol}: ` : ''}${g.title} | ${g.body}`)
    .join('\n') || '- none';
  const events = (desk.todayEvents || []).slice(0, 5)
    .map(e => `- ${e.date} [${e.type}] ${e.symbol || ''} ${e.title || ''}`)
    .join('\n') || '- none';
  const regime = desk.marketRegime?.regime;
  const allocation = desk.marketRegime?.allocation;
  const marketRegimeBrief = regime ? `Market regime:
- regime=${regime.regime || '-'} eventDefenseLevel=${regime.eventDefenseLevel || 'none'} targetCash=${(regime.targetCashRange || []).join('-')}%
- cashGap=${allocation?.cashGap?.status || '-'} current=${Number(allocation?.cashGap?.current || 0).toFixed(1)}%
- allocation actions=${(allocation?.actions || []).map(item => item.title || item.type).join(' | ') || 'none'}` : 'Market regime: unavailable';
  return `Daily Investment Desk (${desk.date})
${marketRegimeBrief}
Market briefing:
- headline=${briefing.headline || ''}
- macro=${(briefing.macroItems || []).map(item => `${item.title}: ${item.body}`).join(' | ') || 'none'}
- micro=${(briefing.microItems || []).map(item => `${item.title}: ${item.body}`).join(' | ') || 'none'}
- portfolio implications=${(briefing.portfolioImplications || []).map(item => `${item.symbol}: ${item.body}`).join(' | ') || 'none'}
- briefing questions=${(briefing.briefingQuestions || []).join(' / ') || 'none'}
Primary action:
- [${desk.primaryAction?.tone || 'allow'}] ${desk.primaryAction?.title || ''}
- ${desk.primaryAction?.body || ''}
Account:
- totalValue=${Number(snapshot.totalValue || 0).toFixed(2)}
- cash=${Number(snapshot.cashValue || 0).toFixed(2)} (${Number(snapshot.cashWeight || 0).toFixed(1)}%)
- top=${snapshot.topSymbol || 'none'} ${Number(snapshot.topWeight || 0).toFixed(1)}%
Position control modes:
${reviews}
Data gaps:
${gaps}
Risk signals:
${risks}
Forbidden actions:
${blocked}
Allowed actions:
${allowed}
Today events:
${events}`;
}

function buildInvestmentMarketBriefing(inv, context = {}) {
  const positions = Array.isArray(inv.positions) ? inv.positions : [];
  const tradable = Array.isArray(context.tradable) ? context.tradable : getTradableInvestmentSlices(positions);
  const events = Array.isArray(context.events) ? context.events : (inv.events || []);
  const today = context.today || toInvestmentDeskDate(new Date());
  const symbols = tradable.map(p => String(p.symbol || '').toUpperCase()).filter(Boolean);
  const eventText = events.map(e => [e.symbol, e.title, e.body, e.source, e.handle].filter(Boolean).join(' ')).join('\n').toLowerCase();
  const has = terms => terms.some(term => eventText.includes(String(term).toLowerCase()));
  const hasSymbol = sym => symbols.includes(sym);

  const macroItems = [];
  const microItems = [];
  const portfolioImplications = [];
  const briefingQuestions = [];
  const dataRequests = [];

  const addMacro = (id, title, body, source = 'watch') => {
    if (!macroItems.some(item => item.id === id)) macroItems.push({ id, title, body, source });
  };
  const addMicro = (id, title, body, source = 'watch') => {
    if (!microItems.some(item => item.id === id)) microItems.push({ id, title, body, source });
  };
  const addImplication = (symbol, title, body, tone = 'watch') => {
    if (!portfolioImplications.some(item => item.symbol === symbol && item.title === title)) {
      portfolioImplications.push({ symbol, title, body, tone });
    }
  };

  if (has(['cpi', 'inflation', '물가', '금리', 'rate', 'fed', 'powell', '파월'])) {
    addMacro('rates', '금리·물가 경로', 'CPI, 파월 발언, 금리 기대가 성장주·코인·스테이블코인 관련주의 할인율과 유동성 프리미엄을 흔드는 축입니다.', 'event');
  } else {
    dataRequests.push('이번 주 CPI, 파월/Fed 발언, 금리 선물 변화');
  }

  if (has(['china', '미중', 'summit', '정상회담', 'tariff', 'trade war'])) {
    addMacro('us-china', '미중 정상회담·공급망', '미중 협상 흐름은 반도체, AI 인프라, 나스닥 위험선호에 직접 연결됩니다.', 'event');
  }

  if (has(['iran', '이란', 'hormuz', '호르무즈', 'oil', '유가', 'ceasefire', '종전'])) {
    addMacro('middle-east', '이란·호르무즈·유가', '지정학 리스크는 유가와 인플레이션 기대를 통해 금리·주식·코인 위험선호를 동시에 건드립니다.', 'event');
  }

  if (has(['clarity', 'market structure', 'genius', 'stablecoin', 'crypto bill', 'markup', '클래리티', '법안', '스테이블코인'])) {
    addMacro('crypto-policy', '크립토 법안·스테이블코인 정책', '공식 일정 전이라도 마크업 가능성, 의원 발언, 업계 계정 흐름은 CRCL·ETH·채굴주에 선반영될 수 있습니다.', 'signal');
  } else if (hasSymbol('CRCL') || symbols.includes('ETH-USD') || symbols.includes('ETH') || hasSymbol('IREN')) {
    dataRequests.push('Clarity Act / GENIUS Act 공식 일정, X 주요 계정 흐름, 코인 시장 반응');
  }

  if (has(['semiconductor', '반도체', 'nvda', 'hbm', 'memory', 'ai chip'])) {
    addMacro('semis', '반도체 강세 지속 여부', '이미 오른 반도체는 밸류에이션 부담과 AI CAPEX 기대를 같이 봐야 하며, 신규 진입은 추격 기준으로 걸러야 합니다.', 'signal');
  }

  tradable.forEach(slice => {
    const symbol = String(slice.symbol || '').toUpperCase();
    const weight = Number(slice.weight || 0);
    const gain = Number(slice.gainPercent || 0);
    if (symbol === 'CRCL') {
      addMicro('crcl-earnings', 'CRCL 실적보다 중요한 변수', '서클은 단순 EPS보다 USDC 발행량, 준비자산 수익률, 금리 경로, 스테이블코인 법안 확률이 핵심입니다.', 'model');
      addImplication('CRCL', '정책 이벤트 민감', `현재 비중 ${weight.toFixed(1)}%. 실적 당일 숫자보다 법안 마크업/금리/USDC 공급 변화가 방향을 정할 수 있습니다.`);
      briefingQuestions.push('CRCL: 실적 숫자, USDC 발행량, 금리 민감도, Clarity/Genius Act 흐름을 분리해서 브리핑해줘.');
    } else if (symbol === 'ETH' || symbol === 'ETH-USD') {
      addMicro('eth-crypto-beta', 'ETH는 정책·유동성 선행지표', 'ETH 포지션은 코인판 위험선호와 법안 기대를 먼저 반영할 수 있어 CRCL/IREN 판단의 선행 신호로 봐야 합니다.', 'model');
      addImplication(symbol, '코인 베타 노출', `현재 비중 ${weight.toFixed(1)}%. 이번 주 크립토 정책/금리 이벤트와 같이 관리해야 합니다.`);
      briefingQuestions.push('ETH: 이번 주 코인판 흐름이 CRCL과 IREN에 주는 선행 신호를 정리해줘.');
    } else if (symbol === 'IREN') {
      addMicro('iren-ai-miner', 'IREN 손절은 가격보다 스토리 훼손 기준', 'IREN은 채굴주이면서 AI 인프라 기대가 섞여 있어 BTC, AI 계약, 실적/가이던스, 자금조달을 나눠 봐야 합니다.', 'model');
      addImplication('IREN', '손절 조건 재정의 필요', `현재 비중 ${weight.toFixed(1)}%, 손익 ${gain.toFixed(1)}%. 가격 손절과 실적/계약/희석 훼손 조건을 분리해야 합니다.`);
      briefingQuestions.push('IREN: 가격 손절선이 아니라 실적, AI 계약, BTC, 희석 리스크 기준으로 손절 조건을 잡아줘.');
    } else if (['NVDA', 'AMD', 'AVGO', 'TSM', 'SMH', 'SOXX', 'QQQM', 'QQQ', 'QLD', 'TQQQ'].includes(symbol)) {
      addMicro('semiconductor-entry', '반도체·나스닥 추격 진입 점검', '강세 섹터라도 이미 오른 구간에서는 신규 추천보다 진입 가격, 분할, 무효화 조건이 먼저입니다.', 'model');
      addImplication(symbol, '추격 매수 검문', `현재 비중 ${weight.toFixed(1)}%. 추천 여부보다 지금 가격에서 손익비가 남아 있는지 확인해야 합니다.`);
      briefingQuestions.push(`${symbol}: 이미 오른 반도체/나스닥 구간에서 신규 진입이 유리한지, 대안 후보와 비교해줘.`);
    }
  });

  if (!macroItems.length) {
    addMacro('macro-needed', '거시 일정 확인 필요', '오늘의 데스크가 제대로 작동하려면 CPI, FOMC/Fed 발언, 지정학, 미중 회담, 코인 정책 일정을 먼저 채워야 합니다.', 'gap');
  }
  if (!microItems.length) {
    addMicro('position-needed', '보유 종목별 핵심 변수 확인 필요', '보유 종목의 실적일, 정책 민감도, 금리 민감도, 섹터 흐름을 연결해야 브리핑 품질이 올라갑니다.', 'gap');
  }
  if (!briefingQuestions.length) {
    briefingQuestions.push('내 보유 종목 기준으로 오늘 가장 중요한 거시/미시 변수와 하지 말아야 할 행동을 브리핑해줘.');
  }

  const headline = buildInvestmentBriefingHeadline({ macroItems, microItems, portfolioImplications, dataRequests });
  const aiBriefingPrompt = [
    '오늘의 투자 데스크 브리핑을 작성해줘.',
    '목표는 종목 추천을 단정하는 것이 아니라, 내 현재 보유 노출 기준으로 이번 주 가격을 실제로 움직일 수 있는 변수와 행동 기준을 정하는 것이다.',
    '고정된 CRCL/ETH/IREN 체크리스트가 아니라, 현재 보유 종목의 사업모델·자산유형·섹터·이벤트·뉴스 흐름을 보고 필요한 리서치 프레임을 새로 만들어줘.',
    '반드시 거시 변수와 미시 변수를 나누고, 각 보유 종목별 핵심 가격 변동 요인, 확인해야 할 공식 자료, 손절/비중축소/추격매수 금지 조건을 제시해줘.',
    'X/루머/비공식 흐름은 확정처럼 말하지 말고, SEC 공시, 회사 IR, 실적콜, 중앙은행/정부 공식 일정, 신뢰 가능한 금융매체, 가격·거래량 중 무엇으로 확인해야 하는지 적어줘.',
    `질문: ${briefingQuestions.join(' / ')}`,
  ].join('\n');

  return {
    headline,
    macroItems: macroItems.slice(0, 6),
    microItems: microItems.slice(0, 6),
    portfolioImplications: portfolioImplications.slice(0, 8),
    briefingQuestions: briefingQuestions.slice(0, 6),
    dataRequests: dataRequests.slice(0, 8),
    aiBriefingPrompt,
  };
}

function buildInvestmentBriefingHeadline({ macroItems, microItems, portfolioImplications, dataRequests }) {
  if ((portfolioImplications || []).some(item => item.symbol === 'CRCL') &&
      (portfolioImplications || []).some(item => item.symbol === 'ETH' || item.symbol === 'ETH-USD')) {
    return '이번 주 핵심은 CRCL 실적보다 크립토 정책·금리·코인판 선행 신호입니다.';
  }
  if ((portfolioImplications || []).some(item => item.symbol === 'IREN')) {
    return 'IREN은 가격보다 AI 계약·실적·희석 리스크 훼손 여부가 손절 기준입니다.';
  }
  if ((macroItems || []).some(item => item.id === 'rates')) {
    return '오늘은 금리·물가 경로가 성장주와 코인 위험선호를 좌우합니다.';
  }
  if ((dataRequests || []).length) {
    return '브리핑 전에 공식 일정과 시장 신호를 먼저 채워야 합니다.';
  }
  return '오늘의 데스크는 계좌보다 시장 변수와 보유 노출의 연결을 먼저 봅니다.';
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

function buildInvestmentDeskPrimaryAction({ snapshot, riskSignals, forbiddenActions, recentSellDecisions, dataGaps }) {
  const firstBlock = (riskSignals || []).find(r => r.severity === 'block');
  if (firstBlock) {
    return {
      tone: 'block',
      title: '오늘은 공격보다 방어가 우선입니다',
      body: `${firstBlock.symbol ? `${firstBlock.symbol}: ` : ''}${firstBlock.body || firstBlock.title}`,
    };
  }
  if ((recentSellDecisions || []).length) {
    return {
      tone: 'watch',
      title: '최근 매도 후 재진입 충동을 분리해서 봐야 합니다',
      body: '이미 바뀐 계좌 상태를 기준으로 새 포지션처럼 계산하고, 매도 대금은 세금·현금 버퍼·재진입 예산으로 나눠야 합니다.',
    };
  }
  if (Number(snapshot?.cashWeight || 0) >= 50) {
    return {
      tone: 'watch',
      title: '현금이 가장 큰 포지션입니다',
      body: '현금은 빈 공간이 아니라 대기 자산입니다. 오늘의 핵심은 한 번에 투입하는 것이 아니라 투입 조건과 금지 조건을 먼저 고정하는 것입니다.',
    };
  }
  if ((dataGaps || []).length) {
    return {
      tone: 'watch',
      title: '판단 전에 계좌 데이터 공백을 먼저 메워야 합니다',
      body: `${dataGaps[0].title}: ${dataGaps[0].body}`,
    };
  }
  if ((forbiddenActions || []).length) {
    return {
      tone: 'watch',
      title: '할 수 있는 행동보다 하지 말아야 할 행동이 먼저입니다',
      body: forbiddenActions[0].reason || forbiddenActions[0].label || '금지 행동을 먼저 확인하세요.',
    };
  }
  return {
    tone: 'allow',
    title: '즉시 차단할 위험은 크지 않습니다',
    body: '그래도 매수·매도 전에는 수량, 가격, 무효화 조건, 계좌 비중을 원장 기준으로 먼저 확인하세요.',
  };
}

function buildInvestmentDeskPositionReviews(slices, rules, todayEvents, maxWeight) {
  const events = Array.isArray(todayEvents) ? todayEvents : [];
  return (Array.isArray(slices) ? slices : []).map(slice => {
    const position = slice.position || slice;
    const symbol = position.symbol || slice.symbol || '';
    const value = parseInvestmentNumber(slice.value);
    const cost = parseInvestmentNumber(slice.cost);
    const gain = value - cost;
    const gainPercent = cost ? (gain / cost) * 100 : 0;
    const hasEvent = events.some(e => !e.symbol || String(e.symbol).toUpperCase() === String(symbol).toUpperCase());
    const stopPrice = parseInvestmentNumber(position.stopPrice);
    const currentPrice = parseInvestmentNumber(position.currentPrice);
    const stopDistance = stopPrice && currentPrice ? ((currentPrice - stopPrice) / currentPrice) * 100 : null;
    let mode = '관찰';
    let tone = 'allow';
    let reason = '현재 원칙 위반은 크지 않습니다.';
    if (slice.weight > maxWeight) {
      mode = '축소/추가매수 금지';
      tone = slice.weight >= 50 ? 'block' : 'watch';
      reason = `비중 ${slice.weight.toFixed(1)}%로 한도 ${maxWeight}%를 초과했습니다.`;
    } else if (hasEvent) {
      mode = '이벤트 대기';
      tone = 'block';
      reason = '오늘 관련 일정이 있어 발표 전 충동 매매를 막아야 합니다.';
    } else if (!currentPrice) {
      mode = '가격 확인';
      tone = 'watch';
      reason = '현재가가 없어 계좌 평가와 위험 계산이 흔들립니다.';
    } else if (!stopPrice) {
      mode = '손절 기준 필요';
      tone = 'watch';
      reason = '손절가나 무효화 조건이 없어 행동 통제가 약합니다.';
    } else if (stopDistance != null && stopDistance < 8) {
      mode = '방어선 근접';
      tone = 'watch';
      reason = `손절 기준까지 약 ${stopDistance.toFixed(1)}% 남았습니다.`;
    }
    return {
      symbol,
      name: position.name || '',
      weight: parseInvestmentNumber(slice.weight),
      value,
      gain,
      gainPercent,
      mode,
      tone,
      reason,
    };
  });
}

function buildInvestmentDeskDataGaps(positions, rules) {
  const gaps = [];
  (Array.isArray(positions) ? positions : []).forEach(p => {
    if (isCashInvestmentPosition(p)) return;
    const symbol = p.symbol || 'UNKNOWN';
    if (!parseInvestmentNumber(p.currentPrice)) {
      gaps.push({
        id: `${symbol}-price`,
        symbol,
        severity: 'watch',
        title: `${symbol} 현재가 공백`,
        body: '현재가가 없으면 총 평가액, 비중, 손익, 위험 신호가 모두 부정확해집니다.',
      });
    }
    if (!parseInvestmentNumber(p.stopPrice) && !String(p.addRule || p.thesis || '').includes('손절')) {
      gaps.push({
        id: `${symbol}-risk-rule`,
        symbol,
        severity: 'watch',
        title: `${symbol} 방어 기준 공백`,
        body: '가격 손절이 아니어도 실적, 공시, 금리, 비트코인 가격 같은 무효화 조건이 필요합니다.',
      });
    }
  });
  if (!rules?.coreRules) {
    gaps.push({
      id: 'core-rules',
      symbol: '',
      severity: 'watch',
      title: '기본 투자 원칙 공백',
      body: 'AI가 판단을 돕더라도 계좌의 최대 비중, 추격매수 제한, 쿨다운 같은 기본값이 먼저 있어야 합니다.',
    });
  }
  return gaps.slice(0, 8);
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
