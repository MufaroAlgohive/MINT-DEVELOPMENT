import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";
import { Resend } from "resend";

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

// Latest stock_intraday_c.current_price per security_id — stamped as
// Expected_fill so claimed-gift PnL is anchored to the live price at claim time.
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

function buildClaimedHtml({ recipientName, senderName, assetName, amountRands }) {
  const fmt = (v) => `R${Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.mymint.co.za";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  body {
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
    background-color: #ffffff;
    margin: 0;
    padding: 0;
    -webkit-font-smoothing: antialiased;
  }
</style>
</head>
<body style="margin:0;padding:40px 20px;background:#ffffff;font-family:'Outfit', sans-serif">

<div style="max-width:520px;margin:0 auto;background:#ffffff;overflow:hidden;">

  <!-- HEADER BLOCK (Gold border is at the bottom of this entire wrapper) -->
  <div style="background:#31005E; border-bottom:3px solid #DDC357;">
    
    <!-- Text Section -->
    <div style="padding:32px 36px; text-align:center;">
      <p style="font-family:'Outfit', sans-serif; font-size:11px; font-weight:600; color:#DDC357; margin:0 0 10px; text-transform:uppercase; letter-spacing:3px;">Gift Claimed</p>
      <h1 style="font-family:'Inter', sans-serif; font-size:28px; font-weight:300; color:#ffffff; margin:0; letter-spacing:-0.5px; line-height:1.2;">Your portfolio just grew.</h1>
    </div>
    
    <!-- FULL WIDTH BANNER IMAGE (Sits above the gold border) -->
    <img src="https://mfxnghmuccevsxwcetej.supabase.co/storage/v1/object/public/Emailer%20Ads/GIFT%20CLAIMED.jpg" alt="Gift Claimed" style="width:100%; height:auto; display:block; margin:0;">
    
  </div>

  <!-- BODY CONTENT -->
  <div style="padding:40px 36px 36px;">
    
    <p style="font-family:'Outfit', sans-serif; font-size:16px; color:#3A3448; line-height:1.6; margin:0 0 24px; font-weight:300;">Hi ${recipientName},</p>
    
    <p style="font-family:'Outfit', sans-serif; font-size:16px; color:#3A3448; line-height:1.6; margin:0 0 36px; font-weight:300;">
      You have successfully claimed <strong>${fmt(amountRands)}</strong> in <strong>${assetName}</strong> — gifted to you by <strong>${senderName}</strong>. It is now securely reflecting in your MINT portfolio.
    </p>

    <!-- CTA BUTTON -->
    <a href="${APP_URL}" style="display:block; background:#31005E; color:#DDC357; text-decoration:none; text-align:center; padding:18px 24px; border-radius:6px; font-family:'Outfit', sans-serif; font-size:13px; font-weight:600; letter-spacing:2px; text-transform:uppercase; margin-bottom:32px; transition: opacity 0.2s ease;">View My Portfolio</a>

    <!-- FOOTER DISCLAIMER -->
    <div style="text-align:center; border-top:1px solid #F0EDF5; padding-top:24px;">
      <p style="font-family:'Outfit', sans-serif; font-size:11px; color:#8A8398; line-height:1.6; margin:0; font-weight:300;">
        MINT - Money In Transit.<br>
        MINT Platforms(Pty) Ltd is an authorised Financial Services Provider (FSP 55118) regulated by the Financial Sector Conduct Authority and a registered Credit Provider (NCRCP22892) under the National Credit Act.
      </p>
    </div>

  </div>
</div>

</body>
</html>`;
}

