/* =============================================
   自畵像 — 대화창 통합 관리
   의존성: state.js, utils.js, ai-counseling.js, ai-myrecords.js, modal.js
   ============================================= */

// ---------------------------------------------------------------------------
// 입력창 키 핸들러
// ---------------------------------------------------------------------------

function handleChatKey(e) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCurrentChat();
  }
}

// ---------------------------------------------------------------------------
// 전송 라우팅
// ---------------------------------------------------------------------------

function sendCurrentChat() {
  const input = document.getElementById('chat-input-bottom');
  const text  = input?.value.trim();
  if (!text) return;
  if (state._ctxChatLoading) {
    logger.info('AI 응답 중이라 새 채팅 전송을 보류', { length: text.length });
    if (typeof showToast === 'function') showToast('아직 답변 중이에요. 잠시 후 다시 보내주세요.');
    input.focus();
    return;
  }
  input.value = '';

  // 일기 변환 모드: AI 없이 혼자 쓰기
  if (state.chatMode === 'diary-convert') {
    appendMessage('user', text);
    return;
  }

  // 받아쓰기 모드: 사용자가 쭉 말할 수 있도록 AI가 매 턴 끼어들지 않는다.
  // 투자 파트너는 대화가 메인 기능이므로 기본적으로 AI가 응답한다.
  if ((state.replyMode || 'dictation') === 'dictation' && state.view !== 'investment') {
    appendMessage('user', text);
    return;
  }

  continueContextChat(text);
}

function setReplyMode(mode) {
  const allowed = [
    'dictation', 'question', 'summary', 'advice',
    'invest-status', 'invest-news', 'invest-rules', 'invest-trade', 'invest-summary',
  ];
  state.replyMode = allowed.includes(mode) ? mode : 'dictation';
  updateReplyModeUI();
}

function selectReplyModeFromModal(mode) {
  setReplyMode(mode);
  closeModal();
}

function updateReplyModeUI() {
  const modes = {
    dictation: '정리 안 된 말 그대로 적어도 돼요',
    question:  '묻고 싶은 걸 그대로 적어주세요',
    summary:   '여기까지 정리해달라고 말해도 좋아요',
    advice:    '의견이 필요한 상황을 적어주세요',
    'invest-status':  '확인할 종목이나 포트폴리오 상태를 물어보세요',
    'invest-news':    '찾아볼 종목, 법안, 공시, 뉴스를 적어주세요',
    'invest-rules':   '세우거나 고칠 투자 원칙을 말해보세요',
    'invest-trade':   '매수·매도 판단을 그대로 적어주세요',
    'invest-summary': '이 대화를 어디에 기록할지 말해보세요',
  };
  const input = document.getElementById('chat-input-bottom');
  if (input) input.placeholder = modes[state.replyMode] || modes.dictation;
}

