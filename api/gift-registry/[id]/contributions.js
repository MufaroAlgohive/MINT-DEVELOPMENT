import { supabaseAdmin, authenticateUser } from '../../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;

    const { data: reg } = await supabaseAdmin
      .from('gift_events').select('id').eq('id', id).eq('creator_user_id', user.id).single();
    if (!reg) return res.status(404).json({ error: 'Registry not found' });

    const { data: contributions, error } = await supabaseAdmin
      .from('gift_contributions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Filter to this registry's items
    const itemIds = new Set();
    const { data: items } = await supabaseAdmin
      .from('gift_registry_items').select('id').eq('gift_event_id', id);
    (items || []).forEach(i => itemIds.add(i.id));

    const filtered = (contributions || []).filter(c => itemIds.has(c.registry_item_id));
    return res.status(200).json({ contributions: filtered });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
