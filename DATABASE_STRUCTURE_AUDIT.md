# Database Structure Audit

## 2026-05-14 Scan Summary

The app currently uses a hybrid persistence model:

- `app_storage`: one encrypted full-app blob for counseling, daily records, settings, chat, and fallback investment data.
- Normalized investment tables: `investment_accounts`, `investment_positions`, `investment_transactions`, `investment_cash_ledger`, `investment_events`.
- Read overlay: investment screens should treat normalized investment tables as the source of truth and overlay them onto the encrypted blob when loading.

## Main Risks Found

1. Stale overwrite risk
   - Several investment endpoints used to start from `read_data()` directly.
   - If `app_storage` had old positions, a later save/sync could revive stale holdings.
   - Fix: routes now use `_read_data_with_investment_ledger()` where the account ledger matters.

2. Slow ledger saves
   - Portfolio snapshot saves could read/encrypt/write the full app blob and mirror history.
   - Fix: DB ledger POST now writes normalized investment tables directly, and fast ledger mirroring skips history rows.

3. History growth risk
   - Rewriting all decisions/events on every portfolio snapshot becomes slower as timeline data grows.
   - Fix: `include_history=False` for position-only ledger saves; full history mirroring remains for explicit full data saves and sync flows.

4. Query growth risk
   - Position, transaction, and event tables had no explicit account/date indexes.
   - Fix: added account/symbol and account/date indexes.

5. Connection cleanup risk
   - `read_data()` and `write_data()` closed DB connections only on the happy path.
   - Fix: added `finally` cleanup.

## Remaining Watch Items

- `app_storage` is still a broad encrypted blob. That is acceptable for counseling/daily records, but account-critical investment data should continue moving toward normalized tables.
- KIS/Bithumb sync still writes the full app blob after merging. It now starts from the normalized ledger, but a future phase should mirror broker positions/trades directly into normalized tables first.
- `investment_cash_ledger` is written from transaction rows, but current portfolio snapshots still treat cash as a position plus account balance. This is workable short term, but the eventual ledger model should make cash balance a derived account field.
- There is no explicit schema migration table. `CREATE TABLE IF NOT EXISTS` is enough for first installs, but future column changes need a small `schema_migrations` mechanism.
