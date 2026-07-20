/**
 * GET /api/og-preview?token=:shareToken
 *
 * Handles /registry/:token and /gift/:token URLs so social crawlers
 * (WhatsApp, iMessage, Telegram, Discord, Slack, etc.) see rich OG preview
 * cards when a wishlist link is shared.
 *
 * Strategy:
 *  - Social bots  → lightweight standalone HTML with OG meta tags only.
 *                   Bots don't execute JS so they don't need the SPA.
 *  - Real users   → dist/index.html with OG tags injected so the SPA boots
 *                   normally and React routes to the registry page.
 *                   Falls back to a JS redirect to / if the file is missing.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Known social/link-preview crawlers
const BOT_RE = /whatsapp|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|applebot|googlebot|bingbot|embedly|quora link preview|pinterest|vkshare|w3c_validator|rogerbot|showyoubot|outbrain|quora/i;

function isBot(ua = '') {
  return BOT_RE.test(ua);
}

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const OCCASION_LABELS = {
  BIRTHDAY: 'Birthday',
  BABY_SHOWER: 'Baby Shower',
  WEDDING: 'Wedding',
  ANNIVERSARY: 'Anniversary',
  CHRISTMAS: 'Christmas',
  GRADUATION: 'Graduation',
  OTHER: 'Wishlist',
};

async function fetchRegistryMeta(token) {
  if (!token || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await sb
      .from('gift_events')
      .select('title, occasion, beneficiary_display_name, items:gift_registry_items(id, status)')
      .eq('share_token', token)
      .not('status', 'in', '(CANCELLED,EXPIRED)')
      .maybeSingle();
    return data || null;
  } catch (e) {
    console.error('[og-preview] supabase error:', e.message);
    return null;
  }
}

function buildOgMeta(reg) {
  let title = 'Gift Wishlist on MINT';
  let description = 'Open to see their wishlist and send a gift that matters 🎁';

  if (reg) {
    const occasionLabel = OCCASION_LABELS[reg.occasion] || 'Wishlist';
    const beneficiary = reg.beneficiary_display_name || '';
    const activeItems = (reg.items || []).filter(i => i.status !== 'REMOVED').length;

    if (beneficiary) {
      title = `${beneficiary}'s ${occasionLabel} Wishlist`;
    } else if (reg.title) {
      title = reg.title;
    } else {
      title = `${occasionLabel} Wishlist on MINT`;
    }

    description = activeItems > 0
      ? `${activeItems} gift idea${activeItems !== 1 ? 's' : ''} — open to see their wishlist and send something they\'ll love 🎁`
      : 'Open to see their wishlist and send a gift that matters 🎁';
  }

  return { title, description };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.query.token || '';
  const ua = req.headers['user-agent'] || '';
  const origin = `https://${req.headers.host}`;
  const pageUrl = `${origin}/registry/${token}`;
  // og-gift-preview.png is in /public, served at the root on Vercel
  const imageUrl = `${origin}/og-gift-preview.png`;

  const reg = await fetchRegistryMeta(token);
  const { title, description } = buildOgMeta(reg);

  const ogTags = `
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="MINT">
  <meta property="og:url" content="${esc(pageUrl)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(imageUrl)}">
  <meta property="og:image:secure_url" content="${esc(imageUrl)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(imageUrl)}">`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  // ── BOT PATH ───────────────────────────────────────────────────────────────
  // Serve a tiny standalone page. Bots don't run JS and don't need the SPA.
  if (isBot(ua)) {
    return res.status(200).send(`<!doctype html>
<html lang="en" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  ${ogTags}
</head>
<body>
  <h1>${esc(title)}</h1>
  <p>${esc(description)}</p>
  <a href="${esc(pageUrl)}">Open wishlist on MINT</a>
</body>
</html>`);
  }

  // ── HUMAN PATH ─────────────────────────────────────────────────────────────
  // Try to serve dist/index.html with OG tags injected so the SPA boots normally.
  // Vercel bundles dist/index.html via the includeFiles config in vercel.json.
  let html = null;
  try {
    html = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf8');
  } catch {
    // dist not bundled or not built yet — fall through to redirect
  }

  if (html) {
    // Inject OG tags + update page title
    const pageTitle = `<title>${esc(reg?.title || title)}</title>`;
    if (html.includes('<title>Mint</title>')) {
      html = html.replace('<title>Mint</title>', `${pageTitle}\n  ${ogTags}`);
    } else {
      html = html.replace('<head>', `<head>\n  ${pageTitle}\n  ${ogTags}`);
    }
    return res.status(200).send(html);
  }

  // Last resort: serve a minimal HTML that preserves the registry token in
  // localStorage before redirecting to /, so App.jsx can still open the
  // correct wishlist after the SPA boots (same mechanism as the full path).
  return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  ${ogTags}
  <script>
    try { localStorage.setItem('mint_ogfallback_registry_token', ${JSON.stringify(token)}); } catch(e) {}
    window.location.replace('/');
  </script>
</head>
<body></body>
</html>`);
}
