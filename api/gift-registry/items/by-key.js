/**
 * POST /api/gift-registry/items/by-key
 *
 * Add an item to a registry by an itemKey:
 *   - Plain ISIN / symbol  → single SHARE row
 *   - "gift:{uuid}" or "strategy:{uuid}" → expand strategy holdings → multiple SHARE rows
 *
 * Mirrors the Express route in server/giftRegistryRoutes.cjs.
 */

import { supabaseAdmin, authenticateUser } from '../../_lib/supabase.js';

async function getLatestPriceCents(isin) {
  const { data: intraday } = await supabaseAdmin
    .from('stock_intraday_c')
    .select('current_price')
    .eq('isin', isin)
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();
  if (intraday?.current_price) return intraday.current_price;
  const { data: sec } = await supabaseAdmin.from('securities_c').select('last_price').eq('isin', isin).single();
  return sec?.last_price || 0;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { registryId, itemKey, quantity } = req.body;
    if (!registryId || !itemKey) return res.status(400).json({ error: 'Missing registryId or itemKey' });
    const targetQty = (Number.isInteger(quantity) && quantity >= 1) ? quantity : 1;

    // Verify ownership
    const { data: reg } = await supabaseAdmin
      .from('gift_events').select('id, status')
      .eq('id', registryId).eq('creator_user_id', user.id).single();
    if (!reg) return res.status(404).json({ error: 'Registry not found' });
    if (['CANCELLED', 'EXPIRED'].includes(reg.status))
      return res.status(400).json({ error: 'Cannot add items to a closed registry' });
    if (reg.status === 'COMPLETED') {
      await supabaseAdmin.from('gift_events').update({ status: 'ACTIVE', updated_at: new Date().toISOString() }).eq('id', registryId);
    }

    const isStrategy = itemKey.startsWith('gift:') || itemKey.startsWith('strategy:');

    if (isStrategy) {
      // ── Strategy basket: expand holdings → one SHARE row per holding ──
      const strategyId = itemKey.replace(/^(gift:|strategy:)/, '');
      const { data: strategy, error: stratErr } = await supabaseAdmin
        .from('strategies_c').select('id, name, holdings').eq('id', strategyId).single();
      if (stratErr || !strategy) return res.status(404).json({ error: 'Strategy not found' });

      const holdings = Array.isArray(strategy.holdings) ? strategy.holdings : [];
      if (!holdings.length) return res.status(400).json({ error: 'Strategy has no holdings' });

      const tickers = [...new Set(holdings.map(h => h.ticker || h.symbol || h).filter(Boolean))];
      const { data: securities } = await supabaseAdmin
        .from('securities_c').select('isin, symbol, name, logo_url, last_price').in('symbol', tickers);
      const secBySymbol = Object.fromEntries((securities || []).map(s => [s.symbol, s]));

      // Build preview logos from ALL strategy holdings (logo-having entries first)
      const previewLogos = holdings.slice(0, 6).map(h => {
        const ticker = h.ticker || h.symbol || String(h);
        const sec = secBySymbol[ticker];
        return { symbol: ticker, name: sec?.name || h.name || ticker, logo_url: sec?.logo_url || null };
      });
      previewLogos.sort((a, b) => (b.logo_url ? 1 : 0) - (a.logo_url ? 1 : 0));

      // Find already-added ISINs to avoid duplicates. Only still-open rows
      // (not REMOVED/FILLED) count — a fully gifted holding can be re-added as new.
      const { data: existing } = await supabaseAdmin
        .from('gift_registry_items').select('isin').eq('gift_event_id', registryId).not('status', 'in', '(REMOVED,FILLED)');
      const existingIsins = new Set((existing || []).map(r => r.isin));

      const toInsert = [];
      const seenIsins = new Set(existingIsins);
      for (const h of holdings) {
        const ticker = h.ticker || h.symbol || h;
        const sec = secBySymbol[ticker];
        if (!sec?.isin || seenIsins.has(sec.isin)) continue;
        seenIsins.add(sec.isin);
        const priceCents = sec.last_price || 0;
        const minTranche = priceCents > 0 ? Math.max(1, Math.ceil(1000 / priceCents)) : 1;
        toInsert.push({
          gift_event_id: registryId, isin: sec.isin, instrument_type: 'SHARE',
          target_quantity: targetQty, price_snapshot_cents: priceCents, min_tranche_quantity: minTranche,
        });
      }

      if (!toInsert.length) return res.status(200).json({ success: true, items: [], message: 'All holdings already in registry' });

      const { data: items, error: insertErr } = await supabaseAdmin
        .from('gift_registry_items').insert(toInsert).select();
      if (insertErr) throw insertErr;

      // Persist preview logos as a dedicated top-level user_metadata key.
      // Supabase merges user_metadata at the top level, so this is atomic — no read-modify-write.
      try {
        await supabaseAdmin.auth.admin.updateUserById(user.id, {
          user_metadata: { [`gift_rp_${registryId}`]: previewLogos },
        });
      } catch { /* non-fatal — preview degrades to item-derived logos */ }

      return res.status(200).json({ success: true, items });

    } else {
      // ── Plain ISIN / symbol ── only dedupe against a still-open row.
      const { data: existing } = await supabaseAdmin
        .from('gift_registry_items').select('id').eq('gift_event_id', registryId).eq('isin', itemKey).not('status', 'in', '(REMOVED,FILLED)').maybeSingle();
      if (existing) return res.status(200).json({ success: true, item: existing, message: 'Already in registry' });

      const priceCents = await getLatestPriceCents(itemKey);
      const minTranche = priceCents > 0 ? Math.max(1, Math.ceil(1000 / priceCents)) : 1;
      const { data: item, error } = await supabaseAdmin
        .from('gift_registry_items')
        .insert({ gift_event_id: registryId, isin: itemKey, instrument_type: 'SHARE',
          target_quantity: targetQty, price_snapshot_cents: priceCents, min_tranche_quantity: minTranche })
        .select().single();
      if (error) throw error;
      return res.status(200).json({ success: true, item });
    }

  } catch (e) {
    console.error('[gift-registry] by-key error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
