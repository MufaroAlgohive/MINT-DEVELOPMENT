import { supabaseAdmin } from '../../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { mintNumber } = req.query;
    const { data, error } = await supabaseAdmin
      .from('gift_events')
      .select(`
        id, title, occasion, event_date, expiry_at, share_token, status,
        beneficiary_display_name,
        items:gift_registry_items(id, target_quantity, filled_quantity)
      `)
      .eq('beneficiary_mint_number', mintNumber.toUpperCase())
      .eq('status', 'ACTIVE');

    if (error) throw error;
    return res.status(200).json({ registries: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
