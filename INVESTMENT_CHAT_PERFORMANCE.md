# Investment Chat Performance Plan

## Problem

Normal investment chat slowed because every message could trigger the same heavy path as a briefing or trade decision:

- server trade-gate evaluation
- server ledger snapshot refresh
- investment reasoning context fetch
- optional market/news/fx context fetches

That is correct for portfolio updates, briefings, research, and order-like messages, but too expensive for ordinary conversation.

## Change

- Keep the heavy path for briefing, research, portfolio, rule, and trade-like intents.
- Let ordinary chat skip the trade gate, ledger refresh, and reasoning-engine fetch.
- Keep news, market, and FX context functions keyword-gated.
- Increase chat-prompt ledger refresh throttling so repeated messages do not refetch the ledger every turn.

## Expected Result

Normal conversation in investment mode should feel close to daily/counseling chat speed, while the desk and portfolio flows still use the ledger and reasoning engines when the user's intent actually needs them.
