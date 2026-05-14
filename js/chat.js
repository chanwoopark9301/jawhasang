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

function getContextChatQueue() {
  if (!Array.isArray(state._ctxChatQueue)) state._ctxChatQueue = [];
  return state._ctxChatQueue;
}

function enqueueContextChat(text) {
  const clean = String(text || '').trim();
  if (!clean) return 0;
  const queue = getContextChatQueue();
  queue.push(clean);
  logger.info('Context chat queued while AI response is active', {
    queueLength: queue.length,
    length: clean.length,
  });
  if (typeof showToast === 'function') {
    showToast(`답변이 끝나면 이어서 보낼게요. 대기 ${queue.length}개`);
  }
  return queue.length;
}

function drainContextChatQueue() {
  const queue = getContextChatQueue();
  if (state._ctxChatLoading || !queue.length) return false;
  const next = queue.shift();
  if (!next) return false;
  setTimeout(() => continueContextChat(next), 0);
  return true;
}

function finishContextChatTurn() {
  hideTypingIndicator();
  state._ctxChatLoading = false;
  drainContextChatQueue();
}

// ---------------------------------------------------------------------------
// 전송 라우팅
// ---------------------------------------------------------------------------

function sendCurrentChat() {
  const input = document.getElementById('chat-input-bottom');
  const text  = input?.value.trim();
  if (!text) return;
  if (state._ctxChatLoading) {
    enqueueContextChat(text);
    input.value = '';
    input.focus();
    return;
  }
  input.value = '';

  // Diary conversion mode: record the user's text without an AI reply.
  if (state.chatMode === 'diary-convert') {
    appendMessage('user', text);
    return;
  }

  // Dictation mode: outside investment, let the user keep talking without interruption.
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
  if (!text) return;
  if (state._ctxChatLoading) {
    enqueueContextChat(text);
    return;
  }
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
  const portfolioEstimateRequest = isInvestment
    && typeof isInvestmentPortfolioEstimateIntent === 'function'
    && isInvestmentPortfolioEstimateIntent(text);

  if (isInvestment) {
    const cashCorrectionUpdate = applyInvestmentCashZeroCorrectionFromChat(text);
    if (cashCorrectionUpdate.changed) {
      const today = new Date().toISOString().split('T')[0];
      state.investment.events.push({
        id: 'ie' + Date.now(),
        date: today,
        type: 'portfolio',
        symbol: 'CASH',
        title: '현금 제거 반영',
        body: cashCorrectionUpdate.summary,
        severity: 'info',
        linkedDecisionId: null,
        linkedRecordId: null,
      });
      hideTypingIndicator();
      appendMessage('ai', `현금 항목을 원장에서 제거했어요.\n\n${cashCorrectionUpdate.summary}`);
      refreshInvestmentSurfaces();
      showToast('현금 항목을 원장에서 제거했어요.');
      persistInvestmentChangesInBackground('cash zero correction');
      finishContextChatTurn();
      return;
    }

    const pendingPortfolioUpdate = applyPendingInvestmentPortfolioSnapshotConfirmation(text);
    if (pendingPortfolioUpdate.changed) {
      const today = new Date().toISOString().split('T')[0];
      state.investment.events.push({
        id: 'ie' + Date.now(),
        date: today,
        type: 'portfolio',
        symbol: pendingPortfolioUpdate.symbols.join(', '),
        title: '포트폴리오 확인 반영',
        body: pendingPortfolioUpdate.summary,
        severity: 'info',
        linkedDecisionId: null,
        linkedRecordId: null,
      });
      hideTypingIndicator();
      appendMessage('ai', `확인한 내용으로 원장을 갱신했어요.\n\n${pendingPortfolioUpdate.summary}`);
      refreshInvestmentSurfaces();
      showToast('포트폴리오 원장에 반영했어요.');
      persistInvestmentChangesInBackground('confirmed portfolio snapshot');
      finishContextChatTurn();
      return;
    }

    const recoveredPortfolioUpdate = applyRecoveredInvestmentPortfolioSnapshotFromRecentChat(text);
    if (recoveredPortfolioUpdate.changed) {
      const today = new Date().toISOString().split('T')[0];
      state.investment.events.push({
        id: 'ie' + Date.now(),
        date: today,
        type: 'portfolio',
        symbol: recoveredPortfolioUpdate.symbols.join(', '),
        title: '포트폴리오 재시도 반영',
        body: recoveredPortfolioUpdate.summary,
        severity: 'info',
        linkedDecisionId: null,
        linkedRecordId: null,
      });
      hideTypingIndicator();
      appendMessage('ai', `최근 대화에서 확인된 내용으로 원장에 반영했어요.\n\n${recoveredPortfolioUpdate.summary}`);
      refreshInvestmentSurfaces();
      showToast('포트폴리오 원장에 반영했어요.');
      persistInvestmentChangesInBackground('recovered portfolio snapshot');
      finishContextChatTurn();
      return;
    }
  }

  if ((portfolioSnapshotRequest || portfolioEstimateRequest) && typeof applyInvestmentPortfolioSnapshotFromChat === 'function') {
    const estimatedPortfolioUpdate = await maybeApplyInvestmentEstimatedPortfolioFromChat(text);
    if (estimatedPortfolioUpdate.changed) {
      const today = new Date().toISOString().split('T')[0];
      state.investment.events.push({
        id: 'ie' + Date.now(),
        date: today,
        type: 'portfolio',
        symbol: estimatedPortfolioUpdate.symbols.join(', '),
        title: '포트폴리오 추정 갱신',
        body: estimatedPortfolioUpdate.summary,
        severity: 'watch',
        linkedDecisionId: null,
        linkedRecordId: null,
      });
      hideTypingIndicator();
      appendMessage('ai', `원장 엔진이 추정값으로 포트폴리오를 갱신했어요.\n\n${estimatedPortfolioUpdate.summary}`);
      refreshInvestmentSurfaces();
      showToast('추정 원장으로 반영했어요. 체결 내역이 확인되면 보정하세요.');
      persistInvestmentChangesInBackground('estimated portfolio snapshot');
      finishContextChatTurn();
      return;
    }
    if (!isStrictInvestmentPortfolioSnapshotText(text)) {
      hideTypingIndicator();
      appendMessage('ai', buildInvestmentPortfolioReconciliationQuestion(buildInvestmentPortfolioSnapshotSourceText(text)));
      finishContextChatTurn();
      return;
    }
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
      finishContextChatTurn();
      return;
    }
  }

  if (isInvestment && await maybeHandleInvestmentChatTradeGate(text)) {
    hideTypingIndicator();
    finishContextChatTurn();
    return;
  }

  if (isInvestment) {
    await syncInvestmentLedgerForChatPrompt();
  }

  let investmentNewsContext = '';
  let investmentMarketContext = '';
  let investmentFxContext = '';
  let investmentReasoningContext = '';
  if (isInvestment && !portfolioSnapshotRequest) {
    const contexts = await resolveInvestmentChatContexts(text);
    investmentReasoningContext = contexts.reasoning;
    investmentNewsContext = contexts.news;
    investmentMarketContext = contexts.market;
    investmentFxContext = contexts.fx;
  }

  const chatPlan = planContextChatRequest({ isInvestment, text });
  // AI 역할: state.currentRole → AI_ROLE_PRESETS에서 prompt 조회. 없으면 topic.aiPrompt 폴백
  const sysPrompt = _buildChatSysPrompt(isMyRecords, topic, student, [investmentReasoningContext, investmentNewsContext, investmentMarketContext, investmentFxContext].filter(Boolean).join('\n'), text, chatPlan);

  // 슬라이딩 윈도우: 비용 모드에 따라 최근 대화만 전송
  // 장기 맥락은 topic.patternAnalysis(사용자가 저장한 분석)가 시스템 프롬프트로 대체
  const WINDOW = chatPlan.historyWindow;
  const messages = state.currentChatMessages
    .filter(m => m.role !== 'system')
    .slice(-WINDOW)
    .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text }));
  const clientRequestId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  logger.info('Context chat AI request start', {
    requestId: clientRequestId,
    view: state.view,
    replyMode: state.replyMode,
    systemChars: sysPrompt.length,
    messageCount: messages.length,
    messageChars: messages.reduce((sum, msg) => sum + String(msg.content || '').length, 0),
    extraContextChars: [investmentReasoningContext, investmentNewsContext, investmentMarketContext, investmentFxContext].join('').length,
    model: chatPlan.model,
    maxTokens: chatPlan.maxTokens,
    tier: chatPlan.tier,
  });

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Request-Id': clientRequestId },
      body: JSON.stringify({
        clientRequestId,
        model: chatPlan.model, max_tokens: chatPlan.maxTokens,
        system: [{ type: 'text', text: sysPrompt, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    if (!res.ok) {
      let detail = '';
      let friendly = '';
      try {
        detail = (await res.text()).slice(0, 1200);
        friendly = friendlyAiHttpError(res.status, detail);
      } catch (_) {
        detail = '';
      }
      const error = new Error(friendly || `AI HTTP ${res.status}${detail ? ` ${detail.slice(0, 240)}` : ''}`);
      error.aiCreditIssue = isAiCreditIssue([detail, friendly].join(' '));
      throw error;
    }
    const data = await res.json();
    const reply = data.content?.map(c => c.text || '').join('').trim();
    if (reply) {
      if (data.fallbackFrom === 'anthropic' && data.provider === 'openai') {
        showAiCreditWarningModal({ fallback: 'openai' });
      }
      logger.info('Context chat AI request success', {
        requestId: clientRequestId,
        view: state.view,
        replyChars: reply.length,
      });
      appendMessage('ai', reply);
      saveSummaryReplyAsRecord(reply);
      await saveInvestmentChatArtifacts(text, reply);
    } else {
      appendMessage('ai', '응답이 비어 있었어요. 방금 질문을 한 번만 다시 보내주세요.');
    }
  } catch (e) {
    const fallback = isInvestment && isInvestmentBriefingIntent(text)
      ? buildInvestmentBriefingFallbackReply(text, e)
      : '';
    logger.error('Context chat AI request failed', {
      requestId: clientRequestId,
      view: state.view,
      replyMode: state.replyMode,
      systemChars: sysPrompt.length,
      messageCount: messages.length,
      messageChars: messages.reduce((sum, msg) => sum + String(msg.content || '').length, 0),
      message: e?.message || String(e),
    });
    if (fallback) {
      if (e?.aiCreditIssue || isAiCreditIssue(e?.message)) {
        showAiCreditWarningModal({ fallback: 'local' });
      }
      appendMessage('ai', fallback);
    } else {
      appendMessage('ai', `죄송해요, 오류가 발생했어요. 다시 시도해주세요.\n\n오류 추적 ID: ${clientRequestId}`);
    }
  } finally {
    finishContextChatTurn();
  }
}

async function resolveInvestmentChatContexts(text) {
  const context = {
    reasoning: '',
    news: '',
    market: '',
    fx: '',
  };
  const startedAt = performance.now();
  const isBriefing = isInvestmentBriefingIntent(text);
  const jobs = [
    ['reasoning', fetchInvestmentReasoningContext],
    ['news', fetchInvestmentNewsContext],
    ['market', fetchInvestmentMarketContext],
    ['fx', fetchInvestmentFxContext],
  ].filter(([, fn]) => typeof fn === 'function');

  const results = await Promise.allSettled(jobs.map(([key, fn]) =>
    Promise.resolve()
      .then(() => runInvestmentContextJob(key, fn, text, isBriefing))
      .then(value => ({ key, value: value || '' }))
  ));

  results.forEach((result, idx) => {
    const key = jobs[idx]?.[0] || 'unknown';
    if (result.status === 'fulfilled') {
      context[result.value.key] = result.value.value;
    } else {
      logger.warn(`investment ${key} context failed`, result.reason);
    }
  });

  logger.info('Investment chat context resolved', {
    durationMs: Math.round(performance.now() - startedAt),
    reasoningChars: context.reasoning.length,
    newsChars: context.news.length,
    marketChars: context.market.length,
    fxChars: context.fx.length,
  });
  return context;
}

async function runInvestmentContextJob(key, fn, text, isBriefing = false) {
  const startedAt = performance.now();
  const timeoutMs = investmentChatContextTimeoutMs(key, isBriefing);
  const fallback = '';
  try {
    const value = await investmentContextTimeout(key, Promise.resolve().then(() => fn(text)), timeoutMs, fallback);
    logger.info('Investment chat context job resolved', {
      key,
      durationMs: Math.round(performance.now() - startedAt),
      timeoutMs,
      chars: String(value || '').length,
    });
    return value || '';
  } catch (error) {
    logger.warn(`investment ${key} context failed`, error);
    return fallback;
  }
}

function investmentChatContextTimeoutMs(key, isBriefing = false) {
  const testOverrides = typeof window !== 'undefined' ? window.__investmentChatContextTimeouts : null;
  const override = Number(testOverrides?.[key]);
  if (Number.isFinite(override) && override > 0) return override;
  const briefingBudget = {
    reasoning: 2500,
    market: 3500,
    fx: 2200,
    news: 4500,
  };
  const normalBudget = {
    reasoning: 4000,
    market: 5000,
    fx: 3000,
    news: 8000,
  };
  return (isBriefing ? briefingBudget : normalBudget)[key] || (isBriefing ? 3500 : 6000);
}

function investmentContextTimeout(key, promise, timeoutMs, fallback = '') {
  let timer = null;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      logger.warn('investment chat context timed out', { key, timeoutMs });
      resolve(fallback);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}


async function maybeHandleInvestmentChatTradeGate(text) {
  if (state.view !== 'investment' || typeof apiEvaluateInvestmentChatGate !== 'function') return false;
  try {
    const data = await apiEvaluateInvestmentChatGate({
      text,
      date: new Date().toISOString().split('T')[0],
    });
    if (!data?.intentDetected || !data.reply) return false;
    const inv = state.investment = normalizeInvestmentState(state.investment);
    const intent = data.intent || {};
    const gate = data.gate || {};
    inv.decisions = Array.isArray(inv.decisions) ? inv.decisions : [];
    inv.decisions.push({
      id: `gate-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      type: 'chat-trade-gate',
      source: 'chat',
      symbol: intent.symbol || gate.symbol || '',
      action: intent.action || gate.action || '',
      verdict: gate.status || 'review',
      status: 'gate',
      title: `서버 투자 게이트: ${intent.symbol || gate.symbol || '대상 미지정'}`,
      summary: data.reply,
      reasons: gate.reasons || [],
      requiredEvidence: gate.requiredEvidence || [],
      blockedActions: gate.blockedActions || [],
      rawIntent: intent,
      serverGate: gate,
      portfolioApplied: false,
    });
    appendMessage('ai', data.reply);
    refreshInvestmentSurfaces();
    persistInvestmentChangesInBackground('chat trade gate');
    return true;
  } catch (error) {
    logger.warn('investment chat trade gate failed; continuing to AI', error);
    return false;
  }
}

function planContextChatRequest({ isInvestment, text }) {
  const ask = String(text || '');
  const deep = isInvestment && isInvestmentDeepAnalysisIntent(ask);
  const briefing = isInvestment && isInvestmentBriefingIntent(ask);
  if (deep) {
    return {
      tier: 'sonnet-deep',
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 1400,
      historyWindow: 12,
    };
  }
  if (briefing) {
    return {
      tier: 'haiku-briefing',
      model: 'claude-haiku-4-5',
      maxTokens: 900,
      historyWindow: 8,
    };
  }
  if (isInvestment) {
    return {
      tier: 'haiku-investment',
      model: 'claude-haiku-4-5',
      maxTokens: 700,
      historyWindow: 10,
    };
  }
  return {
    tier: 'haiku-chat',
    model: 'claude-haiku-4-5',
    maxTokens: 700,
    historyWindow: 14,
  };
}

function isInvestmentDeepAnalysisIntent(text) {
  const ask = String(text || '');
  return /깊게|심층|자세히|실적|어닝|컨콜|컨퍼런스콜|큰\s*(?:매수|매도|손절)|중요\s*(?:매수|매도|판단)|시나리오|컨센서스|가이던스|희석|유상증자|손절\s*조건|매매\s*계획|추가매수\s*판단|deep|earnings|guidance|consensus|scenario/i.test(ask);
}

function isInvestmentBriefingIntent(text) {
  return /브리핑|시황|오늘\s*중요|데스크|시장\s*정리|morning|briefing|market\s*brief/i.test(String(text || ''));
}

function friendlyAiHttpError(status, detail = '') {
  const raw = String(detail || '');
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  const joined = [
    raw,
    parsed?.error,
    parsed?.errorDetail,
    parsed?.providerReason,
  ].filter(Boolean).join(' ').toLowerCase();
  if (isAiCreditIssue(joined)) {
    return `Claude 크레딧 부족으로 AI 호출이 실패했습니다. HTTP ${status}`;
  }
  if (status === 429) return 'AI 호출 한도가 잠시 걸렸습니다. 잠시 후 다시 시도하면 됩니다.';
  if (status === 504) return 'AI 응답 시간이 초과됐습니다.';
  if (status >= 500) return `AI 서버 오류가 발생했습니다. HTTP ${status}`;
  if (status >= 400) return `AI 요청이 거부됐습니다. HTTP ${status}`;
  return '';
}

function isAiCreditIssue(value) {
  return /credit balance|insufficient credit|anthropic_credit|billing|크레딧|잔액/i.test(String(value || ''));
}

function showAiCreditWarningModal({ fallback = 'local' } = {}) {
  if (typeof openModal === 'function') {
    openModal('ai-credit-warning', { provider: 'Claude', fallback });
    return;
  }
  if (typeof showToast === 'function') {
    showToast(fallback === 'openai'
      ? 'Claude 크레딧 부족: OpenAI로 대체했어요.'
      : 'Claude 크레딧 부족: 로컬 임시 브리핑으로 대체했어요.');
  }
}

function buildInvestmentBriefingFallbackReply(userText, error) {
  try {
    const inv = state.investment = normalizeInvestmentState(state.investment);
    const totals = investmentTotals(inv.positions || []);
    const nonCash = (inv.positions || []).filter(p => !isCashInvestmentPosition(p));
    const cash = (inv.positions || [])
      .filter(p => isCashInvestmentPosition(p))
      .reduce((sum, p) => sum + investmentPositionValue(p, 'currentPrice'), 0);
    const rate = parseInvestmentNumber(inv.usdKrwRate) || investmentUsdKrwRate();
    const top = nonCash
      .map(p => {
        const value = investmentPositionValue(p, 'currentPrice');
        const cost = investmentPositionValue(p, 'avgPrice');
        const weight = totals.totalValue ? (value / totals.totalValue) * 100 : 0;
        const gain = value - cost;
        return { p, value, weight, gain, gainPct: cost ? (gain / cost) * 100 : 0 };
      })
      .sort((a, b) => b.value - a.value);
    const desk = typeof buildDailyInvestmentDesk === 'function' ? buildDailyInvestmentDesk(inv) : null;
    const macro = (desk?.macro || []).slice(0, 3).map(item => `- **${item.title}**: ${item.body || item.description || ''}`).join('\n') || '- CPI/Fed/나스닥 위험선호, 금리, 주요 정책 일정을 우선 확인해야 합니다.';
    const micro = top.slice(0, 5).map(item => {
      const symbol = item.p.symbol || item.p.name || '?';
      const thesis = item.p.thesis ? ` 투자 논리: ${item.p.thesis}` : '';
      return `- **${symbol}**: 비중 ${item.weight.toFixed(1)}%, 현재 ${formatMoney(item.p.currentPrice || 0)}, 평단 ${formatMoney(item.p.avgPrice || 0)}, 손익 ${formatMoneySigned(item.gain)} (${item.gainPct >= 0 ? '+' : ''}${item.gainPct.toFixed(2)}%).${thesis}`;
    }).join('\n') || '- 보유 종목 원장이 비어 있어 종목별 미시 변수는 계산하지 못했습니다.';
    const riskLines = [];
    if (top[0] && top[0].weight > parseInvestmentNumber(inv.rules.maxPositionWeight || 25)) {
      riskLines.push(`- ${top[0].p.symbol || top[0].p.name} 비중 ${top[0].weight.toFixed(1)}%가 최대 비중 원칙 ${inv.rules.maxPositionWeight}%를 넘습니다.`);
    }
    if (cash > 0) riskLines.push(`- 현금 ${formatMoney(cash)}(약 ₩${Math.round(cash * rate).toLocaleString('ko-KR')})는 추격매수 대기 자금으로 쓰지 말고, 진입 조건이 맞을 때만 분할 집행합니다.`);
    riskLines.push('- 뉴스나 X 흐름만 보고 즉시 매수하지 않습니다. 공식 공시·회사 IR·신뢰 가능한 금융매체·가격/거래량 확인 전까지는 약한 신호입니다.');
    const reason = friendlyAiFallbackReason(error);
    const trace = reason ? `\n\n> AI 호출은 실패했지만 원장 기준 로컬 브리핑으로 대체했습니다. 원인: ${reason}. 자세한 내용은 콘솔/서버 로그의 추적 ID를 확인하세요.` : '';
    return `## 오늘의 투자 데스크 임시 브리핑\n\n### 계좌 기준\n- 총 평가액: ${formatMoney(totals.totalValue)} (약 ₩${Math.round(totals.totalValue * rate).toLocaleString('ko-KR')})\n- 현금: ${formatMoney(cash)}\n- 투자 수익률: ${totals.totalGainPercent >= 0 ? '+' : ''}${totals.totalGainPercent.toFixed(2)}%\n\n### 거시 변수\n${macro}\n\n### 보유 종목별 확인 지점\n${micro}\n\n### 오늘 하지 말아야 할 행동\n${riskLines.join('\n')}${trace}`;
  } catch (fallbackError) {
    logger.error('Investment briefing fallback failed', fallbackError);
    return '';
  }
}

function friendlyAiFallbackReason(error) {
  const message = String(error?.message || error || '');
  if (!message) return '';
  if (/credit|크레딧|잔액|billing/i.test(message)) return 'Claude 크레딧 부족';
  if (/429|한도|rate/i.test(message)) return 'AI 호출 한도 초과';
  if (/timeout|초과|504/i.test(message)) return 'AI 응답 시간 초과';
  if (/400/.test(message)) return 'AI 요청 거부';
  if (/500|502|503/.test(message)) return 'AI 서버 오류';
  return 'AI 호출 실패';
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
    .filter(m => m.role === 'user')
    .map(m => String(m.text || ''))
    .filter(Boolean)
    .join('\n\n');
  return [recent, raw].filter(Boolean).join('\n\n');
}

function isInvestmentPortfolioEstimateIntent(text) {
  const raw = String(text || '');
  const hasSymbol = extractInvestmentMentionedSymbols(raw).some(symbol => symbol !== 'CASH');
  const hasKrwAmount = parseKoreanKrwAmount(raw) > 0;
  const hasLossRate = extractInvestmentLossPercentFromText(raw) > 0;
  const buyIntent = /(?:샀|매수|투입|넣었|진입|산|bought|buy|invested|entered)/i.test(raw);
  const unknownShares = /(?:몇\s*주|수량|shares?|qty)[^\n.。]{0,24}(?:모르|몰라|unknown|not\s+sure)|(?:모르|몰라)[^\n.。]{0,24}(?:몇\s*주|수량|shares?|qty)/i.test(raw);
  return hasSymbol && hasKrwAmount && hasLossRate && (buyIntent || unknownShares);
}

async function maybeApplyInvestmentEstimatedPortfolioFromChat(text) {
  const raw = String(text || '');
  if (!isInvestmentPortfolioEstimateIntent(raw)) return { changed: false, symbols: [], summary: '' };
  const symbols = extractInvestmentMentionedSymbols(raw).filter(symbol => symbol !== 'CASH');
  const symbol = symbols.length === 1 ? symbols[0] : symbols.find(s => s === inferInvestmentSymbol(raw));
  if (!symbol) return { changed: false, symbols: [], summary: '' };
  const krwAmount = parseKoreanKrwAmount(raw);
  const lossPercent = extractInvestmentLossPercentFromText(raw);
  if (krwAmount <= 0 || lossPercent <= 0 || lossPercent >= 95) return { changed: false, symbols: [], summary: '' };

  let quote = null;
  let fx = null;
  try {
    const data = await fetchMarketQuoteData([symbol, 'USDKRW=X']);
    const quotes = data?.quotes || [];
    quote = quotes.find(q => String(q.symbol || '').toUpperCase() === symbol);
    fx = quotes.find(q => String(q.symbol || '').toUpperCase() === 'USDKRW=X');
  } catch (error) {
    logger.warn('투자 추정 원장 시세 조회 실패', { symbol, error });
  }
  const currentPrice = parseInvestmentNumber(quote?.price) || parseInvestmentNumber((state.investment?.positions || []).find(p => String(p.symbol || '').toUpperCase() === symbol)?.currentPrice);
  const usdKrwRate = parseInvestmentNumber(fx?.price) || investmentUsdKrwRate();
  if (currentPrice <= 0 || usdKrwRate <= 0) return { changed: false, symbols: [], summary: '' };

  const avgPrice = Math.round((currentPrice / (1 - lossPercent / 100)) * 10000) / 10000;
  const investedUsd = Math.round((krwAmount / usdKrwRate) * 100) / 100;
  const shares = Math.round((investedUsd / avgPrice) * 10000) / 10000;
  if (shares <= 0 || avgPrice <= 0) return { changed: false, symbols: [], summary: '' };

  state.investment = normalizeInvestmentState(state.investment);
  const ledgerResult = applyInvestmentLedgerCommand(state.investment, {
    type: 'portfolioSnapshot',
    source: 'user_confirmed',
    positions: [{
      symbol,
      name: inferInvestmentSnapshotName(symbol, raw),
      shares,
      avgPrice,
      currentPrice,
      estimated: true,
      estimateBasis: {
        krwAmount,
        investedUsd,
        lossPercent,
        currentPrice,
        usdKrwRate,
        formula: 'avgPrice = currentPrice / (1 - lossPercent), shares = (krwAmount / usdKrwRate) / avgPrice',
      },
      assetType: isInvestmentCryptoSymbol(symbol) ? 'crypto' : 'stock',
    }],
    usdKrwRate,
    rawText: raw,
  });
  if (!ledgerResult.ok) return { changed: false, symbols: [], summary: '' };
  state.investment = ledgerResult.investment;
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
  const summary = [
    `${symbol} 추정 원장 반영`,
    `- 투입금: 약 ₩${Math.round(krwAmount).toLocaleString('ko-KR')} = ${formatMoney(investedUsd)} (USD/KRW ${usdKrwRate})`,
    `- 현재가: ${formatMoney(currentPrice)}`,
    `- 현재 손익률: -${lossPercent}%`,
    `- 역산 평단: ${formatMoney(avgPrice)}`,
    `- 추정 수량: ${formatShares(shares)}`,
    '',
    '체결 내역을 확인하면 실제 수량/평단으로 보정하세요.',
  ].join('\n');
  return { changed: true, symbols: [symbol], summary };
}

function extractInvestmentLossPercentFromText(text) {
  const raw = String(text || '');
  const patterns = [
    /([0-9][0-9,.]*)\s*(?:%|프로|퍼센트|percent)[^\n.。]{0,24}(?:마이너스|손실|손해|하락|minus|down|loss)/i,
    /(?:마이너스|손실|손해|하락|minus|down|loss)[^\n.。]{0,24}([0-9][0-9,.]*)\s*(?:%|프로|퍼센트|percent)/i,
    /-([0-9][0-9,.]*)\s*(?:%|프로|퍼센트|percent)/i,
  ];
  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (m) return parseInvestmentNumber(m[1]);
  }
  return 0;
}

function isStrictInvestmentPortfolioSnapshotText(text) {
  const raw = String(text || '');
  if (/^\s*\|.*(?:종목|symbol|ticker).*(?:수량|shares|qty).*(?:평단|avg|average)/im.test(raw)) return true;
  const structuredRows = (raw.match(/(?:^|\n)\s*(?:IREN|CRCL|ETH-USD|BTC-USD|INTC|QLD|QQQM)\b[^\n]{0,120}(?:수량|shares|qty)[^\n]{0,80}(?:평단|avg|average)/ig) || []).length;
  if (structuredRows >= 1 && /(?:확정|스냅샷|snapshot|표|아래|대로|수정|반영|갱신)/i.test(raw)) return true;
  const completeClauses = splitInvestmentSnapshotSentences(raw)
    .flatMap(sentence => extractInvestmentSymbolClauses(sentence))
    .filter(clause =>
      /(?:[0-9][0-9,.]*)\s*(?:주|개|shares?|qty)|(?:shares?|quantity|qty|수량)[^0-9]{0,24}([0-9][0-9,.]*)/i.test(clause.text) &&
      /(?:평단|평균\s*단가|avg|average)[^\n0-9]{0,24}\$?\s*([0-9][0-9,.]*)/i.test(clause.text)
    ).length;
  if (completeClauses >= 1 && /(?:확정|스냅샷|snapshot|수정|반영|갱신)/i.test(raw)) return true;
  return false;
}

function buildInvestmentPortfolioReconciliationQuestion(text) {
  const raw = String(text || '');
  const inv = normalizeInvestmentState(state.investment);
  const pending = buildInvestmentPendingPortfolioSnapshotCommand(raw);
  if (pending) state._pendingInvestmentPortfolioSnapshot = pending;
  const nonCash = (inv.positions || []).filter(p => !isCashInvestmentPosition(p));
  const current = nonCash.map(p => `- ${p.symbol}: 수량 ${formatShares(p.shares)} · 평단 ${formatMoney(p.avgPrice)}`).join('\n') || '- 등록된 보유 종목 없음';
  const mentioned = extractInvestmentMentionedSymbols(raw);
  const keep = extractInvestmentKeepSymbols(raw);
  const pendingRows = pending?.command?.positions || [];
  const pendingRowSymbols = pendingRows.map(row => row.symbol).filter(Boolean);
  const effectiveOnlySymbols = pending?.command?.onlySymbols
    ? [...new Set([...(pending.command.onlySymbols || []), ...pendingRowSymbols])]
    : [];
  const pendingRowSet = new Set(pendingRowSymbols);
  const zeroIntent = [
    ...extractInvestmentZeroSymbols(raw).filter(symbol => !pendingRowSet.has(symbol)),
    ...(inv.positions || [])
      .filter(p => {
        const symbol = String(p.symbol || '').toUpperCase();
        if (pendingRowSet.has(symbol)) return false;
        if (isCashInvestmentPosition(p)) return /(?:\uD604\uAE08|\uC608\uC218\uAE08|cash)[^\n.?]{0,40}(?:\uC5C6|0|\uC804\uBD80|\uC774\uC81C\s*\uC5C6)/i.test(raw);
        return investmentTextMentionsPosition(raw, p) && /(?:\uC5C6|\uD314|\uC815\uB9AC|\uC804\uBD80\s*(?:\uC778\uD154|INTC)|\uC774\uC81C\s*\uC5C6)/i.test(extractInvestmentSymbolClauseText(raw, symbol));
      })
      .map(p => p.symbol || p.name)
      .filter(Boolean),
  ];
  const zeroUnique = [...new Set(zeroIntent)];
  const target = mentioned.find(symbol => !keep.includes(symbol) && !zeroUnique.includes(symbol)) || mentioned.find(symbol => symbol === 'INTC');
  const intentLines = [];
  if (pendingRowSymbols.length) intentLines.push(`- 평가액/평단 갱신: ${pendingRowSymbols.join(', ')}`);
  if (keep.length) intentLines.push(`- 그대로 유지: ${keep.join(', ')}`);
  if (zeroUnique.length) intentLines.push(`- 제거 후보: ${zeroUnique.join(', ')}`);
  if (target && !pendingRowSet.has(target)) intentLines.push(`- 중심 종목: ${target}`);
  const missing = [];
  const hasExistingShares = symbol => (inv.positions || []).some(p =>
    !isCashInvestmentPosition(p) && String(p.symbol || '').toUpperCase() === String(symbol || '').toUpperCase() && parseInvestmentNumber(p.shares) > 0
  );
  if (target && !pendingRows.some(row => row.symbol === target) && !hasExistingShares(target)) {
    const clause = extractInvestmentSymbolClauseText(raw, target);
    if (!/(?:[0-9][0-9,.]*)\s*(?:\uC8FC|\uAC1C|shares?|qty)/i.test(clause)) missing.push(`${target} 수량`);
    if (!/(?:\uD3C9\uB2E8|\uD3C9\uADE0\s*\uB2E8\uAC00|avg|average|\uB9E4\uC218\uAC00|\uC0B4\s*\uB54C)[^\n0-9]{0,40}[0-9]/i.test(clause)) missing.push(`${target} 평단 또는 체결가`);
  }
  if (mentioned.includes('CRCL') && !keep.includes('CRCL') && !pendingRowSet.has('CRCL') && !hasExistingShares('CRCL') && !/(?:[0-9][0-9,.]*)\s*(?:\uC8FC|shares?|qty)/i.test(extractInvestmentSymbolClauseText(raw, 'CRCL'))) {
    missing.push('CRCL 수량 유지 여부');
  }
  const missingText = missing.length ? missing.map(item => `- ${item}`).join('\n') : '- 아래 후보가 맞으면 "맞아" 또는 "확정"이라고 답해주세요.';
  const pendingText = pending?.summary ? `\n\n원장 반영 후보:\n${summarizePendingInvestmentPortfolioSnapshot({ ...pending.command, onlySymbols: effectiveOnlySymbols.length ? effectiveOnlySymbols : pending.command.onlySymbols }, inv)}` : '';
  return `원장에 쓰기 전에 먼저 대조할게요.\n\n현재 원장:\n${current}\n\n제가 이해한 변경 의도:\n${intentLines.join('\n') || '- 현재 원장 기준으로 포트폴리오를 재구성'}${pendingText}\n\n확인할 것:\n${missingText}`;
}

function isInvestmentPortfolioConfirmationText(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return /^(?:\uC88B\uC544|\uB9DE\uC544|\uC751|\uB124|\u3147\u3147|\uD655\uC778|\uD655\uC815|\uBC18\uC601|\uC218\uC815|\uADF8\uB300\uB85C|ok|yes|correct|confirm)\b|(?:\uC88B\uC544\s*\uB9DE\uC544|\uB9DE\uC544\s*\uADF8\uB300\uB85C|\uD655\uC815\uD574|\uBC18\uC601\uD574|\uC218\uC815\uD574)/i.test(raw);
}

function applyPendingInvestmentPortfolioSnapshotConfirmation(text) {
  if (!isInvestmentPortfolioConfirmationText(text)) return { changed: false, symbols: [], summary: '' };
  const pending = state._pendingInvestmentPortfolioSnapshot;
  if (!pending?.command) return { changed: false, symbols: [], summary: '' };
  state.investment = normalizeInvestmentState(state.investment);
  const ledgerResult = applyInvestmentLedgerCommand(state.investment, pending.command);
  if (!ledgerResult.ok) {
    logger.warn('pending portfolio confirmation rejected', { reason: ledgerResult.reason, pending });
    return { changed: false, symbols: [], summary: '' };
  }
  state.investment = ledgerResult.investment;
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
  state._pendingInvestmentPortfolioSnapshot = null;
  return {
    changed: true,
    symbols: ledgerResult.symbols || pending.symbols || [],
    summary: pending.summary || `Ledger changes:\n${(ledgerResult.changes || []).map(item => `- ${item}`).join('\n')}`,
  };
}

function isInvestmentCashZeroCorrectionText(text) {
  const raw = String(text || '');
  if (!/(?:\uD604\uAE08|\uC608\uC218\uAE08|cash)/i.test(raw)) return false;
  return /(?:\uC65C|\uC874\uC7AC|\uC788\uB294\uB370|\uC5C6\uC560|\uC9C0\uC6CC|\uC0AD\uC81C|\uC774\uC81C\s*\uC5C6|0\s*(?:\uC6D0|USD|\$)?)/i.test(raw);
}

function applyInvestmentCashZeroCorrectionFromChat(text) {
  if (!isInvestmentCashZeroCorrectionText(text)) return { changed: false, symbols: [], summary: '' };
  state.investment = normalizeInvestmentState(state.investment);
  const ledgerResult = applyInvestmentLedgerCommand(state.investment, {
    type: 'setCash',
    source: 'user_confirmed',
    amount: 0,
    rawText: String(text || ''),
  });
  if (!ledgerResult.ok) {
    logger.warn('cash zero correction rejected', { reason: ledgerResult.reason });
    return { changed: false, symbols: [], summary: '' };
  }
  state.investment = ledgerResult.investment;
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
  return {
    changed: true,
    symbols: ['CASH'],
    summary: 'CASH 0으로 확정해 현금 포지션을 제거했습니다.',
  };
}

function isInvestmentPortfolioRetryApplyIntent(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const action = /(?:apply|retry|again|confirm|commit|save|sync|reflect|update|ledger|portfolio|\uC801\uC6A9|\uBC18\uC601|\uB2E4\uC2DC|\uC7AC\uC2DC\uB3C4|\uD655\uC815|\uC800\uC7A5|\uC6D0\uC7A5|\uD3EC\uD2B8\uD3F4\uB9AC\uC624)/i.test(raw);
  const reference = /(?:this|that|previous|above|same|\uC774\uAC70|\uADF8\uAC70|\uC544\uAE4C|\uBC29\uAE08|\uADF8\uB300\uB85C|\uC704\s*\uB0B4\uC6A9)/i.test(raw);
  return action && reference;
}

function applyRecoveredInvestmentPortfolioSnapshotFromRecentChat(text) {
  if (!isInvestmentPortfolioRetryApplyIntent(text)) return { changed: false, symbols: [], summary: '' };
  const messages = (state.currentChatMessages || []).slice(-14);
  const userSource = messages
    .filter(message => message.role === 'user')
    .map(message => String(message.text || ''))
    .filter(Boolean)
    .join('\n\n');
  const contextSource = messages
    .map(message => String(message.text || ''))
    .filter(Boolean)
    .join('\n\n');
  const pending = buildInvestmentPendingPortfolioSnapshotCommand(userSource || text, { contextText: contextSource || text });
  if (!pending?.command) return { changed: false, symbols: [], summary: '' };
  state.investment = normalizeInvestmentState(state.investment);
  const ledgerResult = applyInvestmentLedgerCommand(state.investment, pending.command);
  if (!ledgerResult.ok) {
    logger.warn('recovered portfolio snapshot rejected', { reason: ledgerResult.reason, pending });
    return { changed: false, symbols: [], summary: '' };
  }
  state.investment = ledgerResult.investment;
  state.investment.alerts = buildInvestmentRiskAlerts(state.investment.positions, state.investment.rules);
  state._pendingInvestmentPortfolioSnapshot = null;
  return {
    changed: true,
    symbols: ledgerResult.symbols || pending.symbols || [],
    summary: pending.summary || `Ledger changes:\n${(ledgerResult.changes || []).map(item => `- ${item}`).join('\n')}`,
  };
}

function buildInvestmentPendingPortfolioSnapshotCommand(text, options = {}) {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  const contextRaw = String(options.contextText || raw);
  const inv = normalizeInvestmentState(state.investment);
  const explicitRate = extractInvestmentUsdKrwRateFromText(`${raw}\n${contextRaw}`);
  const usdKrwRate = explicitRate > 0 ? explicitRate : investmentUsdKrwRate();
  const rows = dedupeInvestmentPortfolioSnapshots([
    ...extractInvestmentPortfolioSnapshotRows(raw),
    ...extractInvestmentKrwPortfolioSnapshots(raw, usdKrwRate),
  ]).filter(row => row.symbol && row.symbol !== 'CASH');
  const keepSymbols = extractInvestmentKeepSymbols(contextRaw);
  const zeroSymbols = extractInvestmentZeroSymbols(contextRaw);
  const onlyRemainingSymbols = extractInvestmentOnlyRemainingSymbols(contextRaw);
  const rowSymbols = new Set(rows.map(row => row.symbol).filter(Boolean));
  const onlySymbols = new Set([...onlyRemainingSymbols, ...keepSymbols, ...rowSymbols]);
  zeroSymbols.forEach(symbol => {
    if (!rowSymbols.has(symbol)) onlySymbols.delete(symbol);
  });
  const cashUsd = inferInvestmentCashSnapshotUsdFromText(contextRaw, zeroSymbols);
  const command = {
    type: 'portfolioSnapshot',
    source: 'user_confirmed',
    positions: rows,
    cashUsd,
    usdKrwRate: explicitRate > 0 ? explicitRate : null,
    onlySymbols: onlySymbols.size ? [...onlySymbols] : null,
    rawText: raw,
  };
  if (!rows.length && cashUsd == null && !onlySymbols.size) return null;
  const summary = summarizePendingInvestmentPortfolioSnapshot(command, inv);
  return {
    command,
    symbols: [...new Set([...rows.map(row => row.symbol), ...onlySymbols, cashUsd != null ? 'CASH' : null].filter(Boolean))],
    summary,
  };
}

function extractInvestmentKeepSymbols(text) {
  const raw = String(text || '');
  return extractInvestmentMentionedSymbols(raw).filter(symbol => {
    const clause = extractInvestmentSymbolClauseText(raw, symbol);
    return /(?:\uADF8\uB300\uB85C|\uC720\uC9C0|\uB0A8\uACA8|\uB0A8\uAE30|\uBCF4\uC720|unchanged|keep|remain)/i.test(clause);
  });
}

function extractInvestmentZeroSymbols(text) {
  const raw = String(text || '');
  return extractInvestmentMentionedSymbols(raw).filter(symbol => {
    const clause = extractInvestmentSymbolClauseText(raw, symbol);
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const saleProceeds = new RegExp(`${escaped}[^\\n.\\u3002]{0,40}(?:\\uB9E4\\uAC01\\uAE08|\\uB9E4\\uB3C4\\uAE08|proceeds|sold|liquidated)|(?:\\uB9E4\\uAC01\\uAE08|\\uB9E4\\uB3C4\\uAE08|proceeds|sold|liquidated)[^\\n.\\u3002]{0,40}${escaped}`, 'i').test(raw);
    return /(?:\uC81C\uAC70|\uC0AD\uC81C|\uC815\uB9AC|\uD314|\uB9E4\uB3C4|\uC5C6|0\s*(?:\uC8FC|\uAC1C)?|remove|sell|zero)/i.test(clause)
      || saleProceeds;
  });
}

function extractInvestmentKrwPortfolioSnapshots(text, usdKrwRate = 0) {
  const rate = parseInvestmentNumber(usdKrwRate) || investmentUsdKrwRate();
  if (rate <= 0) return [];
  const rows = [];
  splitInvestmentSnapshotSentences(text).forEach(sentence => {
    extractInvestmentSymbolClauses(sentence).forEach(clause => {
      const symbol = clause.symbol;
      const source = clause.text;
      if (!symbol || symbol === 'CASH') return;
      const shares = extractSnapshotNumber(source, [
        /([0-9][0-9,.]*)\s*(?:\uAC1C|\uC8FC|shares?|units?)/i,
        /(?:\uC218\uB7C9|\uBCF4\uC720)[^0-9]{0,24}([0-9][0-9,.]*)/i,
      ]);
      const avgKrw = extractInvestmentKrwAmountNear(source, [
        /(?:\uB9E4\uC218\uAC00|\uD3C9\uB2E8|\uD3C9\uADE0|\uC0B4\s*\uB54C|(?:1\s*)?(?:\uC774\uB354\uB9AC\uC6C0|ETH|\uAC1C)\s*\uB2F9)[^\n0-9]{0,40}([0-9][0-9,.]*(?:\.[0-9]+)?\s*(?:\uC5B5|\uCC9C|\uBC31|\uB9CC|\uB9CC\uC6D0|\uC6D0|KRW))/i,
      ]);
      const marketValueKrw = extractInvestmentKrwAmountNear(source, [
        /(?:\uD604\uC7AC\s*\uD3C9\uAC00\uC561|\uD3C9\uAC00\uC561|\uD604\uC7AC\s*\uAC00\uCE58|\uD604\uC7AC)[^\n0-9]{0,40}([0-9][0-9,.]*(?:\.[0-9]+)?\s*(?:\uC5B5|\uCC9C|\uBC31|\uB9CC|\uB9CC\uC6D0|\uC6D0|KRW))/i,
      ]);
      const avgPrice = avgKrw > 0 ? Math.round((avgKrw / rate) * 10000) / 10000 : 0;
      const marketValueUsd = marketValueKrw > 0 ? Math.round((marketValueKrw / rate) * 100) / 100 : 0;
      const currentPrice = marketValueUsd > 0 && shares > 0 ? Math.round((marketValueUsd / shares) * 10000) / 10000 : 0;
      if (shares > 0 || avgPrice > 0 || currentPrice > 0 || marketValueUsd > 0) {
        rows.push({
          symbol,
          name: inferInvestmentSnapshotName(symbol, source),
          shares,
          avgPrice,
          currentPrice,
          marketValueUsd,
          assetType: isInvestmentCryptoSymbol(symbol) ? 'crypto' : 'stock',
        });
      }
    });
  });
  return rows;
}

function extractInvestmentKrwAmountNear(text, patterns) {
  const raw = String(text || '');
  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (m) {
      const amount = parseKoreanKrwAmount(m[1] || m[0]);
      if (amount > 0) return amount;
    }
  }
  return 0;
}

function summarizePendingInvestmentPortfolioSnapshot(pending, inv) {
  const lines = [];
  (pending.positions || []).forEach(row => {
    const bits = [
      `${row.symbol}`,
      row.shares > 0 ? `수량 ${formatShares(row.shares)}` : '',
      row.avgPrice > 0 ? `평단 ${formatMoney(row.avgPrice)}` : '',
      row.currentPrice > 0 ? `현재가 ${formatMoney(row.currentPrice)}` : '',
      row.marketValueUsd > 0 ? `평가액 ${formatMoney(row.marketValueUsd)}` : '',
    ].filter(Boolean);
    lines.push(`- ${bits.join(' | ')}`);
  });
  const only = Array.isArray(pending.onlySymbols) ? pending.onlySymbols : [];
  if (only.length) {
    const effectiveOnly = new Set([...only, ...((pending.positions || []).map(row => row.symbol).filter(Boolean))]);
    const removed = (inv.positions || [])
      .filter(p => !isCashInvestmentPosition(p))
      .map(p => String(p.symbol || '').toUpperCase())
      .filter(symbol => symbol && !effectiveOnly.has(symbol));
    lines.push(`- 유지할 종목: ${[...effectiveOnly].join(', ')}`);
    if (removed.length) lines.push(`- 제거할 종목: ${removed.join(', ')}`);
  }
  if (pending.cashUsd != null) lines.push(`- 현금: ${formatMoney(pending.cashUsd)}`);
  if (pending.usdKrwRate != null) lines.push(`- USD/KRW: ${pending.usdKrwRate}`);
  return lines.join('\n') || '- 반영 후보 없음';
}

function extractInvestmentMentionedSymbols(text) {
  const raw = String(text || '');
  const symbols = [];
  [
    ['INTC', /\b(?:intel|intc)\b|인텔/i],
    ['IREN', /\bIREN\b|아이렌|iris energy/i],
    ['CRCL', /\bCRCL\b|써클|서클|circle/i],
    ['ETH-USD', /\bETH(?:-USD)?\b|이더리움|ethereum|ether/i],
    ['BTC-USD', /\bBTC(?:-USD)?\b|비트코인|bitcoin/i],
    ['QLD', /\bQLD\b/i],
    ['QQQM', /\bQQQM\b/i],
  ].forEach(([symbol, pattern]) => {
    if (pattern.test(raw)) symbols.push(symbol);
  });
  return symbols;
}

function extractInvestmentSymbolClauseText(text, symbol) {
  const clauses = splitInvestmentSnapshotSentences(text).flatMap(sentence => extractInvestmentSymbolClauses(sentence));
  const found = clauses.find(clause => String(clause.symbol || '').toUpperCase() === String(symbol || '').toUpperCase());
  return found?.text || String(text || '');
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
    showToast('시장 신호를 저장했어요.');
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

  if (isInvestmentPortfolioSnapshotIntent(ask) && !isStrictInvestmentPortfolioSnapshotText(ask)) {
    return;
  }

  const portfolioUpdate = isStrictInvestmentPortfolioSnapshotText(combined)
    ? applyInvestmentPortfolioSnapshotFromChat(buildInvestmentPortfolioSnapshotSourceText(combined))
    : { changed: false };
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
  const snapshot = normalizeInvestmentState(state.investment);
  if (typeof _saveToLocalCache === 'function') _saveToLocalCache();
  const savePromise = typeof apiSaveInvestmentLedgerSnapshot === 'function'
    ? apiSaveInvestmentLedgerSnapshot(snapshot, { retries: 0, timeoutMs: 4500 })
    : saveData({ retries: 1 });
  return savePromise
    .then(result => {
      const ok = result === true || result?.ok === true;
      if (result?.investment) {
        state.investment = normalizeInvestmentState({
          ...state.investment,
          ...result.investment,
          chat: state.investment.chat,
          chatSessions: state.investment.chatSessions,
          activeChatSessionId: state.investment.activeChatSessionId,
        });
        if (typeof _saveToLocalCache === 'function') _saveToLocalCache();
      }
      logger.info('investment background save complete', {
        label,
        ok,
        durationMs: Math.round(performance.now() - startedAt),
      });
      if (!ok) throw new Error('investment background save returned false');
      return result;
    })
    .catch(error => {
      logger.warn('investment background save failed', { label, error });
      if (typeof showToast === 'function') {
        const message = /timeout/i.test(String(error?.message || ''))
          ? '화면에는 바로 반영했어요. 서버 저장이 5초 안에 끝나지 않아 다음 동기화에서 다시 확인할게요.'
          : '화면에는 바로 반영했어요. 서버 저장은 잠시 뒤 다시 동기화할게요.';
        showToast(message);
      }
      return { ok: false, error: error?.message || String(error || 'save failed') };
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
  const unsafeRenderedFeedback = isInvestmentRenderedPortfolioFeedback(raw);
  if (!intent || explicitTradeIntent || unsafeRenderedFeedback) {
    logger.debug('투자 포트폴리오 스냅샷 갱신 생략', {
      intent,
      explicitTradeIntent,
      unsafeRenderedFeedback,
      raw: raw.slice(0, 240),
    });
    return { changed: false, symbols: [], summary: '' };
  }

  state.investment = normalizeInvestmentState(state.investment);
  const changed = [];
  const handledSymbols = new Set();
  const explicitRate = extractInvestmentUsdKrwRateFromText(raw);
  const pending = buildInvestmentPendingPortfolioSnapshotCommand(raw, { contextText: raw });
  if (!pending?.command) {
    logger.warn('portfolio snapshot parse produced no ledger command', { raw: raw.slice(0, 500) });
    return { changed: false, symbols: [], summary: '' };
  }
  const cashUsd = pending.command.cashUsd;
  const snapshots = pending.command.positions || [];
  const onlyRemainingSymbols = new Set(pending.command.onlySymbols || []);
  const ledgerResult = applyInvestmentLedgerCommand(state.investment, {
    type: 'portfolioSnapshot',
    source: 'user_confirmed',
    positions: snapshots,
    cashUsd,
    usdKrwRate: explicitRate > 0 ? explicitRate : null,
    onlySymbols: onlyRemainingSymbols.size ? [...onlyRemainingSymbols] : null,
    rawText: raw,
  });
  if (ledgerResult.ok) {
    state.investment = ledgerResult.investment;
    (ledgerResult.symbols || []).forEach(symbol => handledSymbols.add(String(symbol || '').toUpperCase()));
    changed.push(...(ledgerResult.changes || []));
  }

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
  if (cashUsd != null) symbols.push('CASH');
  logger.info('투자 포트폴리오 스냅샷 자동 갱신', { changed, symbols });
  return {
    changed: true,
    symbols: [...new Set(symbols)],
    summary: `대화에서 포트폴리오 값을 추출해 자동 반영했습니다.\n\n${changed.map(item => `- ${item}`).join('\n')}`,
  };
}

function isInvestmentRenderedPortfolioFeedback(text) {
  const raw = String(text || '');
  const complaint = /(?:왜|아니|이건|틀렸|틀린|잘못|오류|이상|변경사항\s*없|가격이\s*바뀌|not\s+right|wrong|incorrect)/i.test(raw);
  const rendered = /(?:포트폴리오를\s*바로\s*갱신|대화에서\s*포트폴리오\s*값을\s*추출|자동\s*반영했습니다|평가손익|매입금|비중|갱신\s*\d{2}\.|shares\s*=|avgPrice\s*=|currentPrice\s*=)/i.test(raw);
  const copiedCards = (raw.match(/(?:평단|수량|현재|매입금|손익|비중|shares\s*=|avgPrice\s*=|currentPrice\s*=)/g) || []).length >= 4;
  return complaint && (rendered || copiedCards);
}

function extractInvestmentOnlyRemainingSymbols(text) {
  const raw = String(text || '');
  const allowed = new Set();
  const patterns = [
    /rest\s+is\s+only\s+([^.\n]+)/i,
    /only\s+([^.\n]+?)\s+(?:left|remain|remaining)/i,
    /나머지[^.\n]*(?:밖에|만)[^.\n]*/i,
  ];
  const segment = patterns.map(pattern => (raw.match(pattern) || [])[1] || (raw.match(pattern) || [])[0]).find(Boolean);
  if (!segment) return allowed;
  const probe = String(segment);
  [
    'IREN',
    'CRCL',
    'INTC',
    'ETH-USD',
    'BTC-USD',
    'QLD',
    'QQQM',
  ].forEach(symbol => {
    if (symbol === 'INTC' && /\b(?:intel|intc)\b|인텔/i.test(probe)) allowed.add('INTC');
    else if (symbol === 'CRCL' && /circle|crcl|써클|서클/i.test(probe)) allowed.add('CRCL');
    else if (symbol === 'ETH-USD' && /ethereum|ether|eth|이더리움/i.test(probe)) allowed.add('ETH-USD');
    else if (new RegExp(`\\b${symbol.replace('-', '\\-')}\\b`, 'i').test(probe)) allowed.add(symbol);
  });
  return allowed;
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
  const rows = [
    ...extractInvestmentInlinePositionSnapshots(raw),
    ...extractInvestmentPortfolioSnapshotBlocks(lines),
  ];
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

function extractInvestmentInlinePositionSnapshots(text) {
  const rows = [];
  const sentences = splitInvestmentSnapshotSentences(text);
  sentences.forEach(sentence => {
    extractInvestmentSymbolClauses(sentence).forEach(clause => {
      const symbol = clause.symbol;
      const source = clause.text;
      if (!symbol || symbol === 'CASH') return;
      const shares = extractSnapshotNumber(source, [
      /([0-9][0-9,.]*)\s*(?:shares?|units?|주|개)/i,
      /(?:shares?|quantity|qty|수량)[^0-9]{0,24}([0-9][0-9,.]*)/i,
      ]);
      const avgPrice = extractSnapshotNumber(source, [
      /(?:average\s*price|avg|average|평단|평균\s*단가)[^0-9]{0,24}\$?\s*([0-9][0-9,.]*)/i,
      ]);
      const currentPrice = extractSnapshotNumber(source, [
      /(?:current\s*price|current|현재가|현재\s*가격)[^0-9]{0,24}\$?\s*([0-9][0-9,.]*)/i,
      ]);
      const marketValueUsd = extractInvestmentMarketValueUsdFromText(source);
      if (shares > 0 || avgPrice > 0 || currentPrice > 0 || marketValueUsd > 0) {
        rows.push({
          symbol,
          name: inferInvestmentSnapshotName(symbol, source),
          shares,
          avgPrice,
          currentPrice,
          marketValueUsd,
          assetType: isInvestmentCryptoSymbol(symbol) ? 'crypto' : 'stock',
        });
      }
    });
  });
  return rows;
}

function extractInvestmentSymbolClauses(sentence) {
  const raw = String(sentence || '');
  const symbols = [
    { symbol: 'INTC', pattern: /\b(?:intel|intc)\b|인텔/ig },
    { symbol: 'IREN', pattern: /\bIREN\b|아이렌|iris energy/ig },
    { symbol: 'CRCL', pattern: /\bCRCL\b|써클|서클|circle/ig },
    { symbol: 'ETH-USD', pattern: /\bETH(?:-USD)?\b|이더리움|ethereum|ether/ig },
    { symbol: 'BTC-USD', pattern: /\bBTC(?:-USD)?\b|비트코인|bitcoin/ig },
    { symbol: 'QLD', pattern: /\bQLD\b/ig },
    { symbol: 'QQQM', pattern: /\bQQQM\b/ig },
  ];
  const hits = [];
  symbols.forEach(item => {
    for (const match of raw.matchAll(item.pattern)) {
      hits.push({ symbol: item.symbol, index: match.index || 0 });
    }
  });
  hits.sort((a, b) => a.index - b.index);
  if (!hits.length) {
    const symbol = normalizeInvestmentSnapshotSymbol(raw);
    return symbol ? [{ symbol, text: raw }] : [];
  }
  return hits.map((hit, index) => {
    const next = hits[index + 1]?.index ?? raw.length;
    return {
      symbol: hit.symbol,
      text: raw.slice(hit.index, next).trim(),
    };
  });
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
    const prev = map.get(key) || {};
    const next = { ...prev, ...row };
    ['shares', 'avgPrice', 'currentPrice', 'marketValueUsd'].forEach(field => {
      const incoming = parseInvestmentNumber(row[field]);
      const existing = parseInvestmentNumber(prev[field]);
      if (incoming <= 0 && existing > 0) next[field] = existing;
    });
    map.set(key, next);
  });
  return [...map.values()];
}

function normalizeInvestmentSnapshotSymbol(value) {
  const raw = String(value || '').replace(/[*`]/g, '').trim();
  const lower = raw.toLowerCase();
  if (/\b(?:intel|intc)\b|인텔/i.test(raw)) return 'INTC';
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
    INTC: 'Intel',
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

function isInvestmentPortfolioSnapshotIntent(text) {
  const raw = String(text || '');
  const snapshotWords = /(?:\uD3EC\uD2B8\uD3F4\uB9AC\uC624|\uACC4\uC88C|\uBCF4\uC720\s*\uC218\uB7C9|\uC794\uC5EC\s*\uC218\uB7C9|\uD604\uC7AC\s*\uC0C1\uD0DC|\uC2A4\uB0C5\uC0F7|\uAC31\uC2E0|\uC218\uC815|\uBC18\uC601|portfolio|account|snapshot|position|update|sync)/i.test(raw);
  const valueWords = /(?:\uC218\uB7C9|\uC8FC|\uAC1C|\uD3C9\uB2E8|\uD3C9\uADE0\s*\uB2E8\uAC00|\uD604\uC7AC\uAC00|\uD604\uC7AC\s*\uAC00\uACA9|\uD604\uAE08|\uC608\uC218\uAE08|\uCD1D\s*\uD3C9\uAC00\uC561|shares?|qty|average|avg|current|cash|total value)/i.test(raw);
  const directCash = /(?:\uD604\uAE08|\uC608\uC218\uAE08|cash)[^\n]{0,80}(?:[0-9]|\uC5B5|\uB9CC|USD|\$)/i.test(raw);
  const cashCorrection = /(?:\uD604\uAE08|\uC608\uC218\uAE08|cash)[^\n.\u3002]{0,32}(?:\uC5C6\uC560|\uC9C0\uC6CC|\uC0AD\uC81C|\uC65C\s*(?:\uC788|\uC874\uC7AC)|\uC774\uC81C\s*\uC5C6)/i.test(raw)
    || (/(?:\uD604\uAE08|\uC608\uC218\uAE08|cash)/i.test(raw) && /(?:\uC65C|\uC874\uC7AC|\uC788\uB294\uB370|\uC5C6\uC560|\uC9C0\uC6CC|\uC0AD\uC81C)/i.test(raw));
  return (snapshotWords && valueWords) || directCash || cashCorrection;
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

function splitInvestmentSnapshotSentences(text) {
  return String(text || '')
    .split(/(?:[。]+|[\n\r]+|\.(?=\s+[A-Z가-힣]|$))/)
    .map(part => part.trim())
    .filter(Boolean);
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

function inferInvestmentCashSnapshotUsdFromText(text, removedSymbols = []) {
  const raw = String(text || '');
  const zeroCashIntent = /(?:\uD604\uAE08|\uC608\uC218\uAE08|cash)[^\n.\u3002]{0,32}(?:\uC5C6|\uC5C6\uC560|\uC9C0\uC6CC|\uC0AD\uC81C|\uC65C\s*(?:\uC788|\uC874\uC7AC)|\uC804\uBD80\s*(?:\uC778\uD154|INTC)|\uC774\uC81C\s*\uC5C6)/i.test(raw)
    || /(?:\uD604\uAE08|\uC608\uC218\uAE08|cash)[^\n.\u3002]{0,16}(?:\s|:|=)0\s*(?:\uC6D0|KRW|USD|\$)?(?:\b|$)/i.test(raw)
    || (/(?:\uD604\uAE08|\uC608\uC218\uAE08|cash)/i.test(raw) && /(?:\uC65C|\uC874\uC7AC|\uC788\uB294\uB370|\uC5C6\uC560|\uC9C0\uC6CC|\uC0AD\uC81C)/i.test(raw));
  if (zeroCashIntent) return 0;
  const cashUsd = inferInvestmentCashUsdFromText(raw);
  const wantsSaleProceeds = /(?:\uB9E4\uAC01\uAE08|\uB9E4\uB3C4\uAE08|proceeds|sold\s*cash|sale\s*cash)/i.test(raw);
  if (wantsSaleProceeds && Array.isArray(removedSymbols) && removedSymbols.length) {
    const base = cashUsd > 0 ? cashUsd : currentInvestmentCashUsd();
    const proceeds = removedSymbols.reduce((sum, symbol) => {
      const position = (state.investment?.positions || []).find(p =>
        !isCashInvestmentPosition(p) && String(p.symbol || '').toUpperCase() === String(symbol || '').toUpperCase()
      );
      if (!position) return sum;
      const shares = parseInvestmentNumber(position.shares);
      const price = parseInvestmentNumber(position.currentPrice) || parseInvestmentNumber(position.lastMarketPrice);
      return shares > 0 && price > 0 ? sum + shares * price : sum;
    }, 0);
    return Math.round((base + proceeds) * 100) / 100;
  }
  return cashUsd > 0 ? cashUsd : null;
}

function currentInvestmentCashUsd() {
  const cash = (state.investment?.positions || []).find(p => isCashInvestmentPosition(p));
  return parseInvestmentNumber(cash?.cashAmount ?? cash?.shares);
}

function extractInvestmentMarketValueUsdFromText(text) {
  const raw = String(text || '');
  const directUsd = raw.match(/(?:\uD3C9\uAC00\uC561|\uCD1D\uC561|\uAC00\uCE58|value|market\s*value|\uD604\uC7AC)[^\n]{0,20}(?:\$|USD\s*)([0-9][0-9,]*(?:\.[0-9]{1,4})?)/i) ||
    raw.match(/(?:\$|USD\s*)([0-9][0-9,]*(?:\.[0-9]{1,4})?)[^\n]{0,20}(?:\uD3C9\uAC00\uC561|\uCD1D\uC561|\uAC00\uCE58|value|market\s*value)/i);
  if (directUsd) return parseInvestmentNumber(directUsd[1]);
  const krw = parseKoreanKrwAmount(raw);
  if (krw <= 0) return 0;
  return Math.round((krw / investmentUsdKrwRate()) * 100) / 100;
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

async function fetchInvestmentReasoningContext(text) {
  if (typeof apiBuildInvestmentReasoning !== 'function') return '';
  const data = await apiBuildInvestmentReasoning({
    text,
    date: new Date().toISOString().split('T')[0],
  });
  const reasoning = data?.reasoning;
  if (!reasoning) return '';
  const interp = reasoning.interpretation || {};
  const research = reasoning.researchFrame || {};
  const portfolioLines = [
    interp.unchanged?.length ? `- unchanged: ${interp.unchanged.join(', ')}` : '',
    interp.removeOrZero?.length ? `- removeOrZero: ${interp.removeOrZero.join(', ')}` : '',
    interp.newOrIncrease?.length ? `- newOrIncrease: ${interp.newOrIncrease.join(', ')}` : '',
    interp.missingFields?.length ? `- missingFields: ${interp.missingFields.join('; ')}` : '',
    interp.autofill?.length ? `- autofill: ${interp.autofill.map(a => `${a.type}(${(a.symbols || []).join(',')})`).join('; ')}` : '',
  ].filter(Boolean).join('\n') || '- no portfolio interpretation';
  const symbolResearch = (research.symbols || []).slice(0, 4).map(item =>
    `- ${item.symbol}: drivers=${(item.drivers || []).slice(0, 4).join(', ')}; needed=${(item.neededEvidence || []).slice(0, 3).join(', ')}`
  ).join('\n') || '- no symbol research frame';
  const decision = reasoning.decisionProtocol || {};
  const ruleDraft = reasoning.ruleDraft || null;
  const foresight = (reasoning.foresightAgenda || []).slice(0, 4).map(item =>
    `- ${item.symbol}: priority=${item.priority}; watch=${(item.watch || []).join(', ')}; why=${item.whyItMatters || ''}`
  ).join('\n') || '- no foresight agenda';
  const questions = (reasoning.questions || []).slice(0, 5).map(q => `- ${q}`).join('\n') || '- no user question needed';
  const instructions = (reasoning.llmInstructions || []).map(x => `- ${x}`).join('\n') || '- use normal investment mode';
  return `\n\n[Investment Reasoning Engine]\n- intentType: ${reasoning.intentType}\n- action: ${reasoning.action}\n- confidence: ${reasoning.confidence}\n- mentionedSymbols: ${(reasoning.mentionedSymbols || []).join(', ') || '-'}\n\nPortfolio interpretation:\n${portfolioLines}\n\nDecision protocol:\n- requiresGate: ${decision.requiresGate ? 'yes' : 'no'}\n- evidenceToCheck: ${(decision.evidenceToCheck || []).slice(0, 5).join('; ') || '-'}\n- doNotDo: ${(decision.doNotDo || []).slice(0, 5).join('; ') || '-'}\n\nRule draft:\n${ruleDraft ? `- symbol: ${ruleDraft.symbol || '-'}\n- template: ${ruleDraft.template || '-'}\n- evidenceHierarchy: ${(ruleDraft.evidenceHierarchy || []).join('; ')}` : '- none'}\n\nResearch frame:\n- macro: ${(research.macro || []).slice(0, 5).join('; ')}\n${symbolResearch}\n\nForesight agenda:\n${foresight}\n\nQuestions to ask only if needed:\n${questions}\n\nLLM behavior instructions:\n${instructions}\n`;
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
  const isBriefing = isInvestmentBriefingIntent(text);
  const limit = isBriefing ? 3 : 7;
  try {
    const data = await apiFetchInvestmentNews(symbols, limit, queries);
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
function _buildChatSysPrompt(isMyRecords, topic, student, extraContext = '', userText = '', chatPlan = null) {
  const modePrompt = _replyModePrompt(state.replyMode || 'dictation');
  if (state.view === 'investment') {
    const inv = state.investment || defaultInvestmentState();
    const isBriefing = isInvestmentBriefingIntent(userText);
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
      ? clampInvestmentPromptBlock(renderDailyDeskBrief(dailyDesk), isBriefing ? 1800 : 4200)
      : 'Daily Investment Desk: unavailable';
    const recentNews = inv.events
      .filter(e => e.type === 'news')
      .slice(isBriefing ? -3 : -5)
      .map(e => `- ${e.date} ${e.symbol || ''} ${clampInvestmentPromptText(e.title, 140)}: ${clampInvestmentPromptText(e.body, isBriefing ? 280 : 650)}`)
      .join('\n') || '- 기록된 뉴스 없음';
    const recentSignals = (inv.events || [])
      .filter(e => e.type === 'signal')
      .slice(isBriefing ? -3 : -8)
      .map(e => `- ${e.date || ''} ${e.symbol || ''} ${clampInvestmentPromptText(e.title || 'Signal', 140)}${e.handle ? ` (@${e.handle})` : ''}: ${clampInvestmentPromptText(e.body, isBriefing ? 240 : 520)}`)
      .join('\n') || '- No saved market signals';
    const todayIso = new Date().toISOString().slice(0, 10);
    const upcomingEvents = (inv.events || [])
      .filter(e => e.date && e.date >= todayIso && ['earnings', 'macro', 'analyst'].includes(e.type))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, isBriefing ? 6 : 10)
      .map(e => `- ${e.date} [${e.type}] ${e.symbol || ''} ${clampInvestmentPromptText(e.title, 140)}: ${clampInvestmentPromptText(e.body, isBriefing ? 220 : 360)}`)
      .join('\n') || '- 예정된 투자 일정 없음';
    const recentDecisions = inv.decisions.slice(-5).map(d =>
      `- ${d.createdAt?.slice(0, 10) || ''} ${d.symbol} ${d.action}: ${clampInvestmentPromptText(d.label, 120)} — ${clampInvestmentPromptText(d.summary, 520)}`
    ).join('\n') || '- 기록된 매매 판단 없음';
    const compactExtraContext = clampInvestmentPromptBlock(extraContext, isBriefing ? 3500 : 8000);
    const budgetLine = chatPlan?.tier
      ? `Model/cost mode: ${chatPlan.tier}. Be concise and do not spend tokens repeating account tables.`
      : 'Model/cost mode: concise.';
    return `당신은 개인 투자자의 이성적 매매 통제 파트너입니다.
목표는 수익률 예측이나 종목 추천이 아니라, 사용자가 사전에 정한 원칙을 기억하고 감정적 매매를 줄이는 것입니다.
감정 상태를 묻지 말고, 원칙·숫자·기록·뉴스 해석을 기준으로 짧고 분명하게 돕습니다.
${budgetLine}

Engine contract:
- Portfolio Ledger Engine is the only source of truth for shares, average price, cash, and realized trade application. AI text, rendered portfolio cards, and previous AI replies are not ledger facts.
- Market Data Engine may refresh currentPrice, previousClose, changePercent, marketUpdatedAt, and USD/KRW only. It must never change shares, average price, or cash.
- Daily Desk, Market Regime, Scenario, and Trade Gate engines produce behavior controls, market view, scenarios, and blocked/review actions. Treat those engine outputs as the frame for advice.
- Your role is to explain engine outputs, organize user intent into clear fields, and ask for the one missing fact needed by the engine. Do not invent ledger changes from estimates or from your own answer.
- When portfolio data appears inconsistent, say that the ledger and displayed summary must be reconciled, then ask for the exact authoritative values or refer to broker/account sync. Do not copy numbers from a rendered portfolio card back into the ledger.
- If the user asks for current status, separate account facts from quote facts: holdings/cost/cash come from the ledger; prices/FX come from market data.

매수/매도 단정이나 수익률 보장은 금지하지만, 원칙 수립·비중 축소·손절 조건·추가매수 조건에 대해서는 앱의 기본 원칙과 보유 데이터에 근거한 "원칙 후보" 또는 "보수적 기본안"을 먼저 제시할 수 있습니다.
사용자가 "너가 추천해줘", "알아서 정해줘", "어떻게 세우면 좋을까"처럼 원칙 설계를 요청하면 "제 역할 밖"이라고 말하지 말고, 단정적 투자 조언이 아닌 실행 가능한 원칙안으로 답합니다.
앱은 '/api/market/quote'를 통해 보유 종목 현재가와 지수를 조회할 수 있습니다. 시세/상태 컨텍스트가 제공된 경우 절대 "실시간 시세 조회 기능이 없다"고 말하지 않습니다.
앱은 같은 시세 API로 USD/KRW 환율도 조회할 수 있습니다. 환율 컨텍스트가 제공된 경우 절대 "환율 조회 기능이 없다"고 말하지 않습니다.
사용자가 "상태 어때", "현재 어때", "시세", "가격", "보유 종목 어때"처럼 물으면 현재가, 평단, 평가손익, 목표가/손절가 거리, 원칙상 확인할 점을 우선 답합니다.
When the user asks to save news, rules, or trade records, organize the title/body so the app can save them as structured artifacts.
When the user asks to modify, reflect, retry, or show the portfolio, structure the intent for Portfolio Ledger Engine: symbol, buy/sell/hold, fill quantity, fill price, remaining quantity, cash, and FX rate.
Never say you cannot modify portfolio data. However, actual mutation is decided by Portfolio Ledger Engine; if one required fact is missing, ask only for that one fact.
Do not say a save or ledger update is complete unless the app/engine result explicitly says it changed.
매매 기록에 필요한 최소 항목은 종목, 매수/매도/보유, 이유입니다. 가능하면 수량, 가격, 손절가, 목표가도 확인합니다.
투자 원칙은 사용자의 말에서 원칙 문장을 만들되, 기준이 애매하면 "어느 조건에서 적용할지"를 먼저 물어봅니다.
포트폴리오 비중이 원칙을 크게 초과한 경우에는 사용자가 숫자를 직접 정하지 않아도 기본 원칙(${inv.rules.maxPositionWeight}%)과 현재 비중을 근거로 1차 목표 비중, 단계적 축소안, 예외 조건을 제안합니다.
사용자가 실제 투자금, 평단, 익절 비율, 실현익을 말하면 반드시 대략 계산을 먼저 합니다. 남은 원가, 남은 평가액, 남은 미실현 손익, 현재 총 이익, 세금 예비금, 남은 포지션의 변동폭을 "추정"으로 분리해 보여줍니다.
실적 발표, 어닝콜, 공시, 인수, 규제처럼 날짜가 있는 이벤트를 물으면 먼저 이벤트 시간과 현재가/평단/비중을 확인하고, 주가 예측 단정 대신 상승/중립/하락 시나리오별 행동 규칙을 제시합니다.
좋은 답변은 애널리스트 보고서가 아니라 "내 계좌에 바로 적용할 수 있는 행동 계획"이어야 합니다. 핵심 구조는 결론 → 내 포지션 계산 → 지금 하지 말 것 → 시나리오별 행동표 → 확인할 체크포인트 → 최종 액션 플랜입니다.
브리핑 요청에서는 포트폴리오 표를 반복하지 않습니다. 포트폴리오 숫자는 필요한 1~2개만 인용하고, 핵심은 "오늘의 뷰"입니다.
브리핑은 반드시 다음 구조로 답합니다: 1) 오늘의 뷰 한 줄, 2) 시장이 이미 가격에 반영한 것, 3) 아직 확인되지 않은 것, 4) 내 계좌에서 제일 위험한 오판 1개, 5) 오늘 하지 말아야 할 행동 2개, 6) 뷰가 틀렸다고 인정할 반증 조건.
브리핑은 모든 종목을 공평하게 다루지 않습니다. 오늘 의사결정에 영향을 주는 상위 2~3개 이슈만 고릅니다. 엣지가 없으면 "오늘은 하지 않는 것이 액션"이라고 말합니다.
브리핑 답변은 650단어를 넘기지 않습니다. 표는 시나리오 표 1개까지만 허용합니다.
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

