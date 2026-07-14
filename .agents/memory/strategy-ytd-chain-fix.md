---
name: Strategy YTD chain fix
description: Why ytd_pct must be chain-linked and the bugs that prevented it from working correctly
---

## The rule
`strategies_returns_c.ytd_pct` must be stored as the chain-linked product of all `1d_pct` rows from year-start, NOT as `basketYtdReturn(holdings)` (current template × Dec-31 anchor). The anchor formula is wrong for any rebalanced strategy.

## The computation (server: computeAndSaveStrategyReturns)
- Fetch each strategy's year-to-date rows in PARALLEL (one query per strategy).
- Chain-multiply all non-null `1d_pct` values in ascending date order.
- Today's ytd = `(chainPrev × (1 + oneDayPct/100) - 1) × 100`.
- Fallback to `basketYtdReturn` only when no prior rows exist (new strategy).

## Two bugs that broke the first attempt

### 1. Supabase 1000-row hard cap
PostgREST hard-caps every response at 1000 rows regardless of `.limit()`. With 9 strategies × ~130 rows ≈ 1170 rows, a single `.in('strategy_id', ids)` bulk query is silently truncated. Each strategy only got ~111 rows (missing the first ~18 days of the year), causing wrong chain values.

**Fix:** fetch per strategy with `Promise.all()` — each query returns ~130 rows, well under the cap.

### 2. Jun 3 null 1d_pct (Yahoo bad-data incident)
Yield Basket and MINT Multi-sector had `1d_pct = null` on Jun 3, 2026 due to the Jun-2026 Yahoo bad-data recovery. The Jun 3 basket_values were correct (real corrected prices), but 1d_pct was nulled.

- Yield Basket: May 29 basket=236,468c → Jun 3 basket=196,284c → 1d_pct = −16.993%
- MINT Multi-sector: Jun 2 basket=278,091c → Jun 3 basket=249,632c → 1d_pct = −10.234%

These were UPDATEd directly in the DB. Skipping them caused Yield Basket chain to be inflated by ~+5pp and MINT Multi-sector losses understated.

## Why the methodology differs from user's "expected" values
User's expected values (Yield +12.10%, Multi −4.22%, etc.) came from an offline EOD-based weighted-average computation using stock_returns_c individual security ytd_pct, weighted by current basket composition. This is a third methodology distinct from both chain and anchor-formula. The chain is the authoritative value (matches Factsheet calendar).
