import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

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

    if (error) throw error;

    const registries = data || [];

    // Enrich all items with logo_url and name in one batch query
    const allItems = registries.flatMap(r => r.items || []);
    const shareIsins = [...new Set(allItems.filter(i => i.instrument_type !== 'BASKET').map(i => i.isin).filter(Boolean))];
    const basketIds = [...new Set(allItems.filter(i => i.instrument_type === 'BASKET').map(i => i.isin).filter(Boolean))];

    let secMap = {};
    if (shareIsins.length) {
      const { data: securities } = await supabaseAdmin
        .from('securities_c')
        .select('isin, name, logo_url')
        .in('isin', shareIsins);
      secMap = Object.fromEntries((securities || []).map(s => [s.isin, s]));
    }

    let stratMap = {};
    if (basketIds.length) {
      const { data: strategies } = await supabaseAdmin
        .from('strategies_c')
        .select('id, name, short_name')
        .in('id', basketIds);
      stratMap = Object.fromEntries((strategies || []).map(s => [s.id, s]));
    }

    // preview logos stored as per-registry top-level keys in user_metadata (gift_rp_<id>)
    // authenticateUser returns the full user object including user_metadata
    const userMeta = user.user_metadata || {};

    const enriched = registries.map(r => {
      const enrichedItems = (r.items || []).map(item => {
        if (item.instrument_type === 'BASKET') {
          const strat = stratMap[item.isin];
          return {
            ...item,
            name: strat?.short_name || strat?.name || item.isin,
            short_name: strat?.short_name || null,
            logo_url: null,
          };
        }
        return {
          ...item,
          name: secMap[item.isin]?.name || item.isin,
          logo_url: secMap[item.isin]?.logo_url || null,
        };
      });

      // Prefer metadata-stored preview; fall back to deriving from items' logo_url
      let previewLogos = userMeta[`gift_rp_${r.id}`] || null;
      if (!previewLogos) {
        const activeItems = enrichedItems.filter(i => i.status !== 'REMOVED');
        if (activeItems.length) {
          const derived = activeItems.map(i => ({
            symbol: i.isin,
            name: i.name,
            logo_url: i.logo_url || null,
          })).sort((a, b) => (b.logo_url ? 1 : 0) - (a.logo_url ? 1 : 0)).slice(0, 6);
          if (derived.some(d => d.logo_url)) previewLogos = derived;
        }
      }
      return {
        ...r,
        preview_logos: previewLogos,
        items: enrichedItems,
      };
    });

    return res.status(200).json({ registries: enriched });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
