/* =============================================
   투자 파트너 — 화면 렌더링
   의존성: state.js, utils.js, investment-rules.js, investment-format.js, investment-portfolio.js
   ============================================= */

function renderInvestmentView() {
  const inv = normalizeInvestmentState(state.investment);
  state.investment = inv;
  const totals = investmentTotals(inv.positions);
  const cashValue = (inv.positions || [])
    .filter(p => isCashInvestmentPosition(p))
    .reduce((sum, p) => sum + investmentPositionValue(p, 'currentPrice'), 0);
  const last = inv.decisions.at(-1);
  const messages = state.currentChatMessages || [];
  const alerts = inv.alerts || buildInvestmentRiskAlerts(inv.positions, inv.rules);
  const desk = typeof buildDailyInvestmentDesk === 'function' ? buildDailyInvestmentDesk(inv) : null;

  return `<div class="investment-view" id="investment-view">
    <section class="investment-hero" id="investment-portfolio-summary">
      <div>
        <div class="investment-kicker">투자 기록 기반 행동 통제</div>
        <h2>포트폴리오 요약</h2>
      </div>
      <div class="investment-total">
        <span>포트폴리오</span>
        <strong>${formatMoney(totals.totalValue)}</strong>
        ${formatKrwApprox(totals.totalValue)}
        <div class="investment-action-row">
          <button class="investment-refresh-btn" id="investment-refresh-market" onclick="refreshInvestmentMarketData()">현재가 갱신</button>
          <button class="investment-refresh-btn" id="investment-sync-kis" onclick="syncKisBrokerData()">KIS 동기화</button>
          <button class="investment-refresh-btn" id="investment-sync-calendar" onclick="syncInvestmentCalendarData()">일정 동기화</button>
        </div>
      </div>
    </section>

    ${renderInvestmentIndexes(inv.market?.indexes || [])}
    ${desk ? renderInvestmentDeskStrip(desk) : ''}

    <section class="investment-summary-grid">
      <div class="investment-summary-card">
        <span>보유 종목</span>
        <strong>${inv.positions.filter(p => !isCashInvestmentPosition(p)).length}</strong>
      </div>
      <div class="investment-summary-card">
        <span>현금</span>
        <strong>${formatMoney(cashValue)}</strong>
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
      <div class="investment-summary-card">
        <span>주문 연동</span>
        <strong>${inv.broker?.orderIntentOnly ? `초안 ${inv.orderIntents?.length || 0}` : '연결됨'}</strong>
      </div>
    </section>

    ${renderInvestmentAlerts(alerts)}
    ${renderInvestmentPositions(inv.positions, totals)}
    ${last ? renderInvestmentVerdict(last) : ''}

    <section class="investment-chat-surface">
      ${messages.length
        ? `<div class="chat-messages" id="chat-messages">${messages.map(m => renderChatBubble(m)).join('')}</div>`
        : '<div class="chat-messages" id="chat-messages"><div class="empty-state">대화를 시작해보세요</div></div>'}
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
      const value = investmentPositionValue(p, 'currentPrice');
      const weight = totals.totalValue ? (value / totals.totalValue) * 100 : 0;
      const isCash = isCashInvestmentPosition(p);
      const hasPrice = isCash || (p.currentPrice != null && parseInvestmentNumber(p.currentPrice) > 0);
      return `<div class="investment-position">
        <div>
          <strong>${esc(p.symbol || '-')}</strong>
          <span>${esc(p.name || '')}${isCash ? ' · 현금' : p.manualPrice ? ' · 수동 현재가' : ''}</span>
        </div>
        <div class="investment-position-meta">
          <span>${hasPrice ? `${formatMoney(value)} ${formatKrwApprox(value)}` : '현재가 미조회'}</span>
          <span>${hasPrice ? `${weight.toFixed(1)}%${isCash ? ' · 대기 자금' : ` · ${formatPercent(p.changePercent)}`}` : '현재가 갱신 필요'}</span>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderInvestmentDeskStrip(desk) {
  const snapshot = desk.accountSnapshot || {};
  const briefing = desk.marketBriefing || {};
  const topRisk = (desk.riskSignals || [])[0];
  const tone = (briefing.dataRequests || []).length ? 'watch' : topRisk?.severity || 'allow';
  const stripBody = (briefing.portfolioImplications || [])[0]?.body
    || (briefing.macroItems || [])[0]?.body
    || (briefing.microItems || [])[0]?.body
    || topRisk?.body
    || '오늘 시장 변수와 내 보유 노출을 함께 점검하세요.';
  return `<section class="investment-desk-strip ${esc(tone)}" id="investment-daily-desk-strip">
    <div>
      <span class="investment-badge ${esc(tone)}">Market Desk</span>
      <h3>${esc(briefing.headline || topRisk?.title || '오늘의 투자 데스크')}</h3>
      <p>${esc(stripBody)}</p>
    </div>
    <div class="investment-desk-strip-metrics">
      <div><span>현금</span><strong>${formatMoney(snapshot.cashValue || 0)}</strong><small>${Number(snapshot.cashWeight || 0).toFixed(1)}%</small></div>
      <div><span>최대 비중</span><strong>${esc(snapshot.topSymbol || '-')} ${Number(snapshot.topWeight || 0).toFixed(1)}%</strong></div>
      <div><span>금지 행동</span><strong>${(desk.forbiddenActions || []).length}</strong></div>
    </div>
    <button class="investment-refresh-btn" id="investment-open-daily-desk" onclick="openModal('investment-desk')">오늘의 데스크 열기</button>
  </section>`;
}

function renderModalInvestmentDesk() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const desk = buildDailyInvestmentDesk(inv);
  const briefing = desk.marketBriefing || {};
  const prep = inv.desk || {};
  const riskTone = (briefing.dataRequests || []).length ? 'watch' : (desk.riskSignals || [])[0]?.severity || 'allow';
  return `
    <button class="modal-close" onclick="closeModal()">x</button>
    <div class="investment-modal-titlebar">
      <div class="modal-title">오늘의 투자 데스크</div>
      <div class="investment-action-row">
        <button class="investment-refresh-btn investment-modal-refresh-btn" id="investment-desk-prepare" onclick="prepareDailyInvestmentDesk({ force: true, silent: false, reason: 'manual' })">오늘 데스크 갱신</button>
        <button class="investment-refresh-btn investment-modal-refresh-btn" onclick="syncInvestmentCalendarData()">일정 동기화</button>
        <button class="investment-refresh-btn investment-modal-refresh-btn" id="investment-desk-notification-permission" onclick="requestInvestmentNotifications()">알림 켜기</button>
        <button class="investment-refresh-btn investment-modal-refresh-btn" id="investment-desk-notification-test" onclick="sendInvestmentDeskTestNotification()">테스트 알림</button>
      </div>
    </div>
    <div class="investment-desk-modal" id="investment-desk-modal">
      <section class="investment-desk-conclusion ${esc(riskTone)}">
        <span class="investment-badge ${esc(riskTone)}">Market Briefing Desk</span>
        <h4>${esc(briefing.headline || '오늘의 시장 브리핑')}</h4>
        <p>계좌 수치판은 포트폴리오에서 보고, 여기서는 이번 주 거시 변수와 보유 종목의 미시 변수가 만나는 지점을 먼저 봅니다.</p>
        <div class="investment-desk-prep-status">
          <strong>${esc(investmentDeskPrepStatusLabel(prep.status))}</strong>
          <span>${prep.lastPreparedAt ? `마지막 준비 ${formatDateTimeShort(prep.lastPreparedAt)}` : `매일 ${esc(prep.prepareTime || '09:00')} 이후 자동 준비`}</span>
        </div>
      </section>

      ${renderInvestmentDeskPreparationSteps(prep)}

      <section class="investment-portfolio-alerts">
        <div class="investment-portfolio-list-head">
          <strong>거시 브리핑</strong>
          <span>금리·물가·정책·지정학·섹터 흐름이 내 계좌에 주는 압력</span>
        </div>
        ${renderInvestmentBriefingCards(briefing.macroItems, 'macro')}
      </section>

      <section class="investment-portfolio-alerts">
        <div class="investment-portfolio-list-head">
          <strong>미시 브리핑</strong>
          <span>보유 종목별로 실적보다 더 중요한 변수와 확인 지표</span>
        </div>
        ${renderInvestmentBriefingCards(briefing.microItems, 'micro')}
      </section>

      <section class="investment-portfolio-alerts">
        <div class="investment-portfolio-list-head">
          <strong>내 계좌에 주는 의미</strong>
          <span>현재 보유 종목별 핵심 가격 변수와 시장 변수를 연결</span>
        </div>
        ${renderInvestmentBriefingImplications(briefing.portfolioImplications)}
      </section>

      ${(briefing.dataRequests || []).length ? `<section class="investment-portfolio-alerts">
        <h4>브리핑 전에 확인할 자료</h4>
        <ul class="investment-desk-list">${briefing.dataRequests.map(item => `<li>${esc(item)}</li>`).join('')}</ul>
      </section>` : ''}
    </div>`;
}

function investmentDeskPrepStatusLabel(status) {
  return ({
    ready: '오늘 데스크 준비 완료',
    partial: '일부 자료만 준비됨',
    running: '데스크 준비 중',
    failed: '데스크 준비 실패',
  })[status] || '자동 준비 대기';
}

function renderInvestmentDeskPreparationSteps(prep) {
  const steps = Array.isArray(prep?.steps) ? prep.steps : [];
  if (!steps.length) return '';
  const needsAttention = steps.filter(step => !step.ok);
  const isRunning = prep?.status === 'running';
  if (!needsAttention.length && !isRunning) return '';
  const visibleSteps = needsAttention.length ? needsAttention : steps.slice(-1);
  return `<section class="investment-portfolio-alerts investment-desk-prep">
    <div class="investment-portfolio-list-head">
      <strong>${isRunning ? '데스크 준비 중' : '확인 필요한 자료'}</strong>
      <span>${isRunning ? '원장·시세·일정·뉴스를 최신 상태로 맞추는 중입니다.' : '브리핑 품질에 영향을 줄 수 있는 항목만 표시합니다.'}</span>
    </div>
    <div class="investment-briefing-grid">
      ${visibleSteps.map(step => `<article class="investment-briefing-card ${step.ok ? 'watch' : 'block'}">
        <span>${step.ok ? '진행 중' : '확인 필요'}</span>
        <strong>${esc(investmentDeskStepLabel(step.name))}</strong>
        <p>${esc(step.detail || '')}</p>
      </article>`).join('')}
    </div>
  </section>`;
}

function investmentDeskStepLabel(name) {
  return ({
    'server-ledger-sync': '서버 원장 동기화',
    'ledger-save-before-batch': '최신 원장 저장',
    'broker-sync': '증권사 잔고 동기화',
    'market-quote-sync': '현재가·지수·환율 갱신',
    'calendar-sync': '실적·거시 일정 동기화',
    'news-signal-sync': '뉴스·시장 신호 수집',
  })[name] || name || '단계';
}

