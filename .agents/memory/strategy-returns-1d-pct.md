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

## Chain-linked YTDs (as of Jul 14 2026, from stored basket_value chain)
| Strategy | YTD |
|---|---|
| ETF Basket | +13.53% |
| MINT Famous Brands | +12.96% |
| Yield Basket | +18.66% |
| MINT Diversified | +11.36% |
| MyGrowthFund | (see live) |
| UCT | +3.25% |
| MINT Multi-sector | −1.94% |
| Blended Focus | −3.11% |
