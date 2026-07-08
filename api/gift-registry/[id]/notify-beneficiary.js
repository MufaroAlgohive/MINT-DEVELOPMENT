import { supabaseAdmin, authenticateUser } from '../../_lib/supabase.js';
import { Resend } from 'resend';

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) {
      console.warn('[notify-beneficiary] ❌ auth failed:', authError?.message);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.query;
    const { email, firstName, isNudge } = req.body || {};
    console.log('[notify-beneficiary] ▶ called by:', user.id, '| registry:', id, '| email:', email, '| isNudge:', isNudge);

    if (!email) return res.status(400).json({ error: 'email is required' });
    const normalizedEmail = email.trim().toLowerCase();

    // Verify registry belongs to this user
    const { data: registry, error: regError } = await supabaseAdmin
      .from('gift_events')
      .select('id, title, share_token, creator_user_id')
      .eq('id', id)
      .eq('creator_user_id', user.id)
      .single();

    if (!registry) {
      console.warn('[notify-beneficiary] ❌ registry not found or not owned by caller | regError:', regError?.message);
      return res.status(404).json({ error: 'Registry not found' });
    }
    console.log('[notify-beneficiary] registry verified:', registry.title, '| share_token:', registry.share_token ? '✅' : '❌ missing');

    // Check if the recipient has a Mint account
    const { data: profiles, error: profError } = await supabaseAdmin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .ilike('email', normalizedEmail)
      .limit(1);

    console.log('[notify-beneficiary] profile lookup for', normalizedEmail, '→', profiles?.length ?? 0, 'row(s)', profError ? `| DB error: ${profError.message}` : '');
    const recipientProfile = profiles?.[0];

    if (!recipientProfile) {
      console.log('[notify-beneficiary] ℹ️ no Mint account found → returning has_account:false');
      // No account — caller will handle invite separately
      return res.status(200).json({ has_account: false });
    }
    console.log('[notify-beneficiary] recipient profile found:', recipientProfile.first_name, recipientProfile.last_name, '| id:', recipientProfile.id);

    // Look up sender's name
    const { data: senderProfile } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .maybeSingle();

    const senderRaw = [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(' ') || 'Someone on Mint';
    const senderName = escHtml(senderRaw);
    const recipientName = firstName || recipientProfile.first_name || normalizedEmail.split('@')[0];
    const appUrl = process.env.APP_URL || 'https://app.mymint.co.za';
    const registryTitle = escHtml(registry.title || 'My Wishlist');

    // Build share URL
    const shareUrl = registry.share_token
      ? `${appUrl}/gift/registry/${registry.share_token}`
      : appUrl;

    const subjectLine = isNudge
      ? `${senderRaw} is nudging you about their wishlist 🎁`
      : `${senderRaw} shared their investment wishlist with you`;

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
      <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 16px;">Hi ${escHtml(recipientName)},</p>
      ${isNudge ? `
      <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 16px;">
        <strong style="color:#3D1A6B;">${senderName}</strong> wanted to remind you about their investment wishlist on <strong style="color:#3D1A6B;">MINT</strong>.
      </p>` : `
      <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 16px;">
        <strong style="color:#3D1A6B;">${senderName}</strong> has shared their investment wishlist &ldquo;${registryTitle}&rdquo; with you on <strong style="color:#3D1A6B;">MINT</strong>.
      </p>`}
      <p style="color:#334155;font-size:15px;line-height:1.7;margin:0 0 28px;">
        You can view their wishlist and contribute an investment gift directly from the app.
      </p>
      <div style="background:#F5F0FF;border-radius:12px;padding:16px 20px;margin:0 0 24px;">
        <p style="color:#3D1A6B;font-size:13px;font-weight:600;margin:0 0 8px;">🎁 ${escHtml(registryTitle)}</p>
        <p style="color:#64748B;font-size:13px;margin:0 0 12px;">Tap below to view and gift an investment.</p>
        <a href="${escHtml(shareUrl)}" style="display:inline-block;background:#3D1A6B;color:white;padding:10px 24px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;">View Wishlist</a>
      </div>
      <p style="color:#94a3b8;font-size:11px;text-align:center;margin:0;">If you weren&rsquo;t expecting this, you can safely ignore this email.</p>
    </div>
    <p style="color:#a0aec0;font-size:10px;text-align:center;margin-top:16px;">Mint Financial Services (Pty) Ltd &nbsp;&middot;&nbsp; FSP No. 55118</p>
  </div>
</body>
</html>`;

    const resendKey = process.env.RESEND_API_KEY;
    console.log('[notify-beneficiary] RESEND_API_KEY:', resendKey ? '✅ set' : '❌ missing — email will be skipped');
    console.log('[notify-beneficiary] subject:', subjectLine);
    console.log('[notify-beneficiary] to:', normalizedEmail);
    console.log('[notify-beneficiary] share_url:', shareUrl);

    if (!resendKey) {
      console.warn('[notify-beneficiary] ⚠️ no RESEND_API_KEY — returning ok:true without sending email');
      return res.status(200).json({ ok: true, sentAt: new Date().toISOString(), email_sent: false });
    }

    try {
      const resend = new Resend(resendKey);
      const sendResult = await resend.emails.send({
        from: 'Mint <noreply@mymint.co.za>',
        to: [normalizedEmail],
        subject: subjectLine,
        html,
      });
      console.log('[notify-beneficiary] ✅ Resend response:', JSON.stringify(sendResult?.data || sendResult));
    } catch (emailErr) {
      console.error('[notify-beneficiary] ❌ Resend send failed:', emailErr.message, emailErr.statusCode);
      // Don't fail the whole request if email sending fails
    }

    console.log('[notify-beneficiary] ✅ done — returning ok:true');
    return res.status(200).json({ ok: true, sentAt: new Date().toISOString() });
  } catch (e) {
    console.error('[notify-beneficiary] ❌ unexpected error:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
}