function renderInvestmentBriefingCards(items, cls) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '<p>저장된 시장 변수나 보유 종목 맥락이 아직 부족합니다.</p>';
  return `<div class="investment-briefing-grid ${esc(cls || '')}">
    ${list.map(item => `<article class="investment-briefing-card">
      <span>${esc(item.source || 'watch')}</span>
      <strong>${esc(item.title || '-')}</strong>
      <p>${esc(item.body || '')}</p>
    </article>`).join('')}
  </div>`;
}

function renderInvestmentBriefingImplications(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '<p>보유 종목과 연결된 브리핑 포인트가 아직 없습니다. 포트폴리오와 뉴스/일정을 먼저 채워주세요.</p>';
  return `<div class="investment-briefing-grid implications">
    ${list.map(item => `<article class="investment-briefing-card ${esc(item.tone || 'watch')}">
      <span>${esc(item.symbol || '계좌')}</span>
      <strong>${esc(item.title || '-')}</strong>
      <p>${esc(item.body || '')}</p>
    </article>`).join('')}
  </div>`;
}

function renderInvestmentDeskPositionReviews(reviews) {
  const list = Array.isArray(reviews) ? reviews : [];
  if (!list.length) return '<p>보유 종목이 없어 계좌 통제 모드를 만들 수 없습니다.</p>';
  return `<div class="investment-desk-position-grid">
    ${list.map(item => `<article class="investment-desk-position ${esc(item.tone || 'allow')}">
      <div>
        <strong>${esc(item.symbol || '-')}</strong>
        <span>${esc(item.name || item.mode || '')}</span>
      </div>
      <div class="investment-desk-position-metrics">
        <span>${Number(item.weight || 0).toFixed(1)}%</span>
        <span>${formatMoney(item.value || 0)}</span>
        <span class="${Number(item.gain || 0) >= 0 ? 'up' : 'down'}">${formatMoneySigned(item.gain || 0)}</span>
      </div>
      <b>${esc(item.mode || '관찰')}</b>
      <p>${esc(item.reason || '')}</p>
    </article>`).join('')}
  </div>`;
}

function renderInvestmentDeskActionList(actions, emptyText) {
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) return `<p>${esc(emptyText)}</p>`;
  return `<ul class="investment-desk-list">${list.map(action => `
    <li><strong>${esc(action.label || action.action || '-')}</strong><span>${esc(action.reason || '')}</span></li>
  `).join('')}</ul>`;
}

