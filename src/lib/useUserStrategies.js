import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { higherOfCostPerShareRands, fetchStrategyCashCents } from "./strategyValuation";
import { getStrategyPriceHistory } from "./strategyData";
import { registerCacheResetCallback } from "./userCacheReset.js";
import { fetchApprovedReturns, clearApprovedReturnsCache } from "./approvedReturns.js";

// Cost basis per share in Rands for a snapshot/holding row.
// Prefers Expected_fill (the price the client saw at click time, in rands) over
// avg_fill (broker fill in cents). Once admin updates the returns job to write
// Expected_fill into the snapshot, this picks it up automatically.
const costBasisRandsPerShare = (h) => {
  const expected = Number(h?.Expected_fill ?? h?.expected_fill ?? 0);
  if (expected > 0) return expected;
  const avgFillCents = Number(h?.avg_fill || 0);
  return avgFillCents > 0 ? avgFillCents / 100 : 0;
};

// Module-level cache — survives unmount/remount when navigating between tabs,
// so the Portfolio page shows last known strategies instead of an empty skeleton.
// Keyed by familyMemberId (or 'parent' for the main account) so child and parent
// caches NEVER bleed into each other when the user switches accounts.
const _cachedStrategiesDataMap = {};

export function clearUserStrategiesCache() {
  Object.keys(_cachedStrategiesDataMap).forEach(k => delete _cachedStrategiesDataMap[k]);
  clearApprovedReturnsCache();
}

registerCacheResetCallback(clearUserStrategiesCache);

