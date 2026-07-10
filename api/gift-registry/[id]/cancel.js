import { supabaseAdmin, authenticateUser } from '../../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    // Release HELD reservations
    const { data: items } = await supabaseAdmin.from('gift_registry_items').select('id').eq('gift_event_id', req.query.id);
    if (items?.length) {
      const itemIds = items.map(i => i.id);
      await supabaseAdmin.from('gift_reservations').update({ status: 'RELEASED' }).in('registry_item_id', itemIds).eq('status', 'HELD');
      await supabaseAdmin.from('gift_registry_items').update({ reserved_quantity: 0 }).eq('gift_event_id', req.query.id);
    }

    const { data, error } = await supabaseAdmin.from('gift_events')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', req.query.id).eq('creator_user_id', user.id).in('status', ['ACTIVE','PAUSED'])
      .select().single();
    if (error || !data) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ success: true, registry: data });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
