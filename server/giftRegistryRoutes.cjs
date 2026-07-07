/**
 * Gift Registry — Express routes + DB migration for development server.
 * All routes mirror api/gift-registry/ Vercel functions.
 *
 * Usage in server/index.cjs:
 *   const { registerGiftRegistryRoutes, ensureGiftRegistryTables } = require('./giftRegistryRoutes.cjs');
 *   await ensureGiftRegistryTables(pgPool, supabaseAdmin);
 *   registerGiftRegistryRoutes(app, supabaseAdmin, pgPool);
 *
 * IMPORTANT notes (from plan):
 *   - Prices in CENTS throughout (ZAp for JSE — do NOT multiply by 100)
 *   - Quantities are always whole integers (Decision 9)
 *   - The atomic reserve is the most critical endpoint — uses conditional UPDATE via pgPool
 *   - Do not touch api/gift/ — existing direct gift flow is separate
 */

'use strict';

const crypto = require('crypto');

// ─── DB migration ────────────────────────────────────────────────────────────

async function ensureGiftRegistryTables(pgPool, supabaseAdmin) {
  // All gift registry tables live in Supabase — NOT in the local pgPool.
  // pgPool is only used for atomic reservation/contribution transactions.
  // Skip pgPool table creation entirely to avoid connection timeout noise at startup.

  if (!supabaseAdmin) {
    console.warn('[gift-registry] No supabaseAdmin client — skipping health check');
    return;
  }

  try {
    const { data, error: tableCheck } = await supabaseAdmin
      .from('gift_events')
      .select('id')
      .limit(1);

    if (tableCheck) {
      console.error(
        '\n⚠️  [gift-registry] gift_events table NOT found in Supabase!' +
        '\n   Error code:', tableCheck.code, '| message:', tableCheck.message,
        '\n   Gift registry CREATE / LIST will fail until the schema is applied.' +
        '\n   Fix: run supabase-gift-registry-schema.sql in your Supabase Dashboard → SQL Editor.\n'
      );
    } else {
      console.log(`[gift-registry] Supabase gift_events confirmed ✓ (${data?.length ?? 0} sample row(s))`);
    }
  } catch (e) {
    console.error('[gift-registry] Health check threw:', e.message);
  }
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getUser(req, supabaseAdmin) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// KYC check: user must have a completed onboarding record
async function isKycComplete(userId, supabaseAdmin) {
  try {
    const { data } = await supabaseAdmin
      .from('user_onboarding_pack_details')
      .select('id')
      .eq('user_id', userId)
      .single();
    return !!data;
  } catch {
    return false;
  }
}

// ─── Price helper ─────────────────────────────────────────────────────────────

async function getLatestPriceCents(isin, supabaseAdmin) {
  // Try intraday first, fall back to securities_c.last_price
  const { data: intraday } = await supabaseAdmin
    .from('stock_intraday_c')
    .select('current_price, security_id')
    .eq('isin', isin)
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();

  if (intraday?.current_price) return intraday.current_price; // already in cents

  const { data: sec } = await supabaseAdmin
    .from('securities_c')
    .select('last_price')
    .eq('isin', isin)
    .single();

  return sec?.last_price || 0; // cents
}

// ─── Routes ───────────────────────────────────────────────────────────────────

function registerGiftRegistryRoutes(app, supabaseAdmin, pgPool) {

  // GET /api/gift-wishlist-prefs — load user's wishlisted keys + strategy watchlist
  app.get('/api/gift-wishlist-prefs', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const prefs = user.user_metadata?.gift_wishlist_prefs || {};
      return res.json({ wishlistedKeys: prefs.keys || [], watchlist: prefs.watchlist || [] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/gift-wishlist-prefs — update wishlisted keys and/or watchlist
  app.put('/api/gift-wishlist-prefs', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const { wishlistedKeys, watchlist } = req.body || {};
      const existing = user.user_metadata?.gift_wishlist_prefs || {};
      const updated = {
        ...existing,
        ...(Array.isArray(wishlistedKeys) ? { keys: wishlistedKeys } : {}),
        ...(Array.isArray(watchlist) ? { watchlist } : {}),
      };
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, gift_wishlist_prefs: updated },
      });
      if (error) throw error;
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/create
  app.post('/api/gift-registry/create', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { occasion, customOccasion, beneficiaryType, beneficiaryDisplayName, title, eventDate, expiryAt, message } = req.body;
      console.log(`[gift-registry] CREATE: user=${user.id} occasion=${occasion} beneficiaryType=${beneficiaryType} title=${title} eventDate=${eventDate} expiryAt=${expiryAt}`);

      if (!occasion || !beneficiaryType || !beneficiaryDisplayName || !title || !eventDate || !expiryAt) {
        const missing = ['occasion','beneficiaryType','beneficiaryDisplayName','title','eventDate','expiryAt'].filter(k => !req.body[k]);
        console.warn(`[gift-registry] CREATE: missing fields: ${missing.join(', ')}`);
        return res.status(400).json({ error: 'Missing required fields', missing });
      }

      const { data: registry, error } = await supabaseAdmin
        .from('gift_events')
        .insert({
          creator_user_id: user.id,
          occasion,
          custom_occasion: customOccasion || null,
          beneficiary_type: beneficiaryType,
          beneficiary_display_name: beneficiaryDisplayName,
          title,
          event_date: eventDate,
          expiry_at: expiryAt,
          message: message || null,
          status: 'DRAFT',
        })
        .select()
        .single();

      if (error) {
        console.error(`[gift-registry] CREATE: Supabase insert error code=${error.code} message=${error.message}`);
        throw error;
      }
      console.log(`[gift-registry] CREATE: success registryId=${registry.id} title=${registry.title}`);
      return res.json({ success: true, registry });
    } catch (e) {
      console.error('[gift-registry] create error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/gift-registry/my-registries
  app.get('/api/gift-registry/my-registries', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { data, error } = await supabaseAdmin
        .from('gift_events')
        .select(`*, items:gift_registry_items(*)`)
        .eq('creator_user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error(`[gift-registry] my-registries: Supabase error code=${error.code} msg=${error.message}`);
        throw error;
      }

      const registries = data || [];
      console.log(`[gift-registry] my-registries: user=${user.id} found=${registries.length} registries`);

      // Enrich all items across all registries with logo_url in one query
      // Separate real ISINs (SHARE/ETF) from strategy UUIDs (BASKET)
      const allItems = registries.flatMap(r => r.items || []);
      const shareIsins = [...new Set(allItems.filter(i => i.instrument_type !== 'BASKET').map(i => i.isin))];
      const basketStrategyIds = [...new Set(allItems.filter(i => i.instrument_type === 'BASKET').map(i => i.isin))];
      console.log(`[gift-registry] my-registries: allItems=${allItems.length} shares=${shareIsins.length} baskets=${basketStrategyIds.length}`);
      if (basketStrategyIds.length) console.log(`[gift-registry] my-registries: basketIds=${JSON.stringify(basketStrategyIds)}`);

      let secMap = {};
      if (shareIsins.length) {
        const { data: securities } = await supabaseAdmin
          .from('securities_c').select('isin, name, logo_url').in('isin', shareIsins);
        secMap = Object.fromEntries((securities || []).map(s => [s.isin, s]));
        console.log(`[gift-registry] my-registries: secMap resolved=${Object.keys(secMap).length}/${shareIsins.length}`);
      }

      // Enrich strategy baskets from strategies_c
      let strategyMap = {};
      if (basketStrategyIds.length) {
        const { data: strategies, error: stratErr } = await supabaseAdmin
          .from('strategies_c').select('id, name, holdings').in('id', basketStrategyIds);
        if (stratErr) console.error(`[gift-registry] my-registries: strategies_c error=${stratErr.message}`);
        console.log(`[gift-registry] my-registries: strategies found=${strategies?.length ?? 0} ids=${strategies?.map(s => s.id+':'+s.name).join(',')}`);
        // For each strategy, also fetch holding logos
        const allTickers = (strategies || []).flatMap(s => (s.holdings || []).map(h => h.ticker || h.symbol || h).filter(Boolean));
        const uniqueTickers = [...new Set(allTickers)];
        let secBySymbol = {};
        if (uniqueTickers.length) {
          const { data: secs } = await supabaseAdmin.from('securities_c').select('symbol, name, logo_url').in('symbol', uniqueTickers);
          secBySymbol = Object.fromEntries((secs || []).map(s => [s.symbol, s]));
        }
        strategyMap = Object.fromEntries((strategies || []).map(s => {
          const holdingsSnap = (s.holdings || [])
            .map(h => { const t = h.ticker || h.symbol || String(h); return { symbol: t, name: secBySymbol[t]?.name || t, logo_url: secBySymbol[t]?.logo_url || null }; })
            .sort((a, b) => (b.logo_url ? 1 : 0) - (a.logo_url ? 1 : 0))
            .slice(0, 5);
          return [s.id, { name: s.name, holdingsSnap }];
        }));
        console.log(`[gift-registry] my-registries: strategyMap keys=${Object.keys(strategyMap).join(',')}`);
      }

      const userMeta = user.user_metadata || {};

      const enriched = registries.map(r => {
        const activeItems = (r.items || []).filter(i => i.status !== 'REMOVED');
        // Build preview logos from active items (prefer holding logos for baskets)
        let previewLogos = null;
        if (activeItems.length) {
          const derived = activeItems.flatMap(i => {
            if (i.instrument_type === 'BASKET') {
              return strategyMap[i.isin]?.holdingsSnap || [];
            }
            return [{ symbol: i.isin, name: secMap[i.isin]?.name || i.isin, logo_url: secMap[i.isin]?.logo_url || null }];
          }).sort((a, b) => (b.logo_url ? 1 : 0) - (a.logo_url ? 1 : 0)).slice(0, 6);
          if (derived.some(d => d.logo_url)) previewLogos = derived;
        }
        return {
          ...r,
          preview_logos: previewLogos,
          items: (r.items || []).map(item => {
            if (item.instrument_type === 'BASKET') {
              return {
                ...item,
                name: strategyMap[item.isin]?.name || item.isin,
                logo_url: null,
                holdings_snapshot: strategyMap[item.isin]?.holdingsSnap || [],
              };
            }
            return {
              ...item,
              name: secMap[item.isin]?.name || item.isin,
              logo_url: secMap[item.isin]?.logo_url || null,
            };
          }),
        };
      });

      return res.json({ registries: enriched });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/gift-registry/:id — full registry (auth required, owner view)
  app.get('/api/gift-registry/:id', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      console.log(`[gift-registry] GET /:id user=${user.id} id=${req.params.id}`);

      const { data: registry, error } = await supabaseAdmin
        .from('gift_events')
        .select(`*, items:gift_registry_items(*)`)
        .eq('id', req.params.id)
        .eq('creator_user_id', user.id)
        .single();

      if (error || !registry) {
        console.warn(`[gift-registry] GET /:id NOT FOUND id=${req.params.id} sbError=${error?.code}:${error?.message}`);
        return res.status(404).json({ error: 'Registry not found' });
      }
      console.log(`[gift-registry] GET /:id found registry title="${registry.title}" items=${registry.items?.length}`);

      // Enrich items — SHARE/ETF from securities_c, BASKET from strategies_c
      if (registry.items?.length) {
        const activeItems = registry.items.filter(i => i.status !== 'REMOVED');
        const shareItems = activeItems.filter(i => i.instrument_type !== 'BASKET');
        const basketItems = activeItems.filter(i => i.instrument_type === 'BASKET');
        console.log(`[gift-registry] GET /:id enrichment: active=${activeItems.length} shares=${shareItems.length} baskets=${basketItems.length}`);
        if (basketItems.length) console.log(`[gift-registry] GET /:id basket isins=${JSON.stringify(basketItems.map(i => ({ id: i.id, isin: i.isin, type: i.instrument_type })))}`);
        const enrichedMap = {};

        if (shareItems.length) {
          const isins = shareItems.map(i => i.isin);
          const { data: securities } = await supabaseAdmin
            .from('securities_c').select('isin, name, logo_url, last_price').in('isin', isins);
          const secMap = Object.fromEntries((securities || []).map(s => [s.isin, s]));
          shareItems.forEach(item => {
            enrichedMap[item.id] = {
              ...item,
              name: secMap[item.isin]?.name || item.isin,
              logo_url: secMap[item.isin]?.logo_url || null,
              price_snapshot_cents: item.price_snapshot_cents || secMap[item.isin]?.last_price || 0,
            };
          });
        }

        if (basketItems.length) {
          const strategyIds = basketItems.map(i => i.isin);
          console.log(`[gift-registry] GET /:id BASKET lookup strategyIds=${JSON.stringify(strategyIds)}`);
          const { data: strategies, error: stratErr } = await supabaseAdmin
            .from('strategies_c').select('id, name, holdings').in('id', strategyIds);
          if (stratErr) console.error(`[gift-registry] GET /:id strategies_c error: ${stratErr.message}`);
          console.log(`[gift-registry] GET /:id strategies found=${strategies?.length ?? 0} names=${strategies?.map(s => s.name).join(',')}`);
          const allTickers = (strategies || []).flatMap(s =>
            (s.holdings || []).map(h => h.ticker || h.symbol || h).filter(Boolean)
          );
          const uniqueTickers = [...new Set(allTickers)];
          const { data: secs } = uniqueTickers.length
            ? await supabaseAdmin.from('securities_c').select('symbol, name, logo_url').in('symbol', uniqueTickers)
            : { data: [] };
          const secBySymbol = Object.fromEntries((secs || []).map(s => [s.symbol, s]));
          const stratMap = Object.fromEntries((strategies || []).map(s => [s.id, s]));

          basketItems.forEach(item => {
            const strategy = stratMap[item.isin];
            if (!strategy) {
              console.warn(`[gift-registry] GET /:id BASKET item isin=${item.isin} NOT found in strategies_c`);
              enrichedMap[item.id] = { ...item, name: item.isin }; return;
            }
            const holdings = strategy.holdings || [];
            const holdingsSnapshot = holdings
              .map(h => { const t = h.ticker || h.symbol || String(h); return { symbol: t, name: secBySymbol[t]?.name || t, logo_url: secBySymbol[t]?.logo_url || null }; })
              .sort((a, b) => (b.logo_url ? 1 : 0) - (a.logo_url ? 1 : 0))
              .slice(0, 5);
            enrichedMap[item.id] = {
              ...item,
              name: strategy.name,
              logo_url: null,
              holdings_snapshot: holdingsSnapshot,
              total_holdings: holdings.length,
            };
          });
        }

        registry.items = activeItems
          .map(item => enrichedMap[item.id] || item)
          .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
      }

      return res.json({ registry });
    } catch (e) {
      console.error(`[gift-registry] GET /:id error: ${e.message}`);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/:id/publish
  app.post('/api/gift-registry/:id/publish', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const shareToken = crypto.randomBytes(24).toString('base64url');

      const { data, error } = await supabaseAdmin
        .from('gift_events')
        .update({ status: 'ACTIVE', share_token: shareToken, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('creator_user_id', user.id)
        .eq('status', 'DRAFT')
        .select()
        .single();

      if (error || !data) return res.status(404).json({ error: 'Registry not found or already published' });
      return res.json({ success: true, registry: data });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/:id/pause
  app.post('/api/gift-registry/:id/pause', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { data, error } = await supabaseAdmin
        .from('gift_events')
        .update({ status: 'PAUSED', updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('creator_user_id', user.id)
        .eq('status', 'ACTIVE')
        .select()
        .single();

      if (error || !data) return res.status(404).json({ error: 'Registry not found or not active' });
      return res.json({ success: true, registry: data });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/:id/resume
  app.post('/api/gift-registry/:id/resume', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { data, error } = await supabaseAdmin
        .from('gift_events')
        .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('creator_user_id', user.id)
        .eq('status', 'PAUSED')
        .select()
        .single();

      if (error || !data) return res.status(404).json({ error: 'Registry not found or not paused' });
      return res.json({ success: true, registry: data });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/:id/cancel
  app.post('/api/gift-registry/:id/cancel', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Release all HELD reservations first
      if (pgPool) {
        const pg = await pgPool.connect();
        try {
          await pg.query(`
            UPDATE gift_reservations gr
               SET status = 'RELEASED'
              FROM gift_registry_items gri
             WHERE gr.registry_item_id = gri.id
               AND gri.gift_event_id = $1
               AND gr.status = 'HELD'
          `, [req.params.id]);

          // Return reserved_quantity back to items
          await pg.query(`
            UPDATE gift_registry_items
               SET reserved_quantity = 0
             WHERE gift_event_id = $1
          `, [req.params.id]);
        } finally {
          pg.release();
        }
      }

      const { data, error } = await supabaseAdmin
        .from('gift_events')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('creator_user_id', user.id)
        .in('status', ['ACTIVE', 'PAUSED'])
        .select()
        .single();

      if (error || !data) return res.status(404).json({ error: 'Registry not found' });
      return res.json({ success: true, registry: data });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/gift-registry/:id — permanently delete a registry (owner only)
  app.delete('/api/gift-registry/:id', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Release any HELD reservations first (best-effort, table cascade handles the rest)
      if (pgPool) {
        const pg = await pgPool.connect();
        try {
          await pg.query(`
            UPDATE gift_reservations gr
               SET status = 'RELEASED'
              FROM gift_registry_items gri
             WHERE gr.registry_item_id = gri.id
               AND gri.gift_event_id = $1
               AND gr.status = 'HELD'
          `, [req.params.id]);
        } finally {
          pg.release();
        }
      }

      const { data, error } = await supabaseAdmin
        .from('gift_events')
        .delete()
        .eq('id', req.params.id)
        .eq('creator_user_id', user.id)
        .select()
        .single();

      if (error || !data) return res.status(404).json({ error: 'Registry not found' });
      return res.json({ success: true });
    } catch (e) {
      console.error('[gift-registry] delete error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/gift-registry/public/:token — public view (no auth to view)
  app.get('/api/gift-registry/public/:token', async (req, res) => {
    try {
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
        .eq('share_token', req.params.token)
        .single();

      if (error || !registry) return res.status(404).json({ error: 'Registry not found' });

      // Enrich items — SHARE/ETF from securities_c, BASKET from strategies_c
      if (registry.items?.length) {
        const activeItems = registry.items.filter(i => i.status !== 'REMOVED');
        const shareItems = activeItems.filter(i => i.instrument_type !== 'BASKET');
        const basketItems = activeItems.filter(i => i.instrument_type === 'BASKET');
        const enrichedMap = {};

        if (shareItems.length) {
          const isins = shareItems.map(i => i.isin);
          const { data: securities } = await supabaseAdmin
            .from('securities_c').select('isin, name, logo_url, last_price').in('isin', isins);
          const secMap = Object.fromEntries((securities || []).map(s => [s.isin, s]));
          shareItems.forEach(item => {
            enrichedMap[item.id] = {
              ...item,
              name: secMap[item.isin]?.name || item.isin,
              logo_url: secMap[item.isin]?.logo_url || null,
              price_snapshot_cents: item.price_snapshot_cents || secMap[item.isin]?.last_price || 0,
            };
          });
        }

        if (basketItems.length) {
          const strategyIds = basketItems.map(i => i.isin);
          const { data: strategies } = await supabaseAdmin
            .from('strategies_c').select('id, name, holdings').in('id', strategyIds);
          const allTickers = (strategies || []).flatMap(s =>
            (s.holdings || []).map(h => h.ticker || h.symbol || h).filter(Boolean)
          );
          const uniqueTickers = [...new Set(allTickers)];
          const { data: secs } = uniqueTickers.length
            ? await supabaseAdmin.from('securities_c').select('symbol, name, logo_url').in('symbol', uniqueTickers)
            : { data: [] };
          const secBySymbol = Object.fromEntries((secs || []).map(s => [s.symbol, s]));
          const stratMap = Object.fromEntries((strategies || []).map(s => [s.id, s]));

          basketItems.forEach(item => {
            const strategy = stratMap[item.isin];
            if (!strategy) { enrichedMap[item.id] = { ...item, name: item.isin }; return; }
            const holdings = strategy.holdings || [];
            const holdingsSnapshot = holdings
              .map(h => { const t = h.ticker || h.symbol || String(h); return { symbol: t, name: secBySymbol[t]?.name || t, logo_url: secBySymbol[t]?.logo_url || null }; })
              .sort((a, b) => (b.logo_url ? 1 : 0) - (a.logo_url ? 1 : 0))
              .slice(0, 5);
            enrichedMap[item.id] = {
              ...item,
              name: strategy.name,
              logo_url: null,
              holdings_snapshot: holdingsSnapshot,
              total_holdings: holdings.length,
            };
          });
        }

        registry.items = activeItems
          .map(item => enrichedMap[item.id] || item)
          .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
      }

      return res.json({ registry });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/gift-registry/by-mint-number/:mintNumber
  app.get('/api/gift-registry/by-mint-number/:mintNumber', async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('gift_events')
        .select(`
          id, title, occasion, event_date, expiry_at, share_token, status,
          beneficiary_display_name,
          items:gift_registry_items(id, target_quantity, filled_quantity)
        `)
        .eq('beneficiary_mint_number', req.params.mintNumber.toUpperCase())
        .eq('status', 'ACTIVE');

      if (error) throw error;
      return res.json({ registries: data || [] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/items/by-key — add an item by itemKey
  // itemKey can be a plain ISIN/symbol ("NPN.JO") or a prefixed strategy ("gift:uuid" / "strategy:uuid").
  // Strategy keys are expanded: each holding in strategies_c.holdings is inserted as a separate SHARE item.
  app.post('/api/gift-registry/items/by-key', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { registryId, itemKey } = req.body;
      console.log(`[gift-registry] by-key: user=${user.id} registryId=${registryId} itemKey=${itemKey}`);
      if (!registryId || !itemKey) return res.status(400).json({ error: 'Missing registryId or itemKey' });

      // Verify ownership
      const { data: reg, error: regErr } = await supabaseAdmin
        .from('gift_events').select('id, status')
        .eq('id', registryId).eq('creator_user_id', user.id).single();
      if (!reg) {
        console.log(`[gift-registry] by-key: registry not found — regErr=${regErr?.message}`);
        return res.status(404).json({ error: 'Registry not found' });
      }
      if (!['DRAFT', 'ACTIVE', 'PAUSED'].includes(reg.status))
        return res.status(400).json({ error: 'Cannot add items to a closed registry' });

      const isStrategy = itemKey.startsWith('gift:') || itemKey.startsWith('strategy:');

      if (isStrategy) {
        // ── Strategy basket: stored as one BASKET row (isin = strategy UUID).
        //    Do NOT expand into individual SHARE rows — the GET enrichment
        //    joins strategies_c to build holdings_snapshot at read time. ──
        const strategyId = itemKey.replace(/^(gift:|strategy:)/, '');
        const { data: strategy, error: stratErr } = await supabaseAdmin
          .from('strategies_c').select('id, name, holdings').eq('id', strategyId).single();
        if (stratErr || !strategy) return res.status(404).json({ error: 'Strategy not found' });

        const holdings = Array.isArray(strategy.holdings) ? strategy.holdings : [];
        if (!holdings.length) return res.status(400).json({ error: 'Strategy has no holdings' });

        // Check if this strategy basket is already in the registry (exclude REMOVED rows so re-add works)
        const { data: existing } = await supabaseAdmin
          .from('gift_registry_items').select('id').eq('gift_event_id', registryId).eq('isin', strategyId).neq('status', 'REMOVED').maybeSingle();
        if (existing) return res.json({ success: true, item: existing, message: 'Already in registry' });

        // Calculate min investment = sum of all holdings' current prices
        const tickers = [...new Set(holdings.map(h => h.ticker || h.symbol || h).filter(Boolean))];
        const { data: securities } = await supabaseAdmin
          .from('securities_c').select('symbol, last_price').in('symbol', tickers);
        const secBySymbol = Object.fromEntries((securities || []).map(s => [s.symbol, s]));
        const minInvestmentCents = holdings.reduce((sum, h) => {
          const ticker = h.ticker || h.symbol || String(h);
          return sum + (secBySymbol[ticker]?.last_price || 0);
        }, 0);

        // Insert a single BASKET row — strategy ID stored in isin field
        const { data: item, error: insertErr } = await supabaseAdmin
          .from('gift_registry_items')
          .insert({
            gift_event_id: registryId,
            isin: strategyId,
            instrument_type: 'BASKET',
            target_quantity: 1,
            price_snapshot_cents: minInvestmentCents,
            min_tranche_quantity: 1,
          }).select().single();
        if (insertErr) throw insertErr;

        return res.json({ success: true, item });

      } else {
        // ── Plain ISIN / symbol ──
        const { data: existing } = await supabaseAdmin
          .from('gift_registry_items').select('id').eq('gift_event_id', registryId).eq('isin', itemKey).neq('status', 'REMOVED').maybeSingle();
        if (existing) return res.json({ success: true, item: existing, message: 'Already in registry' });

        const priceCents = await getLatestPriceCents(itemKey, supabaseAdmin);
        const minTranche = priceCents > 0 ? Math.max(1, Math.ceil(1000 / priceCents)) : 1;
        const { data: item, error } = await supabaseAdmin
          .from('gift_registry_items')
          .insert({ gift_event_id: registryId, isin: itemKey, instrument_type: 'SHARE',
            target_quantity: 1, price_snapshot_cents: priceCents, min_tranche_quantity: minTranche })
          .select().single();
        if (error) throw error;
        return res.json({ success: true, item });
      }
    } catch (e) {
      console.error('[gift-registry] add by-key error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/items — add an item
  app.post('/api/gift-registry/items', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { registryId, isin, instrumentType = 'SHARE', targetQuantity } = req.body;
      if (!registryId || !isin || !targetQuantity) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Verify ownership
      const { data: reg } = await supabaseAdmin
        .from('gift_events')
        .select('id, status')
        .eq('id', registryId)
        .eq('creator_user_id', user.id)
        .single();

      if (!reg) return res.status(404).json({ error: 'Registry not found' });
      if (!['DRAFT', 'ACTIVE', 'PAUSED'].includes(reg.status)) {
        return res.status(400).json({ error: 'Cannot add items to a closed registry' });
      }

      // Get latest price snapshot
      const priceCents = await getLatestPriceCents(isin, supabaseAdmin);
      const minTranche = priceCents > 0 ? Math.max(1, Math.ceil(1000 / priceCents)) : 1;

      const { data: item, error } = await supabaseAdmin
        .from('gift_registry_items')
        .insert({
          gift_event_id: registryId,
          isin,
          instrument_type: instrumentType,
          target_quantity: targetQuantity,
          price_snapshot_cents: priceCents,
          min_tranche_quantity: minTranche,
        })
        .select()
        .single();

      if (error) throw error;
      return res.json({ success: true, item });
    } catch (e) {
      console.error('[gift-registry] add item error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/gift-registry/items/:itemId
  app.delete('/api/gift-registry/items/:itemId', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Fetch the item first
      const { data: item, error: fetchErr } = await supabaseAdmin
        .from('gift_registry_items')
        .select('id, gift_event_id')
        .eq('id', req.params.itemId)
        .single();
      if (fetchErr || !item) return res.status(404).json({ error: 'Item not found' });

      // Verify ownership by checking the parent registry separately (avoids FK join dependency)
      const { data: reg } = await supabaseAdmin
        .from('gift_events')
        .select('id')
        .eq('id', item.gift_event_id)
        .eq('creator_user_id', user.id)
        .single();
      if (!reg) return res.status(403).json({ error: 'Not authorised' });

      const { error } = await supabaseAdmin
        .from('gift_registry_items')
        .update({ status: 'REMOVED' })
        .eq('id', req.params.itemId);

      if (error) throw error;
      return res.json({ success: true });
    } catch (e) {
      console.error('[gift-registry] delete item error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/reserve — ATOMIC reservation (most critical)
  app.post('/api/gift-registry/reserve', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Decision 1 & 3: must be KYC-complete
      const kyc = await isKycComplete(user.id, supabaseAdmin);
      if (!kyc) return res.status(403).json({ error: 'Complete your verification to gift from a registry', code: 'KYC_INCOMPLETE' });

      const { itemId, quantity, registryId } = req.body;
      if (!itemId || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Invalid request' });
      }

      // Check registry is still ACTIVE (Decision 5: EXPIRED registry blocks NEW reservations)
      const { data: reg } = await supabaseAdmin
        .from('gift_events')
        .select('status, expiry_at')
        .eq('id', registryId)
        .single();

      if (!reg || reg.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'This registry is no longer accepting gifts', code: 'REGISTRY_CLOSED' });
      }

      // Get current item state + live price — enforce item belongs to this registry
      const { data: item } = await supabaseAdmin
        .from('gift_registry_items')
        .select('*')
        .eq('id', itemId)
        .eq('gift_event_id', registryId)
        .single();

      if (!item) return res.status(404).json({ error: 'Item not found or does not belong to this registry' });

      const available = item.target_quantity - item.filled_quantity - item.reserved_quantity;
      if (quantity > available) {
        return res.status(409).json({ error: 'Not enough shares available', code: 'SOLD_OUT', remaining: available });
      }

      // Decision 2: validate min tranche
      const minTranche = item.min_tranche_quantity || 1;
      if (quantity < minTranche && quantity !== available) {
        return res.status(400).json({ error: `Minimum gift is ${minTranche} share(s)`, code: 'BELOW_MINIMUM' });
      }

      // Get live price (Decision 8)
      const livePriceCents = await getLatestPriceCents(item.isin, supabaseAdmin);

      // Atomic conditional UPDATE — prevents two gifters buying the same last share
      if (!pgPool) {
        return res.status(503).json({ error: 'Database pool not available' });
      }

      const pg = await pgPool.connect();
      let reservationId;
      try {
        await pg.query('BEGIN');

        const updateResult = await pg.query(`
          UPDATE gift_registry_items
             SET reserved_quantity = reserved_quantity + $1,
                 updated_at = now()
           WHERE id = $2
             AND status IN ('OPEN','PARTIALLY_FILLED')
             AND (filled_quantity + reserved_quantity + $1) <= target_quantity
           RETURNING id
        `, [quantity, itemId]);

        if (updateResult.rowCount === 0) {
          await pg.query('ROLLBACK');
          return res.status(409).json({ error: 'No longer available', code: 'SOLD_OUT', remaining: 0 });
        }

        const resResult = await pg.query(`
          INSERT INTO gift_reservations (registry_item_id, gifter_user_id, quantity, expires_at, price_lock_cents)
          VALUES ($1, $2, $3, now() + interval '10 minutes', $4)
          RETURNING id
        `, [itemId, user.id, quantity, livePriceCents]);

        await pg.query('COMMIT');
        reservationId = resResult.rows[0].id;
      } catch (e) {
        await pg.query('ROLLBACK');
        throw e;
      } finally {
        pg.release();
      }

      return res.json({ success: true, reservationId, livePriceCents, expiresInSeconds: 600 });
    } catch (e) {
      console.error('[gift-registry] reserve error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/contribute — confirm payment, transition reservation → PAID
  app.post('/api/gift-registry/contribute', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { reservationId, registryId, itemId, quantity } = req.body;
      if (!reservationId) return res.status(400).json({ error: 'Missing reservationId' });

      // Fetch reservation
      const { data: reservation } = await supabaseAdmin
        .from('gift_reservations')
        .select('*')
        .eq('id', reservationId)
        .eq('gifter_user_id', user.id)
        .eq('status', 'HELD')
        .single();

      if (!reservation) return res.status(404).json({ error: 'Reservation not found or expired' });
      if (new Date(reservation.expires_at) < new Date()) {
        return res.status(410).json({ error: 'Your reservation has expired. Please start again.', code: 'RESERVATION_EXPIRED' });
      }

      // Get gifter email
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(user.id);
      const gifterEmail = userData?.user?.email || '';

      // Idempotency key
      const idempotencyKey = `${reservationId}:${user.id}`;

      // Check for duplicate
      const { data: existing } = await supabaseAdmin
        .from('gift_contributions')
        .select('id, status')
        .eq('idempotency_key', idempotencyKey)
        .single();

      if (existing) return res.json({ success: true, contribution: existing, duplicate: true });

      // Compute fee (Decision 7) — reuse fees from API
      const livePriceCents = reservation.price_lock_cents;
      const baseRands = (livePriceCents * reservation.quantity) / 100;
      let feeCents = Math.round(baseRands * 0.006 * 100); // ~0.6% fallback estimate
      try {
        const { computeFees } = require('../api/_lib/fees.js');
        const feeResult = computeFees(baseRands, 1);
        feeCents = feeResult?.totalCents || feeCents;
      } catch { /* fees module optional */ }

      const quotedAmountCents = livePriceCents * reservation.quantity + feeCents;

      // Single atomic transaction: insert contribution + consume reservation + update item quantities
      if (!pgPool) return res.status(503).json({ error: 'Database pool not available' });

      let contribution;
      const pg = await pgPool.connect();
      try {
        await pg.query('BEGIN');

        // Idempotency check inside transaction
        const dupCheck = await pg.query(
          `SELECT id, status FROM gift_contributions WHERE idempotency_key = $1`,
          [idempotencyKey]
        );
        if (dupCheck.rowCount > 0) {
          await pg.query('ROLLBACK');
          return res.json({ success: true, contribution: dupCheck.rows[0], duplicate: true });
        }

        // Consume reservation with re-validation guard (expiry + status)
        const resUpdate = await pg.query(`
          UPDATE gift_reservations
             SET status = 'CONSUMED'
           WHERE id = $1
             AND gifter_user_id = $2
             AND status = 'HELD'
             AND expires_at > now()
           RETURNING id, quantity, registry_item_id
        `, [reservationId, user.id]);

        if (resUpdate.rowCount === 0) {
          await pg.query('ROLLBACK');
          return res.status(410).json({ error: 'Reservation has expired or was already consumed', code: 'RESERVATION_EXPIRED' });
        }

        const qty = resUpdate.rows[0].quantity;
        const itemId = resUpdate.rows[0].registry_item_id;

        // Update item quantities
        await pg.query(`
          UPDATE gift_registry_items
             SET filled_quantity   = filled_quantity + $1,
                 reserved_quantity = GREATEST(0, reserved_quantity - $1),
                 status = CASE
                   WHEN filled_quantity + $1 >= target_quantity THEN 'FILLED'
                   WHEN filled_quantity + $1 > 0 THEN 'PARTIALLY_FILLED'
                   ELSE status
                 END,
                 updated_at = now()
           WHERE id = $2
        `, [qty, itemId]);

        // Insert contribution
        const contribResult = await pg.query(`
          INSERT INTO gift_contributions
            (registry_item_id, gifter_user_id, gifter_email, quantity,
             quoted_amount_cents, fee_cents, status, reservation_id, idempotency_key)
          VALUES ($1, $2, $3, $4, $5, $6, 'PAID', $7, $8)
          RETURNING *
        `, [itemId, user.id, gifterEmail, qty, quotedAmountCents, feeCents, reservationId, idempotencyKey]);

        await pg.query('COMMIT');
        contribution = contribResult.rows[0];
      } catch (e) {
        await pg.query('ROLLBACK');
        throw e;
      } finally {
        pg.release();
      }

      // Check if all items are FILLED — mark registry COMPLETED
      const { data: allItems } = await supabaseAdmin
        .from('gift_registry_items')
        .select('status')
        .eq('gift_event_id', registryId)
        .neq('status', 'REMOVED');

      const allFilled = allItems?.every(i => i.status === 'FILLED');
      if (allFilled) {
        await supabaseAdmin
          .from('gift_events')
          .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
          .eq('id', registryId);
      }

      return res.json({ success: true, contribution });
    } catch (e) {
      console.error('[gift-registry] contribute error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/gift-registry/:id/contributions
  app.get('/api/gift-registry/:id/contributions', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Verify ownership
      const { data: reg } = await supabaseAdmin
        .from('gift_events')
        .select('id')
        .eq('id', req.params.id)
        .eq('creator_user_id', user.id)
        .single();

      if (!reg) return res.status(404).json({ error: 'Registry not found' });

      const { data: contributions, error } = await supabaseAdmin
        .from('gift_contributions')
        .select(`*, item:gift_registry_items!registry_item_id(isin, gift_event_id)`)
        .eq('item.gift_event_id', req.params.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.json({ contributions: contributions || [] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  console.log('[gift-registry] Routes registered');
}

// ─── Reservation sweeper cron ─────────────────────────────────────────────────
// Uses supabaseAdmin — gift_reservations and gift_registry_items live in Supabase, not local pgPool.

async function sweepExpiredReservations(supabaseAdmin) {
  if (!supabaseAdmin) return;
  try {
    // Step 1: find HELD reservations past their TTL
    const now = new Date().toISOString();
    const { data: expired, error: fetchErr } = await supabaseAdmin
      .from('gift_reservations')
      .select('id, registry_item_id, quantity')
      .eq('status', 'HELD')
      .lt('expires_at', now);

    if (fetchErr) {
      console.error('[gift-registry] sweeper fetch error:', fetchErr.message);
      return;
    }
    if (!expired || expired.length === 0) return;

    // Step 2: mark them EXPIRED
    const ids = expired.map(r => r.id);
    const { error: updateErr } = await supabaseAdmin
      .from('gift_reservations')
      .update({ status: 'EXPIRED' })
      .in('id', ids);

    if (updateErr) {
      console.error('[gift-registry] sweeper update error:', updateErr.message);
      return;
    }

    // Step 3: return reserved_quantity to each affected item
    const groups = {};
    for (const row of expired) {
      groups[row.registry_item_id] = (groups[row.registry_item_id] || 0) + row.quantity;
    }

    for (const [itemId, qty] of Object.entries(groups)) {
      const { data: item } = await supabaseAdmin
        .from('gift_registry_items')
        .select('reserved_quantity')
        .eq('id', itemId)
        .single();
      if (!item) continue;
      const newQty = Math.max(0, (item.reserved_quantity || 0) - qty);
      await supabaseAdmin
        .from('gift_registry_items')
        .update({ reserved_quantity: newQty, updated_at: now })
        .eq('id', itemId);
    }

    console.log(`[gift-registry] Released ${expired.length} expired reservation(s)`);
  } catch (e) {
    console.error('[gift-registry] sweeper error:', e.message);
  }
}

module.exports = { ensureGiftRegistryTables, registerGiftRegistryRoutes, sweepExpiredReservations };