// familyMemberId: pass a child's family_members.id to see THAT child's strategies;
// omit (or pass null) for the parent's own strategies. Either way the leak is
// closed — parent and child rows in client_strategy_returns_c stay separate.
export const useUserStrategies = (familyMemberId = null) => {
  const cacheKey = familyMemberId || 'parent';
  const [data, setData] = useState(_cachedStrategiesDataMap[cacheKey] || {
    strategies: [],
    selectedStrategy: null,
    loading: true,
    error: null,
  });

  const fetchUserStrategies = useCallback(async (silent = false) => {
    if (!supabase) {
      setData((prev) => ({ ...prev, loading: false, error: "Database not connected" }));
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setData({ strategies: [], selectedStrategy: null, loading: false, error: null });
        return;
      }

      const userId = session.user.id;

      // Query client_strategy_returns_c and strategies_c directly —
      // avoids /api/user/strategies which joins the deleted strategy_metrics table.
      let returnsQuery = supabase
        .from("client_strategy_returns_c")
        .select("strategy_id, basket_value, holdings_snapshot, as_of_date, ytd_pct, inception_pnl")
        .eq("user_id", userId);
      returnsQuery = familyMemberId
        ? returnsQuery.eq("family_member", familyMemberId)
        : returnsQuery.is("family_member", null);

      /* Per-strategy residual cash from rebalances. Each row's balance_cents
         counts toward that strategy's "current value" so the user sees their
         cash portion alongside their positions. Scoped:
         - parent view (familyMemberId null): rows where family_member_id IS NULL
         - child view (familyMemberId set):  rows where family_member_id = id */
      let residualQuery = supabase
        .from("strategy_rebalance_residuals")
        .select("strategy_id, balance_cents")
        .eq("user_id", userId);
      residualQuery = familyMemberId
        ? residualQuery.eq("family_member_id", familyMemberId)
        : residualQuery.is("family_member_id", null);

      /* Closed positions (rebalance sells / replacements) carry the REALISED P&L.
         Same basis as the returns job's inception_pnl: (avg_exit − avg_fill) × qty,
         both in cents. Lets us split total P&L into realised vs unrealised. */
      let closedQuery = supabase
        .from("stock_holdings_c")
        .select("strategy_id, quantity, avg_fill, avg_exit, transaction_id")
        .eq("user_id", userId)
        .eq("is_active", false);
      closedQuery = familyMemberId
        ? closedQuery.eq("family_member_id", familyMemberId)
        : closedQuery.is("family_member_id", null);

      /* Open positions — used to value the strategy at LIVE intraday prices
         (more accurate than the EOD basket_value snapshot, and matches the CRM). */
      let activeQuery = supabase
        .from("stock_holdings_c")
        .select("strategy_id, security_id, quantity, transaction_id, avg_fill, Expected_fill, Fill_date, market_value")
        .eq("user_id", userId)
        .eq("is_active", true)
        .eq("trade_side", "BUY");
      activeQuery = familyMemberId
        ? activeQuery.eq("family_member_id", familyMemberId)
        : activeQuery.is("family_member_id", null);

      const [allReturnsResult, strategiesResult, residualResult, closedResult, activeResult, approvedReturns] = await Promise.all([
        returnsQuery.order("as_of_date", { ascending: false }),
        supabase
          .from("strategies_c")
          .select("id, name, short_name, description, risk_level, sector, icon_url, image_url, holdings")
          .eq("status", "active"),
        residualQuery,
        closedQuery,
        activeQuery,
        fetchApprovedReturns(session, familyMemberId),
      ]);

      /* Value positions straight from holdings (NOT the EOD returns snapshot):
         live price (stock_intraday_c.current_price, cents) × qty, with cost basis
         on the HIGHER-OF rule max(Expected_fill, avg_fill/100). Only FILLED holdings
         (avg_fill > 0 && Fill_date set) count. A strategy appears the moment it has
         filled holdings — no client_strategy_returns_c row needed. */
      const activeRows = (activeResult?.data || []).filter(
        (r) => r?.strategy_id && Number(r.avg_fill) > 0 && r.Fill_date != null
      );
      const liveSecIds = [...new Set(activeRows.map((r) => r.security_id).filter(Boolean))];
      const livePxById = {};
      const secSymbolById = {};
      if (liveSecIds.length > 0) {
        const [{ data: intradayRows }, { data: secRows }] = await Promise.all([
          supabase.from("stock_intraday_c").select("security_id, current_price").in("security_id", liveSecIds).order("timestamp", { ascending: false }),
          supabase.from("securities_c").select("id, symbol").in("id", liveSecIds),
        ]);
        (intradayRows || []).forEach((row) => { if (livePxById[row.security_id] == null) livePxById[row.security_id] = Number(row.current_price) || 0; });
        (secRows || []).forEach((s) => { secSymbolById[s.id] = s.symbol; });
      }

      const positionsByStrategy = {};   // live value (rands)
      const costBasisByStrategy = {};    // higher-of cost basis (rands)
      const holdingPnlBySymbol = {};     // per-strategy → per-symbol P&L for the holdings list
      activeRows.forEach((r) => {
        const sid = r.strategy_id;
        const qty = Math.abs(Number(r.quantity || 0));
        const pxCents = livePxById[r.security_id] || 0;
        const costPerShare = higherOfCostPerShareRands(r);
        const liveVal = pxCents > 0 ? (pxCents / 100) * qty : costPerShare * qty; // fall back to cost if no live px
        const costVal = costPerShare * qty;
        positionsByStrategy[sid] = (positionsByStrategy[sid] || 0) + liveVal;
        costBasisByStrategy[sid] = (costBasisByStrategy[sid] || 0) + costVal;
        const sym = secSymbolById[r.security_id];
        if (sym) {
          const pr = liveVal - costVal;
          (holdingPnlBySymbol[sid] = holdingPnlBySymbol[sid] || {})[sym] = {
            pnlRands: Number(pr.toFixed(2)),
            pnlPct: costVal > 0 ? Number(((pr / costVal) * 100).toFixed(2)) : 0,
          };
        }
      });
      const activeStrategyIds = Object.keys(positionsByStrategy);

      /* Held 8% buffer (reserve) per strategy — shared single source of truth
         (strategyValuation.js). Residual is fetched separately below, so skip it
         here. Cents → rands for this hook's downstream math. */
      const { bufferCentsByStrategy } = await fetchStrategyCashCents({
        userId,
        familyMemberId,
        strategyIds: activeStrategyIds,
        activeHoldings: activeRows,
        includeResidual: false,
      });
      const bufferRandsByStrategy = {};
      Object.entries(bufferCentsByStrategy).forEach(([sid, cents]) => { bufferRandsByStrategy[sid] = cents / 100; });

      if (allReturnsResult.error) {
        console.error("[useUserStrategies] Error fetching returns:", allReturnsResult.error);
        setData((prev) => ({ ...prev, loading: false, error: allReturnsResult.error.message }));
        return;
      }

      const approvedClientRows = approvedReturns?.client_returns || [];
      const approvedStrategyIds = new Set(approvedClientRows.map((row) => row.strategy_id));
      const allReturns = [
        ...approvedClientRows.slice().reverse().map((row) => ({
          ...row,
          basket_value: row.complete_nav_cents,
          ytd_pct: row.gross_strategy_twr_pct,
          inception_pnl: row.strategy_pnl_cents,
          approved_repair: true,
        })),
        ...(allReturnsResult.data || []).filter((row) => !approvedStrategyIds.has(row.strategy_id)),
      ];

      const residualRandsByStrategy = {};
      (residualResult?.data || []).forEach((row) => {
        if (!row?.strategy_id) return;
        residualRandsByStrategy[row.strategy_id] = Number(row.balance_cents || 0) / 100;
      });

      // Accumulated realised P&L per strategy from closed positions (rands).
      const realizedRandsByStrategy = {};
      (closedResult?.data || []).forEach((row) => {
        if (!row?.strategy_id) return;
        const fill = Number(row.avg_fill || 0);
        const exit = Number(row.avg_exit || 0);
        const qty = Number(row.quantity || 0);
        if (!fill || !exit || !qty) return;
        realizedRandsByStrategy[row.strategy_id] =
          (realizedRandsByStrategy[row.strategy_id] || 0) + ((exit - fill) / 100) * qty;
      });

      // Build latest-row and oldest-row per strategy (allReturns is desc order)
      const latestByStrategy = {};
      const oldestByStrategy = {};
      for (const row of allReturns) {
        if (!latestByStrategy[row.strategy_id]) {
          latestByStrategy[row.strategy_id] = row;
        }
        oldestByStrategy[row.strategy_id] = row; // last one written wins = oldest
      }

      // Map strategies_c by id for O(1) lookup
      const strategiesMap = {};
      for (const s of (strategiesResult.data || [])) {
        strategiesMap[s.id] = s;
      }

      const formattedStrategies = activeStrategyIds.map((strategyId) => {
        const returnsRow = latestByStrategy[strategyId] || {}; // chart/YTD only
        const stratMeta = strategiesMap[strategyId] || {};
        const oldestRow = oldestByStrategy[strategyId];

        const residualVal = Number((residualRandsByStrategy[strategyId] || 0).toFixed(2));
        const bufferVal = Number((bufferRandsByStrategy[strategyId] || 0).toFixed(2));
        /* Cash element of the strategy for THIS user = rebalance residual + the
           held 8% buffer (reserve). It's the user's money sitting as cash in the
           strategy, so it counts toward portfolio value. */
        const cashElement = Number((residualVal + bufferVal).toFixed(2));

        /* Positions value + cost basis come STRAIGHT FROM HOLDINGS (live intraday
           price × qty, higher-of cost basis) — never the client_strategy_returns_c
           snapshot. So a strategy is valued correctly the instant it's bought. */
        const positionsVal = Number((positionsByStrategy[strategyId] || 0).toFixed(2));
        const investedBase = Number((costBasisByStrategy[strategyId] || 0).toFixed(2));
        /* Portfolio value = live positions + cash element (residual + buffer). */
        const approvedRow = returnsRow.approved_repair ? returnsRow : null;
        const currentVal = approvedRow
          ? Number((Number(approvedRow.complete_nav_cents || 0) / 100).toFixed(2))
          : Number((positionsVal + cashElement).toFixed(2));
        /* P&L = realised (locked in from rebalance sells) + unrealised (paper
           gain on the CURRENT open positions). A rebalance just converts
           unrealised → realised, so the TOTAL stays stable across rebalances —
           the gain never "disappears" when sold shares leave the cost basis.
             realised   = Σ(avg_exit − avg_fill)×qty over closed positions
             unrealised = live positions − cost basis of open positions
           invested is then DERIVED from the total so the % return is a stable
           "money in → money out" base that doesn't drift after a rebalance.
           (For a fresh buy with no closed lots this equals cost basis + buffer,
           exactly as before — backward compatible.) */
        const realizedPnl = Number((realizedRandsByStrategy[strategyId] || 0).toFixed(2));
        const unrealizedPnl = Number((positionsVal - investedBase).toFixed(2));
        const totalPnl = approvedRow
          ? Number((Number(approvedRow.strategy_pnl_cents || 0) / 100).toFixed(2))
          : Number((unrealizedPnl + realizedPnl).toFixed(2));
        const invested = approvedRow
          ? Number((Number(approvedRow.opening_performance_nav_cents || 0) / 100).toFixed(2))
          : Number((currentVal - totalPnl).toFixed(2));
        const changePct = invested > 0 ? (totalPnl / invested) * 100 : 0;
        const ytdPctDecimal = returnsRow.ytd_pct != null ? returnsRow.ytd_pct / 100 : null;

        // strategies_c.holdings as base (weight/logo_url); augment with per-asset
        // P&L computed from live holdings (live price vs higher-of cost basis).
        const pnlBySymbol = holdingPnlBySymbol[strategyId] || {};
        const baseHoldings = stratMeta.holdings || [];
        const augmentedHoldings = baseHoldings.map(h => {
          const p = pnlBySymbol[h.symbol] || pnlBySymbol[h.ticker];
          return p ? { ...h, ...p } : h;
        });

        return {
          id: strategyId,
          strategyId,
          name: stratMeta.name || "Unknown Strategy",
          shortName: stratMeta.short_name || stratMeta.name || "Strategy",
          description: stratMeta.description || "",
          riskLevel: stratMeta.risk_level || "Moderate",
          sector: stratMeta.sector || "",
          iconUrl: stratMeta.icon_url || null,
          imageUrl: stratMeta.image_url || null,
          holdings: augmentedHoldings,
          investedAmount: Number(invested.toFixed(2)),
          currentValue: currentVal,
          /* Realised vs unrealised P&L (rands). realised + unrealised = total P&L
             shown by the headline (changePct). */
          totalPnl: Number(totalPnl.toFixed(2)),
          realizedPnl,
          unrealizedPnl,
          /* Cash component surfaced separately so the UI can show
             "Positions R890 + Cash R104.61". cashElement = residual + buffer. */
          positionsValue: positionsVal,
          residualCash: residualVal,
          bufferCash: bufferVal,
          cashElement,
          unitsHeld: 0,
          entryDate: null,
          lastUpdated: returnsRow.as_of_date || null,
          previousMonthChange: parseFloat(changePct.toFixed(1)),
          metrics: null,
          firstInvestedDate: oldestRow?.as_of_date || null,
          ytd_pct: ytdPctDecimal,
          hasReturnsData: !!latestByStrategy[strategyId],
        };
      });

      // ── Live price override ────────────────────────────────────────────────
      // Fetch stock_holdings_c + stock_intraday_c so currentValue and
      // investedAmount match the bottom ALL tab (live price × qty instead of
      // the stale daily basket_value snapshot).
      try {
        // Child mode: filter only by family_member_id (no user_id) — matches ChildDashboardPage.fetchHoldings()
        // Parent mode: filter by user_id + family_member IS NULL
        // Fetch ALL strategy holdings (pending + filled) so we can detect pending-only strategies.
        let holdingsQuery;
        if (familyMemberId) {
          holdingsQuery = supabase
            .from("stock_holdings_c")
            .select("security_id, quantity, avg_fill, Expected_fill, strategy_id, Fill_date")
            .eq("family_member_id", familyMemberId)
            .not("strategy_id", "is", null)
            .eq("Status", "active");
        } else {
          holdingsQuery = supabase
            .from("stock_holdings_c")
            .select("security_id, quantity, avg_fill, Expected_fill, strategy_id, Fill_date")
            .eq("user_id", userId)
            .is("family_member_id", null)
            .not("strategy_id", "is", null)
            .eq("Status", "active");
        }

        const { data: allStratHoldings } = await holdingsQuery;
        // Filled = avg_fill > 0 AND Fill_date set (matches ChildPortfolioTab filter)
        const allLiveHoldings = (allStratHoldings || []).filter(h => Number(h.avg_fill) > 0 && h.Fill_date != null);
        // Pending-only = strategy has holdings but NONE are filled
        const filledStrategyIds = new Set(allLiveHoldings.map(h => h.strategy_id));
        const pendingOnlyStrategyIds = new Set(
          (allStratHoldings || [])
            .filter(h => !(Number(h.avg_fill) > 0))
            .map(h => h.strategy_id)
            .filter(id => !filledStrategyIds.has(id))
        );
        // Mixed = strategy has BOTH filled holdings AND new pending ones (re-buy scenario)
        const mixedPendingStrategyIds = new Set(
          (allStratHoldings || [])
            .filter(h => !(Number(h.avg_fill) > 0))
            .map(h => h.strategy_id)
            .filter(id => filledStrategyIds.has(id))
        );

        const secIds = [...new Set(allLiveHoldings.map(h => h.security_id).filter(Boolean))];

        let livePriceMap = {};
        if (secIds.length > 0) {
          const { data: intradayRows } = await supabase
            .from("stock_intraday_c")
            .select("security_id, current_price")
            .in("security_id", secIds)
            .order("timestamp", { ascending: false });
          for (const row of (intradayRows || [])) {
            if (!livePriceMap[row.security_id]) {
              livePriceMap[row.security_id] = Number(row.current_price); // cents
            }
          }
        }

        for (const strat of formattedStrategies) {
          const stratHoldings = allLiveHoldings.filter(h => h.strategy_id === strat.strategyId);

          // Strategy has only pending holdings — show R0 until admin fills the order
          if (stratHoldings.length === 0 && pendingOnlyStrategyIds.has(strat.strategyId)) {
            strat.currentValue = 0;
            strat.positionsValue = 0;
            strat.investedAmount = 0;
            strat.isPending = true;
            continue;
          }

          if (stratHoldings.length === 0) continue;

          // NOTE: the strategy's value (live positions + 8% buffer + residual) and
          // cost basis are ALREADY set by the holdings-driven computation above
          // (positionsByStrategy / costBasisByStrategy / cashElement). Do NOT
          // re-derive/overwrite them here — main's old live-override valued
          // positions only, which dropped the buffer. This loop now only flags
          // pending batches so they can be hidden from the strategies tab.

          // Strategy has a new pending batch on top of existing filled holdings
          if (mixedPendingStrategyIds.has(strat.strategyId)) {
            strat.hasPendingBatch = true;
          }
        }
      } catch (liveErr) {
        console.warn("[useUserStrategies] Live price fetch failed, keeping snapshot values:", liveErr.message);
      }
      // ── end live price override ────────────────────────────────────────────

      // Pending-ONLY strategies (no filled holdings yet) are hidden — they appear
      // on the home tab's Pending orders section until the broker fills them.
      // MIXED strategies (existing filled holdings + a new pending re-buy) ARE kept:
      // the filled portion is real and is valued filled-only (positionsByStrategy /
      // costBasisByStrategy already exclude the pending batch, and the buffer is
      // computed from filled holdings' transactions only). This keeps the home
      // "best performing" card and the portfolio tab in agreement with the purple
      // balance card. The pending batch still shows separately in Pending orders.
      const visibleStrategies = formattedStrategies.filter(s => !s.isPending);
      const nextData = {
        strategies: visibleStrategies,
        selectedStrategy: visibleStrategies[0] || null,
        loading: false,
        error: null,
      };
      // Persist so re-mounts (e.g. navigating back) skip the skeleton.
      // Keyed by cacheKey so parent and child caches stay isolated.
      _cachedStrategiesDataMap[cacheKey] = nextData;
      setData(nextData);

    } catch (err) {
      console.error("Error fetching strategies:", err);
      setData((prev) => ({
        ...prev,
        loading: false,
        error: err.message,
      }));
    }
  }, [familyMemberId]);

  const selectStrategy = useCallback((strategy) => {
    setData((prev) => ({ ...prev, selectedStrategy: strategy }));
  }, []);

  useEffect(() => {
    fetchUserStrategies();

    // Safety timer — release the skeleton after 6 s even if the API is slow/hanging
    const safetyTimer = setTimeout(() => {
      setData((prev) => prev.loading ? { ...prev, loading: false } : prev);
    }, 6000);

    // Silent refresh every 15 s — keeps live P&L in sync with the top balance card
    const pollId = setInterval(() => fetchUserStrategies(true), 15000);

    return () => {
      clearTimeout(safetyTimer);
      clearInterval(pollId);
    };
  }, [fetchUserStrategies]);

  return { ...data, selectStrategy, refetch: fetchUserStrategies };
};

