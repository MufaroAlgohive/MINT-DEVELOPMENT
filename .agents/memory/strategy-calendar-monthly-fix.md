---
name: Strategy calendar monthly return method
description: How getStrategyMonthlyReturnsFromDB computes per-month returns and why rebalance months were wrong.
---

## Rule
- **Inception month**: use `basket_value` start→end (captures user's real entry price vs month-end market value).
- **All subsequent months**: chain-multiply daily `1d_pct` from `client_strategy_returns_c` — NOT basket_value deltas.

**Why:**
`basket_value` is the sum of open position values only. When a rebalance sell happens, the sold position disappears from `basket_value` immediately but the cash proceeds sit in `strategy_rebalance_residuals` — not in `basket_value`. This makes any month containing a rebalance look far worse than reality (e.g. Absa sold Jul 14 → basket_value dropped -11.6% that day, making July look like -19.31% when the real market-move return was -2.86%).

The `1d_pct` column in `client_strategy_returns_c` is written from market prices only and stays near-zero on rebalance days, so chaining it gives the true return without rebalance distortion.

**How to apply:**
In `getStrategyMonthlyReturnsFromDB` in `src/lib/strategyData.js` — the inception month (i===0) branch uses basket_value; all other months (i>0) use `pcts.reduce((prod, pct) => prod * (1 + pct/100), 1) - 1`.

## Also fixed simultaneously
`getOverallPortfolioMonthlyReturns`: removed the `/ totalWeight` re-normalisation. The weighted sum is already portfolio-weighted; dividing by totalWeight again inflates months where only a subset of strategies have data.