function renderModalInvestmentPortfolio() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const slices = getInvestmentPortfolioSlices(inv.positions).sort((a, b) => b.value - a.value);
  const tradableSlices = getTradableInvestmentSlices(inv.positions).sort((a, b) => b.value - a.value);
  const unpriced = getInvestmentUnpricedPositions(inv.positions);
  const totals = investmentTotals(inv.positions);
  const total = totals.totalValue;
  const cashValue = (inv.positions || [])
    .filter(p => isCashInvestmentPosition(p))
    .reduce((sum, p) => sum + investmentPositionValue(p, 'currentPrice'), 0);
  const investedValue = tradableSlices.reduce((sum, p) => sum + p.value, 0);
  const investedCost = tradableSlices.reduce((sum, p) => sum + p.cost, 0);
  const investedGain = investedValue - investedCost;
  const investedGainPercent = investedCost ? (investedGain / investedCost) * 100 : 0;
  if (!slices.length) {
    return `
      <button class="modal-close" onclick="closeModal()">x</button>
      <div class="investment-modal-titlebar">
        <div class="modal-title">포트폴리오</div>
        <div class="investment-action-row">
          <button class="investment-refresh-btn investment-modal-refresh-btn" id="investment-modal-refresh-market" onclick="refreshInvestmentMarketData()">현재가 갱신</button>
          <button class="investment-refresh-btn investment-modal-refresh-btn" id="investment-modal-sync-kis" onclick="syncKisBrokerData()">KIS 동기화</button>
        </div>
      </div>
      <div class="investment-empty">현재가와 수량이 있는 종목을 등록하면 포트폴리오 리포트로 상태를 볼 수 있어요.</div>
      ${renderPortfolioManagementPanel()}`;
  }

  let cursor = 0;
  const gradient = slices.map(p => {
    const start = cursor;
    const end = cursor + (p.weight / 100) * 360;
    cursor = end;
    return `${p.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
  }).join(', ');

  const top = tradableSlices[0] || slices[0];
  const gainRows = (tradableSlices.length ? tradableSlices : slices).map(p => ({ ...p, gain: p.value - p.cost, gainPercent: p.cost ? ((p.value - p.cost) / p.cost) * 100 : 0 }));
  const best = [...gainRows].sort((a, b) => b.gain - a.gain)[0];
  const worst = [...gainRows].sort((a, b) => a.gain - b.gain)[0];
  const staleCount = slices.filter(p => !p.marketUpdatedAt && !p.lastMarketUpdatedAt).length;
  const concentrationLabel = top.weight >= 50 ? '고집중' : top.weight >= 30 ? '집중' : '분산';
  const concentrationTone = top.weight >= 50 ? 'block' : top.weight >= 30 ? 'watch' : 'allow';
  const alerts = buildInvestmentRiskAlerts(inv.positions, inv.rules).slice(0, 4);
  const cleanCoreRules = typeof stripInvestmentPortfolioSnapshotFromRules === 'function'
    ? stripInvestmentPortfolioSnapshotFromRules(inv.rules?.coreRules || '')
    : (inv.rules?.coreRules || '');
  const ruleSummary = cleanCoreRules ? cleanCoreRules : `종목별 최대 비중 ${inv.rules?.maxPositionWeight || 30}% · 쿨다운 ${inv.rules?.cooldownMinutes || 30}분`;
  const updatedAt = inv.market?.fetchedAt || slices.map(p => p.marketUpdatedAt || p.lastMarketUpdatedAt).filter(Boolean).sort().at(-1) || '';

  return `
    <button class="modal-close" onclick="closeModal()">x</button>
    <div class="investment-modal-titlebar">
      <div class="modal-title">포트폴리오 리포트</div>
      <div class="investment-action-row">
        <button class="investment-refresh-btn investment-modal-refresh-btn" id="investment-modal-refresh-market" onclick="refreshInvestmentMarketData()">현재가 갱신</button>
        <button class="investment-refresh-btn investment-modal-refresh-btn" id="investment-modal-sync-kis" onclick="syncKisBrokerData()">KIS 동기화</button>
      </div>
    </div>
    <div class="investment-portfolio-modal" id="investment-portfolio-modal">
      <div class="investment-portfolio-overview">
        <div><span>총 평가액</span><strong>${formatMoney(totals.totalValue)}</strong>${formatKrwApprox(totals.totalValue)}</div>
        <div><span>현금</span><strong>${formatMoney(cashValue)}</strong><small class="investment-krw-approx">비중 ${total ? (cashValue / total * 100).toFixed(1) : '0.0'}%</small></div>
        <div><span>주식/코인 평가액</span><strong>${formatMoney(investedValue)}</strong>${formatKrwApprox(investedValue)}</div>
        <div><span>주식/코인 매입금</span><strong>${formatMoney(investedCost)}</strong>${formatKrwApprox(investedCost)}</div>
        <div><span>평가손익</span><strong class="${investedGain >= 0 ? 'up' : 'down'}">${formatMoneySigned(investedGain)}</strong>${formatKrwApprox(investedGain, true)}</div>
        <div><span>투자 수익률</span><strong class="${investedGain >= 0 ? 'up' : 'down'}">${formatPercent(investedGainPercent)}</strong></div>
        <div><span>최대 보유</span><strong>${esc(top.symbol || '-')} ${top.weight.toFixed(1)}%</strong></div>
        <div><span>집중도</span><strong class="${concentrationTone}">${concentrationLabel}</strong></div>
        <div><span>가격 상태</span><strong>${staleCount ? `${staleCount}개 갱신 필요` : '최신'}</strong></div>
        <div><span>위험 신호</span><strong>${alerts.length}개</strong></div>
      </div>

      <section class="investment-portfolio-status">
        <div>
          <span class="investment-badge ${concentrationTone}">${concentrationLabel}</span>
          <h4>현재 상태</h4>
          <p>최대 보유 종목은 <strong>${esc(top.symbol || '-')}</strong>이고 포트폴리오의 <strong>${top.weight.toFixed(1)}%</strong>를 차지합니다. ${top.weight >= 50 ? '단일 종목 변동성이 전체 성과를 크게 흔드는 구조입니다.' : top.weight >= 30 ? '핵심 종목 중심 구조라 비중 점검이 필요합니다.' : '상대적으로 분산된 구조입니다.'}</p>
          <p>가격 갱신: ${updatedAt ? formatDateTimeShort(updatedAt) : '기록 없음'}${staleCount ? ` · ${staleCount}개 종목은 현재가 갱신이 필요합니다.` : ''}</p>
        </div>
        <div>
          <h4>투자 원칙 체크</h4>
          <p>${esc(ruleSummary)}</p>
          <p>최대 비중 원칙 ${inv.rules?.maxPositionWeight || 30}% 기준으로 ${top.weight > (inv.rules?.maxPositionWeight || 30) ? '초과 상태입니다.' : '허용 범위입니다.'}</p>
        </div>
        <div>
          <h4>성과 기여</h4>
          <p>최대 플러스: <strong>${esc(best.symbol || '-')}</strong> ${formatMoneySigned(best.gain)} (${formatPercent(best.gainPercent)})</p>
          <p>최대 마이너스: <strong>${esc(worst.symbol || '-')}</strong> ${formatMoneySigned(worst.gain)} (${formatPercent(worst.gainPercent)})</p>
        </div>
      </section>

      <div class="investment-pie-wrap">
        <div class="investment-pie-chart" style="background: conic-gradient(${gradient});">
          <div>
            <span>총 평가액</span>
            <strong>${formatMoney(total)}</strong>
            ${formatKrwApprox(total)}
            <small>${slices.length}개 종목</small>
          </div>
        </div>
      </div>

      <div class="investment-portfolio-list">
        <div class="investment-portfolio-list-head">
          <strong>보유 종목 분석</strong>
          <span>비중 · 평가액 · 손익 · 가격 상태</span>
        </div>
        ${slices.map(p => {
          const gain = p.value - p.cost;
          const gainPercent = p.cost ? (gain / p.cost) * 100 : 0;
          const priceFresh = p.marketUpdatedAt || p.lastMarketUpdatedAt;
          const isCash = isCashInvestmentPosition(p);
          return `<div class="investment-portfolio-row">
            <span class="investment-dot" style="background:${p.color}"></span>
            <div class="investment-portfolio-name">
              <strong>${esc(p.symbol || p.name || '종목')}</strong>
              <small>${esc(p.name || '')}${isCash ? ' · 현금' : p.assetType === 'crypto' ? ' · 코인' : ''}</small>
            </div>
            <em>${p.weight.toFixed(1)}%</em>
            <b>${formatMoney(p.value)}</b>
            <small class="investment-portfolio-detail">${isCash ? `보유 현금 ${formatMoney(p.value)} · ${formatKrwApproxText(p.value)}` : `수량 ${formatShares(p.shares)} · 평단 ${formatMoney(p.avgPrice)} · 현재 ${formatMoney(p.currentPrice)} · 매입금 ${formatMoney(p.cost)}`}</small>
            <small class="investment-portfolio-detail ${gain >= 0 ? 'up' : 'down'}">${isCash ? '즉시 투입 가능한 대기 자금' : `손익 ${formatMoneySigned(gain)} · ${formatPercent(gainPercent)} · ${priceFresh ? `갱신 ${formatDateTimeShort(priceFresh)}` : '현재가 갱신 필요'}`}</small>
          </div>`;
        }).join('')}
        ${unpriced.length ? `<div class="investment-portfolio-list-head investment-portfolio-subhead">
          <strong>현재가 미조회 종목</strong>
          <span>저장은 되었지만 평가액 계산에서 제외됨</span>
        </div>
        ${unpriced.map(p => `<div class="investment-portfolio-row investment-portfolio-row-muted">
          <span class="investment-dot muted"></span>
          <div class="investment-portfolio-name">
            <strong>${esc(p.symbol || p.name || '종목')}</strong>
            <small>${esc(p.name || '')}${p.assetType === 'crypto' ? ' · 코인' : ''}</small>
          </div>
          <em>-</em>
          <b>현재가 필요</b>
          <small class="investment-portfolio-detail">수량 ${formatShares(p.shares)} · 평단 ${formatMoney(p.avgPrice)} · 매입금 ${formatMoney(p.cost)}</small>
          <small class="investment-portfolio-detail">현재가 갱신 또는 종목 코드를 확인해주세요.</small>
        </div>`).join('')}` : ''}
      </div>


      ${renderPortfolioManagementPanel()}

      <section class="investment-portfolio-alerts">
        <h4>위험 신호</h4>
        ${alerts.length ? alerts.map(a => `<div class="investment-alert ${esc(a.severity || 'watch')}"><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p></div>`).join('') : '<p>현재 등록된 목표가·손절가·비중 기준에서 즉시 표시할 위험 신호는 없습니다.</p>'}
      </section>
    </div>`;
}
function renderInvestmentPositionForm() {
  return `<form class="investment-form" id="investment-position-form" onsubmit="addInvestmentPositionFromForm(event)">
    <div class="investment-form-toolbar">
      <span>입력 기준: 달러(USD)</span>
      <small>원화는 포트폴리오에서 보조 환산으로 표시됩니다.</small>
    </div>
    <div class="investment-form-row">
      <select class="form-input" id="ip-asset-type" onchange="syncInvestmentPositionAssetType()">
        <option value="stock">주식/ETF</option>
        <option value="crypto">코인</option>
        <option value="cash">현금</option>
      </select>
      <div class="investment-form-hint">코인은 ETH, Ethereum, 이더리움처럼 입력해도 됩니다.</div>
    </div>
    <div class="investment-form-row">
    <input type="hidden" id="ip-id" value="">
      <input class="form-input" id="ip-symbol" placeholder="종목 코드" autocomplete="off">
      <input class="form-input" id="ip-name" placeholder="종목명" autocomplete="off">
    </div>
    <div class="investment-form-row">
      <input class="form-input" id="ip-shares" type="text" inputmode="decimal" placeholder="수량">
      <input class="form-input" id="ip-avg" type="number" min="0" step="0.01" placeholder="평균 단가 ($)">
    </div>
    <div class="investment-form-row">
      <input class="form-input" id="ip-target" type="number" min="0" step="0.01" placeholder="목표가 ($)">
      <input class="form-input" id="ip-stop" type="number" min="0" step="0.01" placeholder="손절가 ($)">
      <label class="investment-check"><input id="ip-longterm" type="checkbox"> 장기보유</label>
    </div>
    <textarea class="form-input investment-textarea" id="ip-thesis" placeholder="투자 논리"></textarea>
    <textarea class="form-input investment-textarea" id="ip-add-rule" placeholder="추가매수 조건"></textarea>
    <div class="investment-form-actions">
      <button class="btn-primary investment-primary" id="investment-add-position" type="submit">종목 저장</button>
      <button class="btn-ghost" id="investment-cancel-edit" type="button" onclick="clearInvestmentPositionForm()">입력 초기화</button>
    </div>
  </form>`;
}

function renderPortfolioManagementPanel() {
  const positions = normalizeInvestmentState(state.investment).positions;
  return `<section class="investment-portfolio-manage" id="investment-portfolio-manage">
    <div class="investment-portfolio-list-head">
      <strong>종목 관리</strong>
      <span>추가·수정은 필요할 때만 열어서 사용</span>
    </div>
    <details class="investment-manage-tools" id="investment-manage-tools">
      <summary>
        <span>종목 추가 / 수정</span>
        <small>주식, 코인, 현금 등록</small>
      </summary>
      ${renderInvestmentPositionForm()}
    </details>
    <div class="investment-manage-list">
      ${positions.length ? positions.map(p => `<div class="investment-manage-row">
        <div>
          <strong>${esc(p.symbol || '-')}</strong>
          <small>${esc(p.name || '')} · ${isCashInvestmentPosition(p) ? `현금 ${formatMoney(investmentPositionValue(p, 'currentPrice'))}` : `${p.assetType === 'crypto' ? '코인' : '주식'} · 수량 ${formatShares(p.shares)} · 평단 ${formatMoney(p.avgPrice)}`}</small>
        </div>
        <div>
          <button type="button" onclick="editInvestmentPosition('${esc(p.id)}')">수정</button>
          <button type="button" class="danger" onclick="deleteInvestmentPosition('${esc(p.id)}')">삭제</button>
        </div>
      </div>`).join('') : '<div class="investment-empty">아직 등록된 종목이 없습니다.</div>'}
    </div>
  </section>`;
}

function renderInvestmentRulesSummary(rules) {
  const chips = [
    `하루 손실 ${rules.dailyLossLimit}%`,
    `종목 비중 ${rules.maxPositionWeight}%`,
    `쿨다운 ${rules.cooldownMinutes}분`,
    `추격 ${rules.chaseLimit}%`,
    `거래 리스크 ${rules.riskPerTrade ?? 1}%`,
    `손익비 ${rules.minRiskReward ?? 2}:1`,
  ];
  const blocks = [
    ['핵심 원칙', rules.coreRules],
    ['진입 체크리스트', rules.entryChecklist],
    ['청산 기준', rules.exitChecklist],
    ['금지 셋업', rules.bannedSetups],
    ['복기 루틴', rules.reviewRoutine],
  ];
  return `<section class="investment-rules-overview">
    <div class="investment-rules-chip-row">
      ${chips.map(chip => `<span>${esc(chip)}</span>`).join('')}
    </div>
    ${blocks.map(([label, body]) => `<article class="investment-rule-card">
      <h4>${esc(label)}</h4>
      <div class="chat-markdown">${renderMarkdownBasic(body || '아직 설정된 내용이 없습니다. 대화창에서 정한 뒤 저장하거나 수동 편집을 열어 입력할 수 있습니다.')}</div>
    </article>`).join('')}
  </section>`;
}

function renderInvestmentRulesForm(rules) {
  return `<form class="investment-form" onsubmit="saveInvestmentRulesFromForm(event)">
    <section class="investment-trader-panel">
      <div class="investment-panel-head">
        <strong>리스크 한도</strong>
        <span>주문 전에 숫자로 먼저 막는 기준</span>
      </div>
      <div class="investment-form-row">
        <label>매매 스타일
          <select class="form-input" id="ir-style">
            ${[['day','데이/단기'], ['swing','스윙'], ['position','포지션'], ['long','장기']].map(([v, label]) => `<option value="${v}"${(rules.tradingStyle || 'swing') === v ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label>1회 거래 리스크 %<input class="form-input" id="ir-risk-trade" type="number" step="0.1" value="${esc(rules.riskPerTrade ?? 1)}"></label>
      </div>
      <div class="investment-form-row">
        <label>하루 손실 한도 %<input class="form-input" id="ir-daily-loss" type="number" step="0.1" value="${esc(rules.dailyLossLimit)}"></label>
        <label>하루 최대 거래 수<input class="form-input" id="ir-max-trades" type="number" step="1" value="${esc(rules.maxDailyTrades ?? 3)}"></label>
      </div>
      <div class="investment-form-row">
        <label>종목별 최대 비중 %<input class="form-input" id="ir-max-weight" type="number" step="0.1" value="${esc(rules.maxPositionWeight)}"></label>
        <label>최소 손익비<input class="form-input" id="ir-min-rr" type="number" step="0.1" value="${esc(rules.minRiskReward ?? 2)}"></label>
      </div>
      <div class="investment-form-row">
        <label>쿨다운 시간<input class="form-input" id="ir-cooldown" type="number" step="1" value="${esc(rules.cooldownMinutes)}"></label>
        <label>추격매수 제한 %<input class="form-input" id="ir-chase" type="number" step="0.1" value="${esc(rules.chaseLimit)}"></label>
      </div>
      <label class="investment-check"><input id="ir-no-loss" type="checkbox" ${rules.noTradeAfterLoss !== false ? 'checked' : ''}> 손실 직후 즉시 재진입 금지</label>
    </section>

    <section class="investment-trader-panel">
      <div class="investment-panel-head">
        <strong>진입 / 청산 체크리스트</strong>
        <span>AI가 매매 전 판단할 때 기준으로 삼는 문장</span>
      </div>
      <textarea class="form-input investment-textarea" id="ir-entry" placeholder="진입 전 반드시 확인할 조건&#10;예: 추세가 살아있고, 손절 위치가 명확하며, 손익비 2:1 이상일 때만 진입">${esc(rules.entryChecklist || '')}</textarea>
      <textarea class="form-input investment-textarea" id="ir-exit" placeholder="청산/보유 판단 기준&#10;예: 목표가 도달 시 절반 익절, 투자 논리 훼손 시 가격과 무관하게 정리">${esc(rules.exitChecklist || '')}</textarea>
    </section>

    <section class="investment-trader-panel">
      <div class="investment-panel-head">
        <strong>금지 셋업과 핵심 원칙</strong>
        <span>내가 반복해서 망가지는 행동을 먼저 차단</span>
      </div>
      <textarea class="form-input investment-textarea" id="ir-banned" placeholder="금지 셋업&#10;예: 뉴스 보고 바로 시장가 매수, 손실 직후 물타기, 목표가 도달 후 근거 없이 홀딩">${esc(rules.bannedSetups || '')}</textarea>
      <textarea class="form-input investment-textarea" id="ir-core" placeholder="내 핵심 투자 원칙">${esc(rules.coreRules || '')}</textarea>
      <textarea class="form-input investment-textarea" id="ir-review" placeholder="복기 루틴&#10;예: 매주 일요일 보유 논리, 손절 회피, 추격매수 여부를 점검">${esc(rules.reviewRoutine || '')}</textarea>
    </section>

    <div class="investment-form-row">
      <label class="investment-check"><input id="ir-strict" type="checkbox" ${rules.strictMode ? 'checked' : ''}> 엄격 모드</label>
      <label class="investment-check"><input id="ir-longterm" type="checkbox" ${rules.longTermBias ? 'checked' : ''}> 장기보유 논리 우선</label>
      <label class="investment-check"><input id="ir-anti-avg" type="checkbox" ${rules.antiAveraging ? 'checked' : ''}> 감정적 물타기 제한</label>
    </div>
    <button class="btn-primary investment-primary" id="investment-save-rules" type="submit">원칙 저장</button>
  </form>`;
}

function renderModalInvestmentPlan() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const latestDecisions = (inv.decisions || []).slice(-5);
  return `
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-title">원칙·매매</div>
    <div class="investment-hub-modal" id="investment-plan-modal">
      <section class="investment-hub-grid">
        <button class="investment-hub-card" id="investment-hub-rules" onclick="openModal('investment-rules')">
          <strong>투자 원칙</strong>
          <span>방향성, 비중 한도, 손절/익절 기준을 한곳에서 관리합니다.</span>
        </button>
        <button class="investment-hub-card" id="investment-hub-decisions" onclick="openModal('investment-timeline')">
          <strong>투자 타임라인</strong>
          <span>매매, 매도 포인트, 뉴스, 일정, 신호를 한 흐름으로 봅니다.</span>
        </button>
      </section>
      <section class="investment-news-overview">
        <div><span>최대 비중</span><strong>${esc(inv.rules?.maxPositionWeight || 30)}%</strong></div>
        <div><span>쿨다운</span><strong>${esc(inv.rules?.cooldownMinutes || 30)}분</strong></div>
        <div><span>매매 기록</span><strong>${(inv.decisions || []).length}</strong></div>
        <div><span>최근 판단</span><strong>${esc((inv.decisions || []).at(-1)?.label || '-')}</strong></div>
      </section>
      <section class="investment-news-list">
        <div class="investment-portfolio-list-head">
          <strong>최근 매매 판단</strong>
          <span>대화에서 확정한 매매도 여기에 쌓입니다.</span>
        </div>
        ${renderInvestmentDecisionList(latestDecisions)}
      </section>
    </div>`;
}

function renderModalInvestmentResearch() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const newsCount = (inv.events || []).filter(e => e.type === 'news').length;
  const signalCount = (inv.events || []).filter(e => e.type === 'signal').length;
  const timelineCount = (inv.events || []).length + (inv.decisions || []).length;
  const upcomingCount = (inv.events || []).filter(e => e.type !== 'news' && e.type !== 'signal').length;
  return `
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="investment-modal-titlebar">
      <div class="modal-title">뉴스·일정</div>
      <div class="investment-action-row">
        <button class="investment-refresh-btn investment-modal-refresh-btn" id="investment-hub-calendar-sync" onclick="syncInvestmentCalendarData()">일정 동기화</button>
      </div>
    </div>
    <div class="investment-hub-modal" id="investment-research-modal">
      <section class="investment-hub-grid">
        <button class="investment-hub-card" id="investment-hub-news" onclick="openModal('investment-timeline')">
          <strong>투자 타임라인</strong>
          <span>뉴스, 공시, 일정, 매매 기록을 한 화면에서 같이 봅니다.</span>
        </button>
        <button class="investment-hub-card" id="investment-hub-timeline" onclick="openModal('investment-timeline')">
          <strong>타임라인</strong>
          <span>뉴스, 일정, 판단, 매매를 시간순으로 묶습니다.</span>
        </button>
        <button class="investment-hub-card" id="investment-hub-signals" onclick="openModal('investment-signals')">
          <strong>검색 신호</strong>
          <span>중요 출처, X/웹 신호, 애널리스트 코멘트를 저장합니다.</span>
        </button>
        <button class="investment-hub-card" id="investment-hub-ai-compare" onclick="openModal('investment-ai-compare')">
          <strong>AI 비교</strong>
          <span>같은 질문을 Claude/OpenAI 관점으로 비교합니다.</span>
        </button>
      </section>
      <section class="investment-news-overview">
        <div><span>뉴스</span><strong>${newsCount}</strong></div>
        <div><span>검색 신호</span><strong>${signalCount}</strong></div>
        <div><span>일정</span><strong>${upcomingCount}</strong></div>
        <div><span>타임라인</span><strong>${timelineCount}</strong></div>
      </section>
      <section class="investment-news-guide">
        <h4>사용 방식</h4>
        <p>평소에는 대화창에서 "IREN 최신 뉴스 찾아줘", "이걸 뉴스 동향에 저장해줘", "실적 발표 일정 추가해줘"처럼 말하고, 이 화면은 저장된 자료를 확인하는 데 씁니다.</p>
      </section>
    </div>`;
}

function renderModalInvestmentRules() {
  return renderModalInvestmentDesk();
}

function renderInvestmentGateForm(positions) {
  const tradable = (positions || []).filter(p => !isCashInvestmentPosition(p));
  return `<form class="investment-form" id="investment-gate-form" onsubmit="runInvestmentGateFromForm(event)">
    <div class="investment-form-toolbar">
      <span>체결가 입력 기준: 달러(USD)</span>
      <small>원화는 기록 저장 후 보조 환산으로만 확인합니다.</small>
    </div>
    <section class="investment-trader-panel">
      <div class="investment-panel-head">
        <strong>거래 개요</strong>
        <span>무슨 셋업을 어떤 시간축에서 실행하는지 먼저 고정</span>
      </div>
    <select class="form-input" id="ig-position" ${tradable.length ? '' : 'disabled'}>
      ${tradable.length
        ? tradable.map(p => `<option value="${esc(p.id)}">${esc(p.symbol || p.name || p.id)}</option>`).join('')
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
    <div class="investment-form-row">
      <select class="form-input" id="ig-setup">
        <option value="planned">계획된 셋업</option>
        <option value="breakout">돌파</option>
        <option value="pullback">눌림목</option>
        <option value="earnings">실적/이벤트</option>
        <option value="rebalance">리밸런싱</option>
        <option value="impulse">충동 의심</option>
      </select>
      <select class="form-input" id="ig-timeframe">
        <option value="intraday">당일</option>
        <option value="swing">수일~수주</option>
        <option value="position">수개월</option>
        <option value="long">장기</option>
      </select>
    </div>
    </section>

    <section class="investment-trader-panel">
      <div class="investment-panel-head">
        <strong>주문 계획</strong>
        <span>가격, 손절, 목표가가 비어 있으면 기록이 아니라 충동에 가깝습니다</span>
      </div>
      <div class="investment-form-row">
      <input class="form-input" id="ig-shares" type="text" inputmode="decimal" placeholder="체결 수량">
      <input class="form-input" id="ig-price" type="number" min="0" step="0.01" placeholder="체결가 ($)">
      </div>
      <div class="investment-form-row">
        <input class="form-input" id="ig-stop" type="number" min="0" step="0.01" placeholder="계획 손절가 ($)">
        <input class="form-input" id="ig-target" type="number" min="0" step="0.01" placeholder="계획 목표가 ($)">
      </div>
      <div class="investment-form-row">
        <input class="form-input" id="ig-risk-reward" type="number" min="0" step="0.1" placeholder="손익비 예: 2">
        <select class="form-input" id="ig-order-type">
          <option value="limit">지정가</option>
          <option value="market">시장가</option>
          <option value="stop">스탑/조건부</option>
        </select>
      </div>
      <div class="investment-form-hint">판단이 진행 가능이고 수량/체결가가 있으면 포트폴리오에 자동 반영됩니다.</div>
    </section>

    <section class="investment-trader-panel">
      <div class="investment-panel-head">
        <strong>주문 전 확인</strong>
        <span>체크가 비어 있으면 AI가 보수적으로 봅니다</span>
      </div>
      <div class="investment-check-grid">
        <label class="investment-check"><input id="ig-check-thesis" type="checkbox"> 투자 논리 유지</label>
        <label class="investment-check"><input id="ig-check-risk" type="checkbox"> 손절 위치 명확</label>
        <label class="investment-check"><input id="ig-check-size" type="checkbox"> 비중/수량 허용</label>
        <label class="investment-check"><input id="ig-check-cooldown" type="checkbox"> 쿨다운 통과</label>
      </div>
      <textarea class="form-input investment-textarea" id="ig-invalidation" placeholder="무효화 조건: 어떤 일이 생기면 이 거래 아이디어가 틀린 것인가"></textarea>
      <textarea class="form-input investment-textarea" id="ig-reason" placeholder="지금 이 행동을 하려는 이유와 사전 계획"></textarea>
    </section>
    <button class="btn-primary investment-primary" id="investment-gate-run" type="submit" ${tradable.length ? '' : 'disabled'}>점검하기</button>
  </form>`;
}

function renderModalInvestmentDecisions() {
  return `
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-title">매매 저널</div>
    <div id="investment-result">${state.investment.decisions.length ? renderInvestmentVerdict(state.investment.decisions.at(-1)) : ''}</div>
    ${renderInvestmentDecisionList(state.investment.decisions)}
    <details class="investment-manage-tools investment-manual-tools" id="investment-gate-tools">
      <summary>
        <span>수동 매매 점검</span>
        <small>대화 대신 직접 주문 전 게이트 작성</small>
      </summary>
      <div class="investment-modal-note">거래를 실행하기 전에 셋업, 손익비, 무효화 조건을 먼저 남깁니다. 기본 흐름은 대화창에서 결정하고, 필요한 경우에만 이 폼을 사용하세요.</div>
      ${renderInvestmentGateForm(state.investment.positions)}
    </details>`;
}

function renderModalInvestmentNews() {
  const news = state.investment.events.filter(e => e.type === 'news').slice().reverse();
  const symbols = [...new Set(news.map(e => String(e.symbol || '').trim().toUpperCase()).filter(Boolean))];
  const latestDate = news.map(e => e.date || '').filter(Boolean).sort().at(-1) || '';
  const latest = news[0];
  return `
    <button class="modal-close" onclick="closeModal()">x</button>
    <div class="modal-title">뉴스 동향 리포트</div>
    <div class="investment-news-modal" id="investment-news-modal">
      <section class="investment-news-overview">
        <div><span>저장 뉴스</span><strong>${news.length}</strong></div>
        <div><span>관련 종목</span><strong>${symbols.length ? symbols.join(', ') : '전체'}</strong></div>
        <div><span>최근 기록일</span><strong>${latestDate || '-'}</strong></div>
        <div><span>최근 주제</span><strong>${esc(latest?.title || '-')}</strong></div>
      </section>

      <section class="investment-news-guide">
        <h4>뉴스 기록 방식</h4>
        <p>대화창에서 최신 뉴스와 원칙 관점 해석을 먼저 논의한 뒤, "뉴스 동향에 기록해줘"라고 말하면 여기에 누적됩니다.</p>
        <p>저장된 내용은 마크다운으로 렌더링되므로 제목, 목록, 원문 링크를 그대로 보관할 수 있습니다.</p>
      </section>

      <section class="investment-news-list">
        ${news.length ? news.map(e => `<article class="investment-news-card">
          <header>
            <span class="investment-badge allow">뉴스</span>
            <div>
              <strong>${esc(e.symbol || '투자')} · ${esc(e.title || '뉴스 동향')}</strong>
              <small>${esc(e.date || '')}</small>
            </div>
          </header>
          <div class="investment-news-body chat-markdown">${renderMarkdownBasic(e.body || '')}</div>
        </article>`).join('') : '<div class="investment-empty">저장된 뉴스 동향이 없습니다.</div>'}
      </section>

      <details class="investment-manage-tools investment-manual-tools" id="investment-news-edit-tools">
        <summary>
          <span>수동 뉴스 추가</span>
          <small>직접 붙여넣어 저장</small>
        </summary>
        <form class="investment-form investment-news-form" id="investment-news-form" onsubmit="addInvestmentNewsFromForm(event)">
          <div class="investment-form-row">
            <input class="form-input" id="in-symbol" placeholder="종목/이슈" autocomplete="off">
            <input class="form-input" id="in-title" placeholder="뉴스 제목" autocomplete="off">
            <input class="form-input" id="in-date" type="date" value="${new Date().toISOString().split('T')[0]}">
          </div>
          <textarea class="form-input investment-textarea investment-news-textarea" id="in-body" placeholder="뉴스 내용과 나의 해석을 마크다운으로 기록"></textarea>
          <button class="btn-primary investment-primary" type="submit">뉴스 저장</button>
        </form>
      </details>
    </div>`;
}

function renderModalInvestmentSignals() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const signals = (inv.events || []).filter(e => e.type === 'signal').slice().reverse();
  const latestDate = signals.map(e => e.date || '').filter(Boolean).sort().at(-1) || '';
  return `
    <button class="modal-close" onclick="closeModal()">x</button>
    <div class="modal-title">Search signals</div>
    <div class="investment-news-modal" id="investment-signals-modal">
      <section class="investment-news-overview">
        <div><span>Saved signals</span><strong>${signals.length}</strong></div>
        <div><span>Source</span><strong>On demand</strong></div>
        <div><span>Last signal</span><strong>${latestDate || '-'}</strong></div>
        <div><span>Auto X sync</span><strong>Paused</strong></div>
      </section>
      <section class="investment-news-guide">
        <h4>How this works</h4>
        <p>Automatic X monitoring is paused. Ask the investment chat to search news, filings, analyst comments, or public web coverage when you need it. If a source matters, say "save this as a signal" and it will appear here, in the timeline, and on the calendar.</p>
      </section>
      <div class="investment-action-row">
        <button class="investment-refresh-btn" id="investment-notification-permission" onclick="requestInvestmentNotifications()">Enable alerts</button>
      </div>
      <section class="investment-news-list">
        <div class="investment-portfolio-list-head"><strong>Saved signal feed</strong><span>Also appears in timeline and calendar.</span></div>
        ${signals.length ? signals.map(e => `<article class="investment-news-card">
          <header><span class="investment-badge watch">Signal</span><div><strong>${esc(e.symbol ? `${e.symbol} · ${e.title || 'Signal'}` : e.title || 'Signal')}</strong><small>${esc(e.date || '')}${e.handle ? ` · @${esc(e.handle)}` : ''}</small></div></header>
          <div class="investment-news-body chat-markdown">${renderMarkdownBasic(e.body || '')}</div>
          ${e.sourceUrl ? `<a class="investment-source-link" href="${esc(e.sourceUrl)}" target="_blank" rel="noopener">Open source</a>` : ''}
        </article>`).join('') : '<div class="investment-empty">No saved market signals yet.</div>'}
      </section>
      <details class="investment-manage-tools investment-manual-tools" id="investment-signal-manual-tools">
        <summary><span>Save source manually</span><small>Paste news, filing, X, or analyst links after checking them.</small></summary>
        <form class="investment-form" id="investment-signal-form" onsubmit="addInvestmentSignalFromForm(event)">
          <div class="investment-form-row">
            <input class="form-input" id="is-symbol" placeholder="Symbol, e.g. IREN" autocomplete="off">
            <input class="form-input" id="is-handle" placeholder="@handle" autocomplete="off">
            <input class="form-input" id="is-date" type="date" value="${new Date().toISOString().split('T')[0]}">
          </div>
          <input class="form-input" id="is-title" placeholder="Signal title" autocomplete="off">
          <input class="form-input" id="is-url" placeholder="Source URL" autocomplete="off">
          <textarea class="form-input investment-textarea investment-news-textarea" id="is-body" placeholder="What happened, why it matters, what must be verified"></textarea>
          <button class="btn-primary investment-primary" type="submit">Save signal</button>
        </form>
      </details>
    </div>`;
}

