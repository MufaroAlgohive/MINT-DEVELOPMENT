import { supabaseAdmin, authenticateUser } from '../../_lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const shareToken = crypto.randomBytes(24).toString('base64url');
    const { data, error } = await supabaseAdmin
      .from('gift_events')
      .update({ status: 'ACTIVE', share_token: shareToken, updated_at: new Date().toISOString() })
      .eq('id', req.query.id)
      .eq('creator_user_id', user.id)
      .eq('status', 'DRAFT')
      .select().single();

    if (error || !data) return res.status(404).json({ error: 'Registry not found or already published' });
    return res.status(200).json({ success: true, registry: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
