import crypto from "crypto";
import { supabaseAdmin, supabase } from "../_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const privateKey = process.env.OZOW_PRIVATE_KEY;
    const {
      SiteCode, TransactionId, TransactionReference, Amount, Status,
      Optional1, Optional2, Optional3, Optional4, Optional5,
      CurrencyCode, IsTest, StatusMessage, HashCheck,
    } = req.body;

    console.log("[ozow/notify] received:", req.body);

    if (privateKey && HashCheck) {
      const hashParts = [
        SiteCode, TransactionId, TransactionReference, Amount, Status,
        Optional1 || "", Optional2 || "", Optional3 || "", Optional4 || "", Optional5 || "",
        CurrencyCode, IsTest, privateKey,
      ];
      const computed = crypto.createHash("sha512").update(hashParts.join("").toLowerCase(), "utf8").digest("hex");
      if (computed.toLowerCase() !== HashCheck.toLowerCase()) {
        console.warn("[ozow/notify] Hash mismatch — possible spoofed request");
        return res.status(200).send("OK");
      }
      console.log("[ozow/notify] Hash verified ✅");
    }

    console.log(`[ozow/notify] ref=${TransactionReference} status=${Status} amount=${Amount}`);

    if (Status === "Complete" || Status === "CompleteExternal") {
      console.log(`[ozow/notify] Payment complete ✅ ref=${TransactionReference}`);

      const strategyId = Optional1 || null;
      const userEmail = Optional2 || null;
      const userId = Optional3 || null;
      const amountZAR = Number(Amount) || 0;

      if (!userId || !strategyId || amountZAR <= 0) {
        console.warn(`[ozow/notify] Missing userId/strategyId/amount — cannot record. userId=${userId} strategyId=${strategyId} amount=${amountZAR}`);
        return res.status(200).send("OK");
      }

      const db = supabaseAdmin || supabase;
      if (!db) {
        console.error("[ozow/notify] No DB client available");
        return res.status(200).send("OK");
      }

      // Deduplication
      const { data: existingTx } = await db
        .from("transactions")
        .select("id")
        .eq("store_reference", TransactionReference)
        .maybeSingle();

      if (existingTx) {
        console.log(`[ozow/notify] Duplicate — already recorded ref=${TransactionReference}`);
        return res.status(200).send("OK");
      }

      // Load strategy holdings
      const { data: strategyData, error: stratError } = await db
        .from("strategies_c")
        .select("name, holdings")
        .eq("id", strategyId)
        .maybeSingle();

      if (stratError || !strategyData) {
        console.error("[ozow/notify] Could not load strategy:", stratError?.message);
        return res.status(200).send("OK");
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
        const now = new Date().toISOString();
        const today = now.split("T")[0];

        for (const holding of strategyHoldings) {
          const sec = secBySymbol[holding.symbol];
          if (!sec) continue;
          const rawQty = Number(holding.quantity || holding.shares || 0);
          if (rawQty <= 0) continue;
          const priceCents = Number(sec.last_price || 0);
          if (priceCents <= 0) continue;

          const holdingQty = rawQty * scalingRatio;

          const { data: existing } = await db
            .from("stock_holdings_c")
            .select("id, quantity, avg_fill")
            .eq("user_id", userId)
            .eq("security_id", sec.id)
            .eq("strategy_id", strategyId)
            .maybeSingle();

          if (existing) {
            const oldQty = Number(existing.quantity || 0);
            const oldAvgFill = Number(existing.avg_fill || 0);
            const newQty = oldQty + holdingQty;
            const newAvgFill = newQty > 0 ? ((oldAvgFill * oldQty) + (priceCents * holdingQty)) / newQty : priceCents;
            await db.from("stock_holdings_c").update({
              quantity: newQty,
              avg_fill: Math.round(newAvgFill),
              market_value: Math.round(newQty * priceCents),
              as_of_date: today,
              updated_at: now,
            }).eq("id", existing.id);
            console.log(`[ozow/notify] Updated holding ${holding.symbol} qty=${newQty}`);
          } else {
            await db.from("stock_holdings_c").insert({
              user_id: userId,
              security_id: sec.id,
              strategy_id: strategyId,
              quantity: holdingQty,
              avg_fill: priceCents,
              market_value: Math.round(holdingQty * priceCents),
              unrealized_pnl: 0,
              as_of_date: today,
              Status: "active",
            });
            console.log(`[ozow/notify] Inserted holding ${holding.symbol} qty=${holdingQty}`);
          }
        }
      }

      // Record transaction
      await db.from("transactions").insert({
        user_id: userId,
        direction: "debit",
        name: `Strategy Investment: ${strategyName}`,
        description: `Invested in strategy ${strategyName}`,
        amount: Math.round(amountZAR * 100),
        store_reference: TransactionReference,
        currency: "ZAR",
        status: "posted",
        transaction_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      console.log(`[ozow/notify] Transaction recorded ref=${TransactionReference}`);

      // Tag as Ozow so the CRM (EFT tab → Ozow Payments) can identify it.
      // Best-effort: the payment is already recorded above; if the
      // payment_method column doesn't exist yet this just no-ops.
      try {
        await db.from("transactions").update({ payment_method: "ozow" }).eq("store_reference", TransactionReference);
      } catch (e) { console.warn("[ozow/notify] payment_method tag skipped:", e?.message); }

      // Upsert user_strategies
      const { data: existingUS } = await db
        .from("user_strategies")
        .select("id, invested_amount")
        .eq("user_id", userId)
        .eq("strategy_id", strategyId)
        .maybeSingle();

      if (existingUS) {
        const newInvested = (existingUS.invested_amount || 0) + Math.round(amountZAR * 100);
        await db.from("user_strategies").update({
          invested_amount: newInvested,
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

    } else if (Status === "Cancelled") {
      console.log(`[ozow/notify] Payment cancelled ref=${TransactionReference}`);
    } else if (Status === "Error") {
      console.log(`[ozow/notify] Payment error ref=${TransactionReference} msg=${StatusMessage}`);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("[ozow/notify] error:", err);
    return res.status(200).send("OK");
  }
}