async function continueContextChat(text) {
  if (!text || state._ctxChatLoading) return;
  state._ctxChatLoading = true;

  appendMessage('user', text);
  showTypingIndicator();

  const isMyRecords = state.view === 'myrecords';
  const isInvestment = state.view === 'investment';
  const topic   = isMyRecords ? state.myTopics.find(t => t.id === state.selTopic) : null;
  const student = (!isMyRecords && !isInvestment) ? state.students.find(s => s.id === state.selStudent) : null;
  const portfolioSnapshotRequest = isInvestment
    && typeof isInvestmentPortfolioSnapshotIntent === 'function'
    && isInvestmentPortfolioSnapshotIntent(text);

  if (portfolioSnapshotRequest && typeof applyInvestmentPortfolioSnapshotFromChat === 'function') {
    let directPortfolioUpdate = { changed: false, symbols: [], summary: '' };
    try {
      directPortfolioUpdate = applyInvestmentPortfolioSnapshotFromChat(buildInvestmentPortfolioSnapshotSourceText(text));
    } catch (error) {
      logger.error('투자 포트폴리오 직접 갱신 파싱 실패', error);
    }
    if (directPortfolioUpdate.changed) {
      const today = new Date().toISOString().split('T')[0];
      state.investment.events.push({
        id: 'ie' + Date.now(),
        date: today,
        type: 'portfolio',
        symbol: directPortfolioUpdate.symbols.join(', '),
        title: '포트폴리오 자동 갱신',
        body: directPortfolioUpdate.summary,
        severity: 'info',
        linkedDecisionId: null,
        linkedRecordId: null,
      });
      hideTypingIndicator();
      appendMessage('ai', `포트폴리오를 바로 갱신했어요.\n\n${directPortfolioUpdate.summary}`);
      refreshInvestmentSurfaces();
      showToast('포트폴리오에 바로 반영했어요. 서버 저장은 뒤에서 진행합니다.');
      persistInvestmentChangesInBackground('direct portfolio snapshot');
      state._ctxChatLoading = false;
      return;
    }
  }

  if (isInvestment) {
    await syncInvestmentLedgerForChatPrompt();
  }

  let investmentNewsContext = '';
  let investmentMarketContext = '';
  let investmentFxContext = '';
  if (isInvestment && !portfolioSnapshotRequest) {
    try {
      investmentNewsContext = await fetchInvestmentNewsContext(text);
    } catch (e) {
      logger.warn('투자 뉴스 컨텍스트 생성 실패', e);
    }
    try {
      investmentMarketContext = await fetchInvestmentMarketContext(text);
    } catch (e) {
      logger.warn('투자 시세 컨텍스트 생성 실패', e);
    }
    try {
      investmentFxContext = await fetchInvestmentFxContext(text);
    } catch (e) {
      logger.warn('투자 환율 컨텍스트 생성 실패', e);
    }
  }

  // AI 역할: state.currentRole → AI_ROLE_PRESETS에서 prompt 조회. 없으면 topic.aiPrompt 폴백
  const sysPrompt = _buildChatSysPrompt(isMyRecords, topic, student, [investmentNewsContext, investmentMarketContext, investmentFxContext].filter(Boolean).join('\n'));

  // 슬라이딩 윈도우: 최근 20개만 전송 (토큰 절약)
  // 장기 맥락은 topic.patternAnalysis(사용자가 저장한 분석)가 시스템 프롬프트로 대체
  const WINDOW = 20;
  const messages = state.currentChatMessages
    .filter(m => m.role !== 'system')
    .slice(-WINDOW)
    .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: isInvestment ? 1600 : 800,
        system: [{ type: 'text', text: sysPrompt, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 400);
      } catch (_) {
        detail = '';
      }
      throw new Error(`AI HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
    }
    const data = await res.json();
    const reply = data.content?.map(c => c.text || '').join('').trim();
    if (reply) {
      appendMessage('ai', reply);
      saveSummaryReplyAsRecord(reply);
      await saveInvestmentChatArtifacts(text, reply);
    } else {
      appendMessage('ai', '응답이 비어 있었어요. 방금 질문을 한 번만 다시 보내주세요.');
    }
  } catch (e) {
    logger.error('Context chat AI request failed', {
      view: state.view,
      replyMode: state.replyMode,
      message: e?.message || String(e),
    });
    appendMessage('ai', '죄송해요, 오류가 발생했어요. 다시 시도해주세요.');
  } finally {
    state._ctxChatLoading = false;
  }
}

function saveSummaryReplyAsRecord(text) {
  if (state.replyMode !== 'summary') return;
  if (state.view !== 'myrecords' || !state.selTopic) return;
  const content = (text || '').trim();
  if (!content) return;

  const record = {
    id: 'r' + Date.now(),
    topicId:   state.selTopic,
    date:      new Date().toISOString().split('T')[0],
    recordNum: getNextRecordNum(state.selTopic),
    content,
    memo:      '대화 정리',
    tags:      [],
    analysis:  null,
    aiChat:    [...(state.currentChatMessages || [])],
  };
  state.myRecords.push(record);
  saveData();
  showToast('정리해서 기록으로 저장했어요.');
  renderRightPanel();
  renderSidebar();
}

function buildInvestmentPortfolioSnapshotSourceText(text) {
  const raw = String(text || '');
  const refersToPrevious = /(?:이거|위|앞|방금|대로|shown|above|previous|this)/i.test(raw);
  if (!refersToPrevious) return raw;
  const recent = (state.currentChatMessages || [])
    .slice(-8)
    .map(m => String(m.text || ''))
    .filter(Boolean)
    .join('\n\n');
  return [recent, raw].filter(Boolean).join('\n\n');
}

async function saveInvestmentChatArtifacts(userText, aiText) {
  if (state.view !== 'investment') return;
  const ask = (userText || '').trim();
  const content = (aiText || '').trim();
  if (!ask || !content) return;
  const today = new Date().toISOString().split('T')[0];
  const combined = `${ask}\n${content}`;
  const robustWantsSave = /(?:\uAE30\uB85D|\uC800\uC7A5|\uCD94\uAC00|\uBC18\uC601|\uC124\uC815|\uB9DE\uCDB0|\uD3EC\uD2B8\uD3F4\uB9AC\uC624|\uC815\uB9AC|\uC218\uC815|save|record|log|portfolio)/i.test(ask);
  const wantsSave = /기록|저장|추가|반영|설정|정해|남겨|수정/.test(ask);
  if (!wantsSave && !robustWantsSave) return;

  const symbol = inferInvestmentSymbol(combined);
  const lower = ask.toLowerCase();
  if (/x\.com|twitter|tweet|x\s*link|signal|elon|musk|thetechinvest|x 계정|트윗/i.test(ask)) {
    state.investment.events.push({
      id: 'x-chat-' + Date.now(),
      date: today,
      type: 'signal',
      symbol,
      title: `${symbol || 'Market'} signal`,
      body: content,
      severity: 'watch',
      source: 'chat',
    });
    await saveData();
    showToast('Market signal saved.');
    refreshInvestmentSurfaces();
    return;
  }
  if (/뉴스|동향|공시|기사|news|headline|filing/.test(ask)) {
    state.investment.events.push({
      id: 'ie' + Date.now(),
      date: today,
      type: 'news',
      symbol,
      title: `${symbol || '투자'} 뉴스 동향`,
      body: content,
      severity: 'info',
      linkedDecisionId: null,
      linkedRecordId: null,
    });
    await saveData();
    showToast('뉴스 동향에 기록했어요.');
    refreshInvestmentSurfaces();
    return;
  }

  const portfolioUpdate = applyInvestmentPortfolioSnapshotFromChat(buildInvestmentPortfolioSnapshotSourceText(combined));
  if (portfolioUpdate.changed) {
    state.investment.events.push({
      id: 'ie' + Date.now(),
      date: today,
      type: 'portfolio',
      symbol: portfolioUpdate.symbols.join(', '),
      title: '포트폴리오 자동 갱신',
      body: portfolioUpdate.summary,
      severity: 'info',
      linkedDecisionId: null,
      linkedRecordId: null,
    });
    refreshInvestmentSurfaces();
    showToast('포트폴리오에 바로 반영했어요. 서버 저장은 뒤에서 진행합니다.');
    persistInvestmentChangesInBackground('portfolio snapshot');
    return;
  }

  if (/투자\s*원칙|원칙|매매\s*원칙|방향성|체크리스트|리스크/.test(ask)) {
    const prev = stripInvestmentPortfolioSnapshotFromRules(state.investment.rules.coreRules || '');
    const cleanContent = stripInvestmentPortfolioSnapshotFromRules(content);
    state.investment.rules.coreRules = [prev, cleanContent].filter(Boolean).join('\n\n');
    await saveData();
    showToast('투자 원칙에 반영했어요.');
    refreshInvestmentSurfaces();
    return;
  }

  if (/(?:\uB9E4\uB9E4|\uAC70\uB798|\uB9E4\uC218|\uB9E4\uB3C4|\uCD94\uAC00\uB9E4\uC218|\uBD84\uD560|\uC9C4\uC785|\uCCAD\uC0B0|\uC775\uC808|\uC190\uC808|\uD314\uC558|\uD314\uC544|\uC218\uC775\s*\uC2E4\uD604|trade|buy|sell)/i.test(combined)) {
    const action = inferInvestmentAction(combined);
    const position = findInvestmentPositionFromText(combined, symbol);
    const trade = inferInvestmentTradeFill(ask, combined, action, position);
    if (isDuplicateInvestmentTradeArtifact(position?.symbol || symbol || '', action, trade.shares, trade.price, combined)) {
      showToast('이미 반영된 매매 기록이라 중복 적용하지 않았어요.');
      refreshInvestmentSurfaces();
      return;
    }
    const decision = {
      id: 'id' + Date.now(),
      createdAt: new Date().toISOString(),
      symbol: position?.symbol || symbol || '',
      action,
      context: 'chat',
      setup: /충동/.test(ask) ? 'impulse' : 'planned',
      timeframe: 'swing',
      reason: ask,
      invalidation: '',
      plannedStop: extractLabeledNumber(ask, /(손절|스탑|stop)/),
      plannedTarget: extractLabeledNumber(ask, /(목표|익절|target)/),
      riskReward: 0,
      orderType: 'limit',
      checklist: { thesis: false, risk: false, size: false, cooldown: false },
      verdict: 'journal',
      label: '대화 기록',
      summary: content,
      findings: [],
      nextSteps: [],
      tradeShares: trade.shares,
      tradePrice: trade.price,
      tradeKey: buildInvestmentTradeArtifactKey(position?.symbol || symbol || '', action, trade.shares, trade.price),
    };
    if (position && (action === 'buy' || action === 'add' || action === 'sell') && trade.shares > 0 && trade.price > 0) {
      let serverApplied = false;
      if (typeof apiCreateInvestmentTransaction === 'function') {
        try {
          const saved = await apiCreateInvestmentTransaction({
            ...decision,
            positionId: position.id,
            quantity: trade.shares,
            price: trade.price,
            idempotencyKey: decision.tradeKey,
          });
          if (saved.investment) {
            state.investment = typeof _mergeIncomingInvestmentState === 'function'
              ? _mergeIncomingInvestmentState(saved.investment)
              : normalizeInvestmentState(saved.investment);
          }
          if (saved.transaction) Object.assign(decision, saved.transaction);
          serverApplied = true;
        } catch (e) {
          logger.warn('투자 원장 서버 저장 실패 - 로컬 반영으로 대체', e);
        }
      }
      if (!serverApplied) {
        state.investment.decisions.push(decision);
        const tradeResult = applyTradeToPortfolio(position.id, action, trade.shares, trade.price);
        decision.portfolioApplied = true;
        decision.cashApplied = true;
        decision.realizedGain = tradeResult.realizedGain || 0;
        decision.cashDelta = tradeResult.cashDelta || 0;
        decision.proceeds = tradeResult.proceeds || 0;
      }
      decision.summary = `${decision.summary}\n\n---\n포트폴리오 반영: ${investmentActionLabel(action)} ${formatShares(trade.shares)}주 @ ${formatMoney(trade.price)}`;
    } else {
      state.investment.decisions.push(decision);
    }
    if (decision.cashApplied) {
      if (action === 'sell') {
        decision.summary = `${decision.summary}\n예수금 +${formatMoney(decision.proceeds || decision.cashDelta || 0)} · 실현손익 ${formatMoneySigned(decision.realizedGain || 0)}`;
      } else {
        decision.summary = `${decision.summary}\n예수금 ${formatMoneySigned(decision.cashDelta || 0)}`;
      }
    }
    await saveData();
    showToast('매매 기록에 남겼어요.');
    refreshInvestmentSurfaces();
  }
}

function refreshInvestmentSurfaces() {
  const active = state.activeModal;
  const investmentModals = new Set([
    'investment-desk',
    'investment-portfolio',
    'investment-timeline',
    'investment-news',
    'investment-decisions',
    'investment-research',
    'investment-signals',
  ]);
  state.investment = normalizeInvestmentState(state.investment);
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
  render();
  if (typeof renderSidebar === 'function') renderSidebar();
  if (typeof renderRightPanel === 'function') renderRightPanel();
  if (active && investmentModals.has(active)) openModal(active);
}

function persistInvestmentChangesInBackground(label = 'investment change') {
  const startedAt = performance.now();
  saveData({ retries: 1 })
    .then(ok => {
      logger.info('투자 변경 백그라운드 저장 완료', {
        label,
        ok,
        durationMs: Math.round(performance.now() - startedAt),
      });
    })
    .catch(error => {
      logger.warn('투자 변경 백그라운드 저장 실패', { label, error });
      if (typeof showToast === 'function') showToast('화면에는 반영했지만 서버 저장이 지연됐어요. 잠시 후 다시 동기화합니다.');
    });
}

let _investmentLedgerPromptSyncAt = 0;

async function syncInvestmentLedgerForChatPrompt() {
  if (typeof apiFetchInvestmentLedgerSnapshot !== 'function') return false;
  const now = Date.now();
  if (now - _investmentLedgerPromptSyncAt < 2000) return false;
  _investmentLedgerPromptSyncAt = now;
  try {
    const data = await apiFetchInvestmentLedgerSnapshot();
    if (!data?.investment || !Array.isArray(data.investment.positions)) return false;
    const incoming = normalizeInvestmentState(data.investment);
    if (!incoming.positions.length) return false;
    state.investment = normalizeInvestmentState({
      ...state.investment,
      ...incoming,
      positions: incoming.positions,
      events: incoming.events?.length ? incoming.events : state.investment.events,
      decisions: incoming.decisions?.length ? incoming.decisions : state.investment.decisions,
      chat: state.investment.chat,
      chatSessions: state.investment.chatSessions,
      activeChatSessionId: state.investment.activeChatSessionId,
    });
    if (typeof _saveToLocalCache === 'function') _saveToLocalCache();
    logger.info('AI 투자 대화 원장 스냅샷 동기화 완료', {
      source: data.source,
      positions: state.investment.positions.length,
    });
    return true;
  } catch (error) {
    logger.warn('AI 투자 대화 원장 스냅샷 동기화 실패', error);
    return false;
  }
}

function buildInvestmentTradeArtifactKey(symbol, action, shares, price) {
  const sym = String(symbol || '').trim().toUpperCase();
  const act = String(action || '').trim().toLowerCase();
  const qty = parseInvestmentNumber(shares);
  const px = parseInvestmentNumber(price);
  if (!sym || !act || qty <= 0 || px <= 0) return '';
  return [sym, act, qty.toFixed(4), px.toFixed(2)].join('|');
}

function isDuplicateInvestmentTradeArtifact(symbol, action, shares, price, text = '') {
  const key = buildInvestmentTradeArtifactKey(symbol, action, shares, price);
  if (!key) return false;
  const normalizedText = normalizeInvestmentTradeText(text);
  return (state.investment?.decisions || []).some(d => {
    if (d.tradeKey && d.tradeKey === key) return true;
    const existingKey = buildInvestmentTradeArtifactKey(d.symbol, d.action, d.tradeShares, d.tradePrice);
    if (existingKey === key) return true;
    if (!normalizedText) return false;
    const existingReason = normalizeInvestmentTradeText(d.reason || '');
    if (existingReason && (normalizedText.includes(existingReason) || existingReason.includes(normalizedText))) return true;
    const existingText = normalizeInvestmentTradeText([d.reason, d.summary].filter(Boolean).join('\n'));
    return existingText && (existingText === normalizedText || existingText.includes(normalizedText) || normalizedText.includes(existingText));
  });
}

function normalizeInvestmentTradeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[₩$,\s]/g, '')
    .toLowerCase()
    .slice(0, 500);
}

function applyInvestmentPortfolioSnapshotFromChat(text) {
  const raw = String(text || '');
  const intent = isInvestmentPortfolioSnapshotIntent(raw);
  const negatesTradeRecord = /(?:\uC544\uB2C8\uB77C|\uB9D0\uACE0|not\s+(?:a\s+)?trade|not\s+record)/i.test(raw);
  const explicitTradeIntent = !negatesTradeRecord && /(?:\uB9E4\uB9E4\s*\uAE30\uB85D|\uAC70\uB798\s*\uAE30\uB85D|\uB9E4\uC218\s*\uAE30\uB85D|\uB9E4\uB3C4\s*\uAE30\uB85D|trade\s*log|record\s*trade)/i.test(raw);
  if (!intent || explicitTradeIntent) {
    logger.debug('투자 포트폴리오 스냅샷 갱신 생략', { intent, explicitTradeIntent, raw: raw.slice(0, 240) });
    return { changed: false, symbols: [], summary: '' };
  }

  state.investment = normalizeInvestmentState(state.investment);
  const changed = [];
  const handledSymbols = new Set();
  const explicitRate = extractInvestmentUsdKrwRateFromText(raw);
  if (explicitRate > 0) {
    state.investment.usdKrwRate = explicitRate;
    state.investment.usdKrwUpdatedAt = new Date().toISOString();
    state.investment.usdKrwSource = '사용자 입력';
    changed.push(`USD/KRW ${explicitRate} 반영`);
  }
  const cashUsd = inferInvestmentCashUsdFromText(raw);
  if (cashUsd > 0) {
    setInvestmentCashAmount(cashUsd);
    changed.push(`현금 ${formatMoney(cashUsd)} 반영`);
  }

  extractInvestmentPortfolioSnapshotRows(raw).forEach(snapshot => {
    if (!snapshot.symbol || snapshot.symbol === 'CASH') return;
    const position = upsertInvestmentPortfolioSnapshotPosition(snapshot);
    handledSymbols.add(String(position.symbol || '').toUpperCase());
    const fields = [
      snapshot.shares > 0 ? `shares=${snapshot.shares}` : '',
      snapshot.avgPrice > 0 ? `avgPrice=${snapshot.avgPrice}` : '',
      snapshot.currentPrice > 0 ? `currentPrice=${snapshot.currentPrice}` : '',
    ].filter(Boolean).join(', ');
    changed.push(`${position.symbol || position.name} ${fields}`);
  });

  (state.investment.positions || []).forEach(position => {
    if (isCashInvestmentPosition(position)) return;
    if (handledSymbols.has(String(position.symbol || '').toUpperCase())) return;
    if (!investmentTextMentionsPosition(raw, position)) return;
    const patch = inferInvestmentPositionSnapshot(raw, position);
    if (!Object.keys(patch).length) return;
    Object.assign(position, patch, {
      manualPrice: patch.currentPrice != null ? true : position.manualPrice,
      marketUpdatedAt: new Date().toISOString(),
    });
    changed.push(`${position.symbol || position.name} ${Object.entries(patch).map(([key, value]) => `${key}=${value}`).join(', ')}`);
  });

  if (!changed.length) {
    logger.warn('투자 포트폴리오 스냅샷 갱신 의도는 감지됐지만 추출된 값이 없음', { raw: raw.slice(0, 500) });
    return { changed: false, symbols: [], summary: '' };
  }
  if (state.investment?.rules?.coreRules) {
    state.investment.rules.coreRules = stripInvestmentPortfolioSnapshotFromRules(state.investment.rules.coreRules);
  }
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
  const symbols = (state.investment.positions || [])
    .filter(p => !isCashInvestmentPosition(p) && (handledSymbols.has(String(p.symbol || '').toUpperCase()) || investmentTextMentionsPosition(raw, p)))
    .map(p => p.symbol || p.name)
    .filter(Boolean);
  if (cashUsd > 0) symbols.push('CASH');
  logger.info('투자 포트폴리오 스냅샷 자동 갱신', { changed, symbols });
  return {
    changed: true,
    symbols: [...new Set(symbols)],
    summary: `대화에서 포트폴리오 값을 추출해 자동 반영했습니다.\n\n${changed.map(item => `- ${item}`).join('\n')}`,
  };
}

function stripInvestmentPortfolioSnapshotFromRules(text) {
  const raw = String(text || '');
  if (!raw) return '';
  const markers = [
    '## 포트폴리오 갱신 반영',
    '### 📊 종목별 현황',
    '### 종목별 현황',
    '### 💵 현금 환산',
    '### 🗂 포트폴리오 합산',
    '### ⚖️ 비중 체크',
  ];
  let cut = raw.length;
  markers.forEach(marker => {
    const idx = raw.indexOf(marker);
    if (idx >= 0) cut = Math.min(cut, idx);
  });
  return raw.slice(0, cut).trim();
}

function extractInvestmentPortfolioSnapshotRows(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/);
  const rows = extractInvestmentPortfolioSnapshotBlocks(lines);
  let header = null;
  for (const line of lines) {
    if (!line.includes('|')) {
      header = null;
      continue;
    }
    const cells = splitInvestmentMarkdownRow(line);
    if (cells.length < 3) continue;
    if (cells.every(cell => /^:?-{2,}:?$/.test(cell))) continue;
    const lower = cells.map(cell => cell.toLowerCase());
    if (lower.some(cell => cell.includes('종목')) && lower.some(cell => cell.includes('수량'))) {
      header = {
        symbol: lower.findIndex(cell => /종목|ticker|symbol/.test(cell)),
        shares: lower.findIndex(cell => /수량|shares|qty|quantity/.test(cell)),
        avgPrice: lower.findIndex(cell => /평단|평균|avg|average/.test(cell)),
        currentPrice: lower.findIndex(cell => /현재가|현재\s*가격|current|price/.test(cell)),
      };
      continue;
    }
    if (!header || header.symbol < 0 || header.shares < 0) continue;
    const symbol = normalizeInvestmentSnapshotSymbol(cells[header.symbol]);
    if (!symbol || symbol === 'CASH') continue;
    const snapshot = {
      symbol,
      name: inferInvestmentSnapshotName(symbol, cells[header.symbol]),
      shares: parseInvestmentSnapshotNumber(cells[header.shares]),
      avgPrice: header.avgPrice >= 0 ? parseInvestmentSnapshotNumber(cells[header.avgPrice]) : 0,
      currentPrice: header.currentPrice >= 0 ? parseInvestmentSnapshotNumber(cells[header.currentPrice]) : 0,
      assetType: isInvestmentCryptoSymbol(symbol) ? 'crypto' : 'stock',
    };
    if (snapshot.shares > 0 || snapshot.avgPrice > 0 || snapshot.currentPrice > 0) rows.push(snapshot);
  }
  return dedupeInvestmentPortfolioSnapshots(rows);
}

function extractInvestmentPortfolioSnapshotBlocks(lines) {
  const rows = [];
  const list = Array.isArray(lines) ? lines.map(line => String(line || '').trim()).filter(Boolean) : [];
  const symbolAt = line => {
    const cleaned = line.replace(/[*`]/g, '').trim();
    if (!cleaned || cleaned.length > 24) return '';
    const symbol = normalizeInvestmentSnapshotSymbol(cleaned);
    if (!symbol || symbol === 'CASH') return '';
    const upper = cleaned.toUpperCase();
    const exact = upper === symbol || upper === symbol.replace('-USD', '') || upper.includes(symbol);
    const knownAlias = /^(아이렌|써클|이더리움|비트코인)$/i.test(cleaned);
    return exact || knownAlias ? symbol : '';
  };
  for (let i = 0; i < list.length; i += 1) {
    const symbol = symbolAt(list[i]);
    if (!symbol) continue;
    const block = [list[i]];
    for (let j = i + 1; j < Math.min(list.length, i + 8); j += 1) {
      const nextSymbol = symbolAt(list[j]);
      if (nextSymbol && nextSymbol !== symbol) break;
      if (nextSymbol && nextSymbol === symbol && j > i + 1) break;
      block.push(list[j]);
    }
    const text = block.join('\n');
    const shares = extractSnapshotNumber(text, [
      /수량[^0-9]{0,18}([0-9][0-9,.]*)/i,
      /수량[^0-9]{0,18}([0-9][0-9,.]*)\s*(?:주|개|shares?|units?)/i,
      /([0-9][0-9,.]*)\s*(?:주|개|shares?|units?)[^\n]{0,18}(?:평단|avg|average)/i,
    ]);
    const avgPrice = extractSnapshotNumber(text, [
      /평단[^0-9]{0,18}\$?\s*([0-9][0-9,.]*)/i,
      /(?:avg|average)[^0-9]{0,18}\$?\s*([0-9][0-9,.]*)/i,
    ]);
    const currentPrice = extractSnapshotNumber(text, [
      /현재[^0-9]{0,18}\$?\s*([0-9][0-9,.]*)/i,
      /(?:current|price)[^0-9]{0,18}\$?\s*([0-9][0-9,.]*)/i,
    ]);
    if (shares > 0 || avgPrice > 0 || currentPrice > 0) {
      rows.push({
        symbol,
        name: inferInvestmentSnapshotName(symbol, block[1] || block[0]),
        shares,
        avgPrice,
        currentPrice,
        assetType: isInvestmentCryptoSymbol(symbol) ? 'crypto' : 'stock',
      });
    }
  }
  return rows;
}

