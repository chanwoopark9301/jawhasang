# Investment Daily Desk Implementation Plan

## Directory Check

- `js/investment-rules.js`: numeric parsing, cash detection, portfolio totals, and rule-based risk alerts.
- `js/investment-portfolio.js`: portfolio slices, unpriced positions, trade-to-portfolio updates, and cash reconciliation after sells.
- `js/render-investment.js`: investment home screen and investment modals.
- `js/render-aipanel.js`: right-side investment menu.
- `js/chat.js`: shared AI chat prompt and investment action extraction.
- `investment_calendar.py`, `investment_backend.py`, `kis_broker.py`: server-side investment data, calendar, market/broker integration.

The investment feature is already separated enough to add a new desk layer without touching daily/counseling modules.

## Product Direction

The next step is not another memo screen. The app should act like a daily investment control desk:

> Read the account state every day, identify what is dangerous today, and slow down the user's next action before impulse trades happen.

This means the desk must combine:

- Portfolio exposure and cash
- Position concentration
- Recent realized trades
- Today's and upcoming events
- Existing investment rules
- Rule-engine alerts

## Data Strategy

Initial version is derived, not separately persisted.

- Source of truth remains `state.investment.positions`, `rules`, `events`, and `decisions`.
- A new derived function `buildDailyInvestmentDesk(investment, date)` creates the current desk snapshot.
- This avoids schema churn and keeps existing Supabase/data.json compatibility.

## Implementation Phases

1. Add `js/investment-desk.js`
   - Build a deterministic desk snapshot.
   - Generate risk signals, blocked actions, allowed actions, and checklist items.
   - Export a compact text brief for AI prompts.

2. Add UI entry points
   - Add "오늘의 데스크" to the investment right-side menu.
   - Add an investment desk strip to the main investment screen.
   - Add a full modal report for account snapshot, risk signals, blocked actions, events, and checklist.

3. Connect AI behavior
   - Inject the desk brief into the investment system prompt.
   - Make the AI answer from desk guardrails first, especially for buy/add/re-entry questions.

4. Test
   - E2E: desk modal catches recent sell + earnings event.
   - E2E: investment AI prompt includes Daily Investment Desk guardrails.
   - Cache/version tests updated.

## Default Guardrail Logic

- Concentration above max rule: block additional buy/add for that symbol.
- Earnings/macro event today: block new impulse buy/add before scenario planning.
- Recent sell with cash created: block immediate re-entry unless the user writes a new rule.
- Cash after sell: mark as dry powder/tax reserve candidate, not "free money."
- Existing risk alerts are promoted into desk signals.

## Later Extensions

- Broker daily sync as the automatic opening step.
- Analyst consensus and earnings expectation deltas.
- Options implied move and post-earnings scenario table.
- Push/PWA notifications for event days and rule violations.
- Model comparison desk: Claude/OpenAI produce separate recommendations, but the rule desk remains the final gate.