async function allocateStrategyHoldings(db, userId, strategyId, strategyHoldings, amountCents, transactionId) {
  const investAmountRands = amountCents / 100;
  let holdingsCreated = 0;
  if (!strategyHoldings.length) return 0;

  const symbols = strategyHoldings.map(h => h.symbol).filter(Boolean);
  const { data: securities } = await db
    .from("securities_c")
    .select("id, symbol, name, last_price, logo_url")
    .in("symbol", symbols);

  const secMap = {};
  (securities || []).forEach(s => { secMap[s.symbol] = s; });

  const intradayPrices = await fetchLatestIntradayPrices(db, (securities || []).map(s => s.id));

  let totalBasketCostRands = 0;
  for (const h of strategyHoldings) {
    const sec = secMap[h.symbol];
    if (sec?.last_price) totalBasketCostRands += sec.last_price * (h.weight || 1);
  }

  if (totalBasketCostRands > 0) {
    const scale = investAmountRands / totalBasketCostRands;
    for (const h of strategyHoldings) {
      const sec = secMap[h.symbol];
      if (!sec?.last_price) continue;
      const qty = Math.floor((h.weight || 1) * scale);
      if (qty <= 0) continue;

      const marketValueCents = Math.round(qty * sec.last_price * 100);

      try {
        // Always insert a NEW row per gift-claimed strategy purchase so duplicate
        // buys remain distinguishable in stock_holdings_c.
        // avg_fill starts as null (pending) — same as regular purchases — so the
        // purple "Pending orders" card shows on the home screen until admin fills.
        await db.from("stock_holdings_c").insert({
          user_id: userId,
          security_id: sec.id,
          quantity: qty,
          avg_fill: null,
          market_value: marketValueCents,
          unrealized_pnl: 0,
          as_of_date: new Date().toISOString().split("T")[0],
          strategy_id: strategyId,
          Status: "active",
          transaction_id: transactionId || null,
          Expected_fill: intradayPrices[sec.id] ?? null,
        });
        holdingsCreated++;
      } catch (e) {
        console.warn(`[gift/claim] holding insert for ${h.symbol}:`, e.message);
      }
    }
  }

  if (holdingsCreated === 0) {
    const sorted = [...strategyHoldings].sort((a, b) => (b.weight || 0) - (a.weight || 0));
    const fallbackSec = secMap[sorted[0]?.symbol];
    if (fallbackSec) {
      try {
        const priceCents = Math.round(fallbackSec.last_price * 100);
        await db.from("stock_holdings_c").insert({
          user_id: userId,
          security_id: fallbackSec.id,
          quantity: 1,
          avg_fill: null,
          market_value: priceCents,
          unrealized_pnl: 0,
          as_of_date: new Date().toISOString().split("T")[0],
          strategy_id: strategyId,
          Status: "active",
          transaction_id: transactionId || null,
          Expected_fill: intradayPrices[fallbackSec.id] ?? null,
        });
        holdingsCreated = 1;
      } catch (e) {
        console.warn("[gift/claim] strategy fallback holding:", e.message);
      }
    }
  }

  return holdingsCreated;
}