function splitInvestmentMarkdownRow(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function dedupeInvestmentPortfolioSnapshots(rows) {
  const map = new Map();
  (rows || []).forEach(row => {
    const key = String(row.symbol || '').toUpperCase();
    if (!key) return;
    map.set(key, { ...(map.get(key) || {}), ...row });
  });
  return [...map.values()];
}

function normalizeInvestmentSnapshotSymbol(value) {
  const raw = String(value || '').replace(/[*`]/g, '').trim();
  const lower = raw.toLowerCase();
  const aliases = [
    { symbol: 'IREN', terms: ['아이렌', 'iris energy', 'iren'] },
    { symbol: 'CRCL', terms: ['써클', '서클', 'circle', 'crcl'] },
    { symbol: 'ETH-USD', terms: ['이더리움', 'ethereum', 'ether', 'eth-usd'] },
    { symbol: 'BTC-USD', terms: ['비트코인', 'bitcoin', 'btc-usd'] },
    { symbol: 'CASH', terms: ['현금', '예수금', 'cash'] },
  ];
  const alias = aliases.find(item => item.terms.some(term => lower.includes(term)));
  if (alias) return alias.symbol;
  const candidates = [...raw.toUpperCase().matchAll(/\b[A-Z][A-Z0-9.\-]{0,12}(?:-USD)?\b/g)]
    .map(m => m[0])
    .filter(sym => !['USD', 'KRW', 'ETF', 'AI'].includes(sym));
  return candidates[0] || '';
}

function inferInvestmentSnapshotName(symbol, source = '') {
  const known = (state.investment?.positions || []).find(p => String(p.symbol || '').toUpperCase() === String(symbol || '').toUpperCase());
  if (known?.name) return known.name;
  const names = {
    IREN: '아이렌',
    CRCL: '써클',
    'ETH-USD': '이더리움',
    'BTC-USD': '비트코인',
    QQQM: 'QQQM',
    QLD: 'QLD',
  };
  const raw = String(source || '').replace(/[*`]/g, '').replace(symbol, '').trim();
  return names[symbol] || raw || symbol;
}

function isInvestmentCryptoSymbol(symbol) {
  return /(?:-USD$|^BTC$|^ETH$|^SOL$)/i.test(String(symbol || ''));
}

function parseInvestmentSnapshotNumber(value) {
  if (value == null) return 0;
  const raw = String(value).replace(/[*`]/g, '').replace(/[₩$]/g, '').replace(/[^\d.,-]/g, '');
  const m = raw.match(/-?[0-9][0-9,]*(?:\.[0-9]+)?/);
  return m ? parseInvestmentNumber(m[0]) : 0;
}

function upsertInvestmentPortfolioSnapshotPosition(snapshot) {
  const symbol = String(snapshot.symbol || '').toUpperCase();
  const now = new Date().toISOString();
  const idx = (state.investment.positions || []).findIndex(p =>
    !isCashInvestmentPosition(p) && String(p.symbol || '').toUpperCase() === symbol
  );
  const previous = idx >= 0 ? state.investment.positions[idx] : {};
  const next = {
    ...previous,
    id: previous.id || `ip-${symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
    assetType: previous.assetType || snapshot.assetType || 'stock',
    symbol,
    name: previous.name || snapshot.name || symbol,
    shares: snapshot.shares > 0 ? snapshot.shares : parseInvestmentNumber(previous.shares),
    avgPrice: snapshot.avgPrice > 0 ? snapshot.avgPrice : parseInvestmentNumber(previous.avgPrice),
    currentPrice: snapshot.currentPrice > 0 ? snapshot.currentPrice : parseInvestmentNumber(previous.currentPrice),
    manualPrice: snapshot.currentPrice > 0 ? true : previous.manualPrice,
    marketUpdatedAt: snapshot.currentPrice > 0 ? now : previous.marketUpdatedAt,
  };
  if (idx >= 0) state.investment.positions[idx] = next;
  else state.investment.positions.push(next);
  return next;
}

function isInvestmentPortfolioSnapshotIntent(text) {
  const raw = String(text || '');
  const snapshotWords = /(?:\uD3EC\uD2B8\uD3F4\uB9AC\uC624|\uACC4\uC88C|\uBCF4\uC720\s*\uC218\uB7C9|\uC794\uC5EC\s*\uC218\uB7C9|\uD604\uC7AC\s*\uC0C1\uD0DC|\uC2A4\uB0C5\uC0F7|\uAC31\uC2E0|\uC218\uC815|\uBC18\uC601|portfolio|account|snapshot|position|update|sync)/i.test(raw);
  const valueWords = /(?:\uC218\uB7C9|\uC8FC|\uAC1C|\uD3C9\uB2E8|\uD3C9\uADE0\s*\uB2E8\uAC00|\uD604\uC7AC\uAC00|\uD604\uC7AC\s*\uAC00\uACA9|\uD604\uAE08|\uC608\uC218\uAE08|\uCD1D\s*\uD3C9\uAC00\uC561|shares?|qty|average|avg|current|cash|total value)/i.test(raw);
  const directCash = /(?:\uD604\uAE08|\uC608\uC218\uAE08|cash)[^\n]{0,80}(?:[0-9]|\uC5B5|\uB9CC|USD|\$)/i.test(raw);
  return (snapshotWords && valueWords) || directCash;
}

function investmentTextMentionsPosition(text, position) {
  const upper = String(text || '').toUpperCase();
  const lower = String(text || '').toLowerCase();
  const symbol = String(position?.symbol || '').toUpperCase();
  const name = String(position?.name || '').toLowerCase();
  if (symbol && upper.includes(symbol)) return true;
  if (name && lower.includes(name)) return true;
  const aliases = {
    IREN: ['\uC544\uC774\uB80C', 'iris energy'],
    CRCL: ['\uC368\uD074', 'circle'],
    QQQM: ['qqqm', '\uB098\uC2A4\uB2E5'],
    'ETH-USD': ['\uC774\uB354\uB9AC\uC6C0', 'ethereum', 'ether'],
    ETH: ['\uC774\uB354\uB9AC\uC6C0', 'ethereum', 'ether'],
    'BTC-USD': ['\uBE44\uD2B8\uCF54\uC778', 'bitcoin'],
    BTC: ['\uBE44\uD2B8\uCF54\uC778', 'bitcoin'],
  };
  return (aliases[symbol] || []).some(term => lower.includes(term));
}

function inferInvestmentPositionSnapshot(text, position = null) {
  const raw = extractInvestmentPositionSnapshotContext(text, position);
  const patch = {};
  const shares = extractSnapshotNumber(raw, [
    /(?:\uBCF4\uC720\s*)?\uC218\uB7C9[^0-9]{0,24}([0-9][0-9,.]*)\s*(?:\uC8FC|\uAC1C|shares?)/i,
    /(?:\uC794\uC5EC|\uB0A8\uC740)[^0-9]{0,24}([0-9][0-9,.]*)\s*(?:\uC8FC|\uAC1C|shares?)/i,
    /(?:remaining|left|holding|position|shares?|quantity|qty)[^0-9]{0,24}([0-9][0-9,.]*)\s*(?:shares?|ea|units?)?/i,
    /([0-9][0-9,.]*)\s*(?:\uC8FC|shares?)\s*(?:\uBCF4\uC720|\uB0A8)/i,
    /([0-9][0-9,.]*)\s*(?:shares?|units?)\s*(?:remaining|left|holding)/i,
    /(?:^|[\s:·-])([0-9][0-9,.]*)\s*(?:\uC8FC|\uAC1C|shares?|units?)(?:\s|$|[·,])/i,
  ]);
  const avgPrice = extractSnapshotNumber(raw, [
    /(?:\uD3C9\uB2E8|\uD3C9\uADE0\s*\uB2E8\uAC00|avg|average)[^0-9]{0,24}\$?\s*([0-9][0-9,.]*)/i,
  ]);
  const currentPrice = extractSnapshotNumber(raw, [
    /(?:\uD604\uC7AC\uAC00|\uD604\uC7AC\s*\uAC00\uACA9|current)[^0-9]{0,24}\$?\s*([0-9][0-9,.]*)/i,
  ]);
  if (shares > 0) patch.shares = shares;
  if (avgPrice > 0) patch.avgPrice = avgPrice;
  if (currentPrice > 0) patch.currentPrice = currentPrice;
  return patch;
}

function extractInvestmentPositionSnapshotContext(text, position) {
  const raw = String(text || '');
  if (!position) return raw;
  const lines = raw.split(/\r?\n/);
  const matched = [];
  lines.forEach((line, index) => {
    if (investmentTextMentionsPosition(line, position)) {
      matched.push(lines.slice(index, Math.min(lines.length, index + 6)).join('\n'));
    }
  });
  const context = matched.filter(Boolean).join('\n').trim();
  return context || raw;
}

function extractSnapshotNumber(text, patterns) {
  for (const pattern of patterns) {
    const m = String(text || '').match(pattern);
    if (m) return parseInvestmentNumber(m[1]);
  }
  return 0;
}

function inferInvestmentCashUsdFromText(text) {
  const raw = String(text || '');
  const preferredUsd = raw.match(/(?:\uB2EC\uB7EC\s*\uD658\uC0B0\s*\uC608\uC218\uAE08|\uD604\uAE08\s*\(\uB2EC\uB7EC\s*\uD658\uC0B0\)|cash\s*\(usd\))[^\n]*?\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,4})?)/i);
  if (preferredUsd) return parseInvestmentNumber(preferredUsd[1]);
  const cashBlockUsd = raw.match(/(?:^|\n)\s*CASH\s*(?:\n|$)[\s\S]{0,180}?(?:\$|USD\s*)([0-9][0-9,]*(?:\.[0-9]{1,4})?)/i);
  if (cashBlockUsd) return parseInvestmentNumber(cashBlockUsd[1]);
  const rateFromText = extractInvestmentUsdKrwRateFromText(raw);
  const preferredKrw = raw.match(/(?:\uBCF4\uC720\s*)?(?:\uD604\uAE08|\uC608\uC218\uAE08)[^\n]{0,40}(?:\u20A9|KRW|\uC6D0)[^\n]{0,10}([0-9][0-9,]*(?:\.[0-9]{1,4})?)/i);
  if (preferredKrw) {
    const krw = parseInvestmentNumber(preferredKrw[1]);
    if (krw > 0) return Math.round((krw / (rateFromText || investmentUsdKrwRate())) * 100) / 100;
  }
  const cashMatch = raw.match(/(?:\uD604\uAE08|\uC608\uC218\uAE08|cash)[^\n]{0,80}/i);
  if (!cashMatch) return 0;
  const fragment = cashMatch[0];
  const usd = fragment.match(/(?:\$|USD\s*)([0-9][0-9,]*(?:\.[0-9]{1,4})?)|([0-9][0-9,]*(?:\.[0-9]{1,4})?)\s*(?:USD|\uB2EC\uB7EC|\uBD88)/i);
  if (usd) return parseInvestmentNumber(usd[1] || usd[2]);
  const krw = parseKoreanKrwAmount(fragment);
  if (krw > 0) return Math.round((krw / (rateFromText || investmentUsdKrwRate())) * 100) / 100;
  const n = parseInvestmentNumber((fragment.match(/([0-9][0-9,]*(?:\.[0-9]{1,4})?)/) || [])[1]);
  return n > 0 ? n : 0;
}

