# Investment Batch Evidence Engine Plan

## Goal

The investment desk should not wait for a chat message before it starts thinking.
Before the market opens, the app should prepare a usable desk brief by running the
deterministic engines first, collecting the evidence those engines ask for, and
saving that evidence to the investment timeline.

The LLM should write and explain. The app engines should decide what must be
checked.

## Core Flow

1. Ledger sync
   - Pull the server ledger and broker read-only data first.
   - The ledger is the source of truth for positions, cash, cost basis, and trades.

2. Market data sync
   - Refresh positions, key indices, and USD/KRW.
   - Save fresh prices before any portfolio or risk judgment.

3. Calendar sync
   - Pull earnings, macro events, and portfolio-relevant dates.
   - Store them as investment events.

4. Evidence request engine
   - Run the desk engine once before news collection.
   - Use `researchQueue`, position assumptions, invalidation checks, and control
     rules as explicit evidence requests.

5. Evidence collection
   - Build search/news queries from the engine requests plus current holdings.
   - Save fetched results into the timeline with source links and verification
     notes.

6. Final desk engine
   - Run the desk engine again after evidence is saved.
   - The final desk should use the newly stored evidence instead of generic
     briefing prompts.

7. Conversation reuse
   - During the day, chat answers should use the latest ledger, desk engine output,
     and timeline evidence before calling an LLM.
   - If fresh evidence is missing, the app should say what needs confirmation.

## Schedule

- Default desk preparation time: `08:50` KST.
- Reason: the user should see the market view about 10 minutes before the Korean
  regular market open.
- Future extension: support separate schedules for Korean, US premarket, US open,
  and US after-hours.

## Evidence Quality Rules

- Official filings, company IR, exchange calendars, and central bank/economic
  calendars are primary evidence.
- Trusted financial media and data providers are secondary evidence.
- X/rumor/RSS-only signals are weak evidence until confirmed by primary or
  trusted secondary sources.
- The desk can use weak evidence as a watch item, but not as a trade trigger.

## Current Implementation Stage

- The browser batch flow now runs a pre-evidence desk engine before news sync.
- News queries now prioritize the engine `researchQueue`.
- The final desk engine runs after evidence is saved, so the briefing can use
  newly collected timeline events.
- A server-side batch endpoint now exists at `/api/investment/desk/batch`.
  This endpoint can be called by an external scheduler even when the browser app
  is not open.

## Server Scheduling

The browser cannot run scheduled work after the app is closed. For true
accumulation, Railway or an external cron must call the server endpoint.

Recommended production setup:

1. Set `INVESTMENT_BATCH_SECRET` in Railway.
2. Schedule a daily POST request to:

```text
POST https://jawhasang-production.up.railway.app/api/investment/desk/batch
Authorization: Bearer <INVESTMENT_BATCH_SECRET>
Content-Type: application/json

{"force": false, "reason": "pre-market-cron"}
```

3. Run it at `08:50` KST for the Korean market desk.
4. Add a second schedule later for US premarket if needed.

## Next Stages

1. Persist evidence requests as normalized DB rows when the investment ledger is
   migrated out of the encrypted JSON blob.
2. Add provider-level evidence scoring: official, trusted media, RSS, X, manual.
3. Add per-position evidence freshness checks.
4. Add market-regime batch snapshots for cash allocation decisions.
5. Reuse the same batch structure for future asset/accounting features.