function investmentTimelineDisplayTitle(item) {
  const symbol = String(item?.symbol || '').trim();
  const title = translateInvestmentTimelineText(String(item?.title || '').trim());
  if (!symbol) return title || '투자 이벤트';
  if (!title) return symbol;
  const cleanTitle = stripLeadingInvestmentSymbol(title, symbol);
  if (!cleanTitle) return symbol;
  if (cleanTitle !== title) return `${symbol} ${cleanTitle}`;
  return `${symbol} · ${cleanTitle}`;
}

function translateInvestmentTimelineText(text) {
  let value = String(text || '').trim();
  if (!value) return '';
  const replacements = [
    [/Circle news/gi, '\uc11c\ud074 \ub274\uc2a4'],
    [/Stablecoin policy update/gi, '\uc2a4\ud14c\uc774\ube14\ucf54\uc778 \uc815\ucc45 \uc5c5\ub370\uc774\ud2b8'],
    [/Planned entry memo/gi, '\uacc4\ud68d \uc9c4\uc785 \uba54\ubaa8'],
    [/IREN expands AI cloud capacity/gi, 'IREN, AI \ud074\ub77c\uc6b0\ub4dc \uc6a9\ub7c9 \ud655\ub300'],
    [/IREN announced an AI data center update/gi, 'IREN\uc774 AI \ub370\uc774\ud130\uc13c\ud130 \uc5c5\ub370\uc774\ud2b8\ub97c \ubc1c\ud45c\ud588\uc2b5\ub2c8\ub2e4'],
    [/Realized profit before earnings/gi, '\uc2e4\uc801 \uc804 \uc218\uc775 \uc2e4\ud604'],
    [/Q3 earnings call/gi, 'Q3 \uc2e4\uc801 \ubc1c\ud45c \ubc0f \ucee8\ud37c\ub7f0\uc2a4\ucf5c'],
    [/Chat note/gi, '\ub300\ud654 \uba54\ubaa8'],
    [/Partial sell/gi, '\uc77c\ubd80 \ub9e4\ub3c4'],
    [/Market signal/gi, '\uc2dc\uc7a5 \uc2e0\ud638'],
    [/policy update/gi, '\uc815\ucc45 \uc5c5\ub370\uc774\ud2b8'],
    [/data center update/gi, '\ub370\uc774\ud130\uc13c\ud130 \uc5c5\ub370\uc774\ud2b8'],
    [/AI cloud/gi, 'AI \ud074\ub77c\uc6b0\ub4dc'],
    [/earnings/gi, '\uc2e4\uc801'],
    [/call/gi, '\ucee8\ud37c\ub7f0\uc2a4\ucf5c'],
    [/news/gi, '\ub274\uc2a4'],
    [/signal/gi, '\uc2e0\ud638'],
    [/sell/gi, '\ub9e4\ub3c4'],
    [/buy/gi, '\ub9e4\uc218'],
    [/entry/gi, '\uc9c4\uc785'],
    [/memo/gi, '\uba54\ubaa8'],
    [/update/gi, '\uc5c5\ub370\uc774\ud2b8'],
  ];
  replacements.forEach(([pattern, replacement]) => {
    value = value.replace(pattern, replacement);
  });
  return value;
}