function extractInvestmentUsdKrwRateFromText(text) {
  const raw = String(text || '');
  const m = raw.match(/1\s*(?:\uB2EC\uB7EC|USD|dollar)[^\n0-9]{0,20}([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\uC6D0|KRW)/i) ||
    raw.match(/USD\s*\/\s*KRW[^0-9]{0,20}([0-9][0-9,]*(?:\.[0-9]+)?)/i) ||
    raw.match(/(?:\uD658\uC728|\uC6D0\/\uB2EC\uB7EC|\uB2EC\uB7EC\/\uC6D0)[^0-9]{0,20}([0-9][0-9,]*(?:\.[0-9]+)?)/i) ||
    raw.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\uC6D0|KRW)\s*(?:\uD658\uC728|\uC801\uC6A9)/i);
  return m ? parseInvestmentNumber(m[1]) : 0;
}

function parseKoreanKrwAmount(text) {
  const raw = String(text || '').replace(/,/g, '');
  let total = 0;
  const addUnit = (regex, multiplier) => {
    const m = raw.match(regex);
    if (m) total += parseInvestmentNumber(m[1]) * multiplier;
  };
  addUnit(/([0-9]+(?:\.[0-9]+)?)\s*\uC5B5/, 100000000);
  addUnit(/([0-9]+(?:\.[0-9]+)?)\s*\uCC9C/, raw.includes('\uC5B5') ? 10000000 : 1000);
  addUnit(/([0-9]+(?:\.[0-9]+)?)\s*\uBC31/, raw.includes('\uC5B5') ? 1000000 : 100);
  addUnit(/([0-9]+(?:\.[0-9]+)?)\s*\uB9CC/, 10000);
  if (total > 0) return total;
  const won = raw.match(/([0-9][0-9.]*)\s*(?:\uC6D0|KRW)/i);
  return won ? parseInvestmentNumber(won[1]) : 0;
}

function inferInvestmentTradeFill(userText, combinedText, action, position) {
  const user = String(userText || '');
  const combined = String(combinedText || '');
  const oldShares = parseInvestmentNumber(position?.shares);
  const shares = inferInvestmentTradeShares(user, combined, action, oldShares);
  const price = inferInvestmentTradePrice(user, action, position) || inferInvestmentTradePrice(combined, action, position);
  return { shares, price };
}

function inferInvestmentTradeShares(userText, combinedText, action, oldShares = 0) {
  const user = String(userText || '');
  const combined = String(combinedText || '');
  if (action === 'sell' && oldShares > 0) {
    const residual = extractResidualShares(user) || extractResidualShares(combined);
    if (residual > 0 && residual < oldShares) {
      return Math.round((oldShares - residual) * 10000) / 10000;
    }
    if (residual > 0 && Math.abs(residual - oldShares) < 0.0001) {
      return 0;
    }
  }
  const direct =
    extractLabeledNumber(user, /(?:수량|quantity|shares?)/) ||
    extractShareCount(user) ||
    extractLabeledNumber(combined, /(?:수량|quantity|shares?)/) ||
    extractShareCount(combined);
  if (direct > 0) {
    if (action === 'sell' && oldShares > 0 && direct >= oldShares) {
      const residual = extractResidualShares(user) || extractResidualShares(combined);
      if (residual > 0 && residual >= oldShares) return 0;
      return oldShares;
    }
    return direct;
  }

  const percent = extractTradePercent(user) || extractTradePercent(combined);
  if (oldShares > 0 && percent > 0 && (action === 'sell' || action === 'buy' || action === 'add')) {
    return Math.round(oldShares * (percent / 100) * 10000) / 10000;
  }
  return 0;
}

function inferInvestmentTradePrice(text, action = '', position = null) {
  const raw = String(text || '');
  const labeled = extractLabeledNumber(raw, /(?:가격|체결|단가|평균가|매도가|매수가|price|at)/);
  if (labeled > 0) return labeled;
  if (action === 'sell') {
    const avg = parseInvestmentNumber(position?.avgPrice);
    const formula = raw.match(/\(([0-9][0-9,.]*)\s*-\s*([0-9][0-9,.]*)\)/);
    if (formula) {
      const first = parseInvestmentNumber(formula[1]);
      const second = parseInvestmentNumber(formula[2]);
      if (!avg || Math.abs(second - avg) < 0.02) return first;
    }
  }
  const currency = raw.match(/(?:[$＄]\s*([0-9][0-9,.]*)|([0-9][0-9,.]*)\s*(?:달러|불|usd|USD))/);
  if (currency) return parseInvestmentNumber(currency[1] || currency[2]);
  return 0;
}

function extractShareCount(text) {
  const raw = String(text || '');
  const m = raw.match(/([0-9][0-9,.]*)\s*(?:주|shares?|개)/i);
  return m ? parseInvestmentNumber(m[1]) : 0;
}

function extractResidualShares(text) {
  const raw = String(text || '');
  const residualLine = raw.split(/\r?\n/).find(line => /(?:잔여|남은|남아있는|남겨진|remaining)/i.test(line));
  if (residualLine) {
    const matches = [...residualLine.matchAll(/([0-9][0-9,.]*)\s*(?:주|shares?)/gi)];
    if (matches.length) return parseInvestmentNumber(matches[matches.length - 1][1]);
  }
  const patterns = [
    /(?:잔여|남은|남아있는|남겨진|remaining)[^\n]*=\s*([0-9][0-9,.]*)\s*(?:주|shares?)/i,
    /(?:잔여|남은|남아있는|남겨진|remaining)[^0-9]{0,24}([0-9][0-9,.]*)\s*(?:주|shares?)/i,
    /(?:수량|포지션)[^0-9]{0,24}=\s*([0-9][0-9,.]*)\s*(?:주|shares?)/i,
  ];
  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (m) return parseInvestmentNumber(m[1]);
  }
  return 0;
}

function extractTradePercent(text) {
  const raw = String(text || '');
  const m = raw.match(/([0-9][0-9,.]*)\s*(?:%|퍼센트|프로|percent)/i);
  return m ? parseInvestmentNumber(m[1]) : 0;
}

function inferInvestmentAction(text) {
  const raw = String(text || '').toLowerCase();
  if (/(?:\uB9E4\uB3C4|\uD314\uC558|\uD314\uC544|\uC775\uC808|\uCCAD\uC0B0|\uC218\uC775\s*\uC2E4\uD604|sell)/i.test(raw)) return 'sell';
  if (/(?:\uCD94\uAC00\uB9E4\uC218|\uBB3C\uD0C0\uAE30|add)/i.test(raw)) return 'add';
  if (/(?:\uBCF4\uC720|hold)/i.test(raw)) return 'hold';
  if (/(?:\uB9E4\uC218|\uC9C4\uC785|buy)/i.test(raw)) return 'buy';
  if (/추가매수|물타기|add/.test(raw)) return 'add';
  if (/매도|청산|익절|손절|sell/.test(raw)) return 'sell';
  if (/보유|홀드|hold/.test(raw)) return 'hold';
  return 'buy';
}

function findInvestmentPositionFromText(text, symbol = '') {
  const raw = String(text || '').toUpperCase();
  const target = String(symbol || '').toUpperCase();
  return (state.investment?.positions || []).find(p => {
    const sym = String(p.symbol || '').toUpperCase();
    const name = String(p.name || '').toUpperCase();
    return (target && sym === target) || (sym && raw.includes(sym)) || (name && raw.includes(name));
  }) || null;
}

function extractLabeledNumber(text, labelRegex) {
  const raw = String(text || '');
  const m = raw.match(new RegExp(`${labelRegex.source}[^0-9-]*([0-9][0-9,.]*)`, 'i'));
  if (!m) return 0;
  return parseInvestmentNumber(m[1]);
}
function inferInvestmentSymbol(text) {
  const known = (state.investment?.positions || []).find(p =>
    p.symbol && text.toUpperCase().includes(String(p.symbol).toUpperCase())
  );
  if (known) return known.symbol;
  const m = (text || '').match(/\b[A-Z]{1,5}\b/);
  return m ? m[0] : '';
}

