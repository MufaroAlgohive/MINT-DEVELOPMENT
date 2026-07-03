import { supabase, supabaseAdmin, authenticateUser } from "../_lib/supabase.js";
import { Resend } from "resend";

function escHtml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabase || !supabaseAdmin) {
      return res.status(500).json({ error: "Admin database client not configured" });
    }

    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { email, first_name, last_name } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }
    const normalizedEmail = email.trim().toLowerCase();

    // Reject if this email already belongs to a Mint account
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", normalizedEmail)
      .limit(1);
    if (existing?.length > 0) {
      return res.status(409).json({
        error: "This email already has a Mint account. Search by email to find them instead.",
      });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return res.json({ success: true, email_sent: false });
    }

    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle();

    const senderRaw = [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(" ") || "Someone on Mint";
    const senderName = escHtml(senderRaw);
    const inviteeName = first_name ? `Hi ${escHtml(first_name)},` : "Hi there,";
    const appUrl = process.env.APP_URL || "https://app.mymint.co.za";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#EEEAF5;font-family:'Barlow',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 20px;">
    <div style="background:#3D1A6B;border-radius:16px 16px 0 0;padding:20px 32px;text-align:center;">
      <div style="font-family:'Barlow Condensed',Arial Narrow,Arial,sans-serif;font-size:36px;font-weight:800;color:white;letter-spacing:4px;text-transform:uppercase;">MINT</div>
      <div style="color:rgba(255,255,255,0.55);font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-top:3px;">Investment &amp; Wealth Platform</div>
    </div>
    <div style="height:3px;background:linear-gradient(90deg,#5B2D8E,#7B4DB0,#EDE8F8);"></div>
    <div style="background:white;border-radius:0 0 16px 16px;padding:36px 32px;">
      <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 16px;">${inviteeName}</p>
      <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 16px;">
        <strong style="color:#3D1A6B;">${senderName}</strong> has invited you to join
        <strong style="color:#3D1A6B;">MINT</strong> &mdash; South Africa&rsquo;s smart investing and wealth platform &mdash; and wants to add you as a <strong>beneficiary</strong>.
      </p>
      <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 28px;">
        Sign up to start building your financial future, receive gifts, and manage your wealth in one place.
      </p>
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#3D1A6B,#5B2D8E);color:white;padding:14px 44px;border-radius:12px;text-decoration:none;font-family:'Barlow Condensed',Arial Narrow,Arial,sans-serif;font-weight:800;font-size:17px;letter-spacing:1px;text-transform:uppercase;">Join MINT</a>
      </div>
      <p style="color:#94a3b8;font-size:11px;text-align:center;margin:0;">If you weren&rsquo;t expecting this invitation, you can safely ignore this email.</p>
    </div>
    <p style="color:#a0aec0;font-size:10px;text-align:center;margin-top:16px;">Mint Financial Services (Pty) Ltd &nbsp;&middot;&nbsp; FSP No. 55118</p>
  </div>
</body>
</html>`;

    let emailSent = false;
    try {
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: "Mint <noreply@mymint.co.za>",
        to: [normalizedEmail],
        subject: `${senderRaw} invited you to join Mint`,
        html,
      });
      emailSent = true;
    } catch (emailErr) {
      console.error("[invite-beneficiary] email send failed:", emailErr.message);
    }

    return res.json({ success: true, email_sent: emailSent });
  } catch (e) {
    console.error("[invite-beneficiary] error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}
