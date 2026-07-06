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
  if (!pgPool) return;
  const client = await pgPool.connect();
  try {
    // gift_events — the registry itself
    await client.query(`
      CREATE TABLE IF NOT EXISTS gift_events (
        id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_user_id          uuid NOT NULL,
        beneficiary_type         text NOT NULL CHECK (beneficiary_type IN ('SELF','CHILD','OTHER')),
        beneficiary_ref          uuid,
        beneficiary_display_name text NOT NULL,
        beneficiary_mint_number  text,
        occasion                 text NOT NULL CHECK (occasion IN ('BIRTHDAY','WEDDING','BABY','GRADUATION','FESTIVE','CUSTOM')),
        custom_occasion          text,
        title                    text NOT NULL,
        event_date               date NOT NULL,
        expiry_at                timestamptz NOT NULL,
        status                   text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','EXPIRED','CANCELLED')),
        share_token              text UNIQUE,
        message                  text,
        created_at               timestamptz DEFAULT now(),
        updated_at               timestamptz DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_gift_events_creator ON gift_events(creator_user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_gift_events_token ON gift_events(share_token)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_gift_events_status ON gift_events(status)`);

    // gift_registry_items — each wishlist line
    await client.query(`
      CREATE TABLE IF NOT EXISTS gift_registry_items (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        gift_event_id         uuid NOT NULL REFERENCES gift_events(id) ON DELETE CASCADE,
        isin                  text NOT NULL,
        instrument_type       text NOT NULL DEFAULT 'SHARE' CHECK (instrument_type IN ('SHARE','ETF','BASKET')),
        target_quantity       int NOT NULL CHECK (target_quantity > 0),
        filled_quantity       int NOT NULL DEFAULT 0,
        reserved_quantity     int NOT NULL DEFAULT 0,
        min_tranche_quantity  int,
        price_snapshot_cents  int,
        status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIALLY_FILLED','FILLED','REMOVED','SUSPENDED')),
        display_order         int DEFAULT 0,
        created_at            timestamptz DEFAULT now(),
        updated_at            timestamptz DEFAULT now(),
        CONSTRAINT no_oversell CHECK (filled_quantity + reserved_quantity <= target_quantity)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_gift_items_event ON gift_registry_items(gift_event_id)`);

    // gift_reservations — 10-min seat-hold while someone is in checkout
    await client.query(`
      CREATE TABLE IF NOT EXISTS gift_reservations (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        registry_item_id  uuid NOT NULL REFERENCES gift_registry_items(id),
        gifter_user_id    uuid NOT NULL,
        quantity          int NOT NULL CHECK (quantity > 0),
        expires_at        timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
        status            text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','CONSUMED','RELEASED','EXPIRED')),
        price_lock_cents  int NOT NULL,
        created_at        timestamptz DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_gift_res_item ON gift_reservations(registry_item_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_gift_res_status ON gift_reservations(status, expires_at)`);

    // gift_contributions — one row per successful payment
    await client.query(`
      CREATE TABLE IF NOT EXISTS gift_contributions (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        registry_item_id      uuid NOT NULL REFERENCES gift_registry_items(id),
        gifter_user_id        uuid NOT NULL,
        gifter_email          text NOT NULL,
        quantity              int NOT NULL,
        quoted_amount_cents   int NOT NULL,
        executed_amount_cents int,
        fee_cents             int,
        status                text NOT NULL DEFAULT 'INITIATED' CHECK (status IN (
          'INITIATED','RESERVED','PAID','EXECUTING','SETTLED','REFUNDED','FAILED','RESERVATION_EXPIRED'
        )),
        reservation_id        uuid REFERENCES gift_reservations(id),
        payment_ref           text,
        order_ref             text,
        idempotency_key       text UNIQUE NOT NULL,
        created_at            timestamptz DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_gift_contrib_item ON gift_contributions(registry_item_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_gift_contrib_gifter ON gift_contributions(gifter_user_id)`);

    // Notify PostgREST to reload its schema cache so Supabase client can see the new tables
    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log('[gift-registry] All tables ready');
  } catch (e) {
    console.error('[gift-registry] Migration error:', e.message);
  } finally {
    client.release();
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
      if (!occasion || !beneficiaryType || !beneficiaryDisplayName || !title || !eventDate || !expiryAt) {
        return res.status(400).json({ error: 'Missing required fields' });
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

      if (error) throw error;
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

      if (error) throw error;

      const registries = data || [];

      // Enrich all items across all registries with logo_url in one query
      const allIsins = [...new Set(registries.flatMap(r => (r.items || []).map(i => i.isin)))];
      let secMap = {};
      if (allIsins.length) {
        const { data: securities } = await supabaseAdmin
          .from('securities_c')
          .select('isin, name, logo_url')
          .in('isin', allIsins);
        secMap = Object.fromEntries((securities || []).map(s => [s.isin, s]));
      }

      const enriched = registries.map(r => ({
        ...r,
        items: (r.items || []).map(item => ({
          ...item,
          name: secMap[item.isin]?.name || item.isin,
          logo_url: secMap[item.isin]?.logo_url || null,
        })),
      }));

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

      const { data: registry, error } = await supabaseAdmin
        .from('gift_events')
        .select(`*, items:gift_registry_items(*)`)
        .eq('id', req.params.id)
        .eq('creator_user_id', user.id)
        .single();

      if (error || !registry) return res.status(404).json({ error: 'Registry not found' });

      // Enrich items with security name/logo
      if (registry.items?.length) {
        const isins = registry.items.map(i => i.isin);
        const { data: securities } = await supabaseAdmin
          .from('securities_c')
          .select('isin, name, logo_url, last_price')
          .in('isin', isins);

        const secMap = Object.fromEntries((securities || []).map(s => [s.isin, s]));
        registry.items = registry.items.map(item => ({
          ...item,
          name: secMap[item.isin]?.name || item.isin,
          logo_url: secMap[item.isin]?.logo_url || null,
          price_snapshot_cents: item.price_snapshot_cents || secMap[item.isin]?.last_price || 0,
        }));
      }

      return res.json({ registry });
    } catch (e) {
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

      // Enrich items with name/logo only — never join to users or holdings
      if (registry.items?.length) {
        const isins = registry.items.map(i => i.isin);
        const { data: securities } = await supabaseAdmin
          .from('securities_c')
          .select('isin, name, logo_url, last_price')
          .in('isin', isins);

        const secMap = Object.fromEntries((securities || []).map(s => [s.isin, s]));
        registry.items = registry.items
          .filter(i => i.status !== 'REMOVED')
          .sort((a, b) => a.display_order - b.display_order)
          .map(item => ({
            ...item,
            name: secMap[item.isin]?.name || item.isin,
            logo_url: secMap[item.isin]?.logo_url || null,
            price_snapshot_cents: item.price_snapshot_cents || secMap[item.isin]?.last_price || 0,
          }));
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
      if (!registryId || !itemKey) return res.status(400).json({ error: 'Missing registryId or itemKey' });

      // Verify ownership
      const { data: reg } = await supabaseAdmin
        .from('gift_events').select('id, status')
        .eq('id', registryId).eq('creator_user_id', user.id).single();
      if (!reg) return res.status(404).json({ error: 'Registry not found' });
      if (!['DRAFT', 'ACTIVE', 'PAUSED'].includes(reg.status))
        return res.status(400).json({ error: 'Cannot add items to a closed registry' });

      const isStrategy = itemKey.startsWith('gift:') || itemKey.startsWith('strategy:');

      if (isStrategy) {
        // ── Strategy basket: expand holdings and insert each as a SHARE item ──
        const strategyId = itemKey.replace(/^(gift:|strategy:)/, '');
        const { data: strategy, error: stratErr } = await supabaseAdmin
          .from('strategies_c').select('id, name, holdings').eq('id', strategyId).single();
        if (stratErr || !strategy) return res.status(404).json({ error: 'Strategy not found' });

        const holdings = Array.isArray(strategy.holdings) ? strategy.holdings : [];
        if (!holdings.length) return res.status(400).json({ error: 'Strategy has no holdings' });

        const tickers = [...new Set(holdings.map(h => h.ticker || h.symbol || h).filter(Boolean))];
        const { data: securities } = await supabaseAdmin
          .from('securities_c').select('isin, symbol, last_price').in('symbol', tickers);
        const secBySymbol = Object.fromEntries((securities || []).map(s => [s.symbol, s]));

        // Find already-added ISINs to avoid duplicates
        const { data: existing } = await supabaseAdmin
          .from('gift_registry_items').select('isin').eq('gift_event_id', registryId);
        const existingIsins = new Set((existing || []).map(r => r.isin));

        const toInsert = [];
        const seenIsins = new Set(existingIsins); // dedupe within this request too
        for (const h of holdings) {
          const ticker = h.ticker || h.symbol || h;
          const sec = secBySymbol[ticker];
          if (!sec?.isin || seenIsins.has(sec.isin)) continue;
          seenIsins.add(sec.isin);
          const priceCents = sec.last_price || 0;
          const minTranche = priceCents > 0 ? Math.max(1, Math.ceil(1000 / priceCents)) : 1;
          toInsert.push({
            gift_event_id: registryId, isin: sec.isin, instrument_type: 'SHARE',
            target_quantity: 1, price_snapshot_cents: priceCents, min_tranche_quantity: minTranche,
          });
        }

        if (!toInsert.length) return res.json({ success: true, items: [], message: 'All holdings already in registry' });

        const { data: items, error: insertErr } = await supabaseAdmin
          .from('gift_registry_items').insert(toInsert).select();
        if (insertErr) throw insertErr;
        return res.json({ success: true, items });

      } else {
        // ── Plain ISIN / symbol ──
        const { data: existing } = await supabaseAdmin
          .from('gift_registry_items').select('id').eq('gift_event_id', registryId).eq('isin', itemKey).maybeSingle();
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

      // Verify ownership via join
      const { data: item } = await supabaseAdmin
        .from('gift_registry_items')
        .select('id, gift_event_id, gift_events!inner(creator_user_id)')
        .eq('id', req.params.itemId)
        .single();

      if (!item || item.gift_events?.creator_user_id !== user.id) {
        return res.status(404).json({ error: 'Item not found' });
      }

      const { error } = await supabaseAdmin
        .from('gift_registry_items')
        .update({ status: 'REMOVED' })
        .eq('id', req.params.itemId);

      if (error) throw error;
      return res.json({ success: true });
    } catch (e) {
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
// Call this to get the cron function — schedule with cron.schedule('* * * * *', ...)
// Decision 5: only expires reservations past their OWN expires_at (not event expiry)

async function sweepExpiredReservations(pgPool) {
  if (!pgPool) return;
  const pg = await pgPool.connect();
  try {
    // Step 1: expire HELD reservations past their TTL
    const expired = await pg.query(`
      UPDATE gift_reservations
         SET status = 'EXPIRED'
       WHERE status = 'HELD'
         AND expires_at < now()
      RETURNING id, registry_item_id, quantity
    `);

    if (expired.rowCount === 0) return;

    // Step 2: return reserved_quantity to each affected item
    // Group by registry_item_id
    const groups = {};
    for (const row of expired.rows) {
      groups[row.registry_item_id] = (groups[row.registry_item_id] || 0) + row.quantity;
    }

    for (const [itemId, qty] of Object.entries(groups)) {
      await pg.query(`
        UPDATE gift_registry_items
           SET reserved_quantity = GREATEST(0, reserved_quantity - $1),
               updated_at = now()
         WHERE id = $2
      `, [qty, itemId]);
    }

    console.log(`[gift-registry] Released ${expired.rowCount} expired reservation(s)`);
  } catch (e) {
    console.error('[gift-registry] sweeper error:', e.message);
  } finally {
    pg.release();
  }
}

module.exports = { ensureGiftRegistryTables, registerGiftRegistryRoutes, sweepExpiredReservations };
