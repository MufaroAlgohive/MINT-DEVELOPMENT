import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;

    // GET — full registry (owner view)
    if (req.method === 'GET') {
      const { data: registry, error } = await supabaseAdmin
        .from('gift_events')
        .select(`*, items:gift_registry_items(*)`)
        .eq('id', id)
        .eq('creator_user_id', user.id)
        .single();

      if (error || !registry) return res.status(404).json({ error: 'Registry not found' });

      if (registry.items?.length) {
        const shareItems = registry.items.filter(i => i.instrument_type !== 'BASKET');
        const basketItems = registry.items.filter(i => i.instrument_type === 'BASKET');

        // Look up SHARE items in securities_c
        // Include `id` so we can batch-fetch live intraday prices by security_id.
        // Also query by symbol in parallel — many JSE stocks have isin=null in securities_c.
        let secMap = {};
        let intradayBySecId = {};
        if (shareItems.length) {
          const isins = shareItems.map(i => i.isin);
          console.log('[PRICE-DEBUG registry/id] shareItem ISINs:', isins);

          const [{ data: byIsin, error: byIsinErr }, { data: bySymbol, error: bySymbolErr }] = await Promise.all([
            supabaseAdmin.from('securities_c').select('id, isin, symbol, name, logo_url, last_price').in('isin', isins),
            supabaseAdmin.from('securities_c').select('id, isin, symbol, name, logo_url, last_price').in('symbol', isins),
          ]);
          console.log('[PRICE-DEBUG registry/id] securities_c byIsin rows:', JSON.stringify(byIsin), 'err:', byIsinErr?.message);
          console.log('[PRICE-DEBUG registry/id] securities_c bySymbol rows:', JSON.stringify(bySymbol), 'err:', bySymbolErr?.message);

          for (const s of (bySymbol || [])) if (s.symbol) secMap[s.symbol] = s;
          for (const s of (byIsin   || [])) if (s.isin)   secMap[s.isin]   = s;
          console.log('[PRICE-DEBUG registry/id] merged secMap keys:', Object.keys(secMap));

          // Batch-fetch live intraday prices — same source the single-security buy screen uses
          const secIds = [...new Set(Object.values(secMap).map(s => s.id).filter(Boolean))];
          console.log('[PRICE-DEBUG registry/id] secIds for intraday query:', secIds);

          if (secIds.length) {
            const { data: intradayRows, error: intradayErr } = await supabaseAdmin
              .from('stock_intraday_c')
              .select('security_id, current_price, timestamp')
              .in('security_id', secIds)
              .order('timestamp', { ascending: false });
            console.log('[PRICE-DEBUG registry/id] intradayRows count:', intradayRows?.length, 'err:', intradayErr?.message);
            console.log('[PRICE-DEBUG registry/id] intradayRows sample (first 5):', JSON.stringify((intradayRows || []).slice(0, 5)));

            for (const row of (intradayRows || [])) {
              if (!intradayBySecId[row.security_id]) intradayBySecId[row.security_id] = row;
            }
            console.log('[PRICE-DEBUG registry/id] intradayBySecId (deduped):', JSON.stringify(intradayBySecId));
          } else {
            console.log('[PRICE-DEBUG registry/id] WARNING: no secIds — skipping intraday query');
          }
        }

        // Look up BASKET items in strategies_c (isin stores the strategy UUID)
        let stratMap = {};
        if (basketItems.length) {
          const { data: strategies } = await supabaseAdmin
            .from('strategies_c')
            .select('id, name, short_name')
            .in('id', basketItems.map(i => i.isin));
          stratMap = Object.fromEntries((strategies || []).map(s => [s.id, s]));
        }

        registry.items = registry.items.map(item => {
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
          const sec = secMap[item.isin];
          // Prefer live intraday price (cents); fall back to EOD last_price; then stored snapshot
          const livePrice = sec?.id ? intradayBySecId[sec.id]?.current_price : null;
          const livePriceCents = livePrice ? Number(livePrice) : (sec?.last_price || item.price_snapshot_cents || 0);
          console.log(`[PRICE-DEBUG registry/id] item isin=${item.isin} | sec.id=${sec?.id} | sec.last_price=${sec?.last_price} | intradayRow=${JSON.stringify(intradayBySecId[sec?.id])} | livePrice=${livePrice} | FINAL cents=${livePriceCents} | FINAL rands=${(livePriceCents/100).toFixed(2)}`);
          return {
            ...item,
            name: sec?.name || item.isin,
            logo_url: sec?.logo_url || null,
            price_snapshot_cents: livePriceCents,
          };
        });
      }

      return res.status(200).json({ registry });
    }

    // PUT — edit title/occasion/expiry/message
    if (req.method === 'PUT') {
      const { title, occasion, expiryAt, message } = req.body;
      const { data, error } = await supabaseAdmin
        .from('gift_events')
        .update({ title, occasion, expiry_at: expiryAt, message, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('creator_user_id', user.id)
        .select()
        .single();
      if (error || !data) return res.status(404).json({ error: 'Registry not found' });
      return res.status(200).json({ success: true, registry: data });
    }

    // DELETE — permanently delete a registry (owner only)
    if (req.method === 'DELETE') {
      const { data, error } = await supabaseAdmin
        .from('gift_events')
        .delete()
        .eq('id', id)
        .eq('creator_user_id', user.id)
        .select()
        .single();
      if (error || !data) return res.status(404).json({ error: 'Registry not found' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