function stripLeadingInvestmentSymbol(title, symbol) {
  let clean = String(title || '').trim();
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!clean || !normalizedSymbol) return clean;
  for (let i = 0; i < 4; i++) {
    const normalizedTitle = clean.toUpperCase();
    if (normalizedTitle === normalizedSymbol) return '';
    if (normalizedTitle.startsWith(`${normalizedSymbol} · `)) {
      clean = clean.slice(normalizedSymbol.length + 3).trim();
    } else if (normalizedTitle.startsWith(`${normalizedSymbol} - `)) {
      clean = clean.slice(normalizedSymbol.length + 3).trim();
    } else if (normalizedTitle.startsWith(`${normalizedSymbol}, `)) {
      clean = clean.slice(normalizedSymbol.length + 2).trim();
    } else if (normalizedTitle.startsWith(`${normalizedSymbol}: `)) {
      clean = clean.slice(normalizedSymbol.length + 2).trim();
    } else if (normalizedTitle.startsWith(`${normalizedSymbol}-`)) {
      clean = clean.slice(normalizedSymbol.length + 1).trim();
    } else if (normalizedTitle.startsWith(`${normalizedSymbol}:`)) {
      clean = clean.slice(normalizedSymbol.length + 1).trim();
    } else if (normalizedTitle.startsWith(`${normalizedSymbol} `)) {
      clean = clean.slice(normalizedSymbol.length).trim();
    } else {
      break;
    }
  }
  return clean;
}