function shouldFetchInvestmentNews(text) {
  const ask = (text || '').toLowerCase();
  if (state.view === 'investment' && state.replyMode === 'invest-news') return true;
  return /\uBE0C\uB9AC\uD551|\uC2DC\uD669|\uC624\uB298\s*\uC911\uC694|\uC2DC\uC7A5\s*\uBE0C\uB9AC\uD551|\uB274\uC2A4|\uCD5C\uC2E0|\uB3D9\uD5A5|\uACF5\uC2DC|\uBC95\uC548|\uADDC\uC81C|\uAC80\uC0C9|\uCC3E\uC544|\uCC3E\uC544\uC918|\uC54C\uC544\uBD10|briefing|brief|market update|news|headline|filing|bill|act|regulation|search|find|look up|x\.com|twitter|tweet|thetechinvest|elon|musk|cathie|wood|thiel/.test(ask);
}

function shouldFetchInvestmentMarketContext(text) {
  const ask = String(text || '').toLowerCase();
  if (state.view === 'investment' && state.replyMode === 'invest-status') return true;
  return /\uBE0C\uB9AC\uD551|\uC2DC\uD669|\uC624\uB298\s*\uC911\uC694|\uC2DC\uC7A5\s*\uBE0C\uB9AC\uD551|\uC0C1\uD0DC|\uC2DC\uC138|\uD604\uC7AC\uAC00|\uAC00\uACA9|\uC5B4\uB54C|\uD3C9\uAC00|\uC190\uC775|\uD3EC\uD2B8\uD3F4\uB9AC\uC624|\uD604\uAE08|\uC608\uC218\uAE08|\uC6D0\uD654|\uD658\uC728|\uB2EC\uB7EC|briefing|brief|market update|status|price|quote|position|portfolio|cash|krw|usd.?krw|exchange|fx/.test(ask);
}

function inferInvestmentMarketSymbols(text) {
  const inv = state.investment || defaultInvestmentState();
  const raw = String(text || '').toUpperCase();
  const lower = String(text || '').toLowerCase();
  const known = (inv.positions || [])
    .map(p => normalizeInvestmentMarketSymbol(p.symbol || ''))
    .filter(Boolean);
  const aliases = [
    { symbols: ['CRCL'], terms: ['써클', '서클', 'circle'] },
    { symbols: ['IREN'], terms: ['아이렌', 'iris energy'] },
    { symbols: ['ETH-USD', 'ETH'], terms: ['이더리움', 'ether', 'ethereum'] },
    { symbols: ['BTC-USD', 'BTC'], terms: ['비트코인', 'bitcoin'] },
  ];
  const aliasSymbols = aliases
    .filter(item => item.terms.some(term => lower.includes(term)))
    .flatMap(item => item.symbols)
    .map(sym => normalizeInvestmentMarketSymbol(sym))
    .filter(sym => known.includes(sym));
  if (aliasSymbols.length) return [...new Set(aliasSymbols)].slice(0, 8);
  const mentioned = known.filter(sym => raw.includes(sym));
  if (mentioned.length) return [...new Set(mentioned)].slice(0, 8);
  const explicit = [...raw.matchAll(/\b[A-Z][A-Z0-9.\-]{0,7}\b/g)]
    .map(m => normalizeInvestmentMarketSymbol(m[0]))
    .filter(sym => !['AI', 'API', 'USD', 'NEWS'].includes(sym));
  if (explicit.length) return [...new Set(explicit)].slice(0, 8);
  if (/\uB0B4|\uBCF4\uC720|\uD3EC\uD2B8\uD3F4\uB9AC\uC624/.test(text || '')) return known.slice(0, 8);
  return known.slice(0, 5);
}

async function fetchInvestmentMarketContext(text) {
  if (!shouldFetchInvestmentMarketContext(text)) return '';
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const symbols = inferInvestmentMarketSymbols(text);
  if (!symbols.length) return '';
  const today = new Date().toISOString().split('T')[0];

  let quotes = [];
  let source = '';
  let quoteError = '';
  try {
    const data = await fetchMarketQuoteData(symbols);
    quotes = data.quotes || [];
    source = data.source || 'market quote proxy';
    if (quotes.length) {
      applyInvestmentQuotes(quotes);
      saveData({ retries: 0 });
    }
  } catch (e) {
    quoteError = e.message || String(e);
    logger.warn('투자 대화 시세 조회 실패', e);
  }

  const quoteMap = {};
  quotes.forEach(q => {
    if (q.symbol) quoteMap[String(q.symbol).toUpperCase()] = q;
  });
  const totals = investmentTotals(inv.positions);
  const rows = symbols.map(sym => {
    const position = (inv.positions || []).find(p => normalizeInvestmentMarketSymbol(p.symbol) === sym);
    const quote = quoteMap[sym];
    const current = quote?.price ?? position?.currentPrice ?? 0;
    const avg = parseInvestmentNumber(position?.avgPrice);
    const shares = parseInvestmentNumber(position?.shares);
    const value = shares * parseInvestmentNumber(current);
    const gain = value - shares * avg;
    const gainPercent = shares && avg ? (gain / (shares * avg)) * 100 : 0;
    const weight = totals.totalValue ? (value / totals.totalValue) * 100 : 0;
    return [
      `- ${sym}${position?.name ? ` (${position.name})` : ''}`,
      `  - 보유 수량: ${shares || 0}`,
      `  - 평균 단가: ${avg || 0}`,
      `  - 조회/기록 현재가: ${current || '미조회'}`,
      quote?.changePercent != null ? `  - 당일 변동률: ${Number(quote.changePercent).toFixed(2)}%` : '',
      shares ? `  - 평가액: $${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}, 평가손익: ${gain >= 0 ? '+' : '-'}$${Math.abs(gain).toLocaleString(undefined, { maximumFractionDigits: 2 })} (${gainPercent >= 0 ? '+' : ''}${gainPercent.toFixed(2)}%)` : '',
      weight ? `  - 포트폴리오 비중: ${weight.toFixed(1)}%` : '',
      position?.targetPrice ? `  - 목표가: ${position.targetPrice}` : '',
      position?.stopPrice ? `  - 손절가: ${position.stopPrice}` : '',
      position?.thesis ? `  - 투자 논리: ${position.thesis}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n');

  return `\n\n[투자 시세/보유 상태 조회 결과]\n- 조회 기준일: ${today}\n- 조회 대상: ${symbols.join(', ')}\n- 시세 출처: ${source || (quoteError ? '조회 실패' : '기록된 현재가')}\n${quoteError ? `- 시세 조회 오류: ${quoteError}\n` : ''}${rows}\n\n시세 응답 규칙:\n- 위 [투자 시세/보유 상태 조회 결과]가 있으면 "실시간 시세 조회 기능이 없다"고 말하지 않는다.\n- 현재가가 조회되었으면 현재가, 평단, 손익, 목표가/손절가와의 거리, 원칙상 확인할 점을 짧게 답한다.\n- 현재가 조회가 실패했더라도 보유 기록의 현재가가 있으면 그 기준이라고 명시하고 해석한다.\n- 매수/매도 단정이나 수익률 보장은 하지 않는다.`;
}

function shouldFetchInvestmentFxContext(text) {
  const ask = String(text || '').toLowerCase();
  return /\uD658\uC728|\uC6D0\uD654|\uC6D0\uC73C\uB85C|\uB2EC\uB7EC|\uD604\uAE08|\uC608\uC218\uAE08|krw|usd.?krw|exchange|fx|cash/.test(ask);
}

async function fetchInvestmentFxContext(text) {
  if (!shouldFetchInvestmentFxContext(text)) return '';
  const inv = state.investment = normalizeInvestmentState(state.investment);
  const today = new Date().toISOString().split('T')[0];
  const explicitRate = extractInvestmentUsdKrwRateFromText(text);
  let rate = explicitRate || investmentUsdKrwRate();
  let source = '기록된 환율';
  let quoteError = '';
  try {
    const data = await fetchMarketQuoteData(['USDKRW=X']);
    const quote = (data.quotes || []).find(q => String(q.symbol || '').toUpperCase() === 'USDKRW=X') || (data.quotes || [])[0];
    if (!explicitRate && quote?.price > 0) {
      rate = Number(quote.price);
      source = data.source || 'market quote proxy';
    }
  } catch (e) {
    quoteError = e.message || String(e);
    logger.warn('투자 대화 환율 조회 실패', e);
  }

  if (explicitRate) source = '사용자 입력';
  if (rate > 0 && Math.abs(parseInvestmentNumber(inv.usdKrwRate) - rate) > 0.0001) {
    inv.usdKrwRate = rate;
    inv.usdKrwUpdatedAt = new Date().toISOString();
    inv.usdKrwSource = source;
    saveData({ retries: 0 });
    if (typeof refreshInvestmentSurfaces === 'function') refreshInvestmentSurfaces();
  }

  const totals = investmentTotals(inv.positions);
  const cashValue = (inv.positions || [])
    .filter(p => isCashInvestmentPosition(p))
    .reduce((sum, p) => sum + investmentPositionValue(p, 'currentPrice'), 0);
  return `\n\n[투자 환율 조회 결과]\n- 조회 기준일: ${today}\n- USD/KRW: ${Number(rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}\n- 환율 출처: ${source}\n${quoteError ? `- 환율 조회 오류: ${quoteError}\n` : ''}- 현금: ${formatMoney(cashValue)} = 약 ₩${Math.round(cashValue * rate).toLocaleString('ko-KR')}\n- 총 평가액: ${formatMoney(totals.totalValue)} = 약 ₩${Math.round(totals.totalValue * rate).toLocaleString('ko-KR')}\n\n환율 응답 규칙:\n- 위 [투자 환율 조회 결과]가 있으면 "환율 조회 기능이 없다"고 말하지 않는다.\n- 원화 환산은 USD/KRW 기준과 조회 기준일을 함께 말한다.\n- 현금은 투자 가능한 예수금으로 설명하되, 세금 예비금이나 버퍼가 있으면 별도 분리 필요성을 짚는다.`;
}

function inferInvestmentNewsSymbols(text) {
  const inv = state.investment || defaultInvestmentState();
  const raw = (text || '').toUpperCase();
  const stopSymbols = new Set(['AI', 'API', 'ETF', 'USD', 'NEWS', 'GENIUS', 'ACT', 'CRYPTO', 'CLARITY', 'BILL', 'FIT21']);
  const known = (inv.positions || [])
    .map(p => String(p.symbol || '').toUpperCase())
    .filter(Boolean);
  const mentioned = known.filter(sym => raw.includes(sym));
  if (mentioned.length) return mentioned;
  const explicit = [...raw.matchAll(/\b[A-Z][A-Z0-9.\-]{0,7}\b/g)]
    .map(m => m[0])
    .filter(sym => !stopSymbols.has(sym));
  if (explicit.length) return [...new Set(explicit)].slice(0, 5);
  if (/\uBCF4\uC720|\uB0B4\s*\uC8FC\uC2DD|\uD3EC\uD2B8\uD3F4\uB9AC\uC624/.test(text || '')) return known.slice(0, 8);
  return known.slice(0, 5);
}

function inferInvestmentNewsQueries(text) {
  const raw = text || '';
  const lower = raw.toLowerCase();
  const queries = [];
  const add = q => {
    if (q && !queries.some(existing => existing.toLowerCase() === q.toLowerCase())) queries.push(q);
  };

  if (/\uD074\uB798\uB9AC\uD2F0|clarity|fit21|market structure|\uC2DC\uC7A5\s*\uAD6C\uC870/.test(lower)) {
    add('crypto market structure clarity act');
    add('Digital Asset Market Structure Clarity Act');
  }
  if (/genius|\uC9C0\uB2C8\uC5B4\uC2A4|\uC2A4\uD14C\uC774\uBE14|stablecoin/.test(lower)) {
    add('GENIUS Act stablecoin bill');
  }
  if (/\uC554\uD638\uD654\uD3D0|\uAC00\uC0C1\uC790\uC0B0|\uB514\uC9C0\uD138\uC790\uC0B0|crypto|\uBC95\uC548|\uADDC\uC81C/.test(lower) && !queries.length) {
    add('US crypto legislation news');
    add('US crypto market structure bill');
  }
  if (/x\.com|twitter|tweet|\uD2B8\uC717|\uD2B8\uC704\uD130|thetechinvest|elon|musk|cathie|wood|thiel/.test(lower)) {
    add(`${raw.replace(/\s+/g, ' ').trim()} market news`);
    add(`${raw.replace(/\s+/g, ' ').trim()} investor commentary`);
  }

  return queries.slice(0, 5);
}
async function fetchInvestmentNewsContext(text) {
  if (!shouldFetchInvestmentNews(text)) return '';
  const symbols = inferInvestmentNewsSymbols(text);
  const queries = inferInvestmentNewsQueries(text);
  if (!symbols.length && !queries.length) return '';
  const today = new Date().toISOString().split('T')[0];
  try {
    const data = await apiFetchInvestmentNews(symbols, 7, queries);
    const items = Array.isArray(data.news) ? data.news : [];
    const targetLines = [
      symbols.length ? `- 조회 종목: ${symbols.join(', ')}` : '',
      queries.length ? `- 조회 이슈: ${queries.join(' / ')}` : '',
    ].filter(Boolean).join('\n');
    if (!items.length) {
      return `\n\n[투자 뉴스 조회 결과]\n- 조회 기준일: ${today}\n${targetLines}\n- 관련 원천 자료나 뉴스가 조회되지 않았습니다. 실패 사실을 짧게 알리고, 기존 투자 원칙 기준으로만 답하세요.`;
    }
    const sourceLines = items.map((item, idx) => [
      `${idx + 1}. ${item.topic || item.symbol || symbols[0] || queries[0]} | ${item.title || '제목 없음'}`,
      `   - 발행/공시일: ${item.published || '미상'}`,
      `   - 출처: ${item.publisher || item.source || '미상'}${item.kind ? ` (${item.kind})` : ''}`,
      item.source && item.publisher ? `   - 수집 경로: ${item.source}` : '',
      `   - 요약 원문: ${item.summary || '제공된 요약 없음'}`,
      `   - 링크: ${item.link || '없음'}`,
    ].filter(Boolean).join('\n')).join('\n');
    return `\n\n[투자 뉴스/공시 조회 결과]\n조회 기준일: ${today}\n${targetLines}\n\n${sourceLines}\n\n뉴스 응답 규칙:\n- 위 자료를 그대로 링크 목록으로만 내보내지 말고, 먼저 확인된 사실을 3~5문장으로 요약한다.\n- RSS 제목/요약만 있는 자료는 단정하지 말고 "확인된 범위에서는"이라고 표시한다.\n- SEC EDGAR는 공식 원천 자료로 취급하되, '뉴스 흐름'이 아니라 공시 원문으로 해석한다.\n- 종목 뉴스와 법안/규제/매크로 이슈가 같이 있으면 각 주제를 별도 섹션으로 나누어 답한다.\n- 비티커 이슈는 특정 종목 공시에 직접 언급이 없음으로 처리하지 말고, 별도 검색 결과로 거시 해석한다.\n- 법안/규제 뉴스는 "무슨 일이 있었나 / 시장 영향 / 내 보유 종목과의 연결 / 내 원칙상 확인할 점" 구조로 답한다.\n- 발행/공시일을 조회 기준일과 혼동하지 않는다. 조회 기준일은 ${today}이지만 자료 발행일은 별도로 말한다.\n- 사용자가 보유주 관점으로 물으면 '무슨 일이 있었나 → 왜 중요한가 → 내 원칙상 확인할 점' 순서로 답한다.\n- 마크다운을 정상 사용한다. 섹션 제목은 반드시 ## 또는 ### 로 시작하고, 굵은 글씨와 짧은 목록을 사용한다.\n- 링크는 마지막 '## 원문 링크' 섹션에만 모으고 본문은 해석과 리스크 체크 중심으로 둔다.\n- 링크 URL을 중간에서 자르지 말고, 완전한 마크다운 링크 형식 [제목](URL)로 쓴다.\n- "실시간 인터넷 검색 기능이 없다"거나 사용자가 직접 검색하라고 말하지 않는다.\n- 특정 종목 매수/매도 추천이나 수익률 예측은 하지 않는다.`;
  } catch (e) {
    logger.warn('투자 뉴스 검색 실패', e);
    return `\n\n[투자 뉴스 조회 결과]\n- 조회 기준일: ${today}\n- 뉴스 조회가 실패했습니다. 실패 사실을 짧게 알리고 기존 기록과 투자 원칙으로만 답하세요.`;
  }
}
function clampInvestmentPromptText(value, max = 700) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max).trim()} ...[truncated ${text.length - max} chars]`;
}

function clampInvestmentPromptBlock(value, max = 6000) {
  const text = String(value || '').trim();
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max).trim()}\n...[truncated ${text.length - max} chars]`;
}

