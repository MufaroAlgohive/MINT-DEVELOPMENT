import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabaseAdmin
      .from('gift_events')
      .select(`*, items:gift_registry_items(*)`)
      .eq('creator_user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const registries = data || [];

    // Enrich all items with logo_url and name in one batch query
    const allIsins = [...new Set(
      registries.flatMap(r => (r.items || []).map(i => i.isin)).filter(Boolean)
    )];
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

    return res.status(200).json({ registries: enriched });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