async function allocateStockHolding(db, userId, securityId, amountCents, transactionId) {
  const { data: sec } = await db
    .from("securities_c")
    .select("id, symbol, last_price")
    .eq("id", securityId)
    .maybeSingle();

  if (!sec?.last_price) return 0;

  const amountRands = amountCents / 100;
  const qty = Math.floor(amountRands / sec.last_price);
  const finalQty = qty > 0 ? qty : 1;
  const marketValueCents = Math.round(finalQty * sec.last_price * 100);

  const intradayPrices = await fetchLatestIntradayPrices(db, [sec.id]);

  try {
    // Always insert a NEW row per gift-claimed stock so duplicate stock buys
    // remain distinguishable in stock_holdings_c (mirrors the strategy-claim
    // pattern; the stacked-card UI groups them by created_at minute).
    // avg_fill starts as null (pending) so the purple "Pending orders" card
    // shows on the home screen until admin fills, matching regular purchases.
    await db.from("stock_holdings_c").insert({
      user_id: userId,
      security_id: sec.id,
      quantity: finalQty,
      avg_fill: null,
      market_value: marketValueCents,
      unrealized_pnl: 0,
      as_of_date: new Date().toISOString().split("T")[0],
      Status: "active",
      transaction_id: transactionId || null,
      Expected_fill: intradayPrices[sec.id] ?? null,
    });
    return finalQty;
  } catch (e) {
    console.warn("[gift/claim] stock holding insert:", e.message);
    return 0;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const db = supabaseAdmin || supabase;
  if (!db) return res.status(500).json({ error: "Database not available" });

  const { user, error: authError } = await authenticateUser(req);
  if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

  const { token, gift_id } = req.body || {};
  if (!token && !gift_id) return res.status(400).json({ error: "Token or gift_id is required." });

  const query = db.from("gift_claims").select("*");
  const { data: gift, error: giftErr } = await (gift_id
    ? query.eq("id", gift_id).maybeSingle()
    : query.eq("token", token).maybeSingle());

  if (giftErr || !gift) return res.status(404).json({ error: "Gift not found." });

  if (gift.status === "claimed") return res.status(400).json({ error: "This gift has already been claimed." });
  if (gift.status === "expired") return res.status(400).json({ error: "This gift has expired." });
  if (gift.status === "cancelled") return res.status(400).json({ error: "This gift was cancelled." });
  if (gift.status === "pending_registration") {
    return res.status(400).json({ error: "You need to complete registration and KYC before claiming this gift." });
  }
  if (new Date(gift.expires_at) < new Date()) {
    return res.status(400).json({ error: "This gift has expired." });
  }
  if (gift.sender_user_id === user.id) {
    return res.status(400).json({ error: "You cannot claim your own gift." });
  }
  if (gift.recipient_user_id && gift.recipient_user_id !== user.id) {
    return res.status(403).json({ error: "This gift was sent to a different account." });
  }

  const { data: onboarding } = await db
    .from("user_onboarding")
    .select("kyc_status")
    .eq("user_id", user.id)
    .maybeSingle();

  const kycStatus = onboarding?.kyc_status;
  if (kycStatus !== "verified" && kycStatus !== "onboarding_complete") {
    return res.status(403).json({ error: "FICA verification required to claim this gift.", kyc_required: true });
  }

  let holdingsAllocated = 0;

  // Insert transaction first so we can stamp its UUID on every holdings row.
  // Use the same format as record-investment.js (debit, "Strategy Investment: X")
  // so the gift flows through the exact same pending-orders code path as a
  // regular strategy purchase — no separate UI branch needed.
  let giftTxId = null;
  try {
    const txName = gift.asset_type === "strategy"
      ? `Strategy Investment: ${gift.asset_name}`
      : `Purchased ${gift.asset_name}`;
    const txInsert = await db.from("transactions").insert({
      user_id: user.id,
      direction: "debit",
      name: txName,
      description: `Investment gift from sender`,
      amount: gift.amount,
      store_reference: `GIFT-CLAIM-${gift.id}`,
      status: "posted",
    }).select("id").single();
    giftTxId = txInsert.data?.id || null;
  } catch (e) { console.warn("[gift/claim] tx insert:", e.message); }

  if (gift.asset_type === "strategy" && gift.strategy_id) {
    const { data: strategy } = await db
      .from("strategies_c")
      .select("id, holdings")
      .eq("id", gift.strategy_id)
      .maybeSingle();

    const strategyHoldings = strategy?.holdings || [];
    holdingsAllocated = await allocateStrategyHoldings(db, user.id, gift.strategy_id, strategyHoldings, gift.amount, giftTxId);
  } else if (gift.asset_type === "stock" && gift.security_id) {
    holdingsAllocated = await allocateStockHolding(db, user.id, gift.security_id, gift.amount, giftTxId);
  }

  if (holdingsAllocated === 0) {
    console.error(`[gift/claim] failed to allocate any holdings for gift ${gift.id}`);
    return res.status(500).json({ error: "Failed to allocate holdings. Please try again." });
  }

  const { error: updateErr } = await db
    .from("gift_claims")
    .update({ status: "claimed", recipient_user_id: user.id, claimed_at: new Date().toISOString() })
    .eq("id", gift.id);

  if (updateErr) {
    console.error("[gift/claim] status update error:", updateErr.message);
    return res.status(500).json({ error: "Failed to finalise claim." });
  }

  const resend = getResend();
  if (resend) {
    try {
      const [{ data: recipient }, { data: sender }] = await Promise.all([
        db.from("profiles").select("first_name, last_name, email").eq("id", user.id).maybeSingle(),
        db.from("profiles").select("first_name, last_name").eq("id", gift.sender_user_id).maybeSingle(),
      ]);
      if (recipient?.email) {
        const recipientName = [recipient.first_name, recipient.last_name].filter(Boolean).join(" ") || "there";
        const senderName = [sender?.first_name, sender?.last_name].filter(Boolean).join(" ") || "Someone";
        await resend.emails.send({
          from: "Mint <noreply@mymint.co.za>",
          to: [recipient.email],
          subject: `Your investment gift is now in your portfolio — ${gift.asset_name}`,
          html: buildClaimedHtml({ recipientName, senderName, assetName: gift.asset_name, amountRands: gift.amount / 100 }),
        });
      }
    } catch (e) { console.warn("[gift/claim] email:", e.message); }
  }

  return res.json({
    success: true,
    holdings_allocated: holdingsAllocated,
    amount: gift.amount,
    asset_name: gift.asset_name,
    asset_type: gift.asset_type,
  });
}
