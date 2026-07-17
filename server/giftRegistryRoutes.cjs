/**
 * Gift Registry — Express routes + DB migration for development server.
 * All routes mirror api/gift-registry/ Vercel functions.
 *
 * Usage in server/index.cjs:
 *   const { registerGiftRegistryRoutes, ensureGiftRegistryTables } = require('./giftRegistryRoutes.cjs');
 *   ensureGiftRegistryTables(pgPool, supabaseAdmin);
 *   registerGiftRegistryRoutes(app, supabaseAdmin);
 *
 * IMPORTANT notes (from plan):
 *   - Prices in CENTS throughout (ZAp for JSE — do NOT multiply by 100)
 *   - Quantities are always whole integers (Decision 9)
 *   - All reads/writes go to Supabase — pgPool is NOT used (no local gift-registry tables)
 *   - Specific routes are registered before wildcard /:id routes to prevent shadowing
 */

'use strict';

const crypto = require('crypto');

// ─── DB migration ────────────────────────────────────────────────────────────

async function ensureGiftRegistryTables(pgPool, supabaseAdmin) {
  // All gift registry tables live in Supabase — NOT in the local pgPool.
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

  // Auto-repair: fix orphaned child registries where beneficiary_ref was never set
  // (these were created with old code that used a non-existent family_member_id column,
  //  leaving beneficiary_ref = NULL and making them invisible on the child's dashboard)
  try {
    const { data: orphaned } = await supabaseAdmin
      .from('gift_events')
      .select('id, creator_user_id, beneficiary_display_name')
      .eq('beneficiary_type', 'CHILD')
      .is('beneficiary_ref', null);

    if (orphaned?.length) {
      console.log(`[gift-registry] Found ${orphaned.length} orphaned child registries — attempting auto-repair`);
      for (const reg of orphaned) {
        const { data: members } = await supabaseAdmin
          .from('family_members')
          .select('id, first_name, last_name')
          .eq('primary_user_id', reg.creator_user_id)
          .eq('relationship', 'child');

        if (!members?.length) continue;

        const displayName = (reg.beneficiary_display_name || '').toLowerCase().trim();
        const match = members.find(m => {
          const fn = (m.first_name || '').toLowerCase().trim();
          const full = `${m.first_name || ''} ${m.last_name || ''}`.toLowerCase().trim();
          return displayName === fn || displayName === full ||
            displayName.startsWith(fn) || fn.startsWith(displayName.split(' ')[0]);
        });

        if (match) {
          const { error: upErr } = await supabaseAdmin
            .from('gift_events')
            .update({ beneficiary_ref: match.id })
            .eq('id', reg.id);
          if (!upErr) {
            console.log(`[gift-registry] Repaired registry ${reg.id} → beneficiary_ref=${match.id} (${match.first_name})`);
          } else {
            console.warn(`[gift-registry] Could not repair registry ${reg.id}:`, upErr.message);
          }
        }
      }
    } else {
      console.log('[gift-registry] No orphaned child registries found — data is clean');
    }
  } catch (e) {
    console.warn('[gift-registry] Auto-repair threw:', e.message);
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

// KYC check: user must have a verified onboarding record.
// Accepts 'approved', 'onboarding_complete', and legacy 'verified' — same logic
// as parseOnboardingFlags in src/lib/checkOnboardingComplete.js.
async function isKycComplete(userId, supabaseAdmin) {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_onboarding')
      .select('kyc_status, sumsub_raw')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      console.log(`[gift-registry] isKycComplete userId=${userId} result=false (no row or query error: ${error?.message})`);
      return false;
    }

    // Mirror exactly the logic used by /api/onboarding/status so the server
    // never rejects a user the frontend considers fully onboarded.

    // "onboarding_complete" is the definitive completed-flow marker.
    if (data.kyc_status === 'onboarding_complete') {
      console.log(`[gift-registry] isKycComplete userId=${userId} kyc_status=onboarding_complete result=true`);
      return true;
    }

    const kycDone = ['approved', 'onboarding_complete', 'verified'].includes(data.kyc_status);
    let raw = {};
    try { raw = typeof data.sumsub_raw === 'string' ? JSON.parse(data.sumsub_raw) : (data.sumsub_raw || {}); } catch {}

    const signed = !!raw?.signed_at || !!raw?.account_agreement_signed;

    // Grandfathering: KYC-approved + signature = all onboarding steps treated as done.
    if (kycDone && signed) {
      console.log(`[gift-registry] isKycComplete userId=${userId} kyc_status=${data.kyc_status} grandfathered=true result=true`);
      return true;
    }

    // Non-grandfathered: every step must be individually complete.
    const taxDone      = !!raw?.tax_details_saved;
    const bankDone     = !!raw?.bank_details_saved;
    const mandateDone  = !!raw?.mandate_data?.agreedMandate || !!raw?.mandate_accepted;
    const riskDone     = !!raw?.risk_disclosure_accepted;
    const sofDone      = !!raw?.source_of_funds_accepted;
    const termsDone    = !!raw?.terms_accepted;
    const result = kycDone && taxDone && bankDone && mandateDone && riskDone && sofDone && termsDone && signed;
    console.log(`[gift-registry] isKycComplete userId=${userId} kyc_status=${data.kyc_status} result=${result}`);
    return result;
  } catch (e) {
    console.warn(`[gift-registry] isKycComplete THREW userId=${userId} err=${e.message}`);
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

  // Try by isin column first; fall back to symbol for JSE stocks where isin is null
  const { data: byIsin } = await supabaseAdmin
    .from('securities_c').select('last_price').eq('isin', isin).maybeSingle();
  if (byIsin?.last_price) return byIsin.last_price;

  const { data: bySym } = await supabaseAdmin
    .from('securities_c').select('last_price').eq('symbol', isin).maybeSingle();
  return bySym?.last_price || 0; // cents
}

// ─── Shared item enrichment helper ────────────────────────────────────────────

async function enrichItems(items, supabaseAdmin) {
  if (!items || !items.length) return items;

  const activeItems = items.filter(i => i.status !== 'REMOVED');
  const shareItems = activeItems.filter(i => i.instrument_type !== 'BASKET');
  const basketItems = activeItems.filter(i => i.instrument_type === 'BASKET');
  const enrichedMap = {};

  if (shareItems.length) {
    const isins = shareItems.map(i => i.isin);
    // Query by isin AND by symbol in parallel — many JSE stocks have isin=null in
    // securities_c and are only indexed by their symbol (e.g. "BHG.JO").
    const [{ data: byIsin }, { data: bySymbol }] = await Promise.all([
      supabaseAdmin.from('securities_c').select('isin, symbol, name, logo_url, last_price').in('isin', isins),
      supabaseAdmin.from('securities_c').select('isin, symbol, name, logo_url, last_price').in('symbol', isins),
    ]);
    // Merge: symbol match first so it's overridden by a real isin match when both exist
    const secMap = {};
    for (const s of (bySymbol || [])) if (s.symbol) secMap[s.symbol] = s;
    for (const s of (byIsin   || [])) if (s.isin)   secMap[s.isin]   = s;
    shareItems.forEach(item => {
      const sec = secMap[item.isin];
      enrichedMap[item.id] = {
        ...item,
        name: sec?.name || item.isin,
        logo_url: sec?.logo_url || null,
        price_snapshot_cents: item.price_snapshot_cents || sec?.last_price || 0,
      };
    });
  }

  if (basketItems.length) {
    const strategyIds = basketItems.map(i => i.isin);
    // Only select columns that actually exist in strategies_c.
    // r_ytd / ytd_as_of_date live in strategies_returns_c — fetched separately below.
    const { data: strategies, error: stratErr } = await supabaseAdmin
      .from('strategies_c')
      .select('id, name, short_name, holdings, tags, risk_level, objective, is_featured, min_investment')
      .in('id', strategyIds);
    if (stratErr) console.warn('[gift-registry] enrichItems strategies_c error:', stratErr.message);

    // Fetch latest YTD return per strategy from the returns table
    const { data: returnsRows } = await supabaseAdmin
      .from('strategies_returns_c')
      .select('strategy_id, as_of_date, ytd_pct')
      .in('strategy_id', strategyIds)
      .order('as_of_date', { ascending: false });
    const latestReturn = {};
    for (const row of (returnsRows || [])) {
      if (!latestReturn[row.strategy_id]) latestReturn[row.strategy_id] = row;
    }

    const allTickers = (strategies || []).flatMap(s =>
      (s.holdings || []).map(h => h.ticker || h.symbol || h).filter(Boolean)
    );
    const uniqueTickers = [...new Set(allTickers)];
    // Include both raw tickers (e.g. "STX40.JO") and normalized without exchange suffix
    // (e.g. "STX40") so the lookup works regardless of which format securities_c uses.
    const normalizedTickers = uniqueTickers.map(t => t.split('.')[0]).filter(Boolean);
    const allQueryTickers = [...new Set([...uniqueTickers, ...normalizedTickers])];
    const { data: secs } = allQueryTickers.length
      ? await supabaseAdmin.from('securities_c').select('symbol, name, logo_url, last_price').in('symbol', allQueryTickers)
      : { data: [] };
    // Build a bidirectional map: both "STX40.JO" and "STX40" point to the same row.
    const secBySymbol = {};
    for (const s of (secs || [])) {
      secBySymbol[s.symbol] = s;
      const norm = s.symbol.split('.')[0];
      if (norm && !secBySymbol[norm]) secBySymbol[norm] = s;
    }
    const stratMap = Object.fromEntries((strategies || []).map(s => [s.id, s]));

    basketItems.forEach(item => {
      const strategy = stratMap[item.isin];
      if (!strategy) { enrichedMap[item.id] = { ...item, name: 'Investment Basket' }; return; }
      const holdings = Array.isArray(strategy.holdings) ? strategy.holdings : [];
      const holdingsSnapshot = holdings
        .map(h => { const t = h.ticker || h.symbol || String(h); const sec = secBySymbol[t] || secBySymbol[t.split('.')[0]]; return { symbol: t, name: sec?.name || t, logo_url: sec?.logo_url || null }; })
        .sort((a, b) => (b.logo_url ? 1 : 0) - (a.logo_url ? 1 : 0))
        .slice(0, 5);

      // Live price: sum(shares × last_price_cents) matching calculateMinInvestmentSync logic.
      // last_price is in cents; display layer applies /100 × 1.08 for the Rand figure.
      const livePriceCents = holdings.reduce((sum, h) => {
        const ticker = h.ticker || h.symbol || String(h);
        const shares = Number(h.shares || h.quantity || h.weight || 1);
        // Look up by raw ticker first, then normalized (strips exchange suffix, e.g. ".JO")
        const sec = secBySymbol[ticker] || secBySymbol[ticker.split('.')[0]];
        return sum + shares * (sec?.last_price || 0);
      }, 0);
      // Fall back to stored DB min_investment (in cents) if live data is unavailable
      const effectivePriceCents = livePriceCents > 0
        ? livePriceCents
        : (strategy.min_investment || item.price_snapshot_cents || 0);

      const ret = latestReturn[strategy.id];

      enrichedMap[item.id] = {
        ...item,
        name: strategy.name || strategy.short_name || 'Investment Basket',
        short_name: strategy.short_name || strategy.name || null,
        logo_url: null,
        holdings_snapshot: holdingsSnapshot,
        total_holdings: holdings.length,
        price_snapshot_cents: effectivePriceCents,
        tags: strategy.tags,
        risk_level: strategy.risk_level,
        r_ytd: ret ? ret.ytd_pct / 100 : null,
        ytd_as_of_date: ret?.as_of_date || null,
        objective: strategy.objective,
        is_featured: strategy.is_featured,
      };
    });
  }

  return activeItems
    .map(item => enrichedMap[item.id] || item)
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
}

// ─── Routes ───────────────────────────────────────────────────────────────────
// ORDERING RULE: specific paths before wildcard /:id to prevent route shadowing.

function registerGiftRegistryRoutes(app, supabaseAdmin) {

  // GET /api/gift-wishlist-prefs — load user's wishlisted keys + strategy watchlist
  //
  // wishlistedKeys drives the heart icon on strategy/security cards. It must reflect
  // whether the item is ACTUALLY still present (OPEN/PARTIALLY_FILLED) in one of the
  // user's active wishlists — not just "was ever liked". Otherwise a heart can keep
  // showing after the underlying item was removed or fully gifted (stale-heart bug).
  // We intersect the stored preference set with the DB-confirmed set on every load.
  app.get('/api/gift-wishlist-prefs', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // When a childFamilyMemberId is provided the caller is rendering a specific
      // child's dashboard.  Hearts must only reflect items in THAT child's registries
      // so that Amara's liked items don't bleed into Will Smith's heart state.
      // In child-context mode we skip reading/writing parent metadata entirely.
      const childFamilyMemberId = req.query.childFamilyMemberId || null;

      if (childFamilyMemberId) {
        // Build confirmed set scoped to this child's registries only
        let registryQuery = supabaseAdmin
          .from('gift_events')
          .select('id')
          .eq('creator_user_id', user.id)
          .eq('beneficiary_ref', childFamilyMemberId)
          .not('status', 'in', '(CANCELLED,EXPIRED)');
        const { data: childRegistries } = await registryQuery;
        const childRegistryIds = (childRegistries || []).map(r => r.id);

        const childSet = new Set();
        if (childRegistryIds.length) {
          const { data: items } = await supabaseAdmin
            .from('gift_registry_items')
            .select('isin, instrument_type')
            .in('gift_event_id', childRegistryIds)
            .in('status', ['OPEN', 'PARTIALLY_FILLED']);
          for (const it of items || []) {
            if (it.instrument_type === 'BASKET') {
              childSet.add(`strategy:${it.isin}`);
              childSet.add(`gift:${it.isin}`);
            } else {
              childSet.add(it.isin);
            }
          }
        }
        // Return child-scoped keys; watchlist is always global (parent pref)
        const prefs = user.user_metadata?.gift_wishlist_prefs || {};
        return res.json({ wishlistedKeys: Array.from(childSet), watchlist: prefs.watchlist || [] });
      }

      const prefs = user.user_metadata?.gift_wishlist_prefs || {};
      const storedKeys = prefs.keys || [];

      // wishlistedKeys must reflect DB truth, not just what was previously written to
      // storage — items can be added to a registry through flows that never touch
      // storage (e.g. "like it, then create a new wishlist"). So we always compute
      // the confirmed set directly from the DB rather than filtering storedKeys.
      // For the parent's own view, exclude child-owned registries so a child's
      // liked items don't show as hearted on the parent's own markets page.
      const { data: myRegistries } = await supabaseAdmin
        .from('gift_events')
        .select('id')
        .eq('creator_user_id', user.id)
        .is('beneficiary_ref', null)
        .not('status', 'in', '(CANCELLED,EXPIRED)');
      const registryIds = (myRegistries || []).map(r => r.id);

      const confirmedSet = new Set();
      if (registryIds.length) {
        const { data: items } = await supabaseAdmin
          .from('gift_registry_items')
          .select('isin, instrument_type')
          .in('gift_event_id', registryIds)
          .in('status', ['OPEN', 'PARTIALLY_FILLED']);
        for (const it of items || []) {
          if (it.instrument_type === 'BASKET') {
            confirmedSet.add(`strategy:${it.isin}`);
            confirmedSet.add(`gift:${it.isin}`);
          } else {
            confirmedSet.add(it.isin);
          }
        }
      }
      const confirmedKeys = Array.from(confirmedSet);

      // Keep storage in sync with the DB-confirmed set so other consumers of the
      // raw stored prefs (if any) don't drift from what the heart icons show.
      const storedSorted = [...storedKeys].sort().join(',');
      const confirmedSorted = [...confirmedKeys].sort().join(',');
      if (storedSorted !== confirmedSorted) {
        const prunedPrefs = { ...prefs, keys: confirmedKeys };
        supabaseAdmin.auth.admin.updateUserById(user.id, {
          user_metadata: { ...user.user_metadata, gift_wishlist_prefs: prunedPrefs },
        }).catch(e => console.error('[gift-wishlist-prefs] sync error:', e.message));
      }

      return res.json({ wishlistedKeys: confirmedKeys, watchlist: prefs.watchlist || [] });
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

      const { occasion, customOccasion, beneficiaryType, beneficiaryDisplayName, title, eventDate, expiryAt, message, familyMemberId } = req.body;
      console.log(`[gift-registry] CREATE start: user=${user.id} occasion=${occasion} beneficiaryType=${beneficiaryType} title=${title} eventDate=${eventDate} expiryAt=${expiryAt}`);

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
          beneficiary_ref: familyMemberId || null,
          title,
          event_date: eventDate,
          expiry_at: expiryAt,
          message: message || null,
          status: 'ACTIVE',
          share_token: crypto.randomBytes(24).toString('base64url'),
        })
        .select()
        .single();

      if (error) {
        console.error(`[gift-registry] CREATE: Supabase insert error code=${error.code} message=${error.message}`);
        throw error;
      }
      console.log(`[gift-registry] CREATE success: registryId=${registry.id} title="${registry.title}"`);
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

      // Check if this user is a linked child account
      const { data: familyRow } = await supabaseAdmin
        .from('family_members')
        .select('id')
        .eq('linked_user_id', user.id)
        .eq('relationship', 'child')
        .maybeSingle();

      let query = supabaseAdmin
        .from('gift_events')
        .select(`*, items:gift_registry_items(*)`);

      if (familyRow?.id) {
        // Child: own registries OR ones the parent created for them — nothing else
        query = query.or(`creator_user_id.eq.${user.id},beneficiary_ref.eq.${familyRow.id}`);
      } else {
        // Parent / regular user: all registries they created
        query = query.eq('creator_user_id', user.id);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

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
        // Query by isin AND symbol — JSE stocks often have isin=null in securities_c
        const [{ data: byIsin }, { data: bySymbol }] = await Promise.all([
          supabaseAdmin.from('securities_c').select('isin, symbol, name, logo_url').in('isin', shareIsins),
          supabaseAdmin.from('securities_c').select('isin, symbol, name, logo_url').in('symbol', shareIsins),
        ]);
        for (const s of (bySymbol || [])) if (s.symbol) secMap[s.symbol] = s;
        for (const s of (byIsin   || [])) if (s.isin)   secMap[s.isin]   = s;
        console.log(`[gift-registry] my-registries: secMap resolved=${Object.keys(secMap).length}/${shareIsins.length}`);
      }

      // Enrich strategy baskets from strategies_c
      let strategyMap = {};
      if (basketStrategyIds.length) {
        const { data: strategies, error: stratErr } = await supabaseAdmin
          .from('strategies_c').select('id, name, holdings').in('id', basketStrategyIds);
        if (stratErr) console.error(`[gift-registry] my-registries: strategies_c error=${stratErr.message}`);
        console.log(`[gift-registry] my-registries: strategies found=${strategies?.length ?? 0} names=${strategies?.map(s => s.name).join(',')}`);
        const allTickers = (strategies || []).flatMap(s => (s.holdings || []).map(h => h.ticker || h.symbol || h).filter(Boolean));
        const uniqueTickers = [...new Set(allTickers)];
        let secBySymbol = {};
        if (uniqueTickers.length) {
          const { data: secs } = await supabaseAdmin.from('securities_c').select('symbol, name, logo_url').in('symbol', uniqueTickers);
          secBySymbol = Object.fromEntries((secs || []).map(s => [s.symbol, s]));
        }
        strategyMap = Object.fromEntries((strategies || []).map(s => {
          const holdingsSnap = (s.holdings || [])
            .map(h => { const t = h.ticker || h.symbol || String(h); const sec = secBySymbol[t] || secBySymbol[t.split('.')[0]]; return { symbol: t, name: sec?.name || t, logo_url: sec?.logo_url || null }; })
            .sort((a, b) => (b.logo_url ? 1 : 0) - (a.logo_url ? 1 : 0))
            .slice(0, 5);
          return [s.id, { name: s.name, holdingsSnap }];
        }));
        console.log(`[gift-registry] my-registries: strategyMap keys=${Object.keys(strategyMap).join(',')}`);
      }

      const enriched = registries.map(r => {
        const activeItems = (r.items || []).filter(i => i.status !== 'REMOVED');
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
                name: strategyMap[item.isin]?.name || 'Investment Basket',
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
      console.error('[gift-registry] my-registries error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── Specific-path GET routes BEFORE wildcard GET /:id ──────────────────────

  // GET /api/gift-registry/public/:token/my-contributions — item IDs gifted by the authed user for this registry
  // MUST be registered before /public/:token to avoid route shadowing in Express 5.
  app.get('/api/gift-registry/public/:token/my-contributions', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.json({ itemIds: [] }); // unauthenticated — return empty, not error

      const { data: registry, error: regErr } = await supabaseAdmin
        .from('gift_events')
        .select('id')
        .eq('share_token', req.params.token)
        .single();

      if (regErr || !registry) return res.json({ itemIds: [] });

      const { data: contribs } = await supabaseAdmin
        .from('gift_contributions')
        .select('registry_item_id')
        .eq('gifter_user_id', user.id)
        .eq('gift_event_id', registry.id)
        .eq('status', 'PAID');

      const itemIds = [...new Set((contribs || []).map(c => c.registry_item_id).filter(Boolean))];
      return res.json({ itemIds });
    } catch (e) {
      return res.json({ itemIds: [] });
    }
  });

  // GET /api/gift-registry/public/:token — public view (no auth required)
  app.get('/api/gift-registry/public/:token', async (req, res) => {
    try {
      const { data: registry, error } = await supabaseAdmin
        .from('gift_events')
        .select(`
          id, title, occasion, custom_occasion, beneficiary_display_name,
          event_date, expiry_at, message, status, share_token, creator_user_id,
          items:gift_registry_items(
            id, isin, instrument_type, target_quantity, filled_quantity,
            reserved_quantity, min_tranche_quantity, price_snapshot_cents,
            status, display_order
          )
        `)
        .eq('share_token', req.params.token)
        .single();

      if (error || !registry) return res.status(404).json({ error: 'Registry not found' });
      registry.items = await enrichItems(registry.items, supabaseAdmin);

      // Fetch contributions with gifter display names and amounts for the "Gift history" tab
      try {
        const itemIds = (registry.items || []).map(i => i.id).filter(Boolean);
        if (itemIds.length > 0) {
          const { data: contribs, error: contribFetchErr } = await supabaseAdmin
            .from('gift_contributions')
            .select('id, registry_item_id, gifter_user_id, gifter_email, quantity, quoted_amount_cents, executed_amount_cents, fee_cents, status, created_at')
            .in('registry_item_id', itemIds)
            .eq('status', 'PAID')
            .order('created_at', { ascending: false });
          if (contribFetchErr) console.warn('[gift-registry] public: contributions query error:', contribFetchErr.message);

          if (contribs && contribs.length > 0) {
            // Enrich with gifter names from profiles
            const gifterIds = [...new Set(contribs.map(c => c.gifter_user_id).filter(Boolean))];
            const { data: profiles } = await supabaseAdmin
              .from('profiles')
              .select('id, first_name, last_name, mint_number')
              .in('id', gifterIds);
            const profileMap = {};
            for (const p of profiles || []) profileMap[p.id] = p;

            registry.all_contributions = contribs.map(c => {
              const p = profileMap[c.gifter_user_id];
              const gifterName = p
                ? [p.first_name, p.last_name].filter(Boolean).join(' ') || c.gifter_email?.split('@')[0] || 'Someone'
                : c.gifter_email?.split('@')[0] || 'Someone';
              return {
                ...c,
                gifter_name: gifterName,
                gifter_mint_number: p?.mint_number || null,
              };
            });
          } else {
            registry.all_contributions = [];
          }
        } else {
          registry.all_contributions = [];
        }
      } catch (contribErr) {
        console.warn('[gift-registry] public: contributions fetch error:', contribErr.message);
        registry.all_contributions = [];
      }

      // Record authenticated viewer for nudge eligibility tracking (fire-and-forget)
      const authHeader = req.headers.authorization || '';
      const viewerToken = authHeader.replace('Bearer ', '');
      if (viewerToken) {
        supabaseAdmin.auth.getUser(viewerToken).then(({ data: { user } }) => {
          if (user?.id) {
            supabaseAdmin.from('gift_registry_views').upsert(
              { registry_id: registry.id, viewer_user_id: user.id, viewed_at: new Date().toISOString() },
              { onConflict: 'registry_id,viewer_user_id' }
            ).then(({ error: ve }) => {
              if (ve && ve.code !== '42P01') {
                console.warn('[gift-registry] view record failed:', ve.message);
              }
            });
          }
        }).catch(() => {});
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

  // ── Specific-path POST/DELETE routes for items BEFORE wildcard /:id/* ──────

  // POST /api/gift-registry/items/by-key — add an item by itemKey
  // itemKey is either a plain ISIN ("NPN.JO") or a prefixed strategy ("gift:uuid" / "strategy:uuid").
  // Strategy keys → one BASKET row (isin = strategy UUID); ISIN keys → one SHARE row.
  app.post('/api/gift-registry/items/by-key', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { registryId, itemKey } = req.body;
      console.log(`[gift-registry] by-key start: user=${user.id} registryId=${registryId} itemKey=${itemKey}`);
      if (!registryId || !itemKey) return res.status(400).json({ error: 'Missing registryId or itemKey' });

      // Verify ownership
      const { data: reg, error: regErr } = await supabaseAdmin
        .from('gift_events').select('id, status')
        .eq('id', registryId).eq('creator_user_id', user.id).single();
      if (!reg) {
        console.warn(`[gift-registry] by-key: registry not found — regErr=${regErr?.message}`);
        return res.status(404).json({ error: 'Registry not found' });
      }
      // COMPLETED just means every item currently listed has been fully gifted —
      // the owner can still add new items, which reopens the registry to ACTIVE
      // so others can gift the new item too. Only CANCELLED/EXPIRED are terminal.
      if (['CANCELLED', 'EXPIRED'].includes(reg.status))
        return res.status(400).json({ error: 'Cannot add items to a closed registry' });
      if (reg.status === 'COMPLETED') {
        await supabaseAdmin.from('gift_events').update({ status: 'ACTIVE', updated_at: new Date().toISOString() }).eq('id', registryId);
        console.log(`[gift-registry] by-key: reopened COMPLETED registry ${registryId} to ACTIVE`);
      }

      const isStrategy = itemKey.startsWith('gift:') || itemKey.startsWith('strategy:');
      console.log(`[gift-registry] by-key: classification=${isStrategy ? 'BASKET/STRATEGY' : 'SHARE/ISIN'}`);

      if (isStrategy) {
        // ── Strategy basket: stored as one BASKET row (isin = strategy UUID).
        //    GET enrichment joins strategies_c to build holdings_snapshot at read time. ──
        const strategyId = itemKey.replace(/^(gift:|strategy:)/, '');
        console.log(`[gift-registry] by-key: strategyId=${strategyId} — looking up strategies_c`);
        const { data: strategy, error: stratErr } = await supabaseAdmin
          .from('strategies_c').select('id, name, holdings').eq('id', strategyId).single();

        if (stratErr || !strategy) {
          console.warn(`[gift-registry] by-key: strategy NOT found strategyId=${strategyId} err=${stratErr?.message}`);
          return res.status(404).json({ error: 'Strategy not found' });
        }
        console.log(`[gift-registry] by-key: strategy resolved name="${strategy.name}" holdings=${strategy.holdings?.length ?? 0}`);

        const holdings = Array.isArray(strategy.holdings) ? strategy.holdings : [];
        if (!holdings.length) return res.status(400).json({ error: 'Strategy has no holdings' });

        // Only dedupe against a still-open row (OPEN/PARTIALLY_FILLED). REMOVED or fully
        // FILLED rows mean nothing is left to gift, so a fresh add creates a brand-new row —
        // otherwise re-gifting an already-completed strategy silently no-ops.
        const { data: existing } = await supabaseAdmin
          .from('gift_registry_items').select('id').eq('gift_event_id', registryId).eq('isin', strategyId).not('status', 'in', '(REMOVED,FILLED)').maybeSingle();
        if (existing) {
          console.log(`[gift-registry] by-key: BASKET already in registry itemId=${existing.id}`);
          return res.json({ success: true, item: existing, message: 'Already in registry' });
        }

        // Calculate min investment = sum of all holdings' current prices
        const tickers = [...new Set(holdings.map(h => h.ticker || h.symbol || h).filter(Boolean))];
        const { data: securities } = await supabaseAdmin
          .from('securities_c').select('symbol, last_price').in('symbol', tickers);
        const secBySymbol = Object.fromEntries((securities || []).map(s => [s.symbol, s]));
        const minInvestmentCents = holdings.reduce((sum, h) => {
          const ticker = h.ticker || h.symbol || String(h);
          return sum + (secBySymbol[ticker]?.last_price || 0);
        }, 0);
        console.log(`[gift-registry] by-key: BASKET minInvestmentCents=${minInvestmentCents} (${(minInvestmentCents/100).toFixed(2)} ZAR)`);

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

        if (insertErr) {
          console.error(`[gift-registry] by-key: BASKET insert error code=${insertErr.code} msg=${insertErr.message}`);
          throw insertErr;
        }
        console.log(`[gift-registry] by-key: BASKET inserted itemId=${item.id} isin=${item.isin} instrument_type=${item.instrument_type} price_snapshot_cents=${item.price_snapshot_cents}`);
        return res.json({ success: true, item });

      } else {
        // ── Plain ISIN / symbol ── same dedupe rule: only block on a still-open row.
        const { data: existing } = await supabaseAdmin
          .from('gift_registry_items').select('id').eq('gift_event_id', registryId).eq('isin', itemKey).not('status', 'in', '(REMOVED,FILLED)').maybeSingle();
        if (existing) {
          console.log(`[gift-registry] by-key: SHARE already in registry itemId=${existing.id}`);
          return res.json({ success: true, item: existing, message: 'Already in registry' });
        }

        const priceCents = await getLatestPriceCents(itemKey, supabaseAdmin);
        const minTranche = priceCents > 0 ? Math.max(1, Math.ceil(1000 / priceCents)) : 1;
        console.log(`[gift-registry] by-key: SHARE isin=${itemKey} priceCents=${priceCents} minTranche=${minTranche}`);

        const { data: item, error } = await supabaseAdmin
          .from('gift_registry_items')
          .insert({ gift_event_id: registryId, isin: itemKey, instrument_type: 'SHARE',
            target_quantity: 1, price_snapshot_cents: priceCents, min_tranche_quantity: minTranche })
          .select().single();
        if (error) {
          console.error(`[gift-registry] by-key: SHARE insert error code=${error.code} msg=${error.message}`);
          throw error;
        }
        console.log(`[gift-registry] by-key: SHARE inserted itemId=${item.id} isin=${item.isin} price_snapshot_cents=${item.price_snapshot_cents}`);
        return res.json({ success: true, item });
      }
    } catch (e) {
      console.error('[gift-registry] add by-key error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/items — add an item (direct, with explicit fields)
  app.post('/api/gift-registry/items', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { registryId, isin, instrumentType = 'SHARE', targetQuantity } = req.body;
      if (!registryId || !isin || !targetQuantity) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const { data: reg } = await supabaseAdmin
        .from('gift_events')
        .select('id, status')
        .eq('id', registryId)
        .eq('creator_user_id', user.id)
        .single();

      if (!reg) return res.status(404).json({ error: 'Registry not found' });
      if (['CANCELLED', 'EXPIRED'].includes(reg.status)) {
        return res.status(400).json({ error: 'Cannot add items to a closed registry' });
      }
      if (reg.status === 'COMPLETED') {
        await supabaseAdmin.from('gift_events').update({ status: 'ACTIVE', updated_at: new Date().toISOString() }).eq('id', registryId);
      }

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

  // DELETE /api/gift-registry/items/:itemId — soft-delete (before DELETE /:id)
  app.delete('/api/gift-registry/items/:itemId', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const { data: item, error: fetchErr } = await supabaseAdmin
        .from('gift_registry_items')
        .select('id, gift_event_id')
        .eq('id', req.params.itemId)
        .single();
      if (fetchErr || !item) return res.status(404).json({ error: 'Item not found' });

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

  // POST /api/gift-registry/reserve — atomic reservation via Supabase optimistic locking
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

      // Check registry is still ACTIVE
      const { data: reg } = await supabaseAdmin
        .from('gift_events')
        .select('status, expiry_at')
        .eq('id', registryId)
        .single();

      if (!reg || reg.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'This registry is no longer accepting gifts', code: 'REGISTRY_CLOSED' });
      }

      // Get current item state
      const { data: item } = await supabaseAdmin
        .from('gift_registry_items')
        .select('*')
        .eq('id', itemId)
        .eq('gift_event_id', registryId)
        .single();

      if (!item) return res.status(404).json({ error: 'Item not found or does not belong to this registry' });

      // Auto-release the caller's OWN stale HELD reservation(s) on this item before
      // computing availability. Items are usually target_quantity=1, so an abandoned
      // checkout (closed the sheet / didn't finish payment) would otherwise leave the
      // user permanently locked out of their own item until the 10-min hold expires.
      // Only ever touches reservations owned by this user — never another gifter's hold.
      const { data: ownHeld } = await supabaseAdmin
        .from('gift_reservations')
        .select('id, quantity')
        .eq('registry_item_id', itemId)
        .eq('gifter_user_id', user.id)
        .eq('status', 'HELD');

      if (ownHeld && ownHeld.length) {
        const ownHeldQty = ownHeld.reduce((sum, r) => sum + (r.quantity || 0), 0);
        await supabaseAdmin
          .from('gift_reservations')
          .update({ status: 'RELEASED' })
          .in('id', ownHeld.map(r => r.id));
        item.reserved_quantity = Math.max(0, item.reserved_quantity - ownHeldQty);
        await supabaseAdmin
          .from('gift_registry_items')
          .update({ reserved_quantity: item.reserved_quantity, updated_at: new Date().toISOString() })
          .eq('id', itemId);
        console.log(`[gift-registry] reserve: auto-released ${ownHeld.length} stale HELD reservation(s) (qty=${ownHeldQty}) for user=${user.id} itemId=${itemId}`);
      }

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
      // For BASKET items, item.isin is the strategy UUID — not a real stock ISIN.
      // getLatestPriceCents queries stock_intraday_c/securities_c which won't match
      // a strategy UUID, so it returns 0. Use price_snapshot_cents instead, which
      // enrichItems calculates as sum(shares × last_price_cents) for the basket.
      const livePriceCents = item.instrument_type === 'BASKET'
        ? (item.price_snapshot_cents || 0)
        : await getLatestPriceCents(item.isin, supabaseAdmin);

      // Atomic conditional UPDATE — optimistic locking via two guards:
      //   1. eq('filled_quantity', item.filled_quantity) — fails if a concurrent fill happened
      //   2. lte('reserved_quantity', maxAllowedReserved)  — fails if a concurrent reservation happened
      // Together these replicate the original SQL: (filled + reserved + qty) <= target atomically.
      const maxAllowedReserved = item.target_quantity - item.filled_quantity - quantity;
      const { data: updatedItem, error: updateErr } = await supabaseAdmin
        .from('gift_registry_items')
        .update({ reserved_quantity: item.reserved_quantity + quantity, updated_at: new Date().toISOString() })
        .eq('id', itemId)
        .eq('gift_event_id', registryId)
        .eq('filled_quantity', item.filled_quantity)   // guard: no concurrent fill
        .lte('reserved_quantity', maxAllowedReserved)  // guard: no concurrent over-reservation
        .in('status', ['OPEN', 'PARTIALLY_FILLED'])
        .select()
        .single();

      if (updateErr || !updatedItem) {
        console.warn(`[gift-registry] reserve: optimistic lock failed itemId=${itemId} — sold out or concurrent reservation/fill`);
        return res.status(409).json({ error: 'No longer available', code: 'SOLD_OUT', remaining: 0 });
      }

      // Insert the reservation record
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { data: reservation, error: resErr } = await supabaseAdmin
        .from('gift_reservations')
        .insert({
          registry_item_id: itemId,
          gifter_user_id: user.id,
          quantity,
          expires_at: expiresAt,
          price_lock_cents: livePriceCents,
          status: 'HELD',
        })
        .select()
        .single();

      if (resErr) {
        // Roll back the reserved_quantity increment (best-effort)
        console.error(`[gift-registry] reserve: failed to insert reservation — rolling back: ${resErr.message}`);
        await supabaseAdmin
          .from('gift_registry_items')
          .update({ reserved_quantity: item.reserved_quantity, updated_at: new Date().toISOString() })
          .eq('id', itemId);
        throw resErr;
      }

      return res.json({ success: true, reservationId: reservation.id, livePriceCents, expiresInSeconds: 600 });
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

      const { reservationId, registryId, totalAmount } = req.body;
      if (!reservationId) return res.status(400).json({ error: 'Missing reservationId' });

      // Idempotency key
      const idempotencyKey = `${reservationId}:${user.id}`;

      // Check for duplicate before doing any work
      const { data: dupContrib } = await supabaseAdmin
        .from('gift_contributions')
        .select('id, status')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (dupContrib) return res.json({ success: true, contribution: dupContrib, duplicate: true });

      // Fetch reservation (must be HELD, not expired, owned by this user)
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

      // Compute fee
      const livePriceCents = reservation.price_lock_cents;
      const baseRands = (livePriceCents * reservation.quantity) / 100;
      let feeCents = Math.round(baseRands * 0.006 * 100); // ~0.6% fallback
      try {
        const { computeFees } = require('../api/_lib/fees.js');
        const feeResult = computeFees(baseRands, 1);
        feeCents = feeResult?.totalCents || feeCents;
      } catch { /* fees module optional */ }

      // Use the totalAmount the checkout UI calculated (includes all fees + markup),
      // falling back to our server-side estimate. totalAmount comes in as Rands.
      const quotedAmountCents = totalAmount && Number(totalAmount) > 0
        ? Math.round(Number(totalAmount) * 100)
        : livePriceCents * reservation.quantity + feeCents;

      // Step 1: Mark reservation CONSUMED — conditional on: HELD + not expired.
      // This is the idempotency gate: a second attempt on the same reservation will
      // find status != HELD and return 410 before anything else changes.
      const { data: consumed, error: consumeErr } = await supabaseAdmin
        .from('gift_reservations')
        .update({ status: 'CONSUMED' })
        .eq('id', reservationId)
        .eq('gifter_user_id', user.id)
        .eq('status', 'HELD')
        .gt('expires_at', new Date().toISOString())
        .select()
        .single();

      if (consumeErr || !consumed) {
        return res.status(410).json({ error: 'Reservation has expired or was already consumed', code: 'RESERVATION_EXPIRED' });
      }

      const qty = consumed.quantity;
      const reservedItemId = consumed.registry_item_id;

      // Step 2: Insert contribution BEFORE updating quantities.
      // Order is critical: if the contribution insert fails we can still roll back
      // the reservation to HELD. If we updated quantities first and the insert then
      // failed, filled/reserved counts would be mutated with no contribution record.
      const { gifterMessage } = req.body;
      const insertPayload = {
        registry_item_id: reservedItemId,
        gifter_user_id: user.id,
        gifter_email: gifterEmail,
        quantity: qty,
        quoted_amount_cents: quotedAmountCents,
        fee_cents: feeCents,
        status: 'PAID',
        reservation_id: reservationId,
        idempotency_key: idempotencyKey,
      };
      if (gifterMessage) {
        insertPayload.gifter_message = String(gifterMessage).slice(0, 120);
      }

      let { data: contribution, error: contribErr } = await supabaseAdmin
        .from('gift_contributions')
        .insert(insertPayload)
        .select()
        .single();

      // If gifter_message column does not yet exist (migration not applied), retry without it
      if (contribErr && gifterMessage &&
          (contribErr.code === '42703' || contribErr.message?.toLowerCase().includes('gifter_message'))) {
        console.error('[gift-registry] contribute: gifter_message column missing — run migration: ALTER TABLE gift_contributions ADD COLUMN IF NOT EXISTS gifter_message text;');
        const { gifter_message: _drop, ...payloadWithout } = insertPayload;
        const retry = await supabaseAdmin
          .from('gift_contributions')
          .insert(payloadWithout)
          .select()
          .single();
        contribution = retry.data;
        contribErr = retry.error;
      }

      if (contribErr) {
        // Roll back: restore reservation to HELD so the gifter can retry
        console.error(`[gift-registry] contribute: contribution insert failed — rolling back reservation ${reservationId}: ${contribErr.message}`);
        await supabaseAdmin
          .from('gift_reservations')
          .update({ status: 'HELD' })
          .eq('id', reservationId)
          .eq('gifter_user_id', user.id);
        throw contribErr;
      }

      // Step 3: Update item quantities now that the contribution record is safely committed.
      // If this update fails the contribution still exists (idempotency key prevents duplicate),
      // and the sweeper will eventually correct reserved_quantity via the CONSUMED reservation.
      const { data: currentItem } = await supabaseAdmin
        .from('gift_registry_items')
        .select('filled_quantity, reserved_quantity, target_quantity')
        .eq('id', reservedItemId)
        .single();

      if (currentItem) {
        const newFilled = (currentItem.filled_quantity || 0) + qty;
        const newReserved = Math.max(0, (currentItem.reserved_quantity || 0) - qty);
        const newStatus = newFilled >= currentItem.target_quantity ? 'FILLED'
          : newFilled > 0 ? 'PARTIALLY_FILLED'
          : 'OPEN';
        const { error: qtyErr } = await supabaseAdmin
          .from('gift_registry_items')
          .update({ filled_quantity: newFilled, reserved_quantity: newReserved, status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', reservedItemId);
        if (qtyErr) {
          console.error(`[gift-registry] contribute: item quantity update failed for itemId=${reservedItemId}: ${qtyErr.message} — contribution ${contribution.id} was recorded, quantities may be stale`);
        }
      }

      // Check if all items are FILLED — mark registry COMPLETED
      const { data: allItems } = await supabaseAdmin
        .from('gift_registry_items')
        .select('id, status, isin')
        .eq('gift_event_id', registryId)
        .neq('status', 'REMOVED');

      const registryNowComplete = allItems?.every(i => i.status === 'FILLED');
      if (registryNowComplete) {
        await supabaseAdmin
          .from('gift_events')
          .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
          .eq('id', registryId);
      }

      // ── Post-contribution: pending holdings + notifications (fire-and-forget) ──
      try {
        const { gifterMessage } = req.body;

        // Fetch registry owner + item details (include item instrument_type and isin for holdings)
        const [registryRow, filledItemRow] = await Promise.all([
          supabaseAdmin.from('gift_events').select('creator_user_id, title, beneficiary_type, beneficiary_ref, share_token').eq('id', registryId).single().then(r => r.data),
          supabaseAdmin.from('gift_registry_items').select('isin, instrument_type').eq('id', reservedItemId).single().then(r => r.data),
        ]);

        const ownerUserId = registryRow?.creator_user_id; // parent / creator
        const registryTitle = registryRow?.title || 'your wishlist';

        // Resolve actual investment recipient: for CHILD registries the holdings
        // and transaction must go to the child's own Supabase account (linked_user_id),
        // not the parent who created the registry.
        let recipientUserId = ownerUserId;
        if (registryRow?.beneficiary_type === 'CHILD' && registryRow?.beneficiary_ref) {
          try {
            const { data: famMember } = await supabaseAdmin
              .from('family_members')
              .select('linked_user_id')
              .eq('id', registryRow.beneficiary_ref)
              .maybeSingle();
            if (famMember?.linked_user_id) {
              recipientUserId = famMember.linked_user_id;
              console.log(`[gift-registry] contribute: CHILD registry — routing holdings to child user ${recipientUserId} (not parent ${ownerUserId})`);
            }
          } catch (famErr) {
            console.warn('[gift-registry] contribute: could not resolve child linked_user_id, falling back to creator:', famErr.message);
          }
        }
        const itemIsin = filledItemRow?.isin || '';
        const isBasket = filledItemRow?.instrument_type === 'BASKET';

        // Resolve item display name: for baskets look up strategy name
        let itemName = 'an item';
        if (isBasket && itemIsin) {
          const { data: strat } = await supabaseAdmin.from('strategies_c').select('name').eq('id', itemIsin).maybeSingle();
          if (strat?.name) itemName = strat.name;
        } else if (itemIsin) {
          const { data: sec } = await supabaseAdmin.from('securities_c').select('name, symbol').eq('isin', itemIsin).maybeSingle();
          itemName = sec?.name || sec?.symbol || itemIsin;
        }

        // Resolve gifter display name from profiles
        const { data: gifterProfile } = await supabaseAdmin.from('profiles').select('first_name, last_name, mint_number').eq('id', user.id).maybeSingle();
        const gifterName = [gifterProfile?.first_name, gifterProfile?.last_name].filter(Boolean).join(' ') || gifterEmail.split('@')[0] || 'Someone';
        const gifterMintNumber = gifterProfile?.mint_number || null;

        // ── 1. Insert pending holdings + transaction for the recipient ──
        // Without a transaction named "Strategy Investment: <name>", the strategy
        // never appears in /api/user/strategies, so the pending card cannot show.
        // recipientUserId is the child's own account (if CHILD registry), else the creator.
        if (recipientUserId && isBasket && itemIsin) {
          try {
            const { data: strategy } = await supabaseAdmin.from('strategies_c').select('id, name, holdings').eq('id', itemIsin).maybeSingle();
            const stratHoldings = strategy?.holdings || [];
            const strategyName = strategy?.name || itemName;
            const symbols = stratHoldings.map(h => h.symbol).filter(Boolean);

            if (symbols.length > 0) {
              const { data: securities } = await supabaseAdmin.from('securities_c').select('id, symbol, last_price').in('symbol', symbols);
              const secMap = {};
              for (const s of securities || []) secMap[s.symbol] = s;

              // Create a transaction for the recipient — this is what /api/user/strategies
              // uses to detect the strategy purchase and surface it as a pending card.
              const now = new Date().toISOString();
              const investAmountCents = reservation.price_lock_cents * qty;
              let recipientTxId = null;
              try {
                const { data: txRow } = await supabaseAdmin.from('transactions').insert({
                  user_id: recipientUserId,
                  direction: 'debit',
                  name: `Strategy Investment: ${strategyName}`,
                  description: 'Investment received as wishlist gift',
                  amount: investAmountCents,
                  store_reference: `REGISTRY-CONTRIB-${contribution.id}`,
                  currency: 'ZAR',
                  status: 'posted',
                  transaction_date: now,
                  created_at: now,
                }).select('id').single();
                recipientTxId = txRow?.id || null;
              } catch (txErr) {
                console.warn('[gift-registry] contribute: recipient transaction insert:', txErr.message);
              }

              // Calculate scale: invested amount (base price before markup) vs basket cost
              const investRands = investAmountCents / 100;
              let totalCostRands = 0;
              for (const h of stratHoldings) {
                const sec = secMap[h.symbol];
                if (sec?.last_price) totalCostRands += (sec.last_price / 100) * (h.weight || 1);
              }
              const scale = totalCostRands > 0 ? investRands / totalCostRands : 1;

              let holdingsInserted = 0;
              for (const h of stratHoldings) {
                const sec = secMap[h.symbol];
                if (!sec?.last_price || !sec?.id) continue;
                const holdingQty = Math.max(1, Math.round((h.weight || 1) * scale));
                try {
                  await supabaseAdmin.from('stock_holdings_c').insert({
                    user_id: recipientUserId,
                    security_id: sec.id,
                    strategy_id: itemIsin,
                    quantity: holdingQty,
                    avg_fill: null,
                    market_value: 0,
                    unrealized_pnl: 0,
                    as_of_date: null,
                    Status: 'active',
                    transaction_id: recipientTxId || null,
                  });
                  holdingsInserted++;
                } catch (he) { console.warn('[gift-registry] contribute: pending holding insert:', he.message); }
              }
              console.log(`[gift-registry] contribute: ${holdingsInserted} holding(s) + tx ${recipientTxId} created for recipient ${recipientUserId} (strategy: ${strategyName})`);

              // Upsert user_strategies so the strategy is discoverable
              if (holdingsInserted > 0) {
                try {
                  const { data: existingUS } = await supabaseAdmin.from('user_strategies').select('id, invested_amount').eq('user_id', recipientUserId).eq('strategy_id', itemIsin).maybeSingle();
                  if (existingUS) {
                    await supabaseAdmin.from('user_strategies').update({ invested_amount: (existingUS.invested_amount || 0) + investAmountCents, updated_at: now }).eq('id', existingUS.id);
                  } else {
                    await supabaseAdmin.from('user_strategies').insert({ user_id: recipientUserId, strategy_id: itemIsin, invested_amount: investAmountCents, status: 'active', created_at: now, updated_at: now });
                  }
                } catch (usErr) { console.warn('[gift-registry] contribute: user_strategies upsert:', usErr.message); }
              }
            }
          } catch (holdingErr) {
            console.warn('[gift-registry] contribute: pending holdings block error:', holdingErr.message);
          }
        }

        // ── 2. Notify the gift recipient and parent about the gift ──
        const shareToken = registryRow?.share_token || '';
        const msgPart = gifterMessage ? ` — "${gifterMessage.slice(0, 80)}"` : '';
        const mintPart = gifterMintNumber ? ` (${gifterMintNumber})` : '';
        const notifPayload = {
          action: 'OPEN_GIFT_REGISTRY',
          registry_id: registryId,
          registry_item_id: reservedItemId,
          share_token: shareToken,
          deep_link: shareToken ? `/gift/${shareToken}` : null,
          gifter_user_id: user.id,
          gifter_name: gifterName,
          gifter_mint_number: gifterMintNumber || null,
          gifter_message: gifterMessage || null,
        };

        // Notify actual recipient (child's own account, or creator for self-registries)
        if (recipientUserId && recipientUserId !== user.id) {
          const { error: recipientNotifErr } = await supabaseAdmin.from('notifications').insert({
            user_id: recipientUserId,
            title: `${gifterName} gifted you 🎁`,
            body: `${gifterName}${mintPart} gifted you ${itemName} from your "${registryTitle}" wishlist!`,
            type: 'system',
            payload: notifPayload,
          });
          if (recipientNotifErr) {
            console.error('[gift-registry] contribute: recipient notification failed:', recipientNotifErr.message);
          } else {
            console.log('[gift-registry] contribute: recipient notification sent → user_id=', recipientUserId);
          }
        }

        // Also notify the parent/creator if the registry is for a child (they want to know too)
        if (ownerUserId && ownerUserId !== recipientUserId && ownerUserId !== user.id) {
          const { error: parentNotifErr } = await supabaseAdmin.from('notifications').insert({
            user_id: ownerUserId,
            title: `${gifterName} gifted your child 🎁`,
            body: `${gifterName}${mintPart} gifted ${itemName} to ${registryRow?.beneficiary_display_name || 'your child'} from the "${registryTitle}" wishlist!`,
            type: 'system',
            payload: notifPayload,
          });
          if (parentNotifErr) {
            console.error('[gift-registry] contribute: parent notification failed:', parentNotifErr.message);
          } else {
            console.log('[gift-registry] contribute: parent notification sent → user_id=', ownerUserId);
          }
        }

        // ── 3. Notify the gifter that their gift went through ──
        if (user.id) {
          const { error: gifterNotifErr } = await supabaseAdmin.from('notifications').insert({
            user_id: user.id,
            title: 'Gift sent! 🎉',
            body: `You gifted ${itemName} from "${registryTitle}". The recipient will love it!`,
            type: 'system',
            payload: notifPayload,
          });
          if (gifterNotifErr) {
            console.error('[gift-registry] contribute: gifter notification failed:', gifterNotifErr.message);
          } else {
            console.log('[gift-registry] contribute: gifter confirmation sent → user_id=', user.id);
          }
        }

        // ── 3. If item is now FILLED — thank-you to every gifter ──
        const itemNowFilled = currentItem && (currentItem.filled_quantity || 0) + qty >= (currentItem.target_quantity || 1);
        if (itemNowFilled) {
          const { data: allContribs } = await supabaseAdmin
            .from('gift_contributions')
            .select('gifter_user_id')
            .eq('registry_item_id', reservedItemId)
            .eq('status', 'PAID');

          const uniqueGifterIds = [...new Set((allContribs || []).map(c => c.gifter_user_id).filter(Boolean))];
          const thankYouRows = uniqueGifterIds.map(gId => ({
            user_id: gId,
            title: 'Your gift came together! 🙌',
            body: `"${itemName}" on "${registryTitle}" is fully funded — thanks to you and others ✨`,
            type: 'system',
            payload: {
              action: 'OPEN_GIFT_REGISTRY',
              registry_id: registryId,
              registry_item_id: reservedItemId,
            },
          }));

          if (thankYouRows.length > 0) {
            await supabaseAdmin.from('notifications').insert(thankYouRows);
          }
        }
      } catch (notifErr) {
        console.error('[gift-registry] contribute: post-contribution error (non-fatal):', notifErr.message);
      }

      return res.json({ success: true, contribution });
    } catch (e) {
      console.error('[gift-registry] contribute error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/:id/notify-beneficiary — send wishlist notification to a Mint user by email
  app.post('/api/gift-registry/:id/notify-beneficiary', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      console.log('[notify-beneficiary] step1 auth: user=', user?.id || 'NONE');
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const registryId = req.params.id;
      const { email, firstName, isNudge } = req.body;
      console.log('[notify-beneficiary] step2 params: registryId=', registryId, 'email=', email, 'isNudge=', isNudge);
      if (!email) return res.status(400).json({ error: 'Missing email' });

      // Verify caller owns this registry
      const { data: registry, error: regErr } = await supabaseAdmin
        .from('gift_events')
        .select('id, title, creator_user_id, share_token, occasion, items:gift_registry_items(id)')
        .eq('id', registryId)
        .eq('creator_user_id', user.id)
        .single();
      console.log('[notify-beneficiary] step3 registry:', registry?.id || 'NOT FOUND', 'err:', regErr?.message);

      if (!registry) return res.status(403).json({ error: 'Wishlist not found or not yours' });

      // Look up target user by email via profiles table (admin REST email filter is unreliable)
      console.log('[notify-beneficiary] step4 lookup email:', email.toLowerCase());
      let targetUserId = null;

      try {
        const { data: profileMatch, error: profileErr } = await supabaseAdmin
          .from('profiles')
          .select('id, email, first_name')
          .eq('email', email.toLowerCase())
          .maybeSingle();
        console.log('[notify-beneficiary] step4 profiles lookup: found=', !!profileMatch, 'id=', profileMatch?.id || 'none', 'err=', profileErr?.message || 'none');
        if (profileMatch?.id) targetUserId = profileMatch.id;
      } catch (lookupErr) {
        console.error('[notify-beneficiary] step4 email lookup failed:', lookupErr.message);
      }

      if (!targetUserId) {
        console.log('[notify-beneficiary] step4 no Mint account for email:', email);
        return res.status(200).json({ sent: false, has_account: false, reason: 'no_mint_account' });
      }

      // Do not notify yourself
      if (targetUserId === user.id) {
        console.log('[notify-beneficiary] step5 self-notify blocked');
        return res.status(400).json({ error: 'Cannot notify yourself' });
      }
      console.log('[notify-beneficiary] step5 targetUserId=', targetUserId);

      // Check existing notification state
      const [notifResult, viewResult] = await Promise.all([
        supabaseAdmin
          .from('notifications')
          .select('id, created_at')
          .eq('user_id', targetUserId)
          .eq('type', 'system')
          .filter('payload->>registry_id', 'eq', registryId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from('gift_registry_views')
          .select('id')
          .eq('registry_id', registryId)
          .eq('viewer_user_id', targetUserId)
          .maybeSingle(),
      ]);

      const existingNotif = notifResult.data;
      const hasViewed = !!viewResult.data;
      console.log('[notify-beneficiary] step6 existingNotif=', !!existingNotif, 'hasViewed=', hasViewed, 'notifErr=', notifResult.error?.message);

      let notifState = 'none';
      if (existingNotif) {
        const diffH = (Date.now() - new Date(existingNotif.created_at).getTime()) / 3_600_000;
        if (diffH < 48) notifState = 'sent';
        else if (!hasViewed) notifState = 'nudge';
        else notifState = 'none';
      }

      if (notifState === 'sent') {
        return res.json({ sent: false, reason: 'already_sent', state: 'sent' });
      }
      if (notifState === 'nudge' && !isNudge) {
        return res.json({ sent: false, reason: 'eligible_nudge', state: 'nudge' });
      }

      // Get sender's display name
      const { data: senderData } = await supabaseAdmin.auth.admin.getUserById(user.id);
      const senderEmail = senderData?.user?.email || '';
      const senderMeta = senderData?.user?.user_metadata || {};
      const senderName = senderMeta.first_name
        ? `${senderMeta.first_name} ${senderMeta.last_name || ''}`.trim()
        : (senderEmail.split('@')[0] || 'Someone');
      console.log('[notify-beneficiary] step7 senderName=', senderName);

      const OCCASION_EMOJI = { BIRTHDAY: '🎂', WEDDING: '💍', BABY: '👶', GRADUATION: '🎓', FESTIVE: '🎄', CUSTOM: '🎉' };
      const emoji = OCCASION_EMOJI[registry.occasion] || '🎁';

      const notifTitle = isNudge
        ? `${senderName} is nudging you ${emoji}`
        : `${senderName} shared a wishlist with you ${emoji}`;
      const notifBody = isNudge
        ? `Don't forget — ${senderName} is hoping for your gift on "${registry.title}". It only takes a moment!`
        : `${senderName} has shared their wishlist with you. Browse "${registry.title}" and find something meaningful to gift.`;

      console.log('[notify-beneficiary] step8 inserting notification: user_id=', targetUserId, 'title=', notifTitle);
      const { data: insertData, error: insertErr } = await supabaseAdmin
        .from('notifications')
        .insert({
          user_id: targetUserId,
          title: notifTitle,
          body: notifBody,
          type: 'system',
          payload: {
            action: 'OPEN_GIFT_REGISTRY',
            registry_id: registryId,
            share_token: registry.share_token,
            deep_link: `/gift/${registry.share_token}`,
            sent_by: user.id,
            is_nudge: !!isNudge,
            registry_title: registry.title,
            item_count: (registry.items || []).length,
            occasion: registry.occasion,
          },
        })
        .select('id');

      console.log('[notify-beneficiary] step8 insert result: data=', insertData, 'err=', insertErr?.message, 'code=', insertErr?.code, 'details=', insertErr?.details);

      if (insertErr) {
        console.error('[notify-beneficiary] INSERT FAILED:', JSON.stringify(insertErr));
        return res.status(500).json({ error: 'Could not send notification', detail: insertErr.message });
      }

      console.log('[notify-beneficiary] SUCCESS: notification sent, id=', insertData?.[0]?.id);
      const nowIso = new Date().toISOString();
      return res.json({ sent: true, nudge: !!isNudge, state: 'sent', sentAt: nowIso });
    } catch (e) {
      console.error('[notify-beneficiary] CAUGHT ERROR:', e.message, e.stack);
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/gift-registry/:id/view-count — viewer count for the registry owner
  app.get('/api/gift-registry/:id/view-count', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Verify ownership
      const { data: reg, error: regErr } = await supabaseAdmin
        .from('gift_events')
        .select('id')
        .eq('id', req.params.id)
        .eq('creator_user_id', user.id)
        .single();

      if (regErr || !reg) return res.status(403).json({ error: 'Not found or not yours' });

      const { count, error: countErr } = await supabaseAdmin
        .from('gift_registry_views')
        .select('viewer_user_id', { count: 'exact', head: true })
        .eq('registry_id', req.params.id);

      if (countErr && countErr.code === '42P01') return res.json({ count: 0 }); // table not yet created
      if (countErr) throw countErr;

      return res.json({ count: count || 0 });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /api/gift-registry/send-pending-nudges — cron endpoint: send 48hr nudge to viewers who haven't gifted yet
  // Protected by Authorization: Bearer <CRON_SECRET> header
  app.post('/api/gift-registry/send-pending-nudges', async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace('Bearer ', '');
      const cronSecret = process.env.CRON_SECRET;
      if (!cronSecret || token !== cronSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      // Find views older than 48 hours
      const { data: views, error: viewErr } = await supabaseAdmin
        .from('gift_registry_views')
        .select('registry_id, viewer_user_id, viewed_at')
        .lt('viewed_at', cutoff);

      if (viewErr && viewErr.code === '42P01') return res.json({ sent: 0, skipped: 0, message: 'gift_registry_views table not found' });
      if (viewErr) throw viewErr;
      if (!views || views.length === 0) return res.json({ sent: 0, skipped: 0 });

      const registryIds = [...new Set(views.map(v => v.registry_id))];

      // Fetch registry details for all relevant registries
      const { data: registries } = await supabaseAdmin
        .from('gift_events')
        .select('id, title, share_token, occasion, creator_user_id, status, items:gift_registry_items(id)')
        .in('id', registryIds)
        .in('status', ['ACTIVE']);

      const regMap = Object.fromEntries((registries || []).map(r => [r.id, r]));

      // Find viewers who have already contributed
      const { data: existingContribs } = await supabaseAdmin
        .from('gift_contributions')
        .select('gift_event_id, gifter_user_id')
        .in('gift_event_id', registryIds)
        .eq('status', 'PAID');

      const contributedSet = new Set((existingContribs || []).map(c => `${c.gift_event_id}:${c.gifter_user_id}`));

      // Find existing nudge notifications to avoid double-sending
      const viewerIds = [...new Set(views.map(v => v.viewer_user_id))];
      const { data: existingNudges } = await supabaseAdmin
        .from('notifications')
        .select('user_id, payload')
        .in('user_id', viewerIds)
        .eq('type', 'system');

      const nudgedSet = new Set();
      for (const n of (existingNudges || [])) {
        if (n.payload?.action === 'OPEN_GIFT_REGISTRY' && n.payload?.is_nudge) {
          nudgedSet.add(`${n.payload.registry_id}:${n.user_id}`);
        }
      }

      const OCCASION_EMOJI = { BIRTHDAY: '🎂', WEDDING: '💍', BABY: '👶', GRADUATION: '🎓', FESTIVE: '🎄', CUSTOM: '🎉' };
      const notifRows = [];
      let skipped = 0;

      for (const view of views) {
        const reg = regMap[view.registry_id];
        if (!reg) { skipped++; continue; }
        if (contributedSet.has(`${view.registry_id}:${view.viewer_user_id}`)) { skipped++; continue; }
        if (nudgedSet.has(`${view.registry_id}:${view.viewer_user_id}`)) { skipped++; continue; }
        if (view.viewer_user_id === reg.creator_user_id) { skipped++; continue; }

        const emoji = OCCASION_EMOJI[reg.occasion] || '🎁';
        notifRows.push({
          user_id: view.viewer_user_id,
          title: `Don't forget "${reg.title}" ${emoji}`,
          body: `You viewed this wishlist — it's not too late to gift the shares they actually want!`,
          type: 'system',
          payload: {
            action: 'OPEN_GIFT_REGISTRY',
            registry_id: reg.id,
            share_token: reg.share_token,
            deep_link: `/gift/${reg.share_token}`,
            is_nudge: true,
            registry_title: reg.title,
            item_count: (reg.items || []).length,
            occasion: reg.occasion,
          },
        });
      }

      if (notifRows.length === 0) return res.json({ sent: 0, skipped });

      const { error: insertErr } = await supabaseAdmin.from('notifications').insert(notifRows);
      if (insertErr) throw insertErr;

      console.log(`[gift-registry] send-pending-nudges: sent=${notifRows.length} skipped=${skipped}`);
      return res.json({ sent: notifRows.length, skipped });
    } catch (e) {
      console.error('[gift-registry] send-pending-nudges error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ── Wildcard /:id routes — must come AFTER all specific-path routes ─────────

  // GET /api/gift-registry/:id — full registry (auth required, owner view)
  app.get('/api/gift-registry/:id', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      console.log(`[gift-registry] GET /:id start: user=${user.id} id=${req.params.id}`);

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
      console.log(`[gift-registry] GET /:id found: title="${registry.title}" rawItems=${registry.items?.length ?? 0}`);

      if (registry.items?.length) {
        const activeItems = registry.items.filter(i => i.status !== 'REMOVED');
        const shareItems = activeItems.filter(i => i.instrument_type !== 'BASKET');
        const basketItems = activeItems.filter(i => i.instrument_type === 'BASKET');
        console.log(`[gift-registry] GET /:id enrichment: active=${activeItems.length} shares=${shareItems.length} baskets=${basketItems.length}`);
        if (basketItems.length) console.log(`[gift-registry] GET /:id basketItems=${JSON.stringify(basketItems.map(i => ({ id: i.id, isin: i.isin, type: i.instrument_type })))}`);

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
              console.warn(`[gift-registry] GET /:id BASKET item isin=${item.isin} NOT found in strategies_c — will show UUID as fallback name`);
              enrichedMap[item.id] = { ...item, name: item.isin }; return;
            }
            const holdings = strategy.holdings || [];
            const holdingsSnapshot = holdings
              .map(h => { const t = h.ticker || h.symbol || String(h); const sec = secBySymbol[t] || secBySymbol[t.split('.')[0]]; return { symbol: t, name: sec?.name || t, logo_url: sec?.logo_url || null }; })
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

        console.log(`[gift-registry] GET /:id end: returning ${registry.items.length} enriched items`);
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

  // POST /api/gift-registry/:id/cancel — release all HELD reservations, then cancel registry
  app.post('/api/gift-registry/:id/cancel', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Fetch all items for this registry to release their reservations
      const { data: items } = await supabaseAdmin
        .from('gift_registry_items')
        .select('id')
        .eq('gift_event_id', req.params.id);

      if (items && items.length) {
        const itemIds = items.map(i => i.id);

        // Release all HELD reservations for this registry's items
        await supabaseAdmin
          .from('gift_reservations')
          .update({ status: 'RELEASED' })
          .in('registry_item_id', itemIds)
          .eq('status', 'HELD');

        // Reset reserved_quantity to 0 on all items
        await supabaseAdmin
          .from('gift_registry_items')
          .update({ reserved_quantity: 0 })
          .in('id', itemIds);
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

      // Release any HELD reservations first (best-effort before cascade delete)
      const { data: items } = await supabaseAdmin
        .from('gift_registry_items')
        .select('id')
        .eq('gift_event_id', req.params.id);

      if (items && items.length) {
        const itemIds = items.map(i => i.id);
        await supabaseAdmin
          .from('gift_reservations')
          .update({ status: 'RELEASED' })
          .in('registry_item_id', itemIds)
          .eq('status', 'HELD');
      }

      const { data, error } = await supabaseAdmin
        .from('gift_events')
        .delete()
        .eq('id', req.params.id)
        .eq('creator_user_id', user.id)
        .select()
        .single();

      if (error || !data) return res.status(404).json({ error: 'Registry not found' });

      // Clean up any notifications that still point at this now-deleted registry
      // (e.g. "shared a wishlist with you" cards). Without this, a recipient who
      // taps an old notification hits a dead share_token and sees
      // "Wishlist not found" even though nothing is actually broken for them —
      // the link is just stale. Best-effort: never fail the delete over this.
      try {
        await supabaseAdmin
          .from('notifications')
          .delete()
          .filter('payload->>registry_id', 'eq', req.params.id)
          .filter('payload->>action', 'eq', 'OPEN_GIFT_REGISTRY');
      } catch (cleanupErr) {
        console.warn('[gift-registry] delete: notification cleanup failed:', cleanupErr.message);
      }

      return res.json({ success: true });
    } catch (e) {
      console.error('[gift-registry] delete error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/gift-registry/:id/contributions
  app.get('/api/gift-registry/:id/contributions', async (req, res) => {
    try {
      const user = await getUser(req, supabaseAdmin);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

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
