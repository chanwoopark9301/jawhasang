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
          <span>${hasPrice ? formatMoney(value) : '현재가 미조회'}</span>
          <span>${hasPrice ? `${weight.toFixed(1)}%${isCash ? ' · 대기 자금' : ` · ${formatPercent(p.changePercent)}`}` : '현재가 갱신 필요'}</span>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

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

function renderModalInvestmentPortfolio() {
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const slices = getInvestmentPortfolioSlices(inv.positions).sort((a, b) => b.value - a.value);
  const totals = investmentTotals(inv.positions);
  const total = totals.totalValue;
  if (!slices.length) {
    return `
      <button class="modal-close" onclick="closeModal()">x</button>
      <div class="modal-title">포트폴리오</div>
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

  const top = slices[0];
  const gainRows = slices.map(p => ({ ...p, gain: p.value - p.cost, gainPercent: p.cost ? ((p.value - p.cost) / p.cost) * 100 : 0 }));
  const best = [...gainRows].sort((a, b) => b.gain - a.gain)[0];
  const worst = [...gainRows].sort((a, b) => a.gain - b.gain)[0];
  const staleCount = slices.filter(p => !p.marketUpdatedAt && !p.lastMarketUpdatedAt).length;
  const concentrationLabel = top.weight >= 50 ? '고집중' : top.weight >= 30 ? '집중' : '분산';
  const concentrationTone = top.weight >= 50 ? 'block' : top.weight >= 30 ? 'watch' : 'allow';
  const alerts = buildInvestmentRiskAlerts(inv.positions, inv.rules).slice(0, 4);
  const ruleSummary = inv.rules?.coreRules ? inv.rules.coreRules : `종목별 최대 비중 ${inv.rules?.maxPositionWeight || 30}% · 쿨다운 ${inv.rules?.cooldownMinutes || 30}분`;
  const updatedAt = inv.market?.fetchedAt || slices.map(p => p.marketUpdatedAt || p.lastMarketUpdatedAt).filter(Boolean).sort().at(-1) || '';

  return `
    <button class="modal-close" onclick="closeModal()">x</button>
    <div class="modal-title">포트폴리오 리포트</div>
    <div class="investment-portfolio-modal" id="investment-portfolio-modal">
      <div class="investment-portfolio-overview">
        <div><span>총 평가액</span><strong>${formatMoney(totals.totalValue)}</strong></div>
        <div><span>총 매입금</span><strong>${formatMoney(totals.totalCost)}</strong></div>
        <div><span>평가손익</span><strong class="${totals.totalGain >= 0 ? 'up' : 'down'}">${formatMoneySigned(totals.totalGain)}</strong></div>
        <div><span>수익률</span><strong class="${totals.totalGain >= 0 ? 'up' : 'down'}">${formatPercent(totals.totalGainPercent)}</strong></div>
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
          return `<div class="investment-portfolio-row">
            <span class="investment-dot" style="background:${p.color}"></span>
            <div class="investment-portfolio-name">
              <strong>${esc(p.symbol || p.name || '종목')}</strong>
              <small>${esc(p.name || '')}</small>
            </div>
            <em>${p.weight.toFixed(1)}%</em>
            <b>${formatMoney(p.value)}</b>
            <small class="investment-portfolio-detail">수량 ${formatShares(p.shares)} · 평단 ${formatMoney(p.avgPrice)} · 현재 ${formatMoney(p.currentPrice)} · 매입금 ${formatMoney(p.cost)}</small>
            <small class="investment-portfolio-detail ${gain >= 0 ? 'up' : 'down'}">손익 ${formatMoneySigned(gain)} · ${formatPercent(gainPercent)} · ${priceFresh ? `갱신 ${formatDateTimeShort(priceFresh)}` : '현재가 갱신 필요'}</small>
          </div>`;
        }).join('')}
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
      <input class="form-input" id="ip-avg" type="number" min="0" step="0.01" placeholder="평균 단가">
    </div>
    <div class="investment-form-row">
      <input class="form-input" id="ip-target" type="number" min="0" step="0.01" placeholder="목표가">
      <input class="form-input" id="ip-stop" type="number" min="0" step="0.01" placeholder="손절가">
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
      <span>포트폴리오 안에서 추가, 수정, 삭제</span>
    </div>
    ${renderInvestmentPositionForm()}
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
  const tradable = (positions || []).filter(p => !isCashInvestmentPosition(p));
  return `<form class="investment-form" id="investment-gate-form" onsubmit="runInvestmentGateFromForm(event)">
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
      <input class="form-input" id="ig-shares" type="text" inputmode="decimal" placeholder="체결 수량">
      <input class="form-input" id="ig-price" type="number" min="0" step="0.01" placeholder="체결가">
      <div class="investment-form-hint">허용된 매매만 포트폴리오에 자동 반영됩니다.</div>
    </div>
    <textarea class="form-input investment-textarea" id="ig-reason" placeholder="지금 이 행동을 하려는 이유"></textarea>
    <button class="btn-primary investment-primary" id="investment-gate-run" type="submit" ${tradable.length ? '' : 'disabled'}>점검하기</button>
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

      <form class="investment-form investment-news-form" id="investment-news-form" onsubmit="addInvestmentNewsFromForm(event)">
        <div class="investment-form-row">
          <input class="form-input" id="in-symbol" placeholder="종목/이슈" autocomplete="off">
          <input class="form-input" id="in-title" placeholder="뉴스 제목" autocomplete="off">
          <input class="form-input" id="in-date" type="date" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <textarea class="form-input investment-textarea investment-news-textarea" id="in-body" placeholder="뉴스 내용과 나의 해석을 마크다운으로 기록"></textarea>
        <button class="btn-primary investment-primary" type="submit">뉴스 저장</button>
      </form>

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
  if (button) button.textContent = 'DB 저장 중';
  const saved = await apiSaveInvestmentPosition(position, 3);
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
  if (saved.investment) state.investment = normalizeInvestmentState(saved.investment);
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
  if (shares) shares.placeholder = type === 'cash' ? '현금 보유액' : '수량';
  if (avg) {
    avg.placeholder = type === 'cash' ? '자동 1달러' : '평균 단가';
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
  const tradeShares = parseInvestmentNumber(document.getElementById('ig-shares')?.value);
  const tradePrice = parseInvestmentNumber(document.getElementById('ig-price')?.value);
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
    tradeShares,
    tradePrice,
  };
  state.investment.decisions.push(decision);
  if (decision.verdict === 'allow' && tradeShares > 0 && tradePrice > 0) {
    applyTradeToPortfolio(position.id, action, tradeShares, tradePrice);
    decision.summary = `${decision.summary} 포트폴리오에 ${formatShares(tradeShares)}주 @ ${formatMoney(tradePrice)} 체결을 반영했습니다.`;
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

function applyTradeToPortfolio(positionId, action, tradeShares, tradePrice) {
  const idx = state.investment.positions.findIndex(p => String(p.id) === String(positionId));
  if (idx < 0) return;
  const p = state.investment.positions[idx];
  const oldShares = parseInvestmentNumber(p.shares);
  const oldAvg = parseInvestmentNumber(p.avgPrice);
  const oldCost = oldShares * oldAvg;
  let nextShares = oldShares;
  let nextAvg = oldAvg;

  if (action === 'buy' || action === 'add') {
    nextShares = oldShares + tradeShares;
    nextAvg = nextShares ? (oldCost + tradeShares * tradePrice) / nextShares : tradePrice;
  } else if (action === 'sell') {
    nextShares = Math.max(0, oldShares - tradeShares);
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
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
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
  const n = parseInvestmentNumber(value);
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMoneySigned(value) {
  const n = parseInvestmentNumber(value);
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
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

function investmentSliceColor(index) {
  return [
    '#2563EB', '#1D9E75', '#EF9F27', '#DC2626', '#7C3AED',
    '#0891B2', '#65A30D', '#DB2777', '#4F46E5', '#EA580C',
  ][index % 10];
}
