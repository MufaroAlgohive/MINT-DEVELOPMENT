import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";
import { Resend } from "resend";

const EXPIRY_HOURS = 4;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.mymint.co.za";

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

async function generateUniqueCode(db) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { data: existing } = await db
      .from("gift_claims")
      .select("id")
      .eq("token", code)
      .eq("status", "pending_claim")
      .maybeSingle();
    if (!existing) return code;
  }
  throw new Error("Could not generate unique gift code");
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
    asset_type, strategy_id, security_id, security_symbol, asset_name,
    amount, recipient_identifier, recipient_first_name, recipient_last_name, message,
  } = req.body || {};

  if (!asset_name) return res.status(400).json({ error: "asset_name is required." });
  if (!amount || typeof amount !== "number" || amount <= 0) return res.status(400).json({ error: "amount must be a positive number in cents." });
  if (!["strategy", "stock"].includes(asset_type)) return res.status(400).json({ error: "asset_type must be 'strategy' or 'stock'." });
  if (!recipient_first_name?.trim()) return res.status(400).json({ error: "recipient_first_name is required." });
  // last name is optional — non-Mint invitees may only have a first name
  const normalizedLastName = (recipient_last_name || "").trim();

  // Block self-gifting
  if (recipient_identifier?.trim()) {
    const recipId = recipient_identifier.trim().toLowerCase();
    const senderAuthEmail = user.email?.toLowerCase() || "";
    const { data: senderProf } = await db.from("profiles").select("email").eq("id", user.id).maybeSingle();
    const senderProfileEmail = senderProf?.email?.toLowerCase() || "";
    if (recipId === senderAuthEmail || recipId === senderProfileEmail) {
      return res.status(400).json({ error: "You cannot gift to yourself." });
    }
    const { data: recipProf } = await db.from("profiles").select("id").eq("email", recipId).maybeSingle();
    if (recipProf?.id === user.id) {
      return res.status(400).json({ error: "You cannot gift to yourself." });
    }
  }

  // Reserve model: the sender's wallet is DEBITED now, at send time, so the
  // funds genuinely leave their spendable balance (no double-spend). Claim does
  // NOT debit again; expire/cancel refund. See gift_claims.reserved_at.
  const { data: wallet, error: walletQueryErr } = await db
    .from("wallets").select("balance").eq("user_id", user.id).maybeSingle();
  if (walletQueryErr || !wallet) return res.status(400).json({ error: "Wallet not found." });

  const originalBalance = Number(wallet.balance);
  const amountRands = amount / 100;
  if (originalBalance < amountRands) return res.status(400).json({ error: "Insufficient wallet balance." });

  // Encode recipient name + message into the message column as JSON
  const messagePayload = JSON.stringify({
    fn: recipient_first_name.trim(),
    ln: normalizedLastName,
    ...(message?.trim() ? { msg: message.trim() } : {}),
  });

  let code;
  try { code = await generateUniqueCode(db); }
  catch (e) { return res.status(500).json({ error: "Failed to generate gift code. Please try again." }); }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  // Debit the wallet FIRST, so a claimable gift can never exist without the money
  // having been taken. If the gift row then fails to save, we roll the debit back.
  const { error: debitErr } = await db
    .from("wallets").update({ balance: originalBalance - amountRands }).eq("user_id", user.id);
  if (debitErr) {
    console.error("[gift/create-v2] wallet debit error:", debitErr.message);
    return res.status(500).json({ error: "Failed to reserve gift funds." });
  }

  const { data: gift, error: insertErr } = await db
    .from("gift_claims")
    .insert({
      sender_user_id: user.id,
      recipient_identifier: recipient_identifier?.trim().toLowerCase() || null,
      recipient_user_id: null,
      amount,
      asset_type,
      strategy_id: strategy_id || null,
      security_id: security_id || null,
      security_symbol: security_symbol || null,
      asset_name,
      token: code,
      status: "pending_claim",
      message: messagePayload,
      expires_at: expiresAt,
      reserved_at: now,
    })
    .select("id, token, expires_at")
    .single();

  if (insertErr) {
    // Roll the debit back — the sender must not be charged for a gift that didn't save.
    await db.from("wallets").update({ balance: originalBalance }).eq("user_id", user.id);
    console.error("[gift/create-v2] insert error:", insertErr.message, insertErr.details, insertErr.hint);
    return res.status(500).json({ error: "Failed to create gift.", detail: insertErr.message });
  }

  // Record the reservation as a posted debit in the sender's history. Claim
  // transfers it to the recipient (no refund); expire/cancel post an offsetting
  // credit back to the sender.
  try {
    await db.from("transactions").insert({
      user_id: user.id,
      direction: "debit",
      name: `Investment Gift — ${asset_name}`,
      description: `Gift to ${recipient_first_name.trim()}${normalizedLastName ? ` ${normalizedLastName}` : ""} — reserved until claimed`,
      amount,
      store_reference: `GIFT2-HOLD-${gift.id}`,
      currency: "ZAR",
      status: "posted",
      transaction_date: now,
      created_at: now,
    });
  } catch (e) { console.warn("[gift/create-v2] tx insert:", e.message); }

  // Post-creation: emails + in-app notification
  const recipientEmail = recipient_identifier?.trim().toLowerCase();
  const { data: senderProfile } = await db.from("profiles").select("first_name, last_name").eq("id", user.id).maybeSingle();
  const senderName = [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(" ") || "Someone";
  const senderAuthEmail = user.email;

  let recipientStatus = "not_registered";
  if (recipientEmail) {
    try {
      const { data: recipientProfile } = await db.from("profiles").select("id").eq("email", recipientEmail).maybeSingle();
      if (recipientProfile?.id) {
        const { data: onboarding } = await db.from("user_onboarding").select("kyc_status").eq("user_id", recipientProfile.id).maybeSingle();
        const kycDone = onboarding?.kyc_status === "verified" || onboarding?.kyc_status === "onboarding_complete";
        recipientStatus = kycDone ? "ready" : "needs_kyc";
        if (kycDone) {
          await db.from("notifications").insert({
            user_id: recipientProfile.id,
            title: `You've been gifted ${asset_name}! 🎁`,
            body: `${senderName} gifted you ${asset_name} on Mint. Ask them for your 6-digit claim code to claim it.`,
            type: "system",
            payload: { action: "gift_received", gift_id: gift.id, asset_name },
          });
        }
      }
    } catch (e) { console.warn("[gift/create-v2] recipient status check:", e.message); }
  }

  const resend = getResend();
  if (resend) {
    // Sender confirmation email
    if (senderAuthEmail) {
      try {
        await resend.emails.send({
          from: "Mint <noreply@mymint.co.za>",
          to: [senderAuthEmail],
          subject: `Your gift of ${asset_name} has been sent 🎁`,
          html: `<!DOCTYPE html>
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
    
    <p style="font-family:'Outfit', sans-serif; font-size:16px; color:#3A3448; line-height:1.6; margin:0 0 24px; font-weight:300;">Hi ${senderProfile?.first_name || "there"},</p>
    
    <p style="font-family:'Outfit', sans-serif; font-size:16px; color:#3A3448; line-height:1.6; margin:0 0 32px; font-weight:300;">
      Your gift of <strong>R${amountRands.toFixed(2)}</strong> in <strong>${asset_name}</strong> to ${recipient_first_name.trim()}${normalizedLastName ? ` ${normalizedLastName}` : ""} has been sent successfully.
    </p>

    <!-- INSTRUCTIONS BOX -->
    <div style="background:#F9F8FB; border:1px solid #E4E0EC; border-radius:8px; padding:28px; margin-bottom:24px;">
      <p style="font-family:'Outfit', sans-serif; font-size:10px; font-weight:600; color:#5C3BCF; text-transform:uppercase; letter-spacing:2px; margin:0 0 16px;">What happens next?</p>
      
      <table class="steps-table" style="width:100%; border-collapse:collapse; font-family:'Outfit', sans-serif; font-size:14.5px; color:#2C2738; font-weight:300; line-height:1.6;">
        <tr>
          <td style="padding:8px 12px 8px 0; vertical-align:top; width:24px; color:#5C3BCF; font-weight:600;">1.</td>
          <td style="padding:8px 0;"><strong>Share the 6-digit claim code</strong> with ${recipient_first_name.trim()} (find it in your Sent Gifts page).</td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0; vertical-align:top; color:#5C3BCF; font-weight:600;">2.</td>
          <td style="padding:8px 0;">${recipient_first_name.trim()} enters the code and their <strong>SA ID number</strong> on the MINT app.</td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0; vertical-align:top; color:#5C3BCF; font-weight:600;">3.</td>
          <td style="padding:8px 0;">The investment is <strong>transferred to their portfolio.</strong></td>
        </tr>
      </table>
    </div>

    <!-- EXPIRATION NOTICE -->
    <div style="border-left:3px solid #DDC357; padding:8px 0 8px 20px; margin-bottom:32px;">
      <p style="font-family:'Outfit', sans-serif; font-size:13.5px; color:#3A3448; margin:0; line-height:1.6; font-weight:300;">
        This gift <strong>expires in 4 hours</strong>. If it isn't claimed in time, you can refund it to your wallet from your Sent Gifts page and try again. You can also cancel it there at any time.
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
</html>`,
        });
        console.log(`[gift/create-v2] Sender confirmation sent to ${senderAuthEmail}`);
      } catch (e) { console.warn("[gift/create-v2] sender email:", e.message); }
    }

    // Recipient notification email
    if (recipientEmail) {
      let emailSteps, emailCta, emailSubject;
      if (recipientStatus === "not_registered") {
        emailSubject = `You've been gifted an investment — sign up on Mint to claim it 🎁`;
        emailSteps = `
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">1.</td><td style="padding:4px 0;"><strong>Sign up</strong> for a free Mint account</td></tr>
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">2.</td><td style="padding:4px 0;">Complete your <strong>FICA verification</strong> (takes ~2 min)</td></tr>
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">3.</td><td style="padding:4px 0;">Ask <strong>${senderName}</strong> for the 6-digit code, then tap <strong>Claim a Gift</strong></td></tr>
        `;
        emailCta = "Sign Up on Mint";
      } else if (recipientStatus === "needs_kyc") {
        emailSubject = `${senderName} gifted you an investment — complete KYC to claim 🎁`;
        emailSteps = `
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">1.</td><td style="padding:4px 0;">Open the Mint app and complete your <strong>FICA verification</strong></td></tr>
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">2.</td><td style="padding:4px 0;">Ask <strong>${senderName}</strong> for the 6-digit claim code</td></tr>
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">3.</td><td style="padding:4px 0;">Tap <strong>Claim a Gift</strong> and enter the code + your SA ID number</td></tr>
        `;
        emailCta = "Complete KYC on Mint";
      } else {
        emailSubject = `${senderName} gifted you an investment on Mint 🎁`;
        emailSteps = `
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">1.</td><td style="padding:4px 0;">Ask <strong>${senderName}</strong> for the 6-digit claim code</td></tr>
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">2.</td><td style="padding:4px 0;">Sign in to the Mint app and tap <strong>Claim a Gift</strong></td></tr>
      <tr><td style="padding:4px 0; color:#8A8398; width:20px; vertical-align:top;">3.</td><td style="padding:4px 0;">Enter the code + your SA ID number</td></tr>
        `;
        emailCta = "Open Mint App";
      }

      try {
        await resend.emails.send({
          from: "Mint <noreply@mymint.co.za>",
          to: [recipientEmail],
          subject: emailSubject,
          html: `<!DOCTYPE html>
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
    <p style="font-family:'Outfit', sans-serif; font-size:16px; color:#3A3448; line-height:1.6; margin:0 0 32px; font-weight:300;">${senderName} has gifted you <strong style="color:#7c3aed;">R${amountRands.toFixed(2)}</strong> invested in <strong>${asset_name}</strong> on MINT.</p>
    
    <div style="background:#F9F8FB; border:1px solid #E4E0EC; border-radius:8px; padding:28px; margin-bottom:32px;">
      <p style="font-family:'Outfit', sans-serif; font-size:10px; font-weight:600; color:#5C3BCF; text-transform:uppercase; letter-spacing:2px; margin:0 0 16px;">How to claim your gift</p>
      <table style="width:100%; border-collapse:collapse; font-family:'Outfit', sans-serif; font-size:14.5px; color:#2C2738; font-weight:300; line-height:1.6;">
        ${emailSteps}
      </table>
    </div>

    <a href="${APP_URL}/?gift=${gift.id}" style="display:block; background:#31005E; color:#DDC357; text-decoration:none; text-align:center; padding:18px 24px; border-radius:6px; font-family:'Outfit', sans-serif; font-size:13px; font-weight:600; letter-spacing:2px; text-transform:uppercase; margin-bottom:28px; transition: opacity 0.2s ease;">🎁 ${emailCta}</a>

    <div style="text-align:center; border-top:1px solid #F0EDF5; padding-top:24px;">
      <p style="font-family:'Outfit', sans-serif; font-size:11px; color:#8A8398; line-height:1.6; margin:0; font-weight:300;">
        The gift expires in 4 hours<br>
        MINT - Money In Transit.<br>
        MINT Platforms(Pty) Ltd is an authorised Financial Services Provider (FSP 55118) regulated by the Financial Sector Conduct Authority and a registered Credit Provider (NCRCP22892) under the National Credit Act.
      </p>
    </div>

  </div>
</div>

</body>
</html>`,
        });
        console.log(`[gift/create-v2] Recipient email sent to ${recipientEmail} (status: ${recipientStatus})`);
      } catch (e) { console.warn("[gift/create-v2] recipient email:", e.message); }
    }
  } else {
    console.warn("[gift/create-v2] RESEND_API_KEY not set — skipping emails");
  }

  return res.json({ success: true, token: gift.token, expires_at: gift.expires_at, gift_id: gift.id });
}
