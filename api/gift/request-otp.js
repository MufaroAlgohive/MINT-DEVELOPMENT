import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";
import { Resend } from "resend";

// In-memory store: userId → { code, expiresAt }
// Shared across requests in the same serverless instance; good enough for OTP use.
const otpStore = new Map();

export { otpStore };

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

function buildOtpHtml({ firstName, code }) {
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
      <p style="font-family:'Outfit', sans-serif; font-size:11px; font-weight:600; color:#DDC357; margin:0 0 10px; text-transform:uppercase; letter-spacing:3px;">Security Verification</p>
      <h1 style="font-family:'Inter', sans-serif; font-size:28px; font-weight:300; color:#ffffff; margin:0; letter-spacing:-0.5px; line-height:1.2;">Your Claim Code.</h1>
    </div>
    
  </div>

  <div style="padding:40px 36px 36px;">
    
    <p style="font-family:'Outfit', sans-serif; font-size:16px; color:#3A3448; line-height:1.6; margin:0 0 24px; font-weight:300;">Hi ${firstName},</p>
    
    <p style="font-family:'Outfit', sans-serif; font-size:16px; color:#3A3448; line-height:1.6; margin:0 0 36px; font-weight:300;">
      Use the code below to confirm your investment gift. <strong>It expires in 10 minutes.</strong>
    </p>

    <div style="background:#F9F8FB; border:1px solid #E4E0EC; border-radius:8px; padding:32px; margin-bottom:36px; text-align:center;">
      <span style="font-family:'Inter', sans-serif; font-size:40px; font-weight:800; letter-spacing:12px; color:#5C3BCF;">${code}</span>
    </div>

    <!-- EXPIRATION NOTICE -->
    <div style="border-left:3px solid #DDC357; padding:8px 0 8px 20px; margin-bottom:32px;">
      <p style="font-family:'Outfit', sans-serif; font-size:13.5px; color:#3A3448; margin:0; line-height:1.6; font-weight:300;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>

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

  const { data: senderProfile } = await db.from("profiles").select("first_name, email").eq("id", user.id).maybeSingle();
  if (!senderProfile?.email) return res.status(400).json({ error: "No email address on your account." });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(user.id, { code, expiresAt: Date.now() + 10 * 60 * 1000 });

  const firstName = senderProfile.first_name || "there";
  const resend = getResend();
  if (resend) {
    try {
      const otpTo = process.env.RESEND_FROM ? senderProfile.email : (process.env.RESEND_TEST_EMAIL || senderProfile.email);
      const otpResult = await resend.emails.send({
        from: process.env.RESEND_FROM || "Mint <onboarding@resend.dev>",
        to: [otpTo],
        subject: `Your Mint gift verification code: ${code}`,
        html: buildOtpHtml({ firstName, code }),
      });
      if (otpResult?.error) {
        console.warn("[gift/request-otp] Email delivery failed:", otpResult.error.message);
        console.log(`\n[DEV] OTP code for ${senderProfile.email}: ${code}\n`);
      }
    } catch (e) {
      console.warn("[gift/request-otp] email exception:", e.message);
      console.log(`\n[DEV] OTP code for ${senderProfile.email}: ${code}\n`);
    }
  } else {
    console.log(`\n[DEV] OTP code for ${senderProfile.email}: ${code}\n`);
  }

  res.json({ success: true });
}
