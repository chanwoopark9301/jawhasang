/* =============================================
   自畵像 — investment question intent engine
   Purpose: interpret the user's investment question before behavior controls.
   ============================================= */

function classifyInvestmentQuestionIntent(text) {
  const ask = String(text || '');
  const intents = [];
  const add = (id) => {
    if (!intents.includes(id)) intents.push(id);
  };
  if (/(?:\uC0C1\uC2B9\uC7A5|\uD558\uB77D\uC7A5|\uD6A1\uBCF4\uC7A5|\uC7A5\uC138|\uAD6D\uBA74|\uC2DC\uC7A5\s*\uAD6D\uBA74|\uC5BC\uB9C8\uB098\s*\uAC08|\uC9C0\uC18D|market\s*regime|bull\s*market|bear\s*market|sideways)/i.test(ask)) {
    add('market_regime');
  }
  if (/(?:\uC8FC\uB3C4\uC8FC|\uC8FC\uB3C4\s*\uC139\uD130|\uB2E4\uC74C\s*\uC8FC\uB3C4|\uC139\uD130\s*\uB85C\uD14C\uC774\uC158|\uBC18\uB3C4\uCCB4\s*\uB2E4\uC74C|\uC5B4\uB290\s*\uC139\uD130|next\s*leader|sector\s*rotation|leading\s*sector|theme\s*rotation)/i.test(ask)) {
    add('sector_rotation');
  }
  if (/(?:\uB4E4\uC5B4\uAC08\uAE4C|\uC9C4\uC785|\uC9C0\uAE08\uC774\uB77C\uB3C4|\uC9C0\uAE08\s*\uC0AC|\uCD94\uACA9|\uD0C0\uC774\uBC0D|entry|enter|timing|chase)/i.test(ask)) {
    add('entry_timing');
  }
  if (/(?:\uD22C\uC790\uC790\s*\uC2EC\uB9AC|\uC2DC\uC7A5\s*\uC2EC\uB9AC|\uC218\uAE09|\uD3EC\uC9C0\uC154\uB2DD|\uACF5\uD3EC|\uD0D0\uC695|\uD53C\uB85C\uAC10|\uACFC\uC5F4|\uC18C\uC678|sentiment|positioning|crowded|fear|greed|exhaustion|fomo)/i.test(ask)) {
    add('market_psychology');
  }
  if (typeof investmentTextHasResearchIntent === 'function' && investmentTextHasResearchIntent(ask)) {
    add('thesis_research');
  }
  if (typeof investmentTextHasTradeLikeIntent === 'function'
      && investmentTextHasTradeLikeIntent(ask)
      && !intents.includes('sector_rotation')
      && !intents.includes('market_regime')) {
    add('trade_control');
  }
  return intents.length ? intents : ['general_investment_chat'];
}

function isInvestmentMarketAnalysisIntent(text) {
  const intents = classifyInvestmentQuestionIntent(text);
  return intents.includes('market_regime')
    || intents.includes('sector_rotation')
    || intents.includes('market_psychology');
}

function buildInvestmentQuestionIntentBrief(text) {
  const intents = classifyInvestmentQuestionIntent(text);
  const labels = {
    market_regime: 'market regime / trend durability question',
    sector_rotation: 'sector rotation / next leadership question',
    entry_timing: 'entry timing / chase-risk question',
    market_psychology: 'market participant psychology / positioning question',
    thesis_research: 'investment thesis research question',
    trade_control: 'trade behavior-control question',
    general_investment_chat: 'general investment conversation',
  };
  return [
    'Investment question intent:',
    `- Detected intent: ${intents.map(id => labels[id] || id).join(', ')}`,
    '- Interpretation comes before behavior control. First explain what the user is really asking, then apply ledger/rule constraints.',
    '- For market regime, sector rotation, or entry timing questions, answer as market analysis rather than refusing as stock recommendation.',
    '- Include market participant psychology when relevant: positioning, crowdedness, FOMO, fear/greed, fatigue, breadth, liquidity, and who is likely trapped or chasing.',
  ].join('\n');
}
