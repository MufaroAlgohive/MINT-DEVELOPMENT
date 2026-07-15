import { authenticateUser, supabaseAdmin, supabase } from "../_lib/supabase.js";
import { createClient } from "@supabase/supabase-js";

function getAuthenticatedDb(token) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (supabaseAdmin) return supabaseAdmin;
  if (token && url && anon) {
    return createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  }
  return supabase;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const { transactionRef, strategyId, amount } = req.body;
    const userId = user.id;

    if (!transactionRef || !strategyId || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    if (!transactionRef.startsWith("MINT-")) {
      return res.status(400).json({ success: false, error: "Invalid transaction reference" });
    }

    const db = getAuthenticatedDb(token);
    if (!db) return res.status(500).json({ success: false, error: "DB unavailable" });

    // Deduplication
    const { data: existingTx } = await db
      .from("transactions")
      .select("id")
      .eq("store_reference", transactionRef)
      .maybeSingle();

    if (existingTx) {
      console.log(`[ozow/record-success] Already recorded ref=${transactionRef}`);
      return res.json({ success: true, alreadyRecorded: true });
    }

    const amountZAR = Number(amount);

    // Load strategy
    const { data: strategyData, error: stratError } = await db
      .from("strategies_c")
      .select("name, holdings")
      .eq("id", strategyId)
      .maybeSingle();

    if (stratError || !strategyData) {
      return res.status(404).json({ success: false, error: "Strategy not found" });
    }

    const strategyName = strategyData.name || "Strategy";
    const strategyHoldings = strategyData.holdings || [];

    if (strategyHoldings.length > 0) {
      const symbols = strategyHoldings.map(h => h.symbol).filter(Boolean);
      const { data: securitiesData } = await db
        .from("securities_c")
        .select("id, symbol, last_price")
        .in("symbol", symbols);

      const secBySymbol = {};
      (securitiesData || []).forEach(s => { secBySymbol[s.symbol] = s; });

      let totalBasketCostRands = 0;
      for (const holding of strategyHoldings) {
        const sec = secBySymbol[holding.symbol];
        if (!sec) continue;
        const qty = Number(holding.quantity || holding.shares || 0);
        const priceCents = Number(sec.last_price || 0);
        if (qty > 0 && priceCents > 0) totalBasketCostRands += (qty * priceCents) / 100;
      }

      const scalingRatio = totalBasketCostRands > 0 ? amountZAR / totalBasketCostRands : 1;

      for (const holding of strategyHoldings) {
        const sec = secBySymbol[holding.symbol];
        if (!sec) continue;
        const rawQty = Number(holding.quantity || holding.shares || 0);
        if (rawQty <= 0) continue;
        const priceCents = Number(sec.last_price || 0);
        if (priceCents <= 0) continue;

        const holdingQty = Math.max(1, Math.round(rawQty * scalingRatio));

        const { error: insertErr } = await db.from("stock_holdings_c").insert({
          user_id: userId,
          security_id: sec.id,
          strategy_id: strategyId,
          quantity: holdingQty,
          avg_fill: null,
          market_value: 0,
          unrealized_pnl: 0,
          as_of_date: null,
          Status: "active",
        });
        if (insertErr) {
          console.error(`[ozow/record-success] Failed to insert pending holding for ${holding.symbol}:`, insertErr.message);
        } else {
          console.log(`[ozow/record-success] Inserted pending holding ${holding.symbol} qty=${holdingQty}`);
        }
      }
    }

    // Transaction record
    await db.from("transactions").insert({
      user_id: userId,
      direction: "debit",
      name: `Strategy Investment: ${strategyName}`,
      description: `Invested in strategy ${strategyName}`,
      amount: Math.round(amountZAR * 100),
      store_reference: transactionRef,
      currency: "ZAR",
      status: "posted",
      transaction_date: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    // Upsert user_strategies
    const { data: existingUS } = await db
      .from("user_strategies")
      .select("id, invested_amount")
      .eq("user_id", userId)
      .eq("strategy_id", strategyId)
      .maybeSingle();

    if (existingUS) {
      await db.from("user_strategies").update({
        invested_amount: (existingUS.invested_amount || 0) + Math.round(amountZAR * 100),
        updated_at: new Date().toISOString(),
      }).eq("id", existingUS.id);
    } else {
      await db.from("user_strategies").insert({
        user_id: userId,
        strategy_id: strategyId,
        invested_amount: Math.round(amountZAR * 100),
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // Tag as Ozow so the CRM (EFT tab → Ozow Payments) can identify it.
    // Best-effort: the payment is already recorded above; if the
    // payment_method column doesn't exist yet this just no-ops.
    try {
      await db.from("transactions").update({ payment_method: "ozow" }).eq("store_reference", transactionRef);
    } catch (e) { console.warn("[ozow/record-success] payment_method tag skipped:", e?.message); }

    console.log(`[ozow/record-success] Investment recorded user=${userId} strategy=${strategyId} amount=${amountZAR} ref=${transactionRef}`);
    return res.json({ success: true });
  } catch (err) {
    console.error("[ozow/record-success] error:", err);
    return res.status(500).json({ success: false, error: "Failed to record investment" });
  }
}
