import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";

/**
 * POST /api/user/request-sell  (Vercel function)
 *
 * Mirror of the Express route in server/index.cjs so the sell flow works on the
 * Vercel app (the Express server isn't part of the Vercel deployment). Flips the
 * filled holding(s) to a pending SELL (side='sell' + trade_side='SELL' so the CRM
 * order book — which reads trade_side first — picks it up), and records a pending
 * credit transaction as the instruction. Proceeds land once the broker fills.
 *
 * Body: { kind: "security"|"strategy", holdingId?, strategyId?, familyMemberId?, quantity? }
 *
 * quantity (single-security only): sell PART of a holding, e.g. 4 of 5 shares.
 * When quantity < the holding's quantity we SPLIT — reduce the original BUY
 * holding and create a new pending-SELL row for just the sold shares (carrying
 * the same cost basis + buy transaction_id). Baskets always sell in full.
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });

    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ success: false, error: authError || "Unauthorized" });

    const db = supabaseAdmin || supabase;
    const userId = user.id;

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const { kind, holdingId, strategyId, familyMemberId, quantity } = body;
    // quantity is optional; if provided it must be a positive number (partial
    // single-security sell). Reject a bad value rather than silently selling all.
    const qtyProvided = quantity !== undefined && quantity !== null && quantity !== "";
    if (qtyProvided && !(Number.isFinite(Number(quantity)) && Number(quantity) > 0)) {
      return res.status(400).json({ success: false, error: "quantity must be a positive number" });
    }
    const requestedQty = qtyProvided ? Math.floor(Number(quantity)) : null;
    if (kind !== "security" && kind !== "strategy")
      return res.status(400).json({ success: false, error: "kind must be 'security' or 'strategy'" });
    if (kind === "security" && !holdingId)
      return res.status(400).json({ success: false, error: "holdingId is required for a security sell" });
    if (kind === "strategy" && !strategyId)
      return res.status(400).json({ success: false, error: "strategyId is required for a strategy sell" });

    // If selling on behalf of a child, verify the family member belongs to this user.
    if (familyMemberId) {
      const { data: fm, error: fmErr } = await db
        .from("family_members").select("id, primary_user_id").eq("id", familyMemberId).maybeSingle();
      if (fmErr || !fm || fm.primary_user_id !== userId)
        return res.status(403).json({ success: false, error: "Child account not found or access denied" });
    }

    // Resolve target holdings — must belong to the caller, be active and filled.
    let q = db
      .from("stock_holdings_c")
      .select('id, user_id, family_member_id, security_id, strategy_id, quantity, avg_fill, market_value, side, trade_side, Status, "Expected_fill", "Fill_date", transaction_id, strategy_name_snapshot')
      .eq("user_id", userId).eq("Status", "active").gt("avg_fill", 0);
    q = familyMemberId ? q.eq("family_member_id", familyMemberId) : q.is("family_member_id", null);
    q = kind === "security" ? q.eq("id", holdingId) : q.eq("strategy_id", strategyId);

    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) {
      console.error("[request-sell] holdings lookup error:", rowsErr.message);
      return res.status(500).json({ success: false, error: "Could not load your holding" });
    }
    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, error: "Holding not found or not sellable" });

    // Don't double-request: bail if everything is already a pending sell. Check
    // BOTH side fields — trade_side is the canonical one the CRM reads.
    const isSell = (r) => String(r.trade_side || "").toUpperCase() === "SELL" || String(r.side || "").toLowerCase() === "sell";
    const sellable = rows.filter((r) => !isSell(r));
    if (sellable.length === 0)
      return res.status(409).json({ success: false, error: "A sell is already pending for this holding", alreadyPending: true });

    const ids = sellable.map((r) => r.id);

    // ── Partial single-security sell? ────────────────────────────────────────
    // Only for kind=security on a single holding, when the requested quantity is
    // below what's held (e.g. 4 of 5). Baskets and "sell all" fall through to the
    // full-position flip. Cap at the holding's quantity for safety.
    const singleRow = kind === "security" && sellable.length === 1 ? sellable[0] : null;
    const holdingQty = singleRow ? Number(singleRow.quantity || 0) : 0;
    const isPartial = !!(singleRow && requestedQty != null && requestedQty < holdingQty);
    const soldQty = (r) => (isPartial && r.id === singleRow.id ? requestedQty : Number(r.quantity || 0));

    // Capture the live price the client is seeing right now (per-share, cents) —
    // this is their "expected exit". Source: latest stock_intraday_c (same as the
    // holdings API). Stored per holding as expected_exit; the client is credited
    // at this price on settlement (MINT keeps the spread vs the broker's avg_exit).
    const secIds = [...new Set(sellable.map((r) => r.security_id).filter(Boolean))];
    const priceBySec = {};
    await Promise.all(secIds.map(async (sid) => {
      const { data } = await db
        .from("stock_intraday_c").select("current_price")
        .eq("security_id", sid).order("timestamp", { ascending: false }).limit(1).maybeSingle();
      if (data?.current_price != null) priceBySec[sid] = Math.round(Number(data.current_price)); // cents/share
    }));
    const expectedExitCents = (r) => {
      const px = priceBySec[r.security_id];
      return Number.isFinite(px) && px > 0 ? px : null;
    };
    // Expected proceeds total (what they saw): live price × SOLD qty, else a
    // proportional slice of market_value.
    const estValueCents = sellable.reduce((s, r) => {
      const px = expectedExitCents(r);
      const qty = soldQty(r);
      const v = px != null
        ? px * qty
        : (Number(r.quantity || 0) > 0 ? Number(r.market_value || 0) * (qty / Number(r.quantity)) : 0);
      return s + Math.round(v);
    }, 0);

    // Friendly label for the transaction row.
    let label = "holding";
    if (kind === "strategy") {
      const { data: strat } = await db.from("strategies_c").select("name, short_name").eq("id", strategyId).maybeSingle();
      label = strat?.short_name || strat?.name || "Strategy";
    } else {
      const secId = sellable[0].security_id;
      if (secId) {
        const { data: sec } = await db.from("securities_c").select("symbol, name").eq("id", secId).maybeSingle();
        label = sec?.name || sec?.symbol || "Asset";
      }
    }

    const reference = "SELL-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    const now = new Date().toISOString();

    // Record the instruction as a pending credit FIRST (proceeds land once the
    // broker fills) — its id is stamped onto every holding below so settlement
    // can find this exact transaction deterministically, even when the broker
    // fills each holding's exit price in separate CRM actions over time.
    const { data: txnRow, error: txErr } = await db.from("transactions").insert({
      user_id: userId,
      family_member_id: familyMemberId || null,
      direction: "credit",
      name: `Sell: ${label}`,
      description: kind === "strategy"
        ? `Sell instruction for strategy ${label} (${ids.length} asset${ids.length === 1 ? "" : "s"})`
        : `Sell instruction for ${label}`,
      amount: estValueCents,
      store_reference: reference,
      currency: "ZAR",
      status: "pending",
      transaction_date: now,
      created_at: now,
    }).select("id").single();
    if (txErr) {
      // Don't queue holdings as SELL without a transaction to settle against —
      // that would silently strand them with no way to credit the client.
      console.error("[request-sell] transaction insert error:", txErr.message);
      return res.status(500).json({ success: false, error: "Could not record the sell instruction" });
    }

    let updErr = null;
    if (isPartial) {
      // ── SPLIT: sell only `requestedQty` of the single holding ──────────────
      // 1. New pending-SELL row for the sold shares, carrying the same cost basis
      //    (avg_fill / Expected_fill) and the original BUY transaction_id so the
      //    reserve-refund logic still ties back to the funding transaction (and
      //    correctly does NOT refund on a partial exit).
      const px = expectedExitCents(singleRow);
      const perShareCents = px != null ? px : (holdingQty > 0 ? Math.round(Number(singleRow.market_value || 0) / holdingQty) : 0);
      const sellRow = {
        user_id: singleRow.user_id,
        family_member_id: singleRow.family_member_id || null,
        security_id: singleRow.security_id,
        strategy_id: singleRow.strategy_id || null,
        quantity: requestedQty,
        avg_fill: singleRow.avg_fill,
        "Expected_fill": singleRow.Expected_fill,
        "Fill_date": singleRow.Fill_date,
        market_value: Math.round(perShareCents * requestedQty),
        side: "sell",
        trade_side: "SELL",
        Status: "active",
        is_active: true,
        sell_requested_at: now,
        sell_transaction_id: txnRow.id,
        transaction_id: singleRow.transaction_id || null,
        strategy_name_snapshot: singleRow.strategy_name_snapshot || null,
        created_at: now,
        updated_at: now,
      };
      if (px != null) sellRow.expected_exit = px;
      const { data: insertedSell, error: insErr } = await db.from("stock_holdings_c").insert(sellRow).select("id").single();
      if (insErr) { updErr = insErr; }

      // 2. Reduce the original BUY holding by the sold shares (keep it BUY/active).
      //    If this fails, DELETE the SELL row we just created — otherwise the
      //    client would briefly show more shares than they own (split leak).
      if (!updErr) {
        const remainingQty = holdingQty - requestedQty;
        const remainingMv = Math.round(perShareCents * remainingQty);
        const { error: redErr } = await db.from("stock_holdings_c")
          .update({ quantity: remainingQty, market_value: remainingMv, updated_at: now })
          .eq("id", singleRow.id);
        if (redErr) {
          updErr = redErr;
          if (insertedSell?.id) await db.from("stock_holdings_c").delete().eq("id", insertedSell.id);
        }
      }
    } else {
      // ── FULL: flip each holding to a pending SELL (baskets + "sell all"). ───
      for (const r of sellable) {
        const patch = {
          side: "sell", trade_side: "SELL", sell_requested_at: now, updated_at: now,
          sell_transaction_id: txnRow.id,
        };
        const px = expectedExitCents(r);
        if (px != null) patch.expected_exit = px;
        const { error } = await db.from("stock_holdings_c").update(patch).eq("id", r.id);
        if (error) { updErr = error; break; }
      }
    }
    if (updErr) {
      console.error("[request-sell] holding update error:", updErr.message);
      // Partial split is fully compensated above (no holdings changed), so void
      // the pending "Sell:" transaction to avoid an orphan credit line.
      if (isPartial) await db.from("transactions").delete().eq("id", txnRow.id);
      return res.status(500).json({ success: false, error: "Could not queue the sell" });
    }

    console.log(`[request-sell] queued ${isPartial ? `${requestedQty} share(s) (partial)` : `${ids.length} holding(s)`} as SELL for user ${userId}, ref ${reference}`);
    return res.status(200).json({ success: true, reference, kind, partial: isPartial, soldQuantity: isPartial ? requestedQty : undefined, holdingCount: ids.length, estimatedValueCents: estValueCents });
  } catch (e) {
    console.error("[request-sell] error:", e?.message || e);
    return res.status(500).json({ success: false, error: e?.message || "Failed to submit sell" });
  }
}
