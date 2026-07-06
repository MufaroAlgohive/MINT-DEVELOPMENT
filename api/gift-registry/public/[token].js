import { supabaseAdmin } from '../../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { token } = req.query;

    // Strict allowlist — never join to users or holdings beyond what's listed here
    const { data: registry, error } = await supabaseAdmin
      .from('gift_events')
      .select(`
        id, title, occasion, custom_occasion, beneficiary_display_name,
        event_date, expiry_at, message, status, share_token,
        items:gift_registry_items(
          id, isin, instrument_type, target_quantity, filled_quantity,
          reserved_quantity, min_tranche_quantity, price_snapshot_cents,
          status, display_order
        )
      `)
      .eq('share_token', token)
      .single();

    if (error || !registry) return res.status(404).json({ error: 'Registry not found' });

    if (registry.items?.length) {
      const isins = registry.items.map(i => i.isin);
      const { data: securities } = await supabaseAdmin.from('securities_c').select('isin, name, logo_url, last_price').in('isin', isins);
      const secMap = Object.fromEntries((securities || []).map(s => [s.isin, s]));
      registry.items = registry.items
        .filter(i => i.status !== 'REMOVED')
        .sort((a, b) => a.display_order - b.display_order)
        .map(item => ({
          ...item,
          name: secMap[item.isin]?.name || item.isin,
          logo_url: secMap[item.isin]?.logo_url || null,
          price_snapshot_cents: item.price_snapshot_cents || secMap[item.isin]?.last_price || 0,
        }));
    }

    return res.status(200).json({ registry });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