// AI 대화용 시스템 프롬프트 생성 (현재 역할 기준으로 매 메시지마다 최신 반영)
function _buildChatSysPrompt(isMyRecords, topic, student, extraContext = '') {
  const modePrompt = _replyModePrompt(state.replyMode || 'dictation');
  if (state.view === 'investment') {
    const inv = state.investment || defaultInvestmentState();
    const totals = typeof investmentTotals === 'function'
      ? investmentTotals(inv.positions || [])
      : { totalValue: 0, totalCost: 0, totalGain: 0, totalGainPercent: 0 };
    const positions = inv.positions.map(p =>
      `- ${p.symbol || '?'}: 수량 ${p.shares || 0}, 평균 ${p.avgPrice || 0}, 현재 ${p.currentPrice || 0}, 목표 ${p.targetPrice || '-'}, 손절 ${p.stopPrice || '-'}, 논리 ${clampInvestmentPromptText(p.thesis || '없음', 240)}`
    ).join('\n') || '- 등록된 보유 종목 없음';
    const portfolioSnapshot = [
      'AUTHORITATIVE CURRENT LEDGER - use these numbers over any earlier chat history.',
      `- 총 평가액: ${totals.totalValue.toFixed(2)}`,
      `- 총 매입금: ${totals.totalCost.toFixed(2)}`,
      `- 평가손익: ${totals.totalGain.toFixed(2)} (${totals.totalGainPercent.toFixed(2)}%)`,
      `- USD/KRW: ${parseInvestmentNumber(inv.usdKrwRate) || 1350}`,
    ].join('\n');
    const dailyDesk = typeof buildDailyInvestmentDesk === 'function' ? buildDailyInvestmentDesk(inv) : null;
    const dailyDeskBrief = dailyDesk && typeof renderDailyDeskBrief === 'function'
      ? clampInvestmentPromptBlock(renderDailyDeskBrief(dailyDesk), 5500)
      : 'Daily Investment Desk: unavailable';
    const recentNews = inv.events
      .filter(e => e.type === 'news')
      .slice(-5)
      .map(e => `- ${e.date} ${e.symbol || ''} ${clampInvestmentPromptText(e.title, 160)}: ${clampInvestmentPromptText(e.body, 650)}`)
      .join('\n') || '- 기록된 뉴스 없음';
    const recentSignals = (inv.events || [])
      .filter(e => e.type === 'signal')
      .slice(-8)
      .map(e => `- ${e.date || ''} ${e.symbol || ''} ${clampInvestmentPromptText(e.title || 'Signal', 160)}${e.handle ? ` (@${e.handle})` : ''}: ${clampInvestmentPromptText(e.body, 520)}`)
      .join('\n') || '- No saved market signals';
    const todayIso = new Date().toISOString().slice(0, 10);
    const upcomingEvents = (inv.events || [])
      .filter(e => e.date && e.date >= todayIso && ['earnings', 'macro', 'analyst'].includes(e.type))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 10)
      .map(e => `- ${e.date} [${e.type}] ${e.symbol || ''} ${clampInvestmentPromptText(e.title, 160)}: ${clampInvestmentPromptText(e.body, 360)}`)
      .join('\n') || '- 예정된 투자 일정 없음';
    const recentDecisions = inv.decisions.slice(-5).map(d =>
      `- ${d.createdAt?.slice(0, 10) || ''} ${d.symbol} ${d.action}: ${clampInvestmentPromptText(d.label, 120)} — ${clampInvestmentPromptText(d.summary, 520)}`
    ).join('\n') || '- 기록된 매매 판단 없음';
    const compactExtraContext = clampInvestmentPromptBlock(extraContext, 8000);
    return `당신은 개인 투자자의 이성적 매매 통제 파트너입니다.
목표는 수익률 예측이나 종목 추천이 아니라, 사용자가 사전에 정한 원칙을 기억하고 감정적 매매를 줄이는 것입니다.
감정 상태를 묻지 말고, 원칙·숫자·기록·뉴스 해석을 기준으로 짧고 분명하게 돕습니다.
매수/매도 단정이나 수익률 보장은 금지하지만, 원칙 수립·비중 축소·손절 조건·추가매수 조건에 대해서는 앱의 기본 원칙과 보유 데이터에 근거한 "원칙 후보" 또는 "보수적 기본안"을 먼저 제시할 수 있습니다.
사용자가 "너가 추천해줘", "알아서 정해줘", "어떻게 세우면 좋을까"처럼 원칙 설계를 요청하면 "제 역할 밖"이라고 말하지 말고, 단정적 투자 조언이 아닌 실행 가능한 원칙안으로 답합니다.
앱은 '/api/market/quote'를 통해 보유 종목 현재가와 지수를 조회할 수 있습니다. 시세/상태 컨텍스트가 제공된 경우 절대 "실시간 시세 조회 기능이 없다"고 말하지 않습니다.
앱은 같은 시세 API로 USD/KRW 환율도 조회할 수 있습니다. 환율 컨텍스트가 제공된 경우 절대 "환율 조회 기능이 없다"고 말하지 않습니다.
사용자가 "상태 어때", "현재 어때", "시세", "가격", "보유 종목 어때"처럼 물으면 현재가, 평단, 평가손익, 목표가/손절가 거리, 원칙상 확인할 점을 우선 답합니다.
사용자가 "뉴스 동향에 기록", "투자 원칙으로 저장", "매매 기록으로 남겨"처럼 말하면 저장될 수 있게 제목과 본문을 정돈해서 답합니다.
사용자가 "포트폴리오 수정", "포트폴리오 반영", "다시 시도", "반영된 포트폴리오 보여줘"처럼 말하면 실제 앱 데이터에 반영될 수 있도록 종목, 매수/매도, 체결 수량, 체결가, 잔여 수량을 명확히 적습니다.
절대 "저는 실제로 포트폴리오 데이터를 직접 수정하는 기능이 없습니다" 또는 "앱에서 직접 변경해 주세요"라고 말하지 않습니다. 정보가 충분하면 반영 문장을 만들고, 부족하면 필요한 숫자 하나만 물어봅니다.
저장에 필요한 정보가 부족하면 바로 저장하지 말고 딱 필요한 항목만 짧게 물어봅니다.
매매 기록에 필요한 최소 항목은 종목, 매수/매도/보유, 이유입니다. 가능하면 수량, 가격, 손절가, 목표가도 확인합니다.
투자 원칙은 사용자의 말에서 원칙 문장을 만들되, 기준이 애매하면 "어느 조건에서 적용할지"를 먼저 물어봅니다.
포트폴리오 비중이 원칙을 크게 초과한 경우에는 사용자가 숫자를 직접 정하지 않아도 기본 원칙(${inv.rules.maxPositionWeight}%)과 현재 비중을 근거로 1차 목표 비중, 단계적 축소안, 예외 조건을 제안합니다.
사용자가 실제 투자금, 평단, 익절 비율, 실현익을 말하면 반드시 대략 계산을 먼저 합니다. 남은 원가, 남은 평가액, 남은 미실현 손익, 현재 총 이익, 세금 예비금, 남은 포지션의 변동폭을 "추정"으로 분리해 보여줍니다.
실적 발표, 어닝콜, 공시, 인수, 규제처럼 날짜가 있는 이벤트를 물으면 먼저 이벤트 시간과 현재가/평단/비중을 확인하고, 주가 예측 단정 대신 상승/중립/하락 시나리오별 행동 규칙을 제시합니다.
좋은 답변은 애널리스트 보고서가 아니라 "내 계좌에 바로 적용할 수 있는 행동 계획"이어야 합니다. 핵심 구조는 결론 → 내 포지션 계산 → 지금 하지 말 것 → 시나리오별 행동표 → 확인할 체크포인트 → 최종 액션 플랜입니다.
실적 분석은 컨센서스 숫자를 반복하지 말고 "컨센서스가 빗나갈 수 있는 지점"을 분석합니다. 매출/EPS 컨센서스, 옵션 기대 변동폭, 애널리스트 코멘트, 회사 공시, 최근 뉴스가 서로 어디서 충돌하는지 비교합니다.
실적 이벤트 답변은 최소한 다음 항목을 분리합니다: 1) 시장 컨센서스, 2) 내 베이스 케이스, 3) 컨센서스와 어긋날 수 있는 핵심 지점, 4) 강한 발표 조합, 5) 위험한 발표 조합, 6) 발표 직후 판정표, 7) 내 계좌 액션 플랜.
AI/데이터센터/채굴주처럼 스토리 주식은 headline EPS보다 실제 주가 반응 변수를 우선합니다. 예: AI Cloud revenue, contracted ARR, revenue-generating ARR, RPO, 대형 고객 acceptance, capex funding, ATM/유상증자 사용량, 희석 리스크, 고객명 직접 언급 여부.
루머는 기본 가치가 아니라 콜옵션으로 다룹니다. 특정 고객명이나 계약 규모가 확인되지 않으면 "루머 해소 실패" 가능성을 따로 표시하고, 이름·규모·기간·선급금·인도/승인 조건이 함께 나올 때만 강한 트리거로 봅니다.
세금, 환율, 수수료는 정확한 세무 조언으로 단정하지 말고 "대략 예비금"으로 표시합니다. 해외주식 실현익이 언급되면 세금 예비금을 먼저 떼어두는 원칙을 제안합니다.

투자 원칙:
- 하루 손실 한도: ${inv.rules.dailyLossLimit}%
- 종목별 최대 비중: ${inv.rules.maxPositionWeight}%
- 쿨다운: ${inv.rules.cooldownMinutes}분
- 추격매수 제한 기준: ${inv.rules.chaseLimit}%
- 핵심 원칙: ${inv.rules.coreRules || '아직 없음'}

보유 종목:
${positions}

포트폴리오 스냅샷:
${portfolioSnapshot}

Daily Investment Desk briefing rules:
- The Daily Desk is a market briefing layer, not a portfolio summary. Use it to connect macro variables, sector flows, policy/news signals, and the user's holdings.
- Split every serious market answer into macro view and micro/position view when relevant.
- Do not use a fixed checklist. Infer the actual price drivers from the current holdings, asset type, sector, market regime, upcoming events, and saved news/signals.
- For each holding, identify what could move price now: earnings/guidance, rates, policy, liquidity, sector momentum, positioning, financing/dilution, contracts, commodities, FX, or geopolitics as applicable.
- Use CRCL/ETH/IREN/semiconductor-specific logic only when those exposures exist; if holdings change, rebuild the research frame around the new holdings.
- Mark unofficial X/trader flow as unconfirmed until official filings, company IR, trusted financial media, or price/volume data confirm it.
- If the user asks for a recommendation, give a ranked scenario/action plan with invalidation conditions, not a guaranteed prediction.

오늘의 투자 데스크:
${dailyDeskBrief}

최근 뉴스 동향:
${recentNews}

다가오는 투자 일정:
Recent X / market signals:
${recentSignals}

Search behavior:
- If investment news/search context is supplied, use it directly and do not claim that real-time search is unavailable.
- Automatic X monitoring is paused. For X/trader requests, summarize available public search/news results and treat them as weak market signals until confirmed by official filings, company IR, trusted financial media, or price/volume data.
- If the user says to save a searched item, save it as news or signal depending on the wording.

${upcomingEvents}

최근 매매 판단:
${recentDecisions}

${compactExtraContext}

${modePrompt}`;
  }
  if (isMyRecords) {
    // currentRole → preset 조회, 없으면 topic.aiPrompt, 없으면 기본값
    let rolePrompt = '따뜻하게 경청하고 공감하는 친구처럼';
    const preset = AI_ROLE_PRESETS.find(p => p.id === state.currentRole);
    if (preset && preset.id !== 'custom' && preset.prompt) {
      rolePrompt = preset.prompt;
    } else if (topic?.aiPrompt) {
      rolePrompt = topic.aiPrompt;
    }
    return `당신은 다음 역할입니다: ${rolePrompt}

주제: '${topic?.title || '나의 기록'}'
한국어 존댓말 사용.

${modePrompt}`;
  } else {
    const student_ = student;
    return `당신은 학교상담 임상 슈퍼바이저입니다.
내담자: ${student_?.alias || '?'} (${student_?.grade || ''}${student_?.gender ? ' · ' + student_.gender : ''})
가정: ${student_?.family || '정보 없음'} / 교우: ${student_?.peers || '정보 없음'}
한국어 존댓말 사용.

${modePrompt}`;
  }
}

