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

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
