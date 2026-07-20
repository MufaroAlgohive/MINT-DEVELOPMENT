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
      // Query by both isin AND symbol in parallel — many JSE stocks have isin=null and
      // are only indexed by symbol (e.g. "BHG.JO"). Symbol match is overridden by isin match.
      let secMap = {};
      let intradayBySecId = {};
      if (shareItems.length) {
        const isins = shareItems.map(i => i.isin);
        // Include `id` so we can batch-fetch live intraday prices by security_id
        const [{ data: byIsin }, { data: bySymbol }] = await Promise.all([
          supabaseAdmin.from('securities_c').select('id, isin, symbol, name, logo_url, last_price').in('isin', isins),
          supabaseAdmin.from('securities_c').select('id, isin, symbol, name, logo_url, last_price').in('symbol', isins),
        ]);
        for (const s of (bySymbol || [])) if (s.symbol) secMap[s.symbol] = s;
        for (const s of (byIsin   || [])) if (s.isin)   secMap[s.isin]   = s;

        // Batch-fetch live intraday prices — same source the single-security buy screen uses
        const secIds = [...new Set(Object.values(secMap).map(s => s.id).filter(Boolean))];
        if (secIds.length) {
          const { data: intradayRows } = await supabaseAdmin
            .from('stock_intraday_c')
            .select('security_id, current_price, timestamp')
            .in('security_id', secIds)
            .order('timestamp', { ascending: false });
          // Keep only the most-recent row per security_id
          for (const row of (intradayRows || [])) {
            if (!intradayBySecId[row.security_id]) intradayBySecId[row.security_id] = row;
          }
        }
      }

      // Look up BASKET items in strategies_c (isin stores the strategy UUID)
      let stratMap = {};
      if (basketItems.length) {
        const { data: strategies } = await supabaseAdmin
          .from('strategies_c')
          .select('id, name, short_name, holdings, risk_level, objective, tags, min_investment')
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

        // Batch logo + price lookup
        // Include both raw tickers (e.g. "STX40.JO") and normalized (e.g. "STX40") so lookup
        // works regardless of which format securities_c uses.
        let secBySymbol = {};
        if (allSymbols.length) {
          const uniqueSymbols = [...new Set(allSymbols)];
          const normalizedSymbols = uniqueSymbols.map(t => t.split('.')[0]).filter(Boolean);
          const allQuerySymbols = [...new Set([...uniqueSymbols, ...normalizedSymbols])];
          const { data: secRows } = await supabaseAdmin
            .from('securities_c')
            .select('symbol, logo_url, name, last_price')
            .in('symbol', allQuerySymbols);
          for (const s of (secRows || [])) {
            secBySymbol[s.symbol] = s;
            const norm = s.symbol.split('.')[0];
            if (norm && !secBySymbol[norm]) secBySymbol[norm] = s;
          }
        }
        const logoBySymbol = secBySymbol; // alias for backward compat below

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
            const sec = secBySymbol[sym] || secBySymbol[sym.split('.')[0]];
            return { symbol: sym, name: sec?.name || h.name || sym, logo_url: sec?.logo_url || null };
          });
          // Live price: sum(shares × last_price_cents) — last_price is already in cents.
          // Falls back to stored min_investment (cents) if live data unavailable.
          const livePriceCents = holdings.reduce((sum, h) => {
            const ticker = h.ticker || h.symbol || String(h);
            const shares = Number(h.shares || h.quantity || h.weight || 1);
            const sec = secBySymbol[ticker] || secBySymbol[ticker.split('.')[0]];
            return sum + shares * (sec?.last_price || 0);
          }, 0);
          const ytdRow = ytdByStratId[s.id];
          return [s.id, {
            ...s,
            holdings_snapshot: holdingsSnapshot,
            total_holdings: s.total_holdings || holdings.length,
            live_price_cents: livePriceCents,
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
            // Prefer live computed price; fall back to stored snapshot, then min_investment
            const priceCents = strat?.live_price_cents > 0
              ? strat.live_price_cents
              : (item.price_snapshot_cents || strat?.min_investment || 0);
            return {
              ...item,
              name: strat?.name || strat?.short_name || item.isin,
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
          const sec = secMap[item.isin];
          // Prefer live intraday price (cents); fall back to EOD last_price; then stored snapshot
          const livePrice = sec?.id ? intradayBySecId[sec.id]?.current_price : null;
          const livePriceCents = livePrice ? Number(livePrice) : (sec?.last_price || item.price_snapshot_cents || 0);
          return {
            ...item,
            name: sec?.name || item.isin,
            logo_url: sec?.logo_url || null,
            price_snapshot_cents: livePriceCents,
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
