import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";

// Latest stock_intraday_c.current_price per security_id (rands).
// Live price source for strategy PnL — replaces stale securities_c.last_price.
async function fetchLatestIntradayPrices(db, securityIds) {
  if (!securityIds || !securityIds.length) return {};
  const ids = [...new Set(securityIds.filter(Boolean))];
  const out = {};
  await Promise.all(ids.map(async (id) => {
    const { data } = await db
      .from("stock_intraday_c")
      .select("current_price")
      .eq("security_id", id)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.current_price != null) {
      // stock_intraday_c.current_price is stored in cents; return rands.
      out[id] = Number(data.current_price) / 100;
    }
  }));
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    if (!supabase) {
      return res.status(500).json({ success: false, error: "Database not connected" });
    }

    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: authError || "Unauthorized" });
    }

    const db = supabaseAdmin || supabase;
    const userId = user.id;

    // 1. Fetch user holdings with strategy_id (primary signal for which strategies user owns)
    // Includes Expected_fill (price client saw at click time) — preferred cost basis.
    const { data: userHoldings, error: holdingsError } = await db
      .from("stock_holdings_c")
      .select("id, family_member_id, security_id, strategy_id, quantity, avg_fill, Expected_fill, is_active, avg_exit, transaction_id")
      .eq("user_id", userId)
      .is("family_member_id", null)
      .not("strategy_id", "is", null);

    if (holdingsError) {
      console.error("[user/strategies] Error fetching user holdings:", holdingsError);
    }

    // 2. Also check transactions for strategy names (fallback / first-invested-date tracking).
    // Include debit transactions (regular purchases) AND credit transactions that are
    // gift receipts ("Gift Received — <strategy name>") so gift-claimed strategies
    // surface correctly while their holdings are still pending.
    const { data: transactions } = await db
      .from("transactions")
      .select("id, name, amount, direction, transaction_date, family_member_id")
      .eq("user_id", userId)
      .is("family_member_id", null)
      .or("direction.eq.debit,name.ilike.Gift Received%");

    const strategyFirstDate = {};
    const strategyTxNames = new Set();
    for (const tx of (transactions || [])) {
      const txName = (tx.name || "").trim();
      let strategyName = null;
      if (txName.startsWith("Strategy Investment: ")) {
        strategyName = txName.replace("Strategy Investment: ", "").trim();
      } else if (txName.startsWith("Purchased ")) {
        strategyName = txName.replace("Purchased ", "").trim();
      } else if (txName.startsWith("Gift Received — ")) {
        strategyName = txName.replace("Gift Received — ", "").trim();
      }
      if (strategyName) {
        strategyTxNames.add(strategyName);
        if (tx.transaction_date) {
          if (!strategyFirstDate[strategyName] || tx.transaction_date < strategyFirstDate[strategyName]) {
            strategyFirstDate[strategyName] = tx.transaction_date;
          }
        }
      }
    }
    const strategyNames = Array.from(strategyTxNames);

    const holdingsByStratId = {};
    const holdingStrategyIds = [];
    // A strategy only belongs on the dashboard while it has at least one OPEN
    // (is_active) holding. A fully-sold strategy keeps its rows (flipped to
    // is_active=false) for history/realised-P&L, but must NOT resurface as a
    // live card — otherwise selling out leaves a ghost strategy behind.
    const activeHoldingStrategyIds = new Set();
    for (const h of (userHoldings || [])) {
      if (!holdingsByStratId[h.strategy_id]) {
        holdingsByStratId[h.strategy_id] = [];
        holdingStrategyIds.push(h.strategy_id);
      }
      holdingsByStratId[h.strategy_id].push(h);
      if (h.is_active !== false) activeHoldingStrategyIds.add(h.strategy_id);
    }

    // If no holdings and no transaction names, return empty
    if (holdingStrategyIds.length === 0 && strategyNames.length === 0) {
      return res.status(200).json({ success: true, strategies: [] });
    }

    // Per-strategy cash (rebalance residual + held 8% buffer) and realised P&L —
    // mirrors the app's strategyValuation helper so the server matches the home
    // card / Portfolio tab and the % return stays stable across rebalances.
    const residualByStrat = {}; // rands
    const bufferByStrat = {};   // rands
    const realizedByStrat = {}; // rands
    if (holdingStrategyIds.length > 0) {
      const { data: resRows } = await db
        .from("strategy_rebalance_residuals")
        .select("strategy_id, balance_cents")
        .eq("user_id", userId).is("family_member_id", null)
        .in("strategy_id", holdingStrategyIds);
      (resRows || []).forEach(r => { if (r.strategy_id) residualByStrat[r.strategy_id] = (residualByStrat[r.strategy_id] || 0) + Number(r.balance_cents || 0) / 100; });

      // Buffer: each active holding's funding transaction, counted once per strategy.
      const txIdsByStrat = {}; const allTxIds = new Set();
      for (const h of (userHoldings || [])) {
        if (h.is_active === false || !h.transaction_id || !h.strategy_id) continue;
        (txIdsByStrat[h.strategy_id] = txIdsByStrat[h.strategy_id] || new Set()).add(h.transaction_id);
        allTxIds.add(h.transaction_id);
      }
      if (allTxIds.size > 0) {
        const { data: bufTxns } = await db.from("transactions").select("id, buffer_cents, buffer_consumed_cents").in("id", [...allTxIds]);
        const bufById = {}; (bufTxns || []).forEach(t => { bufById[t.id] = Number(t.buffer_cents || 0) - Number(t.buffer_consumed_cents || 0); });
        Object.entries(txIdsByStrat).forEach(([sid, set]) => { let s = 0; set.forEach(tid => { s += bufById[tid] || 0; }); bufferByStrat[sid] = s / 100; });
      }

      // AUM management fee taken from the sleeve reduces the held 8% buffer
      // (separate accumulator, never mixed with broker slippage).
      try {
        const { data: aumRows } = await db
          .from("strategy_aum_fee_state")
          .select("strategy_id, aum_fee_consumed_cents")
          .eq("user_id", userId).is("family_member_id", null)
          .in("strategy_id", holdingStrategyIds);
        (aumRows || []).forEach(r => { if (r.strategy_id) bufferByStrat[r.strategy_id] = (bufferByStrat[r.strategy_id] || 0) - Number(r.aum_fee_consumed_cents || 0) / 100; });
      } catch (e) { /* table may not exist yet */ }

      // Realised P&L from closed positions: Σ (avg_exit − avg_fill) × qty (cents → rands).
      for (const h of (userHoldings || [])) {
        if (h.is_active !== false || !h.strategy_id) continue;
        const fill = Number(h.avg_fill || 0), exit = Number(h.avg_exit || 0), qty = Number(h.quantity || 0);
        if (fill && exit && qty) realizedByStrat[h.strategy_id] = (realizedByStrat[h.strategy_id] || 0) + ((exit - fill) / 100) * qty;
      }
    }

    // 3. Build live price map from user's holdings securities
    const allSecurityIds = (userHoldings || []).map(h => h.security_id).filter(Boolean);
    let livePriceMap = {};
    const symbolPnlMap = {};

    if (allSecurityIds.length > 0) {
      const [secsResult, intradayPrices] = await Promise.all([
        db.from("securities_c").select("id, symbol, last_price").in("id", allSecurityIds),
        fetchLatestIntradayPrices(db, allSecurityIds),
      ]);
      const secs = secsResult.data || [];

      // Live price: intraday (rands, ~1min fresh) > securities_c.last_price (rands, stale fallback)
      secs.forEach(s => {
        livePriceMap[s.id] = intradayPrices[s.id] != null
          ? intradayPrices[s.id]
          : Number(s.last_price || 0);
      });

      for (const h of (userHoldings || [])) {
        const sec = secs.find(s => s.id === h.security_id);
        if (!sec) continue;
        const qty = Number(h.quantity || 0);
        const avgFill = Number(h.avg_fill || 0);
        const expectedFillRands = Number(h.Expected_fill || 0);
        if (!avgFill && !expectedFillRands) continue;

        // Cost basis per share: Expected_fill (rands) > avg_fill/100 (legacy)
        const costBasisRandsPerShare = expectedFillRands > 0
          ? expectedFillRands
          : (avgFill / 100);

        const livePrice = livePriceMap[h.security_id] ?? costBasisRandsPerShare;
        symbolPnlMap[sec.symbol] = {
          pnlRands: (livePrice - costBasisRandsPerShare) * qty,
          pnlPct: costBasisRandsPerShare > 0 ? ((livePrice - costBasisRandsPerShare) / costBasisRandsPerShare) * 100 : 0,
          currentValue: livePrice * qty,
          costBasis: costBasisRandsPerShare * qty,
        };
      }
    }

    // 4. Fetch all active strategies from strategies_c (no strategy_metrics join — table is gone)
    const { data: allStrategies, error: stratErr } = await db
      .from("strategies_c")
      .select("id, name, short_name, description, risk_level, sector, icon_url, image_url, holdings, status, is_kid_strategy")
      .eq("status", "active");

    if (stratErr) {
      console.error("[user/strategies] Error fetching strategies:", stratErr);
      return res.status(500).json({ success: false, error: stratErr.message });
    }

    // 5. Fetch returns from strategies_returns_c (replacement for strategy_metrics)
    const strategyIds = (allStrategies || []).map(s => s.id);
    let returnsMap = {};
    if (strategyIds.length > 0) {
      const { data: returnsRows } = await db
        .from("strategy_returns_effective_c")
        .select("strategy_id, as_of_date, ytd_pct, 5d_pct, 1m_pct, 6m_pct")
        .in("strategy_id", strategyIds)
        .order("as_of_date", { ascending: false });

      for (const row of (returnsRows || [])) {
        if (!returnsMap[row.strategy_id]) {
          returnsMap[row.strategy_id] = {
            r_ytd: row.ytd_pct ?? null,
            r_ytd_pct: row.ytd_pct ?? null,
            r_5d: row["5d_pct"] ?? null,
            r_1m: row["1m_pct"] ?? null,
            r_6m: row["6m_pct"] ?? null,
            as_of_date: row.as_of_date ?? null,
          };
        }
      }
    }

    // 6. Get logo/name data for strategy holdings
    const allHoldingSymbols = new Set();
    for (const strategy of (allStrategies || [])) {
      const h = strategy.holdings || [];
      if (Array.isArray(h)) h.forEach(item => { if (item.symbol) allHoldingSymbols.add(item.symbol); });
    }

    let securitiesMap = {};
    if (allHoldingSymbols.size > 0) {
      const { data: secs } = await db
        .from("securities_c")
        .select("symbol, logo_url, name, last_price")
        .in("symbol", Array.from(allHoldingSymbols));
      if (secs) secs.forEach(s => { securitiesMap[s.symbol] = s; });
    }

    // 7. Match and build response
    const matchedStrategies = [];
    for (const strategy of (allStrategies || [])) {
      const matchedByHoldings = activeHoldingStrategyIds.has(strategy.id);
      const matchedByTxName = strategyNames.find(sn =>
        sn.toLowerCase() === (strategy.name || "").toLowerCase() ||
        sn.toLowerCase() === (strategy.short_name || "").toLowerCase()
      );

      // Only include strategies the user has at least one OPEN (is_active)
      // holding for. A lingering transaction alone (e.g. holdings deleted) or a
      // fully-sold strategy (all holdings is_active=false) must NOT resurrect the
      // strategy on the dashboard — that produced ghost "bought"-looking cards.
      if (!matchedByHoldings) continue;

      const latestMetric = returnsMap[strategy.id] || null;

      const enrichedHoldings = (strategy.holdings || []).map(h => {
        const pnlData = symbolPnlMap[h.symbol] || null;
        return {
          ...h,
          logo_url: h.logo_url || securitiesMap[h.symbol]?.logo_url || null,
          name: h.name || securitiesMap[h.symbol]?.name || h.symbol,
          pnlRands: pnlData ? pnlData.pnlRands : null,
          pnlPct: pnlData ? pnlData.pnlPct : null,
          currentValue: pnlData ? pnlData.currentValue : null,
          costBasis: pnlData ? pnlData.costBasis : null,
        };
      });

      const stratHoldings = holdingsByStratId[strategy.id] || [];
      // Only OPEN positions value the strategy; closed (sold) positions must not be
      // counted as still held — they only contribute realised P&L (added below).
      const activeHoldings = stratHoldings.filter(h => h.is_active !== false);
      let investedAmount = 0;
      let currentMarketValue = 0;
      const allPending = activeHoldings.length > 0 && activeHoldings.every(h => !h.avg_fill);

      if (activeHoldings.length === 0 || allPending) {
        // Fall back to transactions for invested amount when no filled holdings
        for (const tx of (transactions || [])) {
          const txName = (tx.name || "").trim();
          let txStratName = null;
          if (txName.startsWith("Strategy Investment: ")) txStratName = txName.replace("Strategy Investment: ", "").trim();
          else if (txName.startsWith("Purchased ")) txStratName = txName.replace("Purchased ", "").trim();
          else if (txName.startsWith("Gift Received — ")) txStratName = txName.replace("Gift Received — ", "").trim();
          if (txStratName && (
            txStratName.toLowerCase() === (strategy.name || "").toLowerCase() ||
            txStratName.toLowerCase() === (strategy.short_name || "").toLowerCase()
          )) {
            investedAmount += Number(tx.amount || 0) / 100;
          }
        }
        // Pending strategies must not contribute to portfolio value until fills arrive.
        currentMarketValue = allPending ? 0 : investedAmount;
      } else {
        let activeCost = 0;
        let positions = 0;
        for (const h of activeHoldings) {
          const qty = Number(h.quantity || 0);
          const avgFill = Number(h.avg_fill || 0);
          const expectedFillRands = Number(h.Expected_fill || 0);
          if (!avgFill && !expectedFillRands) continue;

          // Cost basis per share: Expected_fill (rands) > avg_fill/100 (legacy)
          const costBasisRandsPerShare = expectedFillRands > 0
            ? expectedFillRands
            : (avgFill / 100);

          const livePrice = livePriceMap[h.security_id] || costBasisRandsPerShare;
          activeCost += costBasisRandsPerShare * qty;
          positions += livePrice * qty;
        }
        /* P&L = unrealised (open positions − their cost) + realised (locked-in from
           rebalance sells). currentValue = positions + residual + buffer (same as
           the home card). invested is DERIVED from the total so the % return stays
           stable across rebalances and "invested" reflects true money in. */
        const residual = residualByStrat[strategy.id] || 0;
        const buffer = bufferByStrat[strategy.id] || 0;
        const realized = realizedByStrat[strategy.id] || 0;
        const totalPnl = (positions - activeCost) + realized;
        currentMarketValue = positions + residual + buffer;
        investedAmount = currentMarketValue - totalPnl;
      }

      matchedStrategies.push({
        id: strategy.id,
        name: strategy.name,
        shortName: strategy.short_name || strategy.name,
        description: strategy.description || "",
        riskLevel: strategy.risk_level || "Moderate",
        sector: strategy.sector || "",
        iconUrl: strategy.icon_url,
        imageUrl: strategy.image_url,
        isKidStrategy: !!strategy.is_kid_strategy,
        holdings: enrichedHoldings,
        investedAmount,
        currentMarketValue,
        currentValue: currentMarketValue,
        isPending: activeHoldings.length > 0 && allPending,
        metrics: latestMetric,
        firstInvestedDate: matchedByTxName ? (strategyFirstDate[matchedByTxName] || null) : null,
      });
    }

    return res.status(200).json({ success: true, strategies: matchedStrategies });
  } catch (error) {
    console.error("[user/strategies] Error:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to fetch user strategies" });
  }
}
