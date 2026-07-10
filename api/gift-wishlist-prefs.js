/**
 * GET  /api/gift-wishlist-prefs  — load user's wishlisted item keys + strategy watchlist
 * PUT  /api/gift-wishlist-prefs  — update one or both fields
 *
 * Stored in auth.users.user_metadata as gift_wishlist_prefs: { keys: string[], watchlist: string[] }
 */

import { supabaseAdmin, authenticateUser } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      // wishlistedKeys drives the heart icon on strategy/security cards. It must reflect
      // whether the item is ACTUALLY still present (OPEN/PARTIALLY_FILLED) in one of the
      // user's active wishlists — not just "was ever liked". We always compute the
      // confirmed set directly from the DB (not by filtering storedKeys) because items
      // can be added to a registry through flows that never write to stored prefs (e.g.
      // liking an item while creating a brand new wishlist). Mirrors the same logic in
      // server/giftRegistryRoutes.cjs.
      const prefs = user.user_metadata?.gift_wishlist_prefs || {};
      const storedKeys = prefs.keys || [];

      const { data: myRegistries } = await supabaseAdmin
        .from('gift_events')
        .select('id')
        .eq('creator_user_id', user.id)
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

      const storedSorted = [...storedKeys].sort().join(',');
      const confirmedSorted = [...confirmedKeys].sort().join(',');
      if (storedSorted !== confirmedSorted) {
        const prunedPrefs = { ...prefs, keys: confirmedKeys };
        supabaseAdmin.auth.admin.updateUserById(user.id, {
          user_metadata: { ...user.user_metadata, gift_wishlist_prefs: prunedPrefs },
        }).catch(e => console.error('[gift-wishlist-prefs] sync error:', e.message));
      }

      return res.status(200).json({
        wishlistedKeys: confirmedKeys,
        watchlist: prefs.watchlist || [],
      });
    }

    if (req.method === 'PUT') {
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
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[gift-wishlist-prefs] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