// familyMemberId: pass a child's id for that child's chart; omit for parent's chart.
export const useStrategyChartData = (strategyId, timeFilter = "W", purchaseDate = null, userId = null, familyMemberId = null) => {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchChartData = async () => {
      if (!strategyId) {
        setLoading(false);
        return;
      }

      setLoading(true);

      let resolvedUserId = userId;
      if (!resolvedUserId && supabase) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          resolvedUserId = session?.user?.id || null;
        } catch {}
      }

      if (resolvedUserId && supabase) {
        try {
          const now = new Date();
          const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const DAY_NAMES_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
          // Build a P&L chart from an ascending [{as_of_date, pnl_cents}] series,
          // window-relative to the first point (so 5D/M show the change over the
          // window, ALL shows the full trajectory from ~0).
          const buildChart = (pts) => {
            const base = pts.length ? (pts[0].pnl_cents || 0) : 0;
            const out = [{ day: null, value: 0, fullDate: null }];
            pts.forEach(row => {
              const [y, m, d] = row.as_of_date.split("-").map(Number);
              const dow = new Date(y, m - 1, d).getDay();
              out.push({
                day: `${d} ${MONTH_NAMES[m - 1]} '${String(y).slice(-2)}`,
                value: Number(((row.pnl_cents - base) / 100).toFixed(2)),
                fullDate: `${DAY_NAMES_SHORT[dow]}, ${d} ${MONTH_NAMES[m - 1]} ${y}`,
              });
            });
            return out;
          };
          const windowFilter = (rowsAsc) => {
            if (timeFilter === "D") return rowsAsc.slice(-2);
            if (timeFilter === "5d") return rowsAsc.slice(-5);
            if (timeFilter === "m") { const f = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().split("T")[0]; return rowsAsc.filter(r => r.as_of_date >= f); }
            if (timeFilter === "ytd") { const f = `${now.getFullYear()}-01-01`; return rowsAsc.filter(r => r.as_of_date >= f); }
            return rowsAsc; // all
          };

          // Canonical source first: /api/returns/approved carries the repaired /
          // published personal chain. Plot cumulative performance P&L
          // (inception_pnl_cents) so the line matches the headline return and is
          // free of fee/cash-timing noise. Falls through to the legacy table only
          // when the owner has no canonical rows.
          try {
            const { data: { session: chartSession } } = await supabase.auth.getSession();
            const approved = await fetchApprovedReturns(chartSession, familyMemberId);
            const canonical = (approved?.client_returns || [])
              .filter(r => r.strategy_id === strategyId && r.as_of_date)
              .map(r => ({ as_of_date: String(r.as_of_date).slice(0, 10), pnl_cents: Number(r.inception_pnl_cents ?? r.strategy_pnl_cents ?? 0) }))
              .sort((a, b) => (a.as_of_date < b.as_of_date ? -1 : 1));
            if (canonical.length > 0) {
              setChartData(buildChart(windowFilter(canonical)));
              setLoading(false);
              return;
            }
          } catch (_) { /* fall through to legacy */ }

          let query = supabase
            .from("client_strategy_returns_c")
            .select("as_of_date, basket_value")
            .eq("user_id", resolvedUserId)
            .eq("strategy_id", strategyId)
            .order("as_of_date", { ascending: false });
          query = familyMemberId
            ? query.eq("family_member", familyMemberId)
            : query.is("family_member", null);

          if (timeFilter === "D") {
            query = query.limit(2);
          } else if (timeFilter === "5d") {
            query = query.limit(5);
          } else if (timeFilter === "m") {
            const fromDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
            query = query.gte("as_of_date", fromDate.toISOString().split("T")[0]);
          } else if (timeFilter === "ytd") {
            query = query.gte("as_of_date", `${now.getFullYear()}-01-01`);
          } else if (timeFilter === "all") {
            // no date restriction — fetch full history
          }

          const { data: rows, error } = await query;

          if (!error && rows && rows.length > 0) {
            const ascending = [...rows].reverse();
            // Legacy semantics preserved: P&L relative to the first basket in window.
            setChartData(buildChart(ascending.map(r => ({ as_of_date: r.as_of_date, pnl_cents: Number(r.basket_value || 0) }))));
            setLoading(false);
            return;
          }
        } catch (err) {
          console.warn("[useStrategyChartData] client_strategy_returns_c error, falling back to price history:", err);
        }
      }

      const timeframeMap = {
        "D": "1D",
        "W": "1W",
        "M": "1M",
        "ALL": "1Y",
        "5d": "1W",
        "m": "1M",
        "ytd": "1Y",
        "all": "1Y",
      };

      const timeframe = timeframeMap[timeFilter] || "1D";

      try {
        const priceHistory = await getStrategyPriceHistory(strategyId, timeframe);

        if (!priceHistory || priceHistory.length === 0) {
          setChartData([]);
          setLoading(false);
          return;
        }

        let filteredHistory = priceHistory;
        if (purchaseDate) {
          const purchaseDateStr = purchaseDate.slice(0, 10);
          const afterPurchase = priceHistory.filter(p => p.ts.split("T")[0] >= purchaseDateStr);
          if (afterPurchase.length >= 1) {
            filteredHistory = afterPurchase;
          } else {
            const beforePurchase = priceHistory.filter(p => p.ts.split("T")[0] < purchaseDateStr);
            if (beforePurchase.length > 0) {
              const lastKnown = beforePurchase[beforePurchase.length - 1];
              filteredHistory = [lastKnown, { ...lastKnown, ts: purchaseDateStr + "T00:00:00Z" }];
            } else {
              filteredHistory = priceHistory.slice(-1);
            }
          }
        }

        setChartData(formatChartData(filteredHistory, timeFilter));

      } catch (err) {
        console.error("Error fetching chart data:", err);
        setChartData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchChartData();
  }, [strategyId, timeFilter, purchaseDate, userId, familyMemberId]);

  return { chartData, loading };
};

