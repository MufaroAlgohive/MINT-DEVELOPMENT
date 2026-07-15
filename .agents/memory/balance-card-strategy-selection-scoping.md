---
name: Balance card per-strategy selection scoping
description: SwipeableBalanceCard dropdown selection must scope every basket-derived value to the selected strategy only — not the whole portfolio.
---

## The rule
In `src/components/SwipeableBalanceCard.jsx`, when the asset dropdown has a specific
strategy selected (`selectedAsset.isStrategy`), every downstream calculation that is
"basket-scoped" must filter to that ONE strategy's id:
- `parentStrategyKey` (drives both the 5D/M `client_strategy_returns_c` basket-value
  query AND which strategy ids get summed) must resolve to just the selected
  strategy's id, not the joined set of every strategy the user owns.
- YTD/ALL cost basis must use the selected strategy's own cost basis
  (`selectedAsset.maxOfCostBasis`, i.e. that strategy's `invested_amount + buffer +
  residual - realized`), never `dbData.totalInvested` (the whole-portfolio figure).

**Why:** Before the fix, selecting a single basket only filtered the displayed live
market value — the YTD cost-basis and 5D/M basket-anchor queries silently stayed
scoped to ALL of the user's baskets combined. Comparing one basket's live value
against every basket's combined cost basis produces impossible numbers (e.g. a basket
bought the day before showing "-96.7% YTD"). It also let a freshly-bought basket with
too few trading-day rows bypass the "insufficient data" guard for 5D/M, because the
row count included another basket's longer history.

**How to apply:** `selectedStrategyId = selectedAsset?.isStrategy ? (selectedAsset.strategyId || selectedAsset.strategy_id) : null` — use this everywhere a basket-scoped query or cost-basis lookup is made when an asset is selected. Falls back to the full portfolio scope only for the explicit "All Baskets" (selectedAsset === null) option.

## Related
- Dropdown needs an explicit "All Baskets" option (`setSelectedAsset(null)`) — previously there was no way to return to the aggregate view once a specific basket was selected via the dropdown, and the button label incorrectly showed a strategy's name even while displaying aggregate data.
