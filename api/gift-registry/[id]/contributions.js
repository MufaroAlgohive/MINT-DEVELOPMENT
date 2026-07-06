import { supabaseAdmin, authenticateUser } from '../../_lib/supabase.js';

async function enrichWithGifterNames(contributions) {
  if (!contributions?.length) return contributions;
  const uniqueIds = [...new Set(contributions.map(c => c.gifter_user_id).filter(Boolean))];
  const nameMap = {};
  await Promise.all(uniqueIds.map(async (uid) => {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
      const u = data?.user;
      const fullName =
        u?.user_metadata?.full_name ||
        u?.user_metadata?.name ||
        [u?.user_metadata?.first_name, u?.user_metadata?.last_name].filter(Boolean).join(' ') ||
        '';
      nameMap[uid] = { name: fullName, email: u?.email || '' };
    } catch { nameMap[uid] = { name: '', email: '' }; }
  }));
  return contributions.map(c => ({
    ...c,
    gifter_name: nameMap[c.gifter_user_id]?.name || '',
    gifter_email: c.gifter_email || nameMap[c.gifter_user_id]?.email || '',
  }));
}

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

    const { data: items } = await supabaseAdmin
      .from('gift_registry_items').select('id').eq('gift_event_id', id);
    const itemIds = (items || []).map(i => i.id);

    if (!itemIds.length) return res.status(200).json({ contributions: [] });

    const { data: contributions, error } = await supabaseAdmin
      .from('gift_contributions')
      .select('*')
      .in('registry_item_id', itemIds)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const enriched = await enrichWithGifterNames(contributions || []);
    return res.status(200).json({ contributions: enriched });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
