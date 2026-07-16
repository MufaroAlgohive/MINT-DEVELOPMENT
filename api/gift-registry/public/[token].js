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
          .from('strategies_c')
          .select('id, name, short_name, holdings, risk_level, objective, tags, total_holdings, min_investment')
          .in('id', basketItems.map(i => i.isin));

        // Collect all holding symbols so we can batch-fetch logos
        const allSymbols = [];
        (strategies || []).forEach(s => {
          if (Array.isArray(s.holdings)) {
            s.holdings.forEach(h => {
              const sym = h.ticker || h.symbol || h;
              if (sym) allSymbols.push(sym);
            });
          }
        });

        // Batch logo lookup
        let logoBySymbol = {};
        if (allSymbols.length) {
          const { data: secRows } = await supabaseAdmin
            .from('securities_c')
            .select('symbol, logo_url, name')
            .in('symbol', [...new Set(allSymbols)]);
          (secRows || []).forEach(s => { logoBySymbol[s.symbol] = { logo_url: s.logo_url, name: s.name }; });
        }

        // Fetch the most recent YTD return for each strategy
        let ytdByStratId = {};
        if (strategies?.length) {
          const { data: returnRows } = await supabaseAdmin
            .from('strategies_returns_c')
            .select('strategy_id, ytd_pct, as_of_date')
            .in('strategy_id', strategies.map(s => s.id))
            .order('as_of_date', { ascending: false })
            .limit(strategies.length * 5);
          // Pick the most recent row per strategy
          (returnRows || []).forEach(r => {
            if (!ytdByStratId[r.strategy_id]) ytdByStratId[r.strategy_id] = r;
          });
        }

        stratMap = Object.fromEntries((strategies || []).map(s => {
          const holdings = Array.isArray(s.holdings) ? s.holdings : [];
          const holdingsSnapshot = holdings.slice(0, 6).map(h => {
            const sym = h.ticker || h.symbol || h;
            return { symbol: sym, name: logoBySymbol[sym]?.name || h.name || sym, logo_url: logoBySymbol[sym]?.logo_url || null };
          });
          const ytdRow = ytdByStratId[s.id];
          return [s.id, {
            ...s,
            holdings_snapshot: holdingsSnapshot,
            total_holdings: s.total_holdings || holdings.length,
            r_ytd: ytdRow ? ytdRow.ytd_pct / 100 : null,
            ytd_as_of_date: ytdRow?.as_of_date || null,
          }];
        }));
      }

      registry.items = activeItems
        .sort((a, b) => a.display_order - b.display_order)
        .map(item => {
          if (item.instrument_type === 'BASKET') {
            const strat = stratMap[item.isin];
            // Use stored price_snapshot_cents first; fall back to strategy min_investment (also in cents)
            const priceCents = item.price_snapshot_cents || strat?.min_investment || 0;
            return {
              ...item,
              name: strat?.short_name || strat?.name || item.isin,
              short_name: strat?.short_name || null,
              logo_url: null,
              price_snapshot_cents: priceCents,
              risk_level: strat?.risk_level || null,
              objective: strat?.objective || null,
              tags: strat?.tags || [],
              holdings_snapshot: strat?.holdings_snapshot || [],
              total_holdings: strat?.total_holdings || 0,
              r_ytd: strat?.r_ytd ?? null,
              ytd_as_of_date: strat?.ytd_as_of_date || null,
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
