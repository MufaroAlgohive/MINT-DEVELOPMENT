import { supabaseAdmin, authenticateUser } from '../../../_lib/supabase.js';

/**
 * GET /api/gift-registry/public/[token]/my-contributions
 *
 * Returns the set of registry item IDs that the authenticated user has already
 * gifted (status = PAID) for this registry.  Used by the public wishlist page
 * to show the filled-heart icon on items the viewer already contributed to.
 *
 * Unauthenticated callers get an empty array (not an error) so the page can
 * always render.
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { token } = req.query;

    // Auth is optional — unauthenticated viewers just get an empty list
    const { user } = await authenticateUser(req);
    if (!user) return res.json({ itemIds: [] });

    // Resolve the share_token → registry id
    const { data: registry, error: regErr } = await supabaseAdmin
      .from('gift_events')
      .select('id')
      .eq('share_token', token)
      .maybeSingle();

    if (regErr || !registry) return res.json({ itemIds: [] });

    // Fetch PAID contributions from this user for this registry
    const { data: contribs } = await supabaseAdmin
      .from('gift_contributions')
      .select('registry_item_id')
      .eq('gifter_user_id', user.id)
      .eq('gift_event_id', registry.id)
      .eq('status', 'PAID');

    const itemIds = [...new Set((contribs || []).map(c => c.registry_item_id).filter(Boolean))];
    return res.json({ itemIds });
  } catch (e) {
    console.error('[gift-registry/public/my-contributions]', e.message);
    // Fail gracefully — empty list is safe, a 500 would break the page
    return res.json({ itemIds: [] });
  }
}
