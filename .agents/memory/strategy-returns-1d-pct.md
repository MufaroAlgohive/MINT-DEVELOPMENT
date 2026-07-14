---
name: Strategy returns 1d_pct architecture
description: How basket_value and 1d_pct are computed and stored for the strategy calendar/YTD badge, including the Jun 2026 rebalance and bad-data history.
---

## Rule
`strategies_returns_c` stores `basket_value` (sum of shares × intraday price, cents) and `1d_pct` (today_basket / yesterday_basket − 1) for every trading day. The frontend calendar chain-multiplies `1d_pct` per month; YTD badge is also computed via chain-multiplication — do NOT read `ytd_pct` column for display.

**Why:** `ytd_pct` always uses the CURRENT template back to Dec 31, so any rebalanced strategy shows a wrong number. `basket_value` captures the actual portfolio value at each day (old template → new template), making the chain-linked `1d_pct` correct across rebalances automatically.

## Server computation (computeAndSaveStrategyReturns)
- Computes `basket_value` = Σ(shares × latestIntraday || prevEOD) cents
- Computes `1d_pct` = (today_basket − prev.basket_value) / prev.basket_value × 100
- `prev.basket_value` comes from the most recent stored row before today (already in prevYtdMap, extended to include basket_value)
- Runs at market open (07:00 UTC), close (15:30 UTC), and 60s after startup

## Frontend (FactsheetPage.jsx)
- Calendar: chain-multiply daily `1d_pct` within each month: `(1+r1)(1+r2)…(1+rN) − 1`
- YTD badge: chain-multiply ALL `1d_pct` rows for the year (not `ytd_pct` column)
- Null `1d_pct` rows treated as 0% (correct — data missing, skip day)

## Corruption guard
Jun 3 2026: three strategies had corrupted `1d_pct` values (−18%, −59%, −10%) from:
- MINT Diversified: template updated in DB before trade date (template changed Jun 3, trade dated Jun 18)
- Yield Basket: Yahoo bad prices on Jun 1-2 inflated the basket; Jun 3 was correction day
- MINT Multi-sector: same bad-data incident
→ Jun 1, 2, 3 `1d_pct` nulled for these strategies (treated as 0% in chain)

## Composition log
Historical compositions live in `cc_audit_log` (table=strategies_c, full old_row/new_row JSON).
`strategy_composition_log_c` table: run `server/scripts/supabase-composition-log.sql` in Supabase SQL Editor, then `node server/scripts/seed-composition-log.cjs` to seed.
App-level logging hook: `_logStrategyCompositionChange(db, stratId, newHoldings)` in server/index.cjs — call whenever a strategy's holdings are updated via the API.
pgPool = local PostgreSQL — cannot create Supabase tables via pgPool.

## Spike guard architecture (updated Jul 14 2026)
**Old guard (wrong):** compared new `ytd_pct` vs stored `prev.ytd_pct`. Failed when a corrupt row was
deleted or the formula changed — legitimate corrections got blocked (MINT Famous Brands stuck at 29.46%).

**New guard:** compare `oneDayPct` (daily basket change) against ±15%. Formula-agnostic, won't fire
on day-after-deletion scenarios, won't fire when corrupt prev rows are removed.

**Why 15%:** A diversified equity basket cannot legitimately move 15% in one trading day.
Bad prices that slip through the per-symbol 20% anomaly guard still cannot shift the whole basket 15%.

## Corrupt Jul 13 2026 rows (resolved)
MINT Famous Brands (UUID: 1afcd1ce-9a03-4b67-ae78-99fb69602ce3) and Test Strategy
(UUID: 26daf728-8e95-4ff0-b9e7-69b382b0bb8c) had inflated ytd_pct (29.46% / 25.33%) from the
BOX.JO unit bug on Jul 13. Deleted those rows → spike guard baseline reverted to Jul 10.
After fix: MINT Famous Brands = 12.96%, Test Strategy = 10.58%, saved: 9, blocked: 0.

## ytd_pct column vs 1d_pct chain
- `ytd_pct` column: current template × Dec-31 anchor (fast; wrong for rebalanced strategies)
- `1d_pct` chain: basket_value ratio day-over-day (correct across rebalances)
- Factsheet calendar and YTD badge: use 1d_pct chain (frontend)
- Strategy cards elsewhere: read ytd_pct column (consistent with historical data, acceptable)