// familyMemberId: pass a child's id for that child's period returns; omit for parent's.
export const useStrategyPeriodReturns = (userId, strategyId, activeTab = "m", familyMemberId = null) => {
  const [returnData, setReturnData] = useState({ pnl: 0, pct: 0, basketValue: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchPeriodReturns = async () => {
      if (!userId || !strategyId || !["D", "5d", "m", "ytd"].includes(activeTab)) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const columnMap = {
          "D": { pnl: "1d_pnl", pct: "1d_pct" },
          "5d": { pnl: "5d_pnl", pct: "5d_pct" },
          "m": { pnl: "1m_pnl", pct: "1m_pct" },
          "ytd": { pnl: "ytd_pnl", pct: "ytd_pct" }
        };

        const columns = columnMap[activeTab];

        // Use today's date — stored P&L columns (1m_pnl, 5d_pnl, ytd_pnl) are
        // pre-computed daily with correct calendar lookback; capping to the last
        // weekday on a Sunday would fetch Friday's row whose anchor is 2 days older.
        const todayStr = new Date().toISOString().split("T")[0];

        let query = supabase
          .from("client_strategy_returns_c")
          .select("*")
          .eq("user_id", userId)
          .eq("strategy_id", strategyId)
          .lte("as_of_date", todayStr);
        query = familyMemberId
          ? query.eq("family_member", familyMemberId)
          : query.is("family_member", null);

        const { data, error } = await query
          .order("as_of_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          const pnlValue = data[columns.pnl] || 0;
          const pctValue = data[columns.pct] || 0;
          const basketValue = (Number(data.basket_value || 0)) / 100;
          setReturnData({
            pnl: (Number(pnlValue)) / 100,
            pct: Number(pctValue),
            basketValue: basketValue
          });
        } else {
          setReturnData({ pnl: 0, pct: 0, basketValue: 0 });
        }
      } catch (err) {
        console.warn("[useStrategyPeriodReturns] Error fetching period returns:", err);
        setReturnData({ pnl: 0, pct: 0, basketValue: 0 });
      } finally {
        setLoading(false);
      }
    };

    fetchPeriodReturns();
  }, [userId, strategyId, activeTab, familyMemberId]);

  return { returnData, loading };
};