High-quality briefing contract:
- Core assumption first: start with the one account assumption most likely to hurt the user if wrong.
- Evidence map: separate priced-in facts, unconfirmed signals, missing evidence, and official/trusted sources to verify.
- Position view: for the top 2-3 exposures only, state core assumption, must-verify evidence, invalidation condition, and do-not-do action.
- Do not invent analyst targets, consensus, current prices, earnings dates, or price forecasts unless they appear in supplied market/news/desk context.
- If a number is not in context, say which official source, company IR, SEC filing, trusted financial media, or market data endpoint must confirm it.
- End with behavior control: what not to do today, what would change the view, and what single action is allowed now.

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

function investmentKstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
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

function previousInvestmentCalendarDate(dateText) {
  const d = new Date(`${dateText}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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

function investmentChatSegmentForDate(date = new Date()) {
  const kst = investmentKstParts(date);
  const minutes = (kst.hour * 60) + kst.minute;
  if (minutes >= 9 * 60 && minutes < 18 * 60) {
    return { date: kst.date, segment: 'day', label: '09:00-18:00', order: 1 };
  }
  if (minutes >= 18 * 60 && minutes < (23 * 60 + 30)) {
    return { date: kst.date, segment: 'evening', label: '18:00-23:30', order: 2 };
  }
  if (minutes >= (23 * 60 + 30)) {
    return { date: kst.date, segment: 'overnight', label: '23:30-05:00', order: 3 };
  }
  if (minutes < 5 * 60) {
    return { date: previousInvestmentCalendarDate(kst.date), segment: 'overnight', label: '23:30-05:00', order: 3 };
  }
  return { date: kst.date, segment: 'preopen', label: '05:00-09:00', order: 0 };
}

function investmentChatSegmentRank(session) {
  const date = String(session?.date || '');
  const orderMap = { preopen: 0, day: 1, evening: 2, overnight: 3 };
  return `${date}:${orderMap[session?.segment] ?? -1}`;
}

function investmentChatSessionId(date = investmentMarketSessionDate()) {
  if (date && typeof date === 'object' && date.segment) return `kst-${date.date}-${date.segment}`;
  return `market-${date}`;
}

function ensureInvestmentChatSession(date = new Date()) {
  state.investment = normalizeInvestmentState(state.investment);
  const segment = investmentChatSegmentForDate(date);
  const sessionDate = segment.date;
  const sessionId = investmentChatSessionId(segment);
  let session = state.investment.chatSessions.find(s => s.id === sessionId);

  if (!session) {
    session = {
      id: sessionId,
      date: sessionDate,
      market: 'US',
      segment: segment.segment,
      label: segment.label,
      startedAt: new Date().toISOString(),
      updatedAt: null,
      closedAt: null,
      summarizedAt: null,
      summaryEventId: null,
      summary: '',
      messageCount: 0,
      messages: [],
    };
    if (!state.investment.chatSessions.length && Array.isArray(state.investment.chat) && state.investment.chat.length) {
      session.messages = _sanitizeChatHistory(state.investment.chat);
      session.updatedAt = new Date().toISOString();
    }
    state.investment.chatSessions.push(session);
  } else {
    session.segment = session.segment || segment.segment;
    session.label = session.label || segment.label;
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
  const currentSegment = investmentChatSegmentForDate(date);
  const currentRank = `${currentSegment.date}:${currentSegment.order}`;
  let changed = false;

  state.investment.chatSessions.forEach(session => {
    const canClose = investmentChatSegmentRank(session) < currentRank;
    const messages = _sanitizeChatHistory(session.messages || []);
    const hasNewMessages = !session.summarizedAt || (session.updatedAt && new Date(session.updatedAt) > new Date(session.summarizedAt));
    if (!canClose || !hasNewMessages || messages.filter(m => m.role !== 'system').length < 2) return;

    const eventId = session.summaryEventId || `investment-chat-summary-${session.id}`;
    const exists = state.investment.events.some(e => e.id === eventId);
    const summary = buildInvestmentChatSessionSummary(messages, session.date, session.label || session.segment || '');
    const nextEvent = {
      id: eventId,
      date: session.date,
      type: 'review',
      symbol: inferInvestmentSymbol(messages.map(m => m.text).join('\n')),
      title: `${session.date} ${session.label || session.segment || ''} 투자 대화 요약`,
      body: summary,
      severity: 'info',
      source: 'investment-chat-segment',
    };
    if (!exists) state.investment.events.push(nextEvent);
    else state.investment.events = state.investment.events.map(e => e.id === eventId ? { ...e, ...nextEvent } : e);
    session.closedAt = session.closedAt || date.toISOString();
    session.summarizedAt = date.toISOString();
    session.summaryEventId = eventId;
    session.summary = summary;
    session.messageCount = messages.length;
    session.messages = [];
    try {
      localStorage.removeItem(`jip_chat_v2_investment_${session.id}`);
    } catch (_) {}
    changed = true;
  });

  if (changed) {
    if (typeof _saveToLocalCache === 'function') _saveToLocalCache();
    saveData();
    if (typeof renderRightPanel === 'function') renderRightPanel();
    logger.info('장 마감 대화 세션을 투자 타임라인 이벤트로 자동 정리', {
      count: state.investment.events.filter(e => e.source === 'investment-chat-segment').length,
    });
  }
  return changed;
}

function buildInvestmentChatSessionSummary(messages, dateText, label = '') {
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
    `## ${dateText}${label ? ` ${label}` : ''} 투자 대화 요약`,
    '',
    `- 사용자 발화 ${userLines.length}개, AI 답변 ${aiLines.length}개를 기준으로 정리했습니다.`,
  ];
  if (candidates.length) {
    summaryLines.push('', '### 투자 판단 후보 발화');
    candidates.forEach(line => summaryLines.push(`- ${line.replace(/\s+/g, ' ').slice(0, 180)}`));
  }
  if (lastAi) {
    summaryLines.push('', '### 마지막 판단 맥락', lastAi.slice(0, 1200));
  }
  summaryLines.push('', '> 이 항목은 시간 구간 마감 시 자동 생성된 대화 요약입니다. 실제 매매/포트폴리오 반영은 원장과 매매 기록 기준으로 확인하세요.');
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
