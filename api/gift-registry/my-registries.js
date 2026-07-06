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
    return res.status(200).json({ registries: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
