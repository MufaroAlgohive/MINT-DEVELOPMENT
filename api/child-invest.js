import { supabase, supabaseAdmin, authenticateUser } from "./_lib/supabase.js";
import { computeFees, getFeeConfig } from "./_lib/fees.js";

// Latest stock_intraday_c.current_price per security_id — stamped as
// Expected_fill so child PnL is anchored to the price at click time.
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

/**
 * Child Investment API
 *
 * POST /api/child-invest
 * body: { family_member_id, strategy_id, amount }
 *   → amount is in cents
 *   → deducts from child's available_balance
 *   → places strategy investment creating stock_holdings_c with family_member_id
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const db = supabaseAdmin || supabase;
  if (!db) return res.status(500).json({ error: "Database not available." });

  const { family_member_id, strategy_id, amount, base_amount, units, force } = req.body || {};

  if (!family_member_id) return res.status(400).json({ error: "family_member_id is required." });
  if (!strategy_id) return res.status(400).json({ error: "strategy_id is required." });
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "Amount must be a positive number (in cents)." });
  }
  // Whole baskets bought — scales every holding's quantity. Default 1.
  const unitsN = Math.max(1, Math.floor(Number(units) || 1));

  // Authenticate parent — authenticateUser returns { user, error }
  let parentUserId;
  try {
    const { user } = await authenticateUser(req);
    parentUserId = user?.id;
  } catch {}
  if (!parentUserId) {
    try {
      const { data: fm } = await db
        .from("family_members")
        .select("primary_user_id")
        .eq("id", family_member_id)
        .maybeSingle();
      parentUserId = fm?.primary_user_id;
    } catch {}
  }
  if (!parentUserId) return res.status(401).json({ error: "Could not identify parent." });

  let originalChildBalance = null;
  let childTxId = null;

  try {
    // 1. Verify child belongs to parent
    const { data: child, error: childErr } = await db
      .from("family_members")
      .select("id, primary_user_id, available_balance, first_name, relationship")
      .eq("id", family_member_id)
      .maybeSingle();

    if (childErr) throw childErr;
    if (!child) return res.status(404).json({ error: "Child account not found." });
    if (child.relationship !== "child") return res.status(400).json({ error: "Investments only supported for child accounts." });
    if (child.primary_user_id !== parentUserId) {
      return res.status(403).json({ error: "You can only invest for your own children." });
    }

    // 2. Duplicate-pending guard: if this child already has an UNFILLED buy of
    // the same strategy, warn instead of silently double-purchasing — the first
    // order just hasn't been filled by the desk yet, which is easy to mistake
    // for "it didn't go through". The client can re-submit with force:true.
    if (!force) {
      const { data: pendingRows } = await db
        .from("stock_holdings_c")
        .select("id")
        .eq("family_member_id", family_member_id)
        .eq("strategy_id", strategy_id)
        .eq("Status", "active")
        .or("avg_fill.is.null,avg_fill.eq.0")
        .limit(1);
      if (pendingRows && pendingRows.length) {
        return res.status(409).json({
          pending_exists: true,
          error: "This basket already has a pending purchase awaiting broker fill.",
        });
      }
    }

    // 3. Check child balance
    originalChildBalance = child.available_balance || 0;
    if (originalChildBalance < amount) {
      return res.status(400).json({ error: "Insufficient funds in child's wallet. Transfer funds first." });
    }

    // 3. Fetch strategy + holdings
    const { data: strategy, error: stratErr } = await db
      .from("strategies_c")
      .select("id, name, holdings, min_investment, status")
      .eq("id", strategy_id)
      .maybeSingle();

    if (stratErr) throw stratErr;
    if (!strategy) return res.status(404).json({ error: "Strategy not found." });
    if (strategy.status !== "active") return res.status(400).json({ error: "This strategy is no longer active." });
    // min_investment column is stored in rands; amount arrives in cents.
    const minInvestmentRands = Number(strategy.min_investment || 0);
    const minInvestmentCents = Math.round(minInvestmentRands * 100);
    if (minInvestmentCents > 0 && amount < minInvestmentCents) {
      return res.status(400).json({ error: `Minimum investment is R${minInvestmentRands.toFixed(2)}.` });
    }

    // 4. Deduct from child balance
    const newChildBalance = originalChildBalance - amount;
    const { error: deductErr } = await db
      .from("family_members")
      .update({ available_balance: newChildBalance })
      .eq("id", family_member_id);
    if (deductErr) throw deductErr;

    // 5. Build holdings from strategy basket
    const holdings = strategy.holdings || [];
    let holdingsCreated = 0;

    // Insert transaction first so we can stamp its UUID on every holdings row.
    const ref = `CHILD-INV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Server-authoritative fee breakdown. base_amount arrives in cents (raw,
    // pre-buffer, pre-fees) from ChildInvestModal. Fall back to deriving it
    // from amount if older clients call without it.
    const baseCentsIn = Number(base_amount || 0);
    const baseRandsForFees = baseCentsIn > 0 ? baseCentsIn / 100 : (amount / 100);
    const numAssetsForFees = (strategy.holdings || []).length || 1;
    const feeConfig = await getFeeConfig(db);
    const fees = computeFees(baseRandsForFees, numAssetsForFees, feeConfig);

    // The ledger record is NOT optional: without it the buy is invisible in
    // transaction history and the holdings carry no transaction_id (which the
    // orderbook uses to keep separate purchases separate). Abort + rollback on
    // failure instead of continuing silently.
    const nowIso = new Date().toISOString();
    const txInsert = await db.from("transactions").insert({
      user_id: parentUserId,
      family_member_id: family_member_id,
      name: `Strategy Investment: ${strategy.name}`,
      direction: "debit",
      amount: amount,
      base_amount_cents:     fees.baseCents,
      buffer_cents:          fees.bufferCents,
      buffer_consumed_cents: 0,
      broker_fee_cents:      fees.brokerFeeCents,
      isin_fee_cents:        fees.isinFeeCents,
      transaction_fee_cents: fees.transactionFeeCents,
      description: `${strategy.name} investment for ${child.first_name}`,
      store_reference: ref,
      currency: "ZAR",
      status: "posted",
      transaction_date: nowIso,
      created_at: nowIso,
    }).select("id").single();
    if (txInsert.error || !txInsert.data?.id) {
      throw new Error("Transaction record failed: " + (txInsert.error?.message || "no id returned"));
    }
    childTxId = txInsert.data.id;

    if (holdings.length > 0) {
      // Fetch security prices
      const symbols = holdings.map(h => h.symbol).filter(Boolean);
      const { data: securities } = await db
        .from("securities_c")
        .select("id, symbol, name, last_price")
        .in("symbol", symbols);

      const secMap = {};
      (securities || []).forEach(s => { secMap[s.symbol] = s; });

      const intradayPrices = await fetchLatestIntradayPrices(db, (securities || []).map(s => s.id));

      for (const h of holdings) {
        const sec = secMap[h.symbol];
        if (!sec?.last_price) continue;

        // Basket quantity from strategies_c.holdings × units (whole baskets).
        const qty = Math.floor(Number(h.quantity || h.shares || 0)) * unitsN;
        if (qty <= 0) continue;

        // Child strategy orders start as pending holdings until real fills arrive.
        try {
          await db
            .from("stock_holdings_c")
            .insert({
              user_id: parentUserId,
              family_member_id: family_member_id,
              security_id: sec.id,
              quantity: qty,
              avg_fill: null,
              market_value: 0,
              unrealized_pnl: 0,
              as_of_date: null,
              strategy_id: strategy_id,
              strategy_name_snapshot: strategy.name,
              trade_side: "BUY",
              is_active: true,
              Status: "active",
              transaction_id: childTxId,
              // Price the client saw at click time (rands): intraday preferred,
              // else securities_c.last_price (cents) / 100.
              Expected_fill: intradayPrices[sec.id] ?? (Number(sec.last_price) > 0 ? Number(sec.last_price) / 100 : null),
              created_at: nowIso,
              updated_at: nowIso,
            });
          holdingsCreated++;
        } catch (e) {
          console.warn(`[child-invest] pending holding insert for ${h.symbol}:`, e.message);
        }
      }
    }

    // Never leave the child charged with nothing positioned — undo everything.
    if (holdingsCreated === 0) {
      throw new Error("No holdings could be created for this basket.");
    }

    return res.json({
      success: true,
      child_balance: newChildBalance,
      holdings_created: holdingsCreated,
      strategy_name: strategy.name,
      transaction_ref: ref,
    });
  } catch (e) {
    console.error("[child-invest] error:", e.message);

    // Rollback: void the ledger record (if created), then restore the balance.
    if (childTxId) {
      try { await db.from("transactions").delete().eq("id", childTxId); }
      catch (rb) { console.error("[child-invest] tx rollback failed:", rb.message); }
    }
    if (originalChildBalance !== null) {
      try {
        await db
          .from("family_members")
          .update({ available_balance: originalChildBalance })
          .eq("id", family_member_id);
      } catch (rb) { console.error("[child-invest] rollback failed:", rb.message); }
    }

    return res.status(500).json({ error: "Investment failed. Please try again." });
  }
}
