# Investment Chat Segment Retention

Date: 2026-05-14

## Goal

Investment chat should feel continuous when the user leaves and returns to the app. At the same time, raw chat cannot grow forever.

## Session Model

Investment chat is now grouped by Korean time windows:

- `09:00-18:00` day session
- `18:00-23:30` evening session
- `23:30-05:00` overnight session
- `05:00-09:00` pre-open buffer session

The active segment keeps its raw messages so the conversation can continue after refresh or reopening the app.

## Compaction Rule

When the app enters a later segment:

1. Previous segment messages are summarized.
2. A timeline event is written with source `investment-chat-segment`.
3. The previous session stores `summary`, `messageCount`, and `summaryEventId`.
4. Raw `messages` are cleared from the closed segment.
5. The localStorage key for that closed segment is removed.

## Reason

This matches the investment desk workflow:

- During a live segment, continuity matters.
- After the segment ends, the useful residue is the decision context, not every message.
- Timeline summaries preserve what matters without making the chat prompt and database grow indefinitely.