// ── useStrategyLivePeriodReturn ───────────────────────────────────────────────
// Single source of truth for 5D / M / YTD period P&L on the portfolio tab.
// Mirrors the purple card's (SwipeableBalanceCard parent-mode) computation
// exactly: cash-adjusted anchor, trading-day-aware lookback, same live total.
// Pass familyMemberId to use child mode (no buffer/residual, basket-only comparison).
export const useStrategyLivePeriodReturn = (userId, strategyId, activeTab, investedAmount, familyMemberId = null) => {
  const [returnData, setReturnData] = useState({ pnl: 0, pct: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId || !strategyId || !["5d", "m", "ytd"].includes(activeTab)) {
      setReturnData({ pnl: 0, pct: 0 });
      return;
    }

    let cancelled = false;
    setLoading(true);

    const run = async () => {
      try {
        if (familyMemberId) {
          // ── CHILD MODE ───────────────────────────────────────────────────────
          // Step 1: active child holdings
          const { data: activeHlds } = await supabase
            .from("stock_holdings_c")
            .select("security_id, quantity, avg_fill, Expected_fill")
            .eq("family_member_id", familyMemberId)
            .eq("strategy_id", strategyId)
            .eq("is_active", true);

          const holdings = (activeHlds || []).filter(h => Number(h.quantity || 0) > 0);
          const securityIds = [...new Set(holdings.map(h => h.security_id).filter(Boolean))];

          // Step 2: latest intraday prices
          const { data: intradayRows } = securityIds.length > 0
            ? await supabase
                .from("stock_intraday_c")
                .select("security_id, current_price")
                .in("security_id", securityIds)
                .order("timestamp", { ascending: false })
            : { data: [] };

          if (cancelled) return;

          const latestPriceMap = {};
          (intradayRows || []).forEach(row => {
            if (!latestPriceMap[row.security_id])
              latestPriceMap[row.security_id] = Number(row.current_price || 0);
          });

          let livePositionsCents = 0;
          let costBasisRands = 0;
          holdings.forEach(h => {
            const qty = Number(h.quantity || 0);
            const priceCents = latestPriceMap[h.security_id] || 0;
            livePositionsCents += Math.round(priceCents * qty);
            const ef = Number(h.Expected_fill || 0);
            const af = Number(h.avg_fill || 0);
            costBasisRands += (ef > 0 ? ef : af / 100) * qty;
          });

          const liveTotalRands = livePositionsCents / 100;

          // YTD / ALL: live basket minus cost basis
          if (activeTab === "ytd") {
            if (costBasisRands <= 0) { if (!cancelled) setReturnData({ pnl: 0, pct: 0 }); return; }
            const pnl = parseFloat((liveTotalRands - costBasisRands).toFixed(2));
            const pct = parseFloat(((pnl / costBasisRands) * 100).toFixed(4));
            if (!cancelled) setReturnData({ pnl, pct });
            return;
          }

          // 5D / M: trading-day-aware basket comparison (no cash adjustment for children)
          const rowLimit = activeTab === "5d" ? 5 : 22;
          const FETCH_LIMIT = rowLimit * 4 + 15;

          const { data: basketRows } = await supabase
            .from("client_strategy_returns_c")
            .select("as_of_date, basket_value")
            .eq("family_member", familyMemberId)
            .eq("strategy_id", strategyId)
            .order("as_of_date", { ascending: false })
            .limit(FETCH_LIMIT);

          if (cancelled) return;

          const basketByDate = {};
          (basketRows || []).forEach(r => {
            basketByDate[r.as_of_date] = Number(r.basket_value || 0);
          });

          const allDates = Object.keys(basketByDate).sort();
          // Strip non-trading days: consecutive rows with identical basket values
          const tradingDates = allDates.filter((d, i) =>
            i === 0 || basketByDate[d] !== basketByDate[allDates[i - 1]]
          );

          if (tradingDates.length < rowLimit + 1) {
            if (!cancelled) setReturnData({ pnl: 0, pct: 0 });
            return;
          }

          const anchorDate = tradingDates[tradingDates.length - 1 - rowLimit];
          const anchorBasketCents = basketByDate[anchorDate];

          const pnl = parseFloat((liveTotalRands - anchorBasketCents / 100).toFixed(2));
          const pct = anchorBasketCents > 0
            ? parseFloat(((pnl / (anchorBasketCents / 100)) * 100).toFixed(4))
            : 0;

          if (!cancelled) setReturnData({ pnl, pct });
          return;
        }

        // ── PARENT MODE ──────────────────────────────────────────────────────
        // Step 1: active holdings (Status="active", same filter as /api/user/holdings)
        const { data: activeHlds } = await supabase
          .from("stock_holdings_c")
          .select("transaction_id, security_id, quantity, avg_fill")
          .eq("Status", "active")
          .eq("user_id", userId)
          .is("family_member_id", null)
          .eq("strategy_id", strategyId);

        const holdings = (activeHlds || []).filter(h => Number(h.avg_fill || 0) > 0);
        const allTxIds = [...new Set(holdings.map(h => h.transaction_id).filter(Boolean))];
        const securityIds = [...new Set(holdings.map(h => h.security_id).filter(Boolean))];

        // Step 2: buffer + residual + latest intraday prices (parallel)
        const [txnResult, residualResult, intradayResult] = await Promise.all([
          allTxIds.length > 0
            ? supabase.from("transactions").select("buffer_cents, buffer_consumed_cents").in("id", allTxIds)
            : Promise.resolve({ data: [] }),
          supabase
            .from("strategy_rebalance_residuals")
            .select("balance_cents, updated_at")
            .eq("user_id", userId)
            .is("family_member_id", null)
            .eq("strategy_id", strategyId),
          securityIds.length > 0
            ? supabase
                .from("stock_intraday_c")
                .select("security_id, current_price")
                .in("security_id", securityIds)
                .order("timestamp", { ascending: false })
            : Promise.resolve({ data: [] }),
        ]);

        if (cancelled) return;

        let totalBufferCents = 0;
        (txnResult.data || []).forEach(t => {
          totalBufferCents += Number(t.buffer_cents || 0) - Number(t.buffer_consumed_cents || 0);
        });

        let totalResidualCents = 0;
        let earliestResidualDateStr = null;
        (residualResult.data || []).forEach(r => {
          totalResidualCents += Number(r.balance_cents || 0);
          const d = r.updated_at ? r.updated_at.split("T")[0] : null;
          if (d && (!earliestResidualDateStr || d < earliestResidualDateStr)) earliestResidualDateStr = d;
        });

        const latestPriceMap = {};
        (intradayResult.data || []).forEach(row => {
          if (!latestPriceMap[row.security_id])
            latestPriceMap[row.security_id] = Number(row.current_price || 0);
        });

        let livePositionsCents = 0;
        holdings.forEach(h => {
          const priceCents = latestPriceMap[h.security_id] || 0;
          livePositionsCents += Math.round(priceCents * Number(h.quantity || 0));
        });

        const liveTotalRands = livePositionsCents / 100 + (totalBufferCents + totalResidualCents) / 100;

        const cashCentsAt = (dateStr) =>
          (earliestResidualDateStr && dateStr >= earliestResidualDateStr)
            ? totalBufferCents + totalResidualCents
            : totalBufferCents;

        // YTD: live total − invested amount (mirrors home card exactly)
        if (activeTab === "ytd") {
          if (!investedAmount || investedAmount <= 0) {
            if (!cancelled) setReturnData({ pnl: 0, pct: 0 });
            return;
          }
          const pnl = parseFloat((liveTotalRands - investedAmount).toFixed(2));
          const pct = parseFloat(((pnl / investedAmount) * 100).toFixed(4));
          if (!cancelled) setReturnData({ pnl, pct });
          return;
        }

        // 5D / M: cash-adjusted, trading-day-aware anchor
        const rowLimit = activeTab === "5d" ? 5 : 22;
        const FETCH_LIMIT = rowLimit * 4 + 15;

        const { data: basketRows } = await supabase
          .from("client_strategy_returns_c")
          .select("as_of_date, basket_value")
          .eq("user_id", userId)
          .is("family_member", null)
          .eq("strategy_id", strategyId)
          .order("as_of_date", { ascending: false })
          .limit(FETCH_LIMIT);

        if (cancelled) return;

        const basketByDate = {};
        (basketRows || []).forEach(r => {
          basketByDate[r.as_of_date] = Number(r.basket_value || 0);
        });

        const allDates = Object.keys(basketByDate).sort();
        const tradingDates = allDates.filter((d, i) =>
          i === 0 || basketByDate[d] !== basketByDate[allDates[i - 1]]
        );

        if (tradingDates.length < rowLimit + 1) {
          if (!cancelled) setReturnData({ pnl: 0, pct: 0 });
          return;
        }

        const anchorDate = tradingDates[tradingDates.length - 1 - rowLimit];
        const anchorBasketCents = basketByDate[anchorDate];
        const anchorCashCents = cashCentsAt(anchorDate);
        const anchorTotalCents = anchorBasketCents + anchorCashCents;

        const pnl = parseFloat((liveTotalRands - anchorTotalCents / 100).toFixed(2));
        const pct = anchorTotalCents > 0
          ? parseFloat(((pnl / (anchorTotalCents / 100)) * 100).toFixed(4))
          : 0;

        if (!cancelled) setReturnData({ pnl, pct });
      } catch (e) {
        console.warn("[useStrategyLivePeriodReturn] error:", e.message);
        if (!cancelled) setReturnData({ pnl: 0, pct: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [userId, strategyId, activeTab, investedAmount, familyMemberId]);

  return { returnData, loading };
};

function parseDateParts(ts) {
  const dateStr = ts.split("T")[0];
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayOfWeek = new Date(y, m - 1, d).getDay();
  return { year: y, month: m, day: d, dayOfWeek };
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatChartData(priceHistory, timeFilter) {
  if (!priceHistory || priceHistory.length === 0) return [];

  switch (timeFilter) {
    case "D":
    case "W":
    case "5d": {
      return priceHistory.map((p) => {
        const { day, month, dayOfWeek, year } = parseDateParts(p.ts);
        return {
          day: `${day} ${MONTH_NAMES_SHORT[month - 1]} '${String(year).slice(-2)}`,
          value: p.nav,
          fullDate: `${DAY_NAMES[dayOfWeek]}, ${day} ${MONTH_NAMES_SHORT[month - 1]} ${year}`,
        };
      });
    }
    case "M":
    case "m": {
      return priceHistory.map((p) => {
        const { year, day, month } = parseDateParts(p.ts);
        return {
          day: `${day} ${MONTH_NAMES_SHORT[month - 1]} '${String(year).slice(-2)}`,
          value: p.nav,
          fullDate: `${day} ${MONTH_NAMES_SHORT[month - 1]} ${year}`,
        };
      });
    }
    case "ALL":
    case "ytd":
    case "all": {
      const monthKeys = new Set();
      priceHistory.forEach((p) => {
        const { year, month } = parseDateParts(p.ts);
        monthKeys.add(`${year}-${month}`);
      });
      if (monthKeys.size < 3) {
        return priceHistory.map((p) => {
          const { year, month, day, dayOfWeek } = parseDateParts(p.ts);
          return {
            day: `${day} ${MONTH_NAMES_SHORT[month - 1]}`,
            value: p.nav,
            fullDate: `${DAY_NAMES[dayOfWeek]}, ${day} ${MONTH_NAMES_SHORT[month - 1]} ${year}`,
          };
        });
      }
      const grouped = {};
      priceHistory.forEach((p) => {
        const { year, month } = parseDateParts(p.ts);
        const key = `${MONTH_NAMES_SHORT[month - 1]} '${String(year).slice(-2)}`;
        grouped[key] = p.nav;
      });
      const entries = Object.entries(grouped);
      return entries.map(([day, value]) => ({
        day,
        value,
        fullDate: day,
      }));
    }
    default:
      return priceHistory.map((p) => {
        const { year, month, day, dayOfWeek } = parseDateParts(p.ts);
        return {
          day: `${day} ${MONTH_NAMES_SHORT[month - 1]}`,
          value: p.nav,
          fullDate: `${DAY_NAMES[dayOfWeek]}, ${day} ${MONTH_NAMES_SHORT[month - 1]} ${year}`,
        };
      });
  }
}
