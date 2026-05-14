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

## Example Contract

For a large INTC position, the desk should not merely say "Intel looks weak/strong." It should state:

- Core assumption: the turnaround is real only if foundry losses shrink, margins recover, and data center/AI competitiveness improves.
- Must verify: foundry loss path, gross margin/free cash flow, data center/AI CPU share, CHIPS/subsidy execution.
- Invalidation: foundry breakeven pushed out, margin recovery fails, or AI/data center competitiveness remains weak.
- Do-not-do: do not add only because the price looks cheaper or because a target price headline changed.
