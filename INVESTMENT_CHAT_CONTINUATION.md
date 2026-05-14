# Investment Chat Continuation Plan

## Problem

Long investment answers can stop in the middle when the model reaches its
`max_tokens` limit. The app already receives Anthropic metadata such as
`stop_reason`, but the chat UI previously displayed only the first response.

## Direction

- Detect `stop_reason === "max_tokens"` from `/api/analyze`.
- Automatically ask the model to continue from the exact stopping point.
- Do not repeat the previous answer.
- Merge all segments into one visible assistant reply.
- Limit continuation attempts so one chat turn cannot spend tokens endlessly.

## Current Behavior

- Initial answer uses the selected chat plan.
- If it is cut by token limit, the frontend sends up to two continuation calls.
- The final saved chat/artifact text is the combined answer.

## Future Improvements

- Stream partial text while continuation calls run.
- Add a visible "continue" button when the automatic continuation budget is used.
- Track continuation token usage in the debug logger.
