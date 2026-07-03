import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";
import { Resend } from "resend";
import crypto from "crypto";

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.mymint.co.za";

function buildGiftSentHtml({ senderFirstName, recipientFirstName, recipientLastName, recipientIdentifier, assetName, amountRands }) {
  const fmt = (v) => Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.mymint.co.za";
  const recFullName = recipientFirstName ? `${recipientFirstName} ${recipientLastName || ''}`.trim() : recipientIdentifier;
  const recFirstName = recipientFirstName || recipientIdentifier;
  const senderFirst = senderFirstName || "there";

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
  
  /* OVERRIDE APP INLINE STYLES FOR TABLE */
  .steps-table {
    width: 100% !important;
    border-collapse: collapse !important;
    background-color: transparent !important;
  }
  .steps-table td {
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif !important;
    color: #2C2738 !important;
    font-size: 14.5px !important;
    padding: 8px 0 !important;
    border: none !important;
  }
  .steps-table strong, .steps-table b {
    font-weight: 600 !important;
    color: #1A1622 !important;
  }
</style>
</head>
<body style="margin:0;padding:40px 20px;background:#ffffff;font-family:'Outfit', sans-serif">

<div style="max-width:520px;margin:0 auto;background:#ffffff;overflow:hidden;">

  <!-- HEADER BLOCK -->
  <div style="background:#31005E; border-bottom:3px solid #DDC357;">
    
    <!-- Text Section -->
    <div style="padding:32px 36px; text-align:center;">
      <p style="font-family:'Outfit', sans-serif; font-size:11px; font-weight:600; color:#DDC357; margin:0 0 10px; text-transform:uppercase; letter-spacing:3px;">Transfer Initiated</p>
      <h1 style="font-family:'Inter', sans-serif; font-size:28px; font-weight:300; color:#ffffff; margin:0; letter-spacing:-0.5px; line-height:1.2;">Gift sent successfully.</h1>
    </div>
    
    <!-- FULL WIDTH BANNER IMAGE -->
    <img src="https://mfxnghmuccevsxwcetej.supabase.co/storage/v1/object/public/Emailer%20Ads/Gift%20Sent.jpg" alt="Gift Sent" style="width:100%; height:auto; display:block; margin:0;">
    
  </div>

  <!-- BODY CONTENT -->
  <div style="padding:40px 36px 36px;">
    
    <p style="font-family:'Outfit', sans-serif; font-size:16px; color:#3A3448; line-height:1.6; margin:0 0 24px; font-weight:300;">Hi ${senderFirst},</p>
    
    <p style="font-family:'Outfit', sans-serif; font-size:16px; color:#3A3448; line-height:1.6; margin:0 0 32px; font-weight:300;">
      Your gift of <strong>R${fmt(amountRands)}</strong> in <strong>${assetName}</strong> to ${recFullName} has been sent successfully.
    </p>

    <!-- INSTRUCTIONS BOX -->
    <div style="background:#F9F8FB; border:1px solid #E4E0EC; border-radius:8px; padding:28px; margin-bottom:24px;">
      <p style="font-family:'Outfit', sans-serif; font-size:10px; font-weight:600; color:#5C3BCF; text-transform:uppercase; letter-spacing:2px; margin:0 0 16px;">What happens next?</p>
      
      <table class="steps-table" style="width:100%; border-collapse:collapse; font-family:'Outfit', sans-serif; font-size:14.5px; color:#2C2738; font-weight:300; line-height:1.6;">
        <tr>
          <td style="padding:8px 12px 8px 0; vertical-align:top; width:24px; color:#5C3BCF; font-weight:600;">1.</td>
          <td style="padding:8px 0;"><strong>Share the 6-digit claim code</strong> with ${recFirstName} (find it in your Sent Gifts page).</td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0; vertical-align:top; color:#5C3BCF; font-weight:600;">2.</td>
          <td style="padding:8px 0;">${recFirstName} enters the code and their <strong>SA ID number</strong> on the MINT app.</td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0; vertical-align:top; color:#5C3BCF; font-weight:600;">3.</td>
          <td style="padding:8px 0;">The investment is <strong>transferred to their portfolio.</strong></td>
        </tr>
      </table>
    </div>

    <!-- EXPIRATION NOTICE (Gold Pull-Quote Style) -->
    <div style="border-left:3px solid #DDC357; padding:8px 0 8px 20px; margin-bottom:32px;">
      <p style="font-family:'Outfit', sans-serif; font-size:13.5px; color:#3A3448; margin:0; line-height:1.6; font-weight:300;">
        This gift <strong>expires in 30 days</strong>. If it isn't claimed in time, you can refund it to your wallet from your Sent Gifts page and try again. You can also cancel it there at any time.
      </p>
    </div>

    <!-- CTA BUTTON -->
    <a href="${APP_URL}" style="display:block; background:#31005E; color:#DDC357; text-decoration:none; text-align:center; padding:18px 24px; border-radius:6px; font-family:'Outfit', sans-serif; font-size:13px; font-weight:600; letter-spacing:2px; text-transform:uppercase; margin-bottom:32px; transition: opacity 0.2s ease;">View Sent Gifts</a>

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

function buildGiftRecipientHtml({ senderName, assetName, amountRands, message, claimUrl, isRegistration }) {
  const fmt = (v) => `R${Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const btnLabel = isRegistration ? "Register & Claim Gift" : "Claim My Investment Gift";

  const emailSteps = isRegistration
    ? `
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">1.</td><td style="padding:4px 0;">Register for a MINT account</td></tr>
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">2.</td><td style="padding:4px 0;">Complete your FICA verification</td></tr>
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">3.</td><td style="padding:4px 0;">Your gift will be added to your portfolio</td></tr>
    `
    : `
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">1.</td><td style="padding:4px 0;">Click the claim button below</td></tr>
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">2.</td><td style="padding:4px 0;">Log into your MINT account</td></tr>
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">3.</td><td style="padding:4px 0;">The investment will be added to your portfolio</td></tr>
    `;

  const messageHtml = message ? `<div style="background:#ede9fe;border-left:4px solid #7c3aed;border-radius:8px;padding:16px 20px;margin:20px 0 32px;"><p style="color:#4c1d95;font-size:14px;margin:0;font-family:'Outfit', sans-serif;">"${message}"</p></div>` : "";

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

  <div style="background:#31005E; border-bottom:3px solid #DDC357;">
    
    <div style="padding:32px 36px; text-align:center;">
      <p style="font-family:'Outfit', sans-serif; font-size:11px; font-weight:600; color:#DDC357; margin:0 0 10px; text-transform:uppercase; letter-spacing:3px;">A gift that grows</p>
      <h1 style="font-family:'Inter', sans-serif; font-size:28px; font-weight:300; color:#ffffff; margin:0; letter-spacing:-0.5px; line-height:1.15;">Surprise! You just got a gift.</h1>
    </div>
    
    <img src="https://mfxnghmuccevsxwcetej.supabase.co/storage/v1/object/public/Emailer%20Ads/Gifting%20New%20Image.png.jpg" alt="MINT Gift" style="width:100%; height:auto; display:block; margin:0;">
    
  </div>

  <div style="padding:40px 36px 36px;">
    
    <h2 style="font-family:'Inter', sans-serif; font-size:22px; font-weight:600; color:#31005E; margin:0 0 12px; letter-spacing:-0.2px;">${senderName} sent you a surprise.</h2>
    <p style="font-family:'Outfit', sans-serif; font-size:16px; color:#3A3448; line-height:1.6; margin:0 0 32px; font-weight:300;">${senderName} has gifted you <strong style="color:#7c3aed;">${fmt(amountRands)}</strong> invested in <strong>${assetName}</strong> on MINT.</p>
    
    ${messageHtml}

    <div style="background:#F9F8FB; border:1px solid #E4E0EC; border-radius:8px; padding:28px; margin-bottom:32px;">
      <p style="font-family:'Outfit', sans-serif; font-size:10px; font-weight:600; color:#5C3BCF; text-transform:uppercase; letter-spacing:2px; margin:0 0 16px;">How to claim your gift</p>
      <table style="width:100%; border-collapse:collapse; font-family:'Outfit', sans-serif; font-size:14.5px; color:#2C2738; font-weight:300; line-height:1.6;">
        ${emailSteps}
      </table>
    </div>

    <a href="${claimUrl}" style="display:block; background:#31005E; color:#DDC357; text-decoration:none; text-align:center; padding:18px 24px; border-radius:6px; font-family:'Outfit', sans-serif; font-size:13px; font-weight:600; letter-spacing:2px; text-transform:uppercase; margin-bottom:28px; transition: opacity 0.2s ease;">${btnLabel}</a>

    <div style="text-align:center; border-top:1px solid #F0EDF5; padding-top:24px;">
      <p style="font-family:'Outfit', sans-serif; font-size:11px; color:#8A8398; line-height:1.6; margin:0; font-weight:300;">
        The gift expires in 30 days<br>
        MINT - Money In Transit.<br>
        MINT Platforms(Pty) Ltd is an authorised Financial Services Provider (FSP 55118) regulated by the Financial Sector Conduct Authority and a registered Credit Provider (NCRCP22892) under the National Credit Act.
      </p>
    </div>

  </div>
</div>

</body>
</html>`;
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

  const {
    recipient_identifier,
    amount,
    asset_type,
    strategy_id,
    security_id,
    security_symbol,
    asset_name,
    message,
  } = req.body || {};

  if (!recipient_identifier?.trim()) return res.status(400).json({ error: "Recipient email or phone is required." });
  if (!amount || typeof amount !== "number" || amount <= 0) return res.status(400).json({ error: "Amount must be a positive number (in cents)." });
  if (!["strategy", "stock"].includes(asset_type)) return res.status(400).json({ error: "asset_type must be 'strategy' or 'stock'." });
  if (!asset_name) return res.status(400).json({ error: "asset_name is required." });
  if (asset_type === "strategy" && !strategy_id) return res.status(400).json({ error: "strategy_id required for strategy gifts." });
  if (asset_type === "stock" && !security_id) return res.status(400).json({ error: "security_id required for stock gifts." });

  const identifier = recipient_identifier.trim().toLowerCase();

  const { data: senderProfile } = await db.from("profiles").select("first_name, last_name, email").eq("id", user.id).maybeSingle();
  if (!senderProfile) return res.status(400).json({ error: "Sender profile not found." });
  if (senderProfile.email?.toLowerCase() === identifier) {
    return res.status(400).json({ error: "You cannot gift to yourself." });
  }

  const { data: wallet } = await db.from("wallets").select("balance").eq("user_id", user.id).maybeSingle();
  const walletBalanceCents = Math.round(Number(wallet?.balance || 0) * 100);
  if (walletBalanceCents < amount) {
    return res.status(400).json({ error: "Insufficient wallet balance." });
  }

  const isEmail = identifier.includes("@");
  let recipientUserId = null;
  let recipientEmail = null;
  let recipientProfileFetched = null;

  if (isEmail) {
    const { data: recipientProfile } = await db
      .from("profiles")
      .select("id, email, first_name, last_name")
      .eq("email", identifier)
      .maybeSingle();
    if (recipientProfile) {
      recipientUserId = recipientProfile.id;
      recipientEmail = recipientProfile.email;
      recipientProfileFetched = recipientProfile;
    } else {
      recipientEmail = identifier;
    }
  } else {
    const { data: recipientProfile } = await db
      .from("profiles")
      .select("id, email, phone, first_name, last_name")
      .eq("phone", identifier)
      .maybeSingle();
    if (recipientProfile) {
      recipientUserId = recipientProfile.id;
      recipientEmail = recipientProfile.email;
      recipientProfileFetched = recipientProfile;
    }
  }

  const status = recipientUserId ? "pending_claim" : "pending_registration";
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const newBalanceRands = (walletBalanceCents - amount) / 100;
  const { error: walletErr } = await db
    .from("wallets")
    .update({ balance: newBalanceRands })
    .eq("user_id", user.id);
  if (walletErr) return res.status(500).json({ error: "Failed to deduct from wallet." });

  const { data: gift, error: giftErr } = await db
    .from("gift_claims")
    .insert({
      sender_user_id: user.id,
      recipient_identifier: identifier,
      recipient_user_id: recipientUserId,
      amount,
      asset_type,
      strategy_id: strategy_id || null,
      security_id: security_id || null,
      security_symbol: security_symbol || null,
      asset_name,
      token,
      status,
      message: message?.trim() || null,
      expires_at: expiresAt,
    })
    .select("id, token, status")
    .single();

  if (giftErr) {
    await db.from("wallets").update({ balance: walletBalanceCents / 100 }).eq("user_id", user.id);
    console.error("[gift/create] insert error:", giftErr.message);
    return res.status(500).json({ error: "Failed to create gift." });
  }

  try {
    await db.from("transactions").insert({
      user_id: user.id,
      direction: "debit",
      name: `Investment Gift — ${asset_name}`,
      description: `Gift to ${identifier}`,
      amount,
      store_reference: `GIFT-${gift.id}`,
      status: "posted",
    });
  } catch (e) { console.warn("[gift/create] tx insert:", e.message); }

  if (recipientUserId) {
    const amountRands = amount / 100;
    const senderName = [senderProfile.first_name, senderProfile.last_name].filter(Boolean).join(" ") || "Someone";
    try {
      await db.from("notifications").insert({
        user_id: recipientUserId,
        title: `🎁 You've received an investment gift!`,
        body: `${senderName} gifted you R${amountRands.toFixed(2)} in ${asset_name}. Tap to claim it.`,
        type: "investment",
        payload: { action: "gift_received", gift_id: gift.id, token, asset_name, amount },
      });
    } catch (e) { console.warn("[gift/create] notification insert:", e.message); }
  }

  const resend = getResend();
  if (resend) {
    const amountRands = amount / 100;
    const senderName = [senderProfile.first_name, senderProfile.last_name].filter(Boolean).join(" ") || "Someone";
    const claimPath = status === "pending_registration"
      ? `/register?gift=${gift.id}&token=${token}`
      : `/gift/claim/${token}`;
    const claimUrl = `${APP_URL}${claimPath}`;
    const isRegistration = status === "pending_registration";

    try {
      if (senderProfile.email) {
        await resend.emails.send({
          from: "Mint <noreply@mymint.co.za>",
          to: [senderProfile.email],
          subject: `Your gift of R${amountRands.toFixed(2)} in ${asset_name} has been sent`,
          html: buildGiftSentHtml({
            senderFirstName: senderProfile.first_name,
            recipientFirstName: recipientProfileFetched?.first_name,
            recipientLastName: recipientProfileFetched?.last_name,
            recipientIdentifier: identifier,
            assetName: asset_name,
            amountRands,
          }),
        });
      }
    } catch (e) { console.warn("[gift/create] sender email:", e.message); }

    if (isEmail && recipientEmail) {
      try {
        await resend.emails.send({
          from: "Mint <noreply@mymint.co.za>",
          to: [recipientEmail],
          subject: `${senderName} gifted you R${amountRands.toFixed(2)} on Mint 🎁`,
          html: buildGiftRecipientHtml({ senderName, assetName: asset_name, amountRands, message, claimUrl, isRegistration }),
        });
      } catch (e) { console.warn("[gift/create] recipient email:", e.message); }
    }
  }

  return res.json({
    success: true,
    gift_id: gift.id,
    status: gift.status,
    token: gift.token,
  });
}
