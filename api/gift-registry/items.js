import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';

async function getLatestPriceCents(isin) {
  const { data: intraday } = await supabaseAdmin
    .from('stock_intraday_c')
    .select('current_price')
    .eq('isin', isin)
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();
  if (intraday?.current_price) return intraday.current_price;
  const { data: sec } = await supabaseAdmin.from('securities_c').select('last_price').eq('isin', isin).single();
  return sec?.last_price || 0;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    // POST — add item
    if (req.method === 'POST') {
      const { registryId, isin, instrumentType = 'SHARE', targetQuantity } = req.body;
      if (!registryId || !isin || !targetQuantity) return res.status(400).json({ error: 'Missing required fields' });

      const { data: reg } = await supabaseAdmin
        .from('gift_events').select('id,status').eq('id', registryId).eq('creator_user_id', user.id).single();
      if (!reg) return res.status(404).json({ error: 'Registry not found' });
      if (!['DRAFT','ACTIVE','PAUSED'].includes(reg.status)) return res.status(400).json({ error: 'Cannot add items to a closed registry' });

      const priceCents = await getLatestPriceCents(isin);
      const minTranche = priceCents > 0 ? Math.max(1, Math.ceil(1000 / priceCents)) : 1;

      const { data: item, error } = await supabaseAdmin.from('gift_registry_items').insert({
        gift_event_id: registryId, isin, instrument_type: instrumentType,
        target_quantity: targetQuantity, price_snapshot_cents: priceCents, min_tranche_quantity: minTranche,
      }).select().single();

      if (error) throw error;
      return res.status(200).json({ success: true, item });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
