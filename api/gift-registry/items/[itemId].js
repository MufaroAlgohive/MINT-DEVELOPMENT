import { supabaseAdmin, authenticateUser } from '../../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { itemId } = req.query;
    const { data: item } = await supabaseAdmin
      .from('gift_registry_items')
      .select('id, gift_event_id, gift_events!inner(creator_user_id)')
      .eq('id', itemId).single();

    if (!item || item.gift_events?.creator_user_id !== user.id) return res.status(404).json({ error: 'Item not found' });

    await supabaseAdmin.from('gift_registry_items').update({ status: 'REMOVED' }).eq('id', itemId);
    return res.status(200).json({ success: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
