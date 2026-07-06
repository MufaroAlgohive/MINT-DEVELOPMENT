import { supabaseAdmin, authenticateUser } from '../../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabaseAdmin.from('gift_events')
      .update({ status: 'PAUSED', updated_at: new Date().toISOString() })
      .eq('id', req.query.id).eq('creator_user_id', user.id).eq('status', 'ACTIVE')
      .select().single();
    if (error || !data) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ success: true, registry: data });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
