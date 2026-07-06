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
      const prefs = user.user_metadata?.gift_wishlist_prefs || {};
      return res.status(200).json({
        wishlistedKeys: prefs.keys || [],
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
