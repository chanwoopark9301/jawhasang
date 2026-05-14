# Briefing Latency Audit

Date: 2026-05-14

## Finding

Investment briefing chat was slow because it waited for every pre-LLM context source before sending the AI request.

The slow path was:

1. Investment reasoning context
2. News/search context
3. Market quote context
4. FX context
5. LLM request

The first four jobs were already started in parallel, but `Promise.allSettled` still waited for the slowest one. When news aggregation or quote/FX lookup stalled, a normal "briefing" request felt stuck before the model even started answering.

## Fix Direction

Briefing context collection is now treated as a time-budgeted preflight.

- Each context job has its own timeout.
- Generic briefing fetches fewer news items.
- Slow optional context degrades to an empty block instead of blocking the whole answer.
- Per-context duration and timeout logs are emitted so future bottlenecks can be traced.

## Current Budgets

- Reasoning: 2.5s for briefing, 4s otherwise
- Market quotes: 3.5s for briefing, 5s otherwise
- FX: 2.2s for briefing, 3s otherwise
- News: 4.5s for briefing, 8s otherwise

## Next Step

- Add server-side partial-result timeouts to `/api/investment/news`.
- Reuse morning desk cache for generic briefing.
- Only force fresh news search when the user explicitly asks for latest news/search.