function buildUnifiedInvestmentTimelineRows(inv) {
  const decisionIds = new Set((inv.decisions || []).map(d => String(d.id || '')).filter(Boolean));
  const shadowEventTypes = new Set(['trade', 'trade-note', 'alert']);
  const events = (inv.events || [])
    .filter(e => {
      const linkedDecisionId = String(e.linkedDecisionId || '');
      return !(linkedDecisionId && decisionIds.has(linkedDecisionId) && shadowEventTypes.has(e.type));
    })
    .map(e => ({
    id: e.id || `event-${Math.random()}`,
    date: e.date || (e.createdAt || '').slice(0, 10) || '',
    createdAt: e.createdAt || e.date || '',
    type: e.type || 'event',
    symbol: e.symbol || '',
    title: e.title || '투자 이벤트',
    body: e.body || '',
    severity: e.severity || 'info',
  }));
  const decisions = (inv.decisions || []).map(d => ({
    id: d.id || `decision-${Math.random()}`,
    date: (d.createdAt || '').slice(0, 10) || '',
    createdAt: d.createdAt || '',
    type: 'decision',
    symbol: d.symbol || '',
    action: d.action || '',
    title: `${investmentActionLabel(d.action)} · ${stripLeadingInvestmentSymbol(d.label || '판단', d.symbol || '') || '판단'}`,
    body: d.summary || d.reason || '',
    severity: d.verdict || 'info',
    tradeShares: parseInvestmentNumber(d.tradeShares),
    tradePrice: parseInvestmentNumber(d.tradePrice),
    proceeds: parseInvestmentNumber(d.proceeds),
    realizedGain: parseInvestmentNumber(d.realizedGain),
    accountTotal: parseInvestmentNumber(d.accountTotal),
  }));
  const seen = new Set();
  return [...events, ...decisions]
    .filter(r => r.date || r.title || r.body)
    .filter(r => {
      const key = String(r.id || `${r.type}-${r.date}-${r.symbol}-${r.title}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')))
    .slice(0, 120);
}

function investmentTimelineKnownSymbols(inv) {
  const symbols = new Set();
  (inv.positions || [])
    .filter(p => !isCashInvestmentPosition(p))
    .forEach(p => {
      const symbol = String(p.symbol || '').trim().toUpperCase();
      if (symbol && symbol !== 'CASH') symbols.add(symbol);
    });
  return [...symbols].sort();
}

function investmentTimelineSelectedSymbol(inv, rows) {
  const symbols = investmentTimelineKnownSymbols(inv);
  const current = String(state.investmentTimelineSymbol || '').trim().toUpperCase();
  if (current && (current === 'ALL' || symbols.includes(current))) return current;
  return 'ALL';
}

function setInvestmentTimelineSymbol(symbol) {
  state.investmentTimelineSymbol = String(symbol || 'ALL').trim().toUpperCase();
  state.investmentTimelineSelectedId = '';
  const box = document.getElementById('modal-box');
  if (box) {
    box.innerHTML = renderModalInvestmentTimeline();
    requestAnimationFrame(initInvestmentTimelineDragScroll);
  }
}

function selectInvestmentTimelineItem(id) {
  state.investmentTimelineSelectedId = String(id || '');
  const box = document.getElementById('modal-box');
  if (box) {
    box.innerHTML = renderModalInvestmentTimeline();
    requestAnimationFrame(initInvestmentTimelineDragScroll);
  }
}

function investmentTimelineMarketRows(rows) {
  const marketTypes = new Set(['macro', 'event', 'earnings', 'news', 'signal', 'review', 'calendar']);
  return (rows || []).filter(row => row.type !== 'decision' && marketTypes.has(row.type || 'event'));
}

function investmentTimelineAssetRows(rows) {
  return (rows || []).filter(row => {
    if (row.type === 'decision') return true;
    if (['portfolio', 'cash', 'asset'].includes(row.type)) return true;
    return parseInvestmentNumber(row.accountTotal) > 0;
  });
}

function investmentTimelineOverallRows(rows) {
  const seen = new Set();
  return [
    ...investmentTimelineMarketRows(rows).filter(row => {
      const symbol = String(row.symbol || '').trim();
      return !symbol || ['macro', 'calendar', 'review'].includes(row.type || '');
    }),
    ...investmentTimelineAssetRows(rows),
  ].filter(row => {
    const key = String(row.id || `${row.type}-${row.date}-${row.symbol}-${row.title}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function investmentTimelinePointTone(item, graphType) {
  if (graphType === 'timeline') {
    if (item.type === 'decision') return item.action === 'sell' ? 'trade-sell' : 'trade-buy';
    if (item.type === 'macro') return 'market-macro';
    if (item.type === 'earnings') return 'market-earnings';
    if (item.type === 'signal') return 'market-signal';
    if (item.type === 'news') return item.symbol ? 'symbol-news' : 'market-news';
    return 'asset-event';
  }
  if (graphType === 'symbol') {
    if (item.type === 'decision') return item.action === 'sell' ? 'trade-sell' : 'trade-buy';
    if (item.type === 'news') return 'symbol-news';
    return 'symbol-event';
  }
  if (graphType === 'market') {
    if (item.type === 'macro') return 'market-macro';
    if (item.type === 'earnings') return 'market-earnings';
    if (item.type === 'signal') return 'market-signal';
    return 'market-news';
  }
  if (item.type === 'decision') return item.realizedGain >= 0 ? 'asset-up' : 'asset-down';
  return 'asset-event';
}

function investmentTimelineValueForGraph(item, graphType, index) {
  if (graphType === 'asset') {
    return parseInvestmentNumber(item.accountTotal)
      || parseInvestmentNumber(item.proceeds)
      || parseInvestmentNumber(item.value)
      || index + 1;
  }
  if (graphType === 'symbol' && item.type === 'decision') {
    return parseInvestmentNumber(item.accountTotal)
      || parseInvestmentNumber(item.proceeds)
      || (parseInvestmentNumber(item.tradeShares) * parseInvestmentNumber(item.tradePrice))
      || index + 1;
  }
  return index + 1;
}

function investmentTimelineFilteredRows(rows, selected) {
  const mode = String(selected || 'ALL').toUpperCase();
  if (mode === 'ALL') return investmentTimelineOverallRows(rows);
  return (rows || []).filter(row => String(row.symbol || '').toUpperCase() === mode);
}

function renderInvestmentTimelineGraphPanel({ id, title, subtitle, rows, graphType, emptyText, selectorHtml = '' }) {
  const chronological = (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || '')));
  const points = chronological
    .filter(item => item && (item.date || item.createdAt || item.title || item.body))
    .map((item, index, arr) => {
      const shares = parseInvestmentNumber(item.tradeShares);
      const price = parseInvestmentNumber(item.tradePrice);
      const proceeds = parseInvestmentNumber(item.proceeds) || (shares > 0 && price > 0 ? shares * price : 0);
      const realizedGain = parseInvestmentNumber(item.realizedGain);
      const value = investmentTimelineValueForGraph({ ...item, proceeds, realizedGain }, graphType, index);
      return {
        ...item,
        x: arr.length === 1 ? 50 : (index / (arr.length - 1)) * 100,
        value,
        shares,
        price,
        proceeds,
        realizedGain,
        tone: investmentTimelinePointTone({ ...item, realizedGain }, graphType),
        date: item.date || (item.createdAt || '').slice(0, 10) || '',
      };
    });
  if (!points.length) {
    return `<section class="investment-trade-graph ${esc(graphType)} empty" id="${esc(id)}">
      <div class="investment-portfolio-list-head">
        <strong>${esc(title)}</strong>
        <span>${esc(subtitle)}</span>
      </div>
      ${selectorHtml}
      <div class="investment-empty">${esc(emptyText || '아직 그래프로 표시할 투자 기록이 없습니다.')}</div>
    </section>`;
  }
  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const laneY = graphType === 'market' || graphType === 'timeline'
    ? item => investmentTimelineEventLaneY(item.type)
    : item => 84 - ((item.value - min) / range) * 64;
  const placed = points.map(item => ({ ...item, y: laneY(item) }));
  const polyline = placed.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const graphWidth = Math.max(1280, placed.length * 180);
  const latest = placed.at(-1);
  return `<section class="investment-trade-graph ${esc(graphType)}" id="${esc(id)}">
    <div class="investment-portfolio-list-head">
      <strong>${esc(title)}</strong>
      <span>${esc(subtitle)}</span>
    </div>
    ${selectorHtml}
    <div class="investment-trade-graph-summary compact">
      <div><span>포인트</span><strong>${placed.length}개</strong></div>
      <div><span>최근 기록</span><strong>${esc(investmentTimelineDisplayTitle(latest))}</strong></div>
      <div><span>최근 날짜</span><strong>${esc(latest.date || '-')}</strong></div>
      <div><span>그래프 유형</span><strong>${esc(typeLabelForInvestmentTimelineGraph(graphType))}</strong></div>
    </div>
    <div class="investment-trade-graph-scroll" data-drag-scroll="investment-timeline">
      <div class="investment-trade-graph-area ${esc(graphType)}" style="width:${graphWidth}px">
        <div class="investment-trade-y-label">${graphType === 'asset' ? '총자산/현금' : graphType === 'symbol' ? '종목 흐름' : graphType === 'timeline' ? '타임라인' : '시장 이벤트'}</div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="${esc(polyline)}" fill="none" stroke="${investmentTimelineGraphStroke(graphType)}" stroke-width="2.2" vector-effect="non-scaling-stroke"></polyline>
        </svg>
        <div class="investment-trade-point-layer">
          ${placed.map(p => `<button type="button" class="investment-timeline-graph-point ${p.type === 'decision' ? 'investment-trade-point' : 'investment-event-point'} ${esc(p.tone)} ${esc(p.type || 'event')}${String(state.investmentTimelineSelectedId || '') === String(p.id || '') ? ' selected' : ''}"
            style="left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%;" aria-label="${esc(investmentTimelineDisplayTitle(p))}" onclick="selectInvestmentTimelineItem('${esc(String(p.id || ''))}')">
            <span></span>
            <div class="investment-trade-tooltip">
              <strong>${esc(investmentTimelineDisplayTitle(p))}</strong>
              <small>${esc(p.date || '')} · ${esc(typeLabelForInvestmentTimelineGraph(p.type, p.action))}</small>
              ${p.symbol ? `<small>대상: ${esc(p.symbol)}</small>` : ''}
              ${p.shares ? `<small>수량/가격: ${formatShares(p.shares)}주 · ${formatMoney(p.price)}</small>` : ''}
              ${p.proceeds ? `<small>체결/대금: ${formatMoney(p.proceeds)}</small>` : ''}
              ${p.realizedGain ? `<small>실현손익: ${formatMoneySigned(p.realizedGain)}</small>` : ''}
              ${graphType === 'asset' && p.value ? `<small>Y값: ${formatMoney(p.value)}</small>` : ''}
              ${p.body ? `<p>${esc(translateInvestmentTimelineText(String(p.body).replace(/\s+/g, ' ').slice(0, 180)))}</p>` : ''}
            </div>
          </button>`).join('')}
        </div>
        <div class="investment-trade-x-label">시간 순서</div>
      </div>
    </div>
  </section>`;
}

function investmentTimelineGraphStroke(graphType) {
  return ({
    symbol: 'rgba(37,99,235,.76)',
    market: 'rgba(124,58,237,.7)',
    asset: 'rgba(15,110,86,.78)',
    timeline: 'rgba(37,99,235,.72)',
  })[graphType] || 'rgba(37,99,235,.72)';
}

function renderInvestmentTimelineGraphs(inv, rows) {
  const selectedSymbol = investmentTimelineSelectedSymbol(inv, rows);
  const symbols = investmentTimelineKnownSymbols(inv);
  const visibleRows = investmentTimelineFilteredRows(rows, selectedSymbol);
  const selectorHtml = `<div class="investment-timeline-filter">
    <label for="investment-timeline-symbol-select">타임라인 보기</label>
    <select class="form-input" id="investment-timeline-symbol-select" onchange="setInvestmentTimelineSymbol(this.value)">
      <option value="ALL"${selectedSymbol === 'ALL' ? ' selected' : ''}>종합</option>
      ${symbols.map(symbol => `<option value="${esc(symbol)}"${symbol === selectedSymbol ? ' selected' : ''}>${esc(symbol)}</option>`).join('')}
    </select>
  </div>`;
  return `<div class="investment-timeline-graph-stack">
    ${renderInvestmentTimelineGraphPanel({
      id: 'investment-timeline-graph',
      title: selectedSymbol === 'ALL' ? '종합 타임라인' : `${selectedSymbol} 타임라인`,
      subtitle: selectedSymbol === 'ALL'
        ? '시장 뉴스·핵심 일정·총자산 변동을 한 시간축에서 봅니다.'
        : '선택한 종목의 뉴스·이벤트·매매 기록만 한 시간축에서 봅니다.',
      rows: visibleRows,
      graphType: 'timeline',
      emptyText: selectedSymbol === 'ALL'
        ? '아직 종합 타임라인에 표시할 시장 뉴스나 자산 변동 기록이 없습니다.'
        : '선택한 종목에 연결된 뉴스나 매매 기록이 아직 없습니다.',
      selectorHtml,
    })}
    ${renderInvestmentTimelineDetailPanel(visibleRows)}
  </div>`;
}

function renderInvestmentTimelineDetailPanel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const selectedId = String(state.investmentTimelineSelectedId || '');
  const selected = list.find(row => String(row.id || '') === selectedId) || list[0] || null;
  if (!selected) {
    return `<section class="investment-timeline-detail-panel empty" id="investment-timeline-detail">
      <h4>상세 기록</h4>
      <p>그래프에 표시된 점을 클릭하면 뉴스 전문이나 매매 기록 전문이 여기에 표시됩니다.</p>
    </section>`;
  }
  const shares = parseInvestmentNumber(selected.tradeShares);
  const price = parseInvestmentNumber(selected.tradePrice);
  const proceeds = parseInvestmentNumber(selected.proceeds) || (shares > 0 && price > 0 ? shares * price : 0);
  const realizedGain = parseInvestmentNumber(selected.realizedGain);
  const body = translateInvestmentTimelineText(selected.body || '');
  return `<section class="investment-timeline-detail-panel" id="investment-timeline-detail">
    <div class="investment-portfolio-list-head">
      <strong>${esc(investmentTimelineDisplayTitle(selected))}</strong>
      <span>${esc(selected.date || (selected.createdAt || '').slice(0, 10) || '')} · ${esc(typeLabelForInvestmentTimelineGraph(selected.type, selected.action))}</span>
    </div>
    <div class="investment-timeline-detail-meta">
      ${selected.symbol ? `<span>대상 ${esc(selected.symbol)}</span>` : ''}
      ${shares ? `<span>${formatShares(shares)}주</span>` : ''}
      ${price ? `<span>${formatMoney(price)}</span>` : ''}
      ${proceeds ? `<span>대금 ${formatMoney(proceeds)}</span>` : ''}
      ${realizedGain ? `<span class="${realizedGain >= 0 ? 'up' : 'down'}">실현 ${formatMoneySigned(realizedGain)}</span>` : ''}
    </div>
    <div class="investment-timeline-detail-body chat-markdown">
      ${body ? renderMarkdownBasic(body) : '<p>저장된 본문이 없습니다.</p>'}
    </div>
  </section>`;
}

function renderInvestmentSellPointGraph(decisions) {
  const sells = (Array.isArray(decisions) ? decisions : [])
    .filter(d => d && d.action === 'sell' && parseInvestmentNumber(d.tradeShares) > 0 && parseInvestmentNumber(d.tradePrice) > 0)
    .map(d => {
      const shares = parseInvestmentNumber(d.tradeShares);
      const price = parseInvestmentNumber(d.tradePrice);
      const proceeds = parseInvestmentNumber(d.proceeds) || shares * price;
      const value = parseInvestmentNumber(d.accountTotal) || proceeds;
      return {
        ...d,
        shares,
        price,
        proceeds,
        value,
        realizedGain: parseInvestmentNumber(d.realizedGain),
        date: (d.createdAt || '').slice(0, 10) || d.date || '',
      };
    });
  if (!sells.length) {
    return `<section class="investment-trade-graph empty" id="investment-trade-graph">
      <div class="investment-portfolio-list-head">
        <strong>매도 포인트 그래프</strong>
        <span>매도 기록이 생기면 계좌 흐름과 함께 표시됩니다.</span>
      </div>
      <div class="investment-empty">아직 그래프로 표시할 매도 기록이 없습니다.</div>
    </section>`;
  }
  const values = sells.map(s => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = sells.map((s, i) => {
    const x = sells.length === 1 ? 50 : (i / (sells.length - 1)) * 100;
    const y = 86 - ((s.value - min) / range) * 66;
    return { ...s, x, y };
  });
  const polyline = points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const latest = points.at(-1);
  const graphWidth = Math.max(1560, points.length * 220);
  return `<section class="investment-trade-graph" id="investment-trade-graph">
    <div class="investment-portfolio-list-head">
      <strong>매도 포인트 그래프</strong>
      <span>X축 매도 순서 · Y축 계좌 총액 또는 매도대금</span>
    </div>
    <div class="investment-trade-graph-summary">
      <div><span>매도 포인트</span><strong>${points.length}개</strong></div>
      <div><span>최근 매도</span><strong>${esc(latest.symbol || '-')} ${formatShares(latest.shares)}주</strong></div>
      <div><span>최근 매도대금</span><strong>${formatMoney(latest.proceeds)}</strong></div>
      <div><span>최근 실현손익</span><strong class="${latest.realizedGain >= 0 ? 'up' : 'down'}">${formatMoneySigned(latest.realizedGain)}</strong></div>
    </div>
    <div class="investment-trade-graph-scroll" data-drag-scroll="investment-timeline">
    <div class="investment-trade-graph-area" style="width:${graphWidth}px">
      <div class="investment-trade-y-label">자산/매도대금</div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${esc(polyline)}" fill="none" stroke="rgba(37,99,235,.72)" stroke-width="2.4" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <div class="investment-trade-point-layer">
        ${points.map(p => `<button type="button" class="investment-trade-point ${p.realizedGain >= 0 ? 'up' : 'down'}"
          style="left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%;" aria-label="${esc(p.symbol || '매도')} 매도 포인트">
          <span></span>
          <div class="investment-trade-tooltip">
            <strong>${esc(p.symbol || '-')} · ${formatShares(p.shares)}주 매도</strong>
            <small>${esc(p.date || '')} · ${formatMoney(p.price)} 체결</small>
            <small>매도대금 ${formatMoney(p.proceeds)}</small>
            <small>실현손익 ${formatMoneySigned(p.realizedGain)}</small>
            <small>Y값 ${formatMoney(p.value)}</small>
          </div>
        </button>`).join('')}
      </div>
      <div class="investment-trade-x-label">매도 포인트</div>
    </div>
    </div>
  </section>`;
}

function renderInvestmentTimelineEventGraph(rows) {
  const chronological = (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || '')));
  const points = chronological
    .filter(item => item && (item.type !== 'decision' || parseInvestmentNumber(item.tradeShares) > 0 || item.body || item.title))
    .map((item, index, arr) => {
      const shares = parseInvestmentNumber(item.tradeShares);
      const price = parseInvestmentNumber(item.tradePrice);
      const proceeds = parseInvestmentNumber(item.proceeds) || (shares > 0 && price > 0 ? shares * price : 0);
      const value = parseInvestmentNumber(item.accountTotal) || proceeds;
      const isTrade = item.type === 'decision';
      return {
        ...item,
        x: arr.length === 1 ? 50 : (index / (arr.length - 1)) * 100,
        isTrade,
        shares,
        price,
        proceeds,
        value,
        realizedGain: parseInvestmentNumber(item.realizedGain),
        date: item.date || (item.createdAt || '').slice(0, 10) || '',
      };
    });
  if (!points.length) {
    return `<section class="investment-trade-graph empty" id="investment-trade-graph">
      <div class="investment-portfolio-list-head">
        <strong>투자 이벤트 그래프</strong>
        <span>매매와 핵심 이벤트가 생기면 같은 시간축에 표시됩니다.</span>
      </div>
      <div class="investment-empty">아직 그래프로 표시할 투자 기록이 없습니다.</div>
    </section>`;
  }
  const tradePoints = points.filter(item => item.isTrade && item.value > 0);
  const eventPoints = points.filter(item => !item.isTrade);
  const values = tradePoints.map(item => item.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const range = Math.max(1, max - min);
  const placed = points.map(item => ({
    ...item,
    y: item.isTrade && item.value > 0
      ? 86 - ((item.value - min) / range) * 66
      : investmentTimelineEventLaneY(item.type),
  }));
  const tradePolyline = placed
    .filter(item => item.isTrade && item.value > 0)
    .map(item => `${item.x.toFixed(2)},${item.y.toFixed(2)}`)
    .join(' ');
  const eventPolyline = placed
    .map(item => `${item.x.toFixed(2)},${item.y.toFixed(2)}`)
    .join(' ');
  const latest = placed.at(-1);
  const graphWidth = Math.max(1560, placed.length * 220);
  return `<section class="investment-trade-graph" id="investment-trade-graph">
    <div class="investment-portfolio-list-head">
      <strong>투자 이벤트 그래프</strong>
      <span>X축 시간순 · 매매는 자산/대금 축 · 뉴스·공시·일정은 이벤트 점</span>
    </div>
    <div class="investment-trade-graph-summary">
      <div><span>전체 포인트</span><strong>${placed.length}개</strong></div>
      <div><span>매매 포인트</span><strong>${tradePoints.length}개</strong></div>
      <div><span>핵심 이벤트</span><strong>${eventPoints.length}개</strong></div>
      <div><span>최근 기록</span><strong>${esc(investmentTimelineDisplayTitle(latest))}</strong></div>
    </div>
    <div class="investment-trade-graph-scroll" data-drag-scroll="investment-timeline">
    <div class="investment-trade-graph-area" style="width:${graphWidth}px">
      <div class="investment-trade-y-label">자산/이벤트</div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${tradePolyline ? `<polyline points="${esc(tradePolyline)}" fill="none" stroke="rgba(37,99,235,.72)" stroke-width="2.4" vector-effect="non-scaling-stroke"></polyline>` : ''}
        ${eventPoints.length ? `<polyline points="${esc(eventPolyline)}" fill="none" stroke="rgba(15,23,42,.18)" stroke-width="1.2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></polyline>` : ''}
      </svg>
      <div class="investment-trade-point-layer">
        ${placed.map(p => `<button type="button" class="${p.isTrade ? 'investment-trade-point' : 'investment-event-point'} ${p.realizedGain >= 0 ? 'up' : 'down'} ${esc(p.type || 'event')}"
          style="left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%;" aria-label="${esc(investmentTimelineDisplayTitle(p))}">
          <span></span>
          <div class="investment-trade-tooltip">
            <strong>${esc(investmentTimelineDisplayTitle(p))}</strong>
            <small>${esc(p.date || '')} · ${esc(typeLabelForInvestmentTimelineGraph(p.type, p.action))}</small>
            ${p.isTrade && p.shares ? `<small>${formatShares(p.shares)}주 · ${formatMoney(p.price)}</small>` : ''}
            ${p.proceeds ? `<small>대금 ${formatMoney(p.proceeds)}</small>` : ''}
            ${p.realizedGain ? `<small>실현손익 ${formatMoneySigned(p.realizedGain)}</small>` : ''}
            ${p.body ? `<small>${esc(String(p.body).replace(/\s+/g, ' ').slice(0, 90))}</small>` : ''}
          </div>
        </button>`).join('')}
      </div>
      <div class="investment-trade-x-label">시간순 투자 기록</div>
    </div>
    </div>
  </section>`;
}

function initInvestmentTimelineDragScroll() {
  document.querySelectorAll('.investment-trade-graph-scroll').forEach(scroller => {
    if (scroller.dataset.dragReady === '1') return;
    scroller.dataset.dragReady = '1';
    let startX = 0;
    let startLeft = 0;
    let dragging = false;

    scroller.addEventListener('pointerdown', event => {
      if (event.button != null && event.button !== 0) return;
      startX = event.clientX;
      startLeft = scroller.scrollLeft;
      dragging = false;
      scroller.classList.add('is-dragging');
      scroller.setPointerCapture?.(event.pointerId);
    });

    scroller.addEventListener('pointermove', event => {
      if (!scroller.classList.contains('is-dragging')) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 3) dragging = true;
      scroller.scrollLeft = startLeft - dx;
      if (dragging) event.preventDefault();
    });

    const stop = event => {
      if (!scroller.classList.contains('is-dragging')) return;
      scroller.classList.remove('is-dragging');
      scroller.releasePointerCapture?.(event.pointerId);
    };
    scroller.addEventListener('pointerup', stop);
    scroller.addEventListener('pointercancel', stop);
    scroller.addEventListener('pointerleave', stop);
    scroller.addEventListener('click', event => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = false;
    }, true);
  });
}

function investmentTimelineEventLaneY(type) {
  return ({
    macro: 26,
    earnings: 34,
    event: 42,
    news: 52,
    signal: 62,
    portfolio: 72,
    review: 80,
  })[type] || 58;
}

function typeLabelForInvestmentTimelineGraph(type, action = '') {
  if (type === 'decision') return investmentActionLabel(action);
  return ({
    symbol: '종목',
    market: '시장',
    asset: '자산',
    news: '뉴스',
    signal: '신호',
    event: '일정',
    earnings: '실적',
    macro: '거시 이벤트',
    portfolio: '포트폴리오',
    review: '회고',
  })[type] || '이벤트';
}

function renderModalInvestmentTimeline() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const rows = buildUnifiedInvestmentTimelineRows(inv);
  const newsCount = rows.filter(r => r.type === 'news').length;
  const signalCount = rows.filter(r => r.type === 'signal').length;
  const decisionCount = rows.filter(r => r.type === 'decision').length;
  const sellCount = (inv.decisions || []).filter(d => d.action === 'sell').length;
  return `
    <button class="modal-close" onclick="closeModal()">x</button>
    <div class="investment-modal-titlebar">
      <div class="modal-title">투자 타임라인</div>
      <div class="investment-action-row">
        <button class="investment-refresh-btn investment-modal-refresh-btn" onclick="syncInvestmentCalendarData()">일정 동기화</button>
      </div>
    </div>
    <div class="investment-timeline-modal" id="investment-timeline-modal">
      <section class="investment-news-overview">
        <div><span>전체 기록</span><strong>${rows.length}</strong></div>
        <div><span>매매 판단</span><strong>${decisionCount}</strong></div>
        <div><span>뉴스·신호</span><strong>${newsCount + signalCount}</strong></div>
        <div><span>매도 포인트</span><strong>${sellCount}</strong></div>
      </section>

      ${renderInvestmentTimelineGraphs(inv, rows)}

      <details class="investment-manage-tools investment-manual-tools" id="investment-gate-tools">
        <summary>
          <span>수동 매매 추가</span>
          <small>대화 대신 직접 주문 게이트 작성</small>
        </summary>
        <div class="investment-modal-note">매매 기록도 타임라인에 저장됩니다. 대화창에서 결정하는 흐름을 우선하고, 필요한 경우에만 직접 입력하세요.</div>
        ${renderInvestmentGateForm(inv.positions)}
      </details>

      <details class="investment-manage-tools investment-manual-tools" id="investment-news-edit-tools">
        <summary>
          <span>수동 뉴스 추가</span>
          <small>뉴스·공시·메모를 타임라인에 저장</small>
        </summary>
        <form class="investment-form investment-news-form" id="investment-news-form" onsubmit="addInvestmentNewsFromForm(event)">
          <div class="investment-form-row">
            <input class="form-input" id="in-symbol" placeholder="종목/테마" autocomplete="off">
            <input class="form-input" id="in-title" placeholder="뉴스 제목" autocomplete="off">
            <input class="form-input" id="in-date" type="date" value="${new Date().toISOString().split('T')[0]}">
          </div>
          <textarea class="form-input investment-textarea investment-news-textarea" id="in-body" placeholder="뉴스 내용과 나의 해석을 마크다운으로 기록"></textarea>
          <button class="btn-primary investment-primary" type="submit">뉴스 저장</button>
        </form>
      </details>

    </div>`;
}

function renderModalInvestmentDecisions() {
  return renderModalInvestmentTimeline();
}

function renderModalInvestmentNews() {
  return renderModalInvestmentTimeline();
}

function renderModalInvestmentAICompare() {
  return `
    <button class="modal-close" onclick="closeModal()">x</button>
    <div class="modal-title">Claude / OpenAI 투자 답변 비교</div>
    <div class="investment-modal-note">같은 투자 질문을 두 모델에 동시에 보내고, 답변이 원칙·숫자·리스크를 얼마나 잘 지키는지 비교합니다. 이 기능은 종목 추천기가 아니라 판단 품질 점검용입니다.</div>
    <form class="investment-form" id="investment-ai-compare-form" onsubmit="runInvestmentAICompare(event)">
      <textarea class="form-input investment-textarea" id="iac-question" placeholder="예: IREN 추가매수해도 돼? 내 원칙 기준으로 비교해줘."></textarea>
      <div class="investment-form-row">
        <button class="btn-ghost" type="button" onclick="fillInvestmentAICompareExample('IREN 추가매수해도 돼? 내 원칙 기준으로 판단해줘.')">IREN 추가매수</button>
        <button class="btn-ghost" type="button" onclick="fillInvestmentAICompareExample('CRCL 뉴스가 내 포트폴리오에 어떤 의미인지 해석해줘.')">CRCL 뉴스</button>
        <button class="btn-ghost" type="button" onclick="fillInvestmentAICompareExample('이 매매 기록이 내 투자 원칙 위반인지 봐줘.')">원칙 위반</button>
      </div>
      <button class="btn-primary investment-primary" id="iac-run" type="submit">두 모델 비교</button>
    </form>
    <div class="investment-ai-compare-result" id="investment-ai-compare-result">
      <div class="investment-empty">질문을 입력하면 Claude와 OpenAI 답변을 나란히 보여줍니다.</div>
    </div>`;
}

function renderInvestmentVerdict(decision) {
  const cls = decision.verdict || decision.status;
  const label = decision.label || (cls === 'block' ? '차단 권고' : cls === 'cooldown' ? '쿨다운 필요' : '진행 가능');
  const findings = decision.findings || [];
  const nextSteps = decision.nextSteps || [];
  return `<div class="investment-verdict ${esc(cls)}">
    <div class="investment-verdict-label">${esc(label)}</div>
    <div class="investment-verdict-summary chat-markdown">${renderMarkdownBasic(decision.summary || '')}</div>
    <ul>${findings.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    ${nextSteps.length ? `<div class="investment-next">${nextSteps.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
  </div>`;
}

function enrichInvestmentVerdict(verdict, detail) {
  const d = detail || {};
  const checks = d.checklist || {};
  const missingChecks = Object.values(checks).filter(v => !v).length;
  const rules = d.rules || {};
  const minRiskReward = parseInvestmentNumber(rules.minRiskReward) || 2;
  if (d.setup === 'impulse') {
    verdict.score += 3;
    verdict.findings.push('셋업이 충동 의심으로 표시됐습니다. 주문보다 쿨다운과 기록이 우선입니다.');
  }
  if (d.riskReward > 0 && d.riskReward < minRiskReward) {
    verdict.score += 3;
    verdict.findings.push(`손익비 ${d.riskReward.toFixed(1)}이 최소 기준 ${minRiskReward.toFixed(1)}보다 낮습니다.`);
  }
  if (!d.plannedStop) {
    verdict.score += 2;
    verdict.findings.push('계획 손절가가 비어 있습니다. 손절 위치 없는 주문은 제한합니다.');
  }
  if (!d.plannedTarget) {
    verdict.score += 1;
    verdict.findings.push('계획 목표가가 비어 있습니다. 기대 보상 구간을 먼저 정하세요.');
  }
  if (missingChecks >= 2) {
    verdict.score += 2;
    verdict.findings.push('주문 전 확인 항목이 충분히 체크되지 않았습니다.');
  }
  verdict.status = verdict.score >= 6 ? 'block' : verdict.score >= 3 ? 'cooldown' : 'allow';
  verdict.label = verdict.status === 'block' ? '차단 권고' : verdict.status === 'cooldown' ? '쿨다운 필요' : '진행 가능';
  verdict.summary = verdict.findings[0] || verdict.summary;
  verdict.nextSteps = getInvestmentNextSteps(verdict.status, rules);
}

function renderInvestmentDecisionList(decisions) {
  if (!decisions.length) return '<div class="investment-empty">아직 매매 전 점검 기록이 없습니다.</div>';
  return `<div class="investment-decision-list">
    ${decisions.slice().reverse().map(d => `<div class="investment-decision">
      <span class="investment-badge ${esc(d.verdict)}">${esc(d.label)}</span>
      <strong>${esc(d.symbol)} · ${investmentActionLabel(d.action)} · ${investmentSetupLabel(d.setup)}</strong>
      <div class="investment-decision-metrics">
        <span>${esc(investmentTimeframeLabel(d.timeframe))}</span>
        <span>손익비 ${d.riskReward ? esc(d.riskReward) : '-'}</span>
        <span>${esc(d.orderType === 'market' ? '시장가' : d.orderType === 'stop' ? '조건부' : '지정가')}</span>
      </div>
      <div class="investment-decision-summary chat-markdown">${renderMarkdownBasic(d.summary || '')}</div>
      ${d.invalidation ? `<p class="investment-decision-note">무효화: ${esc(d.invalidation)}</p>` : ''}
      <small>${esc((d.createdAt || '').slice(0, 16).replace('T', ' '))}</small>
    </div>`).join('')}
  </div>`;
}
