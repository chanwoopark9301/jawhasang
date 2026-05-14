# Briefing Quality Upgrade

Date: 2026-05-14

## Problem

The investment briefing had a useful shape, but it could still sound like a generic news summary. It could mention analyst targets, consensus, or outlook language without a clear evidence chain, and it did not always begin from the user's account-level risk.

## Product Direction

The briefing should behave like an investment control desk:

1. Start from the account's most fragile assumption.
2. Separate priced-in facts from unconfirmed signals.
3. For the largest exposures, show the core assumption, evidence to verify, invalidation condition, and forbidden behavior.
4. Avoid invented analyst targets, consensus, prices, and dates unless supplied by market/news/desk context.
5. End with behavior control, not a vague recommendation.

## Engine Changes

- Added a server-side `viewQuality` frame to the investment desk engine.
- Added a dedicated Intel/turnaround semiconductor profile.
- Added position-level core assumptions and verification checklists.
- Added briefing LLM instructions for assumption-first analysis and no unsupported analyst/consensus numbers.
- Added chat prompt rules that force the same quality contract in the final answer.
- Added a hypothesis-first answer shape for ordinary investment chat, so the AI first restates the user's thesis and then separates the right-world, wrong-world, evidence, and today's forbidden behavior.

## Investment Chat Answer Shape

When the user asks whether an investment idea makes sense, what the next market leader could be, whether to buy/hold/sell, or how to think about an existing thesis, the answer must use this shape:

1. Restate the user's investment hypothesis in one sentence.
2. Explain the world where the hypothesis is right.
3. Explain the world where the hypothesis is wrong.
4. Name the evidence to check now.
5. End with the do-not-do action today.

This is meant to prevent generic checklist answers. The AI should sound like a thinking partner, but the ledger, market data, and desk engines remain the authority for account facts and behavior controls.

Sector-rotation questions are analysis requests, not forbidden stock-picking requests.
In short: sector-rotation questions are analysis requests.
When the user asks what the next leading sector could be or whether to enter a hot sector now, the AI should not refuse. It should translate the question into a ranked theme scenario, explain what evidence would confirm or break each scenario, and then let behavior controls decide whether action is allowed today.

The root issue is intent classification before behavior control. A short question like "what leads after semiconductors?" is not a request for a stock pick. It is a market-regime, sector-rotation, entry-timing, and market participant psychology question. The chat prompt now carries that intent frame explicitly before the rule/gate instructions, so the AI should interpret the question first and then apply controls.

Implementation note: this intent frame now lives in `js/investment-question-intent.js` instead of being buried inside `chat.js`. Market analysis questions without concrete order details skip the trade gate, while concrete trade/order questions still go through behavior control.

## Example Contract

For a large INTC position, the desk should not merely say "Intel looks weak/strong." It should state:

- Core assumption: the turnaround is real only if foundry losses shrink, margins recover, and data center/AI competitiveness improves.
- Must verify: foundry loss path, gross margin/free cash flow, data center/AI CPU share, CHIPS/subsidy execution.
- Invalidation: foundry breakeven pushed out, margin recovery fails, or AI/data center competitiveness remains weak.
- Do-not-do: do not add only because the price looks cheaper or because a target price headline changed.
