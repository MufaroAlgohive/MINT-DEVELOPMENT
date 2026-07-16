/**
 * GET /api/og-preview?token=:shareToken&type=registry|gift
 *
 * Serves the SPA's index.html with dynamically injected Open Graph meta tags
 * so that WhatsApp, iMessage, Telegram, etc. show a rich link preview card
 * when a wishlist URL is shared.
 *
 * Bots (WhatsApp crawler etc.) read the <meta> tags and never execute JS,
 * so they see the preview. Real users get the full SPA with the injected tags
 * in the <head> — React hydrates normally and the app routes to the registry.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.query.token || '';
  const origin = `https://${req.headers.host}`;
  const pageUrl = `${origin}/registry/${token}`;
  const imageUrl = `${origin}/og-gift-preview.png`;

  // Defaults used when registry cannot be fetched
  let title = 'Gift Wishlist on MINT';
  let description = 'Open to see their wishlist and send a gift that matters 🎁';
  let registryTitle = '';

  try {
    if (token && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: reg } = await sb
        .from('gift_events')
        .select('title, occasion, beneficiary_display_name, items:gift_registry_items(id, status)')
        .eq('share_token', token)
        .not('status', 'in', '(CANCELLED,EXPIRED)')
        .maybeSingle();

      if (reg) {
        registryTitle = reg.title || '';
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
          ? `${activeItems} gift idea${activeItems !== 1 ? 's' : ''} — open to see their wishlist and send something they'll love 🎁`
          : `Open to see their wishlist and send a gift that matters 🎁`;
      }
    }
  } catch (e) {
    console.error('[og-preview] fetch error:', e.message);
  }

  // Inject OG tags into the built index.html so the SPA still boots for real users
  const ogTags = `
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="MINT" />
    <meta property="og:url" content="${esc(pageUrl)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${esc(imageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(imageUrl)}" />`;

  let html;
  try {
    // In production the built assets live in /dist (Vercel's output directory)
    html = readFileSync(join(process.cwd(), 'dist', 'index.html'), 'utf8');
  } catch {
    // Fallback: minimal shell so the SPA still loads
    html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title></head><body><div id="root"></div></body></html>`;
  }

  // Inject OG tags right after <head> and update <title>
  html = html.replace(
    '<title>Mint</title>',
    `<title>${esc(registryTitle || title)}</title>${ogTags}`,
  );
  // Fallback if title tag differs
  if (!html.includes(ogTags)) {
    html = html.replace('<head>', `<head>${ogTags}`);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Cache 60s on CDN edge, serve stale for up to 5 min while revalidating
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  return res.status(200).send(html);
}