function _replyModePrompt(mode) {
  const shared = `공통 원칙:
- 사용자의 말을 끊거나 대화를 억지로 이어가지 않는다.
- 사용자가 요청하지 않으면 분석, 조언, 해석을 길게 하지 않는다.
- 응답은 기본적으로 1~3문장으로 짧게 한다.
- 한국어 존댓말을 사용한다.`;

  if (mode === 'invest-status') {
    return `${shared}

현재 응답 모드: 투자 상태
- 보유 종목, 현재가, 평단, 평가손익, 목표가/손절가 거리, 포트폴리오 비중을 먼저 본다.
- 시세 컨텍스트가 있으면 그 숫자를 기준으로 답하고, 조회가 실패하면 기록된 현재가 기준이라고 명시한다.
- 결론은 "현재 상태 / 원칙상 확인할 점 / 지금 하지 말아야 할 행동" 순서로 짧게 정리한다.`;
  }
  if (mode === 'invest-news') {
    return `${shared}

현재 응답 모드: 투자 뉴스
- 뉴스, 공시, 법안, 실적 발표를 원천 자료와 금융 뉴스 기준으로 분리해 정리한다.
- 단순 링크 나열이 아니라 "무슨 일 / 왜 중요함 / 내 보유 종목과 원칙상 영향"으로 해석한다.
- 확인되지 않은 내용은 추정이라고 분명히 표시하고 매수·매도 단정은 하지 않는다.`;
  }
  if (mode === 'invest-rules') {
    return `${shared}

현재 응답 모드: 투자 원칙
- 사용자의 말에서 실제로 집행 가능한 원칙 문장, 조건, 예외, 점검 주기를 뽑는다.
- 정보가 부족해도 앱 기본 원칙과 보유 데이터로 합리적 기본안을 만들 수 있으면 먼저 제시한다. 질문은 기본안 제시 후 꼭 필요한 확인 1개만 한다.
- "추천은 제 역할 밖입니다", "직접 정해주세요"처럼 회피하지 않는다. 대신 "원칙 후보", "보수적 기본안", "공격적 대안"처럼 책임 있는 선택지로 말한다.
- 비중 축소 원칙은 현재 비중이 한도보다 높으면 기본 한도까지의 단계적 축소안을 제시한다. 예: 실적 전 1차 목표 50%, 이벤트 후 25~30%, 계약 발표 시 예외 보류.
- 저장을 요청받으면 투자 원칙 메뉴에 들어갈 수 있는 형태로 제목과 규칙을 정돈한다.`;
  }
  if (mode === 'invest-trade') {
    return `${shared}

현재 응답 모드: 매매 판단
- 종목, 행동(매수/매도/보유), 수량, 가격, 손절가, 목표가, 이유, 원칙 위반 여부를 점검한다.
- 물타기, 추격매수, 손절 회피, 익절 미루기 위험을 먼저 확인한다.
- 사용자가 비중, 수량, 축소폭, 추가매수 구간을 물으면 현재 포트폴리오와 앱 기본 원칙을 기준으로 보수적 기본안을 제시한다.
- "추천은 제 역할 밖입니다"라고 멈추지 말고, "조건부 매매 계획"으로 바꿔서 말한다.
- 사용자가 실적 발표 전후 계획을 물으면 "예측"보다 "수익 방어/업사이드 참여" 프레임으로 답한다.
- 큰 실현익이 있는 경우 남은 물량을 공짜 주식처럼 다루지 말고 현재 평가액이 걸린 새 포지션으로 계산한다.
- 컨센서스, 옵션 기대 변동폭, 애널리스트 코멘트, 회사 공시가 있으면 서로 같은 방향인지 충돌하는지 비교한다.
- "실제 발표가 어디서 어긋날 수 있는가"를 먼저 찾고, 숫자 미스보다 주가가 반응할 변수와 스토리 미스를 구분한다.
- 답변에는 가능하면 시나리오별 가격/비중/행동 표를 포함하고, 마지막에는 오늘 당장 할 행동 3~5개만 남긴다.
- 결론은 허가/금지 단정이 아니라 "통과 조건 / 위반 가능성 / 지금 필요한 확인 하나"로 말한다.`;
  }
  if (mode === 'invest-summary') {
    return `${shared}

현재 응답 모드: 투자 정리
- 지금 대화를 투자 타임라인, 뉴스 동향, 투자 원칙, 매매 기록 중 어디에 저장할지 구분해 정리한다.
- 저장 가능한 제목, 본문, 관련 종목, 날짜, 다음 점검 항목을 포함한다.
- 저장에 필요한 핵심 정보가 부족하면 누락된 항목만 짧게 묻는다.`;
  }
  if (mode === 'question') {
    return `${shared}

현재 응답 모드: 답변
- 사용자의 질문에 바로 답한다.
- 되묻거나 대화를 이어가기 위한 질문을 하지 않는다.
- 사용자가 "딱 하나", "바로", "구체적으로"라고 요청하면 후보를 늘어놓지 말고 가장 효과적인 방법 하나만 제시한다.
- 답변은 짧게 시작하고, 바로 실행 가능한 첫 행동을 포함한다.
- 공감 문장으로 시간을 쓰지 말고 결론부터 말한다.`;
  }
  if (mode === 'summary') {
    return `${shared}

현재 응답 모드: 정리
- 지금까지 사용자가 말한 내용을 DB에 기록으로 저장될 본문처럼 정리한다.
- 이 응답은 그대로 '나의 기록'에 저장되므로 제목 후보, 핵심 내용, 남겨둘 문장을 읽기 좋은 기록 형태로 쓴다.
- 후속 질문을 하지 않는다.`;
  }
  if (mode === 'advice') {
    return `${shared}

현재 응답 모드: 조언
- 사용자가 조언을 원하는 것으로 보고, 조심스럽지만 분명한 의견을 준다.
- 가능한 다음 행동은 하나만 제안한다.
- 조언 뒤에 대화를 이어가려는 질문을 붙이지 않는다.`;
  }
  return `${shared}

현재 응답 모드: 받아쓰기
- 당신은 대화를 이어가기 위해 질문하는 챗봇이 아니라, 사용자의 말을 받아 적고 핵심을 짧게 붙잡는 기록 조력자다.
- 사용자가 요청하지 않으면 후속 질문을 하지 않는다.
- 사용자의 말을 기록 가능한 핵심 표현으로 1~2문장만 정리한다.
- "더 말해볼까요?", "어떤 기분이었나요?" 같은 자동 질문을 피한다.
- 필요하면 "기록해둘게요", "핵심은 ~로 남겨둘 수 있어요"처럼 반응한다.`;
}

// ---------------------------------------------------------------------------
// 대화 내용 localStorage 저장/복원 (새로고침·탭 전환 후에도 유지)
// ---------------------------------------------------------------------------

function investmentNewYorkParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function previousInvestmentWeekday(dateText) {
  const d = new Date(`${dateText}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

function investmentMarketSessionDate(date = new Date()) {
  const ny = investmentNewYorkParts(date);
  if (ny.weekday === 'Sat' || ny.weekday === 'Sun') return previousInvestmentWeekday(ny.date);
  return ny.date;
}

function isAfterInvestmentMarketClose(date = new Date()) {
  const ny = investmentNewYorkParts(date);
  if (ny.weekday === 'Sat' || ny.weekday === 'Sun') return true;
  return ny.hour > 16 || (ny.hour === 16 && ny.minute >= 0);
}

function investmentChatSessionId(date = investmentMarketSessionDate()) {
  return `market-${date}`;
}

function ensureInvestmentChatSession(date = new Date()) {
  state.investment = normalizeInvestmentState(state.investment);
  const sessionDate = investmentMarketSessionDate(date);
  const sessionId = investmentChatSessionId(sessionDate);
  let session = state.investment.chatSessions.find(s => s.id === sessionId);

  if (!session) {
    session = {
      id: sessionId,
      date: sessionDate,
      market: 'US',
      startedAt: new Date().toISOString(),
      updatedAt: null,
      closedAt: null,
      summarizedAt: null,
      summaryEventId: null,
      messages: [],
    };
    if (!state.investment.chatSessions.length && Array.isArray(state.investment.chat) && state.investment.chat.length) {
      session.messages = _sanitizeChatHistory(state.investment.chat);
      session.updatedAt = new Date().toISOString();
    }
    state.investment.chatSessions.push(session);
  }

  state.investment.activeChatSessionId = session.id;
  return session;
}

function getActiveInvestmentChatSession() {
  state.investment = normalizeInvestmentState(state.investment);
  return state.investment.chatSessions.find(s => s.id === state.investment.activeChatSessionId) || ensureInvestmentChatSession();
}

function _chatStorageKey() {
  const id = state.selTopic || state.selStudent;
  if (state.view === 'investment') {
    const session = ensureInvestmentChatSession();
    return `jip_chat_v2_investment_${session.id}`;
  }
  return id ? `jip_chat_v2_${id}` : null;
}

function saveChatHistory() {
  const key = _chatStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(state.currentChatMessages));
    if (state.view === 'investment') {
      state.investment = normalizeInvestmentState(state.investment);
      const session = getActiveInvestmentChatSession();
      session.messages = _sanitizeChatHistory(state.currentChatMessages || []);
      session.updatedAt = new Date().toISOString();
      state.investment.chat = [...session.messages];
      if (typeof _saveToLocalCache === 'function') _saveToLocalCache();
      saveData();
      maybeFinalizeInvestmentMarketChatSession();
    }
  } catch (e) { /* 용량 초과 무시 */ }
}

function loadChatHistory() {
  const key = _chatStorageKey();
  if (!key) return false;
  if (state.view === 'investment') {
    state.investment = normalizeInvestmentState(state.investment);
    const session = getActiveInvestmentChatSession();
    if (Array.isArray(session.messages) && session.messages.length) {
      state.currentChatMessages = _sanitizeChatHistory(session.messages);
      state.investment.chat = [...state.currentChatMessages];
      maybeFinalizeInvestmentMarketChatSession();
      return state.currentChatMessages.length > 0;
    }
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const msgs = JSON.parse(raw);
    if (Array.isArray(msgs) && msgs.length) {
      const sanitized = _sanitizeChatHistory(msgs);
      if (sanitized.length) {
        state.currentChatMessages = sanitized;
        if (state.view === 'investment') {
          const session = getActiveInvestmentChatSession();
          session.messages = [...sanitized];
          session.updatedAt = new Date().toISOString();
          state.investment.chat = [...sanitized];
          maybeFinalizeInvestmentMarketChatSession();
        }
        if (sanitized.length !== msgs.length) saveChatHistory();
        return true;
      }
      localStorage.removeItem(key);
    }
  } catch (e) { /* 파싱 오류 무시 */ }
  if (state.view === 'investment' && state.investment.chat.length) {
    const legacy = _sanitizeChatHistory(state.investment.chat);
    if (legacy.length) {
      const session = getActiveInvestmentChatSession();
      session.messages = [...legacy];
      session.updatedAt = new Date().toISOString();
      state.currentChatMessages = legacy;
      return true;
    }
  }
  return false;
}

function _sanitizeChatHistory(msgs) {
  const starterTexts = [
    '대화 준비가 되었어요!',
    '받아쓰기 모드예요. 정리 안 된 말 그대로 남겨도 괜찮아요.',
  ];
  const cleaned = (Array.isArray(msgs) ? msgs : [])
    .filter(m => m && typeof m.text === 'string')
    .filter(m => !(m.role === 'system' && starterTexts.includes(m.text.trim())));
  while (cleaned.length && cleaned[0].role !== 'user') cleaned.shift();
  return cleaned;
}

function maybeFinalizeInvestmentMarketChatSession(date = new Date()) {
  if (!state.investment) return false;
  state.investment = normalizeInvestmentState(state.investment);
  const currentSessionDate = investmentMarketSessionDate(date);
  const afterClose = isAfterInvestmentMarketClose(date);
  let changed = false;

  state.investment.chatSessions.forEach(session => {
    const canClose = session.date < currentSessionDate || (session.date === currentSessionDate && afterClose);
    const messages = _sanitizeChatHistory(session.messages || []);
    const hasNewMessages = !session.summarizedAt || (session.updatedAt && new Date(session.updatedAt) > new Date(session.summarizedAt));
    if (!canClose || !hasNewMessages || messages.filter(m => m.role !== 'system').length < 2) return;

    const eventId = session.summaryEventId || `market-chat-summary-${session.id}`;
    const exists = state.investment.events.some(e => e.id === eventId);
    const nextEvent = {
      id: eventId,
      date: session.date,
      type: 'review',
      symbol: inferInvestmentSymbol(messages.map(m => m.text).join('\n')),
      title: `${session.date} 장 마감 대화 요약`,
      body: buildInvestmentChatSessionSummary(messages, session.date),
      severity: 'info',
      source: 'market-chat-session',
    };
    if (!exists) state.investment.events.push(nextEvent);
    else state.investment.events = state.investment.events.map(e => e.id === eventId ? { ...e, ...nextEvent } : e);
    session.closedAt = session.closedAt || date.toISOString();
    session.summarizedAt = date.toISOString();
    session.summaryEventId = eventId;
    changed = true;
  });

  if (changed) {
    if (typeof _saveToLocalCache === 'function') _saveToLocalCache();
    saveData();
    if (typeof renderRightPanel === 'function') renderRightPanel();
    logger.info('장 마감 대화 세션을 투자 타임라인 이벤트로 자동 정리', {
      count: state.investment.events.filter(e => e.source === 'market-chat-session').length,
    });
  }
  return changed;
}

function buildInvestmentChatSessionSummary(messages, dateText) {
  const userLines = messages
    .filter(m => m.role === 'user')
    .map(m => String(m.text || '').trim())
    .filter(Boolean);
  const aiLines = messages
    .filter(m => m.role === 'ai')
    .map(m => String(m.text || '').trim())
    .filter(Boolean);
  const keywordRe = /매수|매도|손절|익절|원칙|뉴스|공시|실적|포트폴리오|현금|비중|리스크|IREN|CRCL|QQQM|ETH|BTC|FOMC|CPI/i;
  const candidates = userLines.filter(line => keywordRe.test(line)).slice(-8);
  const lastAi = aiLines.slice(-3).map(line => line.split(/\n+/).slice(0, 4).join('\n')).join('\n\n');
  const summaryLines = [
    `## ${dateText} 장중 대화 요약`,
    '',
    `- 사용자 발화 ${userLines.length}개, AI 응답 ${aiLines.length}개를 기준으로 정리했습니다.`,
  ];
  if (candidates.length) {
    summaryLines.push('', '### 저장 후보 발화');
    candidates.forEach(line => summaryLines.push(`- ${line.replace(/\s+/g, ' ').slice(0, 180)}`));
  }
  if (lastAi) {
    summaryLines.push('', '### 마지막 판단 맥락', lastAi.slice(0, 1200));
  }
  summaryLines.push('', '> 이 항목은 장 마감 후 자동 생성된 대화 세션 요약입니다. 실제 매매 반영은 매매기록/포트폴리오 이벤트를 기준으로 다시 확인하세요.');
  return summaryLines.join('\n');
}

// ---------------------------------------------------------------------------
// state.currentChatMessages 관리
// ---------------------------------------------------------------------------

function appendMessage(role, text) {
  state.currentChatMessages.push({ role, text });
  saveChatHistory();
  renderChatView();
  scrollChatToBottom();
}

function appendSystemMessage(text) {
  state.currentChatMessages.push({ role: 'system', text });
  renderChatView();
}

function scrollChatToBottom() {
  // main-content가 실제 스크롤 컨테이너 (chat-messages는 내부 flex 요소)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const container = document.getElementById('main-content');
      if (container) container.scrollTop = container.scrollHeight;
    });
  });
}

// ---------------------------------------------------------------------------
// 대화창 렌더링 (currentChatMessages 기반)
// ---------------------------------------------------------------------------

function renderChatView() {
  // 상세 뷰가 열려있으면 chat이 덮어쓰지 않음 (레이스 컨디션 방지)
  if (state.selRecord || state.selSession) return;
  const content = document.getElementById('main-content');
  if (!content) return;
  if (state.view === 'investment') {
    content.innerHTML = renderInvestmentView();
    scrollChatToBottom();
    return;
  }
  if (!state.currentChatMessages.length) {
    content.innerHTML = '<div class="chat-messages" id="chat-messages"><div class="empty-state">대화를 시작해보세요</div></div>';
    return;
  }
  content.innerHTML = `<div class="chat-messages" id="chat-messages">
    ${state.currentChatMessages.map(m => renderChatBubble(m)).join('')}
  </div>`;
  scrollChatToBottom();
}

function renderChatBubble(m) {
  if (m.hidden) return '';
  if (m.role === 'system') {
    return `<div class="chat-system-msg">${esc(m.text)}</div>`;
  }
  const isUser = m.role === 'user';
  const body = isUser ? esc(m.text) : renderMarkdownBasic(m.text);
  return `<div class="chat-bubble-wrap ${isUser ? 'user' : 'ai'}"><div class="chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-ai chat-markdown'}">${body}</div></div>`;
}
// ---------------------------------------------------------------------------
// 입력 중 표시 (점 3개 애니메이션)
// ---------------------------------------------------------------------------

function showTypingIndicator() {
  if (state.selRecord || state.selSession) return;
  let msgs = document.getElementById('chat-messages');
  if (!msgs) {
    // 첫 메시지 전 상태 — 컨테이너 생성
    const content = document.getElementById('main-content');
    if (!content) return;
    content.innerHTML = '<div class="chat-messages" id="chat-messages"></div>';
    msgs = document.getElementById('chat-messages');
  }
  document.getElementById('chat-typing-indicator')?.remove();
  const el = document.createElement('div');
  el.id = 'chat-typing-indicator';
  el.className = 'chat-bubble-wrap ai';
  el.innerHTML = `<div class="chat-bubble chat-bubble-ai chat-typing">
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  </div>`;
  msgs.appendChild(el);
  scrollChatToBottom();
}

function hideTypingIndicator() {
  document.getElementById('chat-typing-indicator')?.remove();
}

// ---------------------------------------------------------------------------
// 컨텍스트 대화 시작 (주제/내담자 선택 직후 AI 첫 마디)
// ---------------------------------------------------------------------------

function startContextChat() {
  const isMyRecords = state.view === 'myrecords';

  // 상담 기록 — 기존 슈퍼비전 대화 이력 복원
  if (!isMyRecords && state.selSession) {
    const session = state.sessions.find(s => s.id === state.selSession);
    if (session?.supervisionChat?.length) {
      state.currentChatMessages = session.supervisionChat.map(m => ({
        role: m.role, text: m.text,
      }));
      renderChatView();
      return;
    }
  }
  renderChatView();
}
