/* =============================================
   自畵像 — 대화창 통합 관리
   의존성: state.js, utils.js, ai-counseling.js, ai-myrecords.js, modal.js
   ============================================= */

// ---------------------------------------------------------------------------
// 입력창 키 핸들러
// ---------------------------------------------------------------------------

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCurrentChat();
  }
}

// ---------------------------------------------------------------------------
// 전송 라우팅
// ---------------------------------------------------------------------------

function sendCurrentChat() {
  console.log('[chat] sendCurrentChat 호출됨');
  const input = document.getElementById('chat-input-bottom');
  console.log('[chat] input 요소:', input, '| 값:', input?.value);
  const text  = input?.value.trim();
  if (!text) { console.warn('[chat] 빈 입력 — 전송 중단'); return; }
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

  console.log('[chat] continueContextChat 호출, text=', text);
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

  let investmentNewsContext = '';
  let investmentMarketContext = '';
  if (isInvestment) {
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
  }

  // AI 역할: state.currentRole → AI_ROLE_PRESETS에서 prompt 조회. 없으면 topic.aiPrompt 폴백
  const sysPrompt = _buildChatSysPrompt(isMyRecords, topic, student, [investmentNewsContext, investmentMarketContext].filter(Boolean).join('\n'));

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
        model: 'claude-sonnet-4-6', max_tokens: 600,
        system: [{ type: 'text', text: sysPrompt, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    const data = await res.json();
    const reply = data.content?.map(c => c.text || '').join('').trim();
    if (reply) {
      appendMessage('ai', reply);
      saveSummaryReplyAsRecord(reply);
      saveInvestmentChatArtifacts(text, reply);
    } else {
      hideTypingIndicator();
    }
  } catch (e) {
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

function saveInvestmentChatArtifacts(userText, aiText) {
  if (state.view !== 'investment') return;
  const ask = (userText || '').trim();
  const content = (aiText || '').trim();
  if (!ask || !content) return;
  const today = new Date().toISOString().split('T')[0];
  const wantsSave = /기록|저장|추가|반영|설정|정해|남겨|수정/.test(ask);
  if (!wantsSave) return;

  const symbol = inferInvestmentSymbol(ask);
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
    saveData();
    showToast('Market signal saved.');
    renderRightPanel();
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
    saveData();
    showToast('뉴스 동향에 기록했어요.');
    renderRightPanel();
    return;
  }

  if (/투자\s*원칙|원칙|매매\s*원칙|방향성|체크리스트|리스크/.test(ask)) {
    const prev = state.investment.rules.coreRules || '';
    state.investment.rules.coreRules = [prev, content].filter(Boolean).join('\n\n');
    saveData();
    showToast('투자 원칙에 반영했어요.');
    renderRightPanel();
    return;
  }

  if (/매매|거래|매수|매도|추가매수|분할|진입|청산|trade|buy|sell/.test(lower + ask)) {
    const action = inferInvestmentAction(ask);
    const position = findInvestmentPositionFromText(ask, symbol);
    const decision = {
      id: 'id' + Date.now(),
      createdAt: new Date().toISOString(),
      symbol: symbol || position?.symbol || '미지정',
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
      tradeShares: extractLabeledNumber(ask, /(수량|주|개)/),
      tradePrice: extractLabeledNumber(ask, /(가격|체결|단가|price)/),
    };
    state.investment.decisions.push(decision);
    state.investment.events.push({
      id: 'ie' + Date.now(),
      date: today,
      type: 'trade-note',
      symbol: decision.symbol,
      title: `${decision.symbol} ${investmentActionLabel(action)} 기록`,
      body: content,
      severity: 'info',
      linkedDecisionId: decision.id,
      linkedRecordId: null,
    });
    saveData();
    showToast('매매 기록에 남겼어요.');
    renderRightPanel();
  }
}

function inferInvestmentAction(text) {
  const raw = String(text || '').toLowerCase();
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
  return /\uB274\uC2A4|\uCD5C\uC2E0|\uB3D9\uD5A5|\uACF5\uC2DC|\uBC95\uC548|\uADDC\uC81C|news|headline|filing|bill|act|regulation/.test(ask);
}

function shouldFetchInvestmentMarketContext(text) {
  const ask = String(text || '').toLowerCase();
  if (state.view === 'investment' && state.replyMode === 'invest-status') return true;
  return /\uC0C1\uD0DC|\uC2DC\uC138|\uD604\uC7AC\uAC00|\uAC00\uACA9|\uC5B4\uB54C|\uD3C9\uAC00|\uC190\uC775|\uD3EC\uD2B8\uD3F4\uB9AC\uC624|status|price|quote|position|portfolio/.test(ask);
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
// AI 대화용 시스템 프롬프트 생성 (현재 역할 기준으로 매 메시지마다 최신 반영)
function _buildChatSysPrompt(isMyRecords, topic, student, extraContext = '') {
  const modePrompt = _replyModePrompt(state.replyMode || 'dictation');
  if (state.view === 'investment') {
    const inv = state.investment || defaultInvestmentState();
    const totals = typeof investmentTotals === 'function'
      ? investmentTotals(inv.positions || [])
      : { totalValue: 0, totalCost: 0, totalGain: 0, totalGainPercent: 0 };
    const positions = inv.positions.map(p =>
      `- ${p.symbol || '?'}: 수량 ${p.shares || 0}, 평균 ${p.avgPrice || 0}, 현재 ${p.currentPrice || 0}, 목표 ${p.targetPrice || '-'}, 손절 ${p.stopPrice || '-'}, 논리 ${p.thesis || '없음'}`
    ).join('\n') || '- 등록된 보유 종목 없음';
    const portfolioSnapshot = [
      `- 총 평가액: ${totals.totalValue.toFixed(2)}`,
      `- 총 매입금: ${totals.totalCost.toFixed(2)}`,
      `- 평가손익: ${totals.totalGain.toFixed(2)} (${totals.totalGainPercent.toFixed(2)}%)`,
    ].join('\n');
    const recentNews = inv.events
      .filter(e => e.type === 'news')
      .slice(-5)
      .map(e => `- ${e.date} ${e.symbol || ''} ${e.title}: ${e.body}`)
      .join('\n') || '- 기록된 뉴스 없음';
    const recentSignals = (inv.events || [])
      .filter(e => e.type === 'signal')
      .slice(-8)
      .map(e => `- ${e.date || ''} ${e.symbol || ''} ${e.title || 'Signal'}${e.handle ? ` (@${e.handle})` : ''}: ${e.body || ''}`)
      .join('\n') || '- No saved market signals';
    const todayIso = new Date().toISOString().slice(0, 10);
    const upcomingEvents = (inv.events || [])
      .filter(e => e.date && e.date >= todayIso && ['earnings', 'macro', 'analyst'].includes(e.type))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 10)
      .map(e => `- ${e.date} [${e.type}] ${e.symbol || ''} ${e.title}: ${e.body || ''}`)
      .join('\n') || '- 예정된 투자 일정 없음';
    const recentDecisions = inv.decisions.slice(-5).map(d =>
      `- ${d.createdAt?.slice(0, 10) || ''} ${d.symbol} ${d.action}: ${d.label} — ${d.summary}`
    ).join('\n') || '- 기록된 매매 판단 없음';
    return `당신은 개인 투자자의 이성적 매매 통제 파트너입니다.
목표는 수익률 예측이나 종목 추천이 아니라, 사용자가 사전에 정한 원칙을 기억하고 감정적 매매를 줄이는 것입니다.
감정 상태를 묻지 말고, 원칙·숫자·기록·뉴스 해석을 기준으로 짧고 분명하게 돕습니다.
매수/매도 단정이나 수익률 보장은 금지하지만, 원칙 수립·비중 축소·손절 조건·추가매수 조건에 대해서는 앱의 기본 원칙과 보유 데이터에 근거한 "원칙 후보" 또는 "보수적 기본안"을 먼저 제시할 수 있습니다.
사용자가 "너가 추천해줘", "알아서 정해줘", "어떻게 세우면 좋을까"처럼 원칙 설계를 요청하면 "제 역할 밖"이라고 말하지 말고, 단정적 투자 조언이 아닌 실행 가능한 원칙안으로 답합니다.
앱은 '/api/market/quote'를 통해 보유 종목 현재가와 지수를 조회할 수 있습니다. 시세/상태 컨텍스트가 제공된 경우 절대 "실시간 시세 조회 기능이 없다"고 말하지 않습니다.
사용자가 "상태 어때", "현재 어때", "시세", "가격", "보유 종목 어때"처럼 물으면 현재가, 평단, 평가손익, 목표가/손절가 거리, 원칙상 확인할 점을 우선 답합니다.
사용자가 "뉴스 동향에 기록", "투자 원칙으로 저장", "매매 기록으로 남겨"처럼 말하면 저장될 수 있게 제목과 본문을 정돈해서 답합니다.
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

최근 뉴스 동향:
${recentNews}

다가오는 투자 일정:
Recent X / market signals:
${recentSignals}

${upcomingEvents}

최근 매매 판단:
${recentDecisions}

${extraContext}

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

function _chatStorageKey() {
  const id = state.selTopic || state.selStudent;
  if (state.view === 'investment') return 'jip_chat_v2_investment';
  return id ? `jip_chat_v2_${id}` : null;
}

function saveChatHistory() {
  const key = _chatStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(state.currentChatMessages));
    if (state.view === 'investment') {
      state.investment = normalizeInvestmentState(state.investment);
      state.investment.chat = [...state.currentChatMessages];
      saveData();
    }
  } catch (e) { /* 용량 초과 무시 */ }
}

function loadChatHistory() {
  const key = _chatStorageKey();
  if (!key) return false;
  if (state.view === 'investment') {
    state.investment = normalizeInvestmentState(state.investment);
    if (state.investment.chat.length) {
      state.currentChatMessages = _sanitizeChatHistory(state.investment.chat);
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
        if (sanitized.length !== msgs.length) saveChatHistory();
        return true;
      }
      localStorage.removeItem(key);
    }
  } catch (e) { /* 파싱 오류 무시 */ }
  return false;
}

function _sanitizeChatHistory(msgs) {
  const starterTexts = [
    '대화 준비가 되었어요!',
    '받아쓰기 모드예요. 정리 안 된 말 그대로 남겨도 괜찮아요.',
  ];
  const cleaned = msgs
    .filter(m => m && typeof m.text === 'string')
    .filter(m => !(m.role === 'system' && starterTexts.includes(m.text.trim())));
  while (cleaned.length && cleaned[0].role !== 'user') cleaned.shift();
  return cleaned;
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
