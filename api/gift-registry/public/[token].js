import { supabaseAdmin } from '../../_lib/supabase.js';

function sanitizeContributions(contributions) {
  if (!contributions?.length) return contributions;
  // Public endpoint — return only non-identifying fields; no names, emails, or user IDs.
  return contributions.map(c => ({
    id: c.id,
    registry_item_id: c.registry_item_id,
    quantity: c.quantity,
    status: c.status,
    created_at: c.created_at,
  }));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // No-index header — prevent search engines from indexing personal wishlists
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  try {
    const { token } = req.query;

    const { data: registry, error } = await supabaseAdmin
      .from('gift_events')
      .select(`
        id, title, occasion, custom_occasion, beneficiary_display_name,
        event_date, expiry_at, message, status, share_token,
        items:gift_registry_items(
          id, isin, instrument_type, target_quantity, filled_quantity,
          reserved_quantity, min_tranche_quantity, price_snapshot_cents,
          status, display_order
        )
      `)
      .eq('share_token', token)
      .single();

    if (error || !registry) return res.status(404).json({ error: 'Registry not found' });

    if (registry.items?.length) {
      const activeItems = registry.items.filter(i => i.status !== 'REMOVED');
      const shareItems = activeItems.filter(i => i.instrument_type !== 'BASKET');
      const basketItems = activeItems.filter(i => i.instrument_type === 'BASKET');

      // Look up SHARE items in securities_c
      let secMap = {};
      if (shareItems.length) {
        const { data: securities } = await supabaseAdmin
          .from('securities_c').select('isin, name, logo_url, last_price').in('isin', shareItems.map(i => i.isin));
        secMap = Object.fromEntries((securities || []).map(s => [s.isin, s]));
      }

      // Look up BASKET items in strategies_c (isin stores the strategy UUID)
      let stratMap = {};
      if (basketItems.length) {
        const { data: strategies } = await supabaseAdmin
          .from('strategies_c').select('id, name, short_name').in('id', basketItems.map(i => i.isin));
        stratMap = Object.fromEntries((strategies || []).map(s => [s.id, s]));
      }

      registry.items = activeItems
        .sort((a, b) => a.display_order - b.display_order)
        .map(item => {
          if (item.instrument_type === 'BASKET') {
            const strat = stratMap[item.isin];
            return {
              ...item,
              name: strat?.short_name || strat?.name || item.isin,
              short_name: strat?.short_name || null,
              logo_url: null,
              price_snapshot_cents: item.price_snapshot_cents || 0,
            };
          }
          return {
            ...item,
            name: secMap[item.isin]?.name || item.isin,
            logo_url: secMap[item.isin]?.logo_url || null,
            price_snapshot_cents: item.price_snapshot_cents || secMap[item.isin]?.last_price || 0,
          };
        });

      // Fetch contributions for all items (publicly visible — show display name only, no PII)
      const itemIds = registry.items.map(i => i.id);
      if (itemIds.length) {
        const { data: contributions } = await supabaseAdmin
          .from('gift_contributions')
          .select('id, registry_item_id, gifter_user_id, quantity, status, created_at')
          .in('registry_item_id', itemIds)
          .in('status', ['PAID', 'EXECUTING', 'SETTLED'])
          .order('created_at', { ascending: false });

        const enriched = sanitizeContributions(contributions || []);

        // Attach contributions to their items and also expose a flat list
        const contribsByItem = {};
        enriched.forEach(c => {
          if (!contribsByItem[c.registry_item_id]) contribsByItem[c.registry_item_id] = [];
          contribsByItem[c.registry_item_id].push(c);
        });
        registry.items = registry.items.map(item => ({
          ...item,
          contributions: contribsByItem[item.id] || [],
        }));
        registry.all_contributions = enriched;
      }
    }

    return res.status(200).json({ registry });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
