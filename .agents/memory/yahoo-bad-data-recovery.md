---
name: Yahoo bad-data recovery
description: Playbook for JSE strategy returns corruption — anchor unit mismatch (BOX.JO) and EOD price spikes (Jul 2026 incidents)
---

## BOX.JO anchor unit mismatch (Jul 13 2026)

Yahoo Finance returns BOX.JO historical prices in Rand, not ZAp, for the Dec-31 period.
`Math.round(71.35)` = 71 instead of 7135. Fix: DB-first anchors in `computeAndSaveStrategyReturns`.

**All 35 strategy securities** now load Dec-31 anchors from `stock_returns_c` (where `as_of_date = '2025-12-31'`).
Yahoo is only called as last resort. A provider-agnostic unit sanity check (ratio < 0.05 → ×100) catches any future Rand vs ZAp mismatch.

## EOD spike recovery playbook (FSR/NPN/AGL/SBK Jul 13 2026 pattern)

1. Query `stock_returns_c` for today vs previous trading day. Flag symbols with >20% move.
2. PATCH `stock_returns_c` bad rows back to previous day's `current_price` and `ytd_pct`.
3. PATCH `securities_c.last_price` for bad symbols back to previous day's price.
4. DELETE `strategies_returns_c` rows with `as_of_date = '<today>'`.
5. Restart server — 60s startup cron re-runs `computeAndSaveStrategyReturns` automatically.

## Guards in place (post Jul 13 2026)

- **Anchor**: DB-first from `stock_returns_c` Dec-31; unit sanity check on any external value
- **Compute guard**: cross-day YTD spike threshold ±15pp — blocked strategies keep previous day's value
- **Intraday guard**: `fetchYahooPrice` rejects >20% single-session moves (unchanged)
- **Status endpoint**: `GET /api/strategy-returns/status` (admin key) shows latest vs prev YTD per strategy

## securities_c.last_price write source

Not in `server/index.cjs`. It is written by an external process (likely an external data pipeline or Supabase trigger). The server only reads this column. The strategy YTD computation deliberately avoids it and uses `stock_intraday_c` instead.
