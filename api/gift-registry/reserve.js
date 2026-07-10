import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';
import { createPool } from '../_lib/pgPool.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    // Decision 1 & 3: KYC check
    const { data: onboarding } = await supabaseAdmin
      .from('user_onboarding_pack_details').select('id').eq('user_id', user.id).single();
    if (!onboarding) return res.status(403).json({ error: 'Complete your verification to gift', code: 'KYC_INCOMPLETE' });

    const { itemId, quantity, registryId } = req.body;
    if (!itemId || !quantity || quantity < 1) return res.status(400).json({ error: 'Invalid request' });

    // Check registry ACTIVE (Decision 5)
    const { data: reg } = await supabaseAdmin.from('gift_events').select('status').eq('id', registryId).single();
    if (!reg || reg.status !== 'ACTIVE') return res.status(400).json({ error: 'Registry is not accepting gifts', code: 'REGISTRY_CLOSED' });

    // Get item state — enforce item belongs to this registry
    const { data: item } = await supabaseAdmin.from('gift_registry_items').select('*').eq('id', itemId).eq('gift_event_id', registryId).single();
    if (!item) return res.status(404).json({ error: 'Item not found or does not belong to this registry' });

    const available = item.target_quantity - item.filled_quantity - item.reserved_quantity;
    if (quantity > available) return res.status(409).json({ error: 'Not enough shares available', code: 'SOLD_OUT', remaining: available });

    // Minimum check (Decision 2)
    const minTranche = item.min_tranche_quantity || 1;
    if (quantity < minTranche && quantity !== available) {
      return res.status(400).json({ error: `Minimum gift is ${minTranche} share(s)`, code: 'BELOW_MINIMUM' });
    }

    // Live price (Decision 8)
    const { data: intraday } = await supabaseAdmin
      .from('stock_intraday_c').select('current_price').eq('isin', item.isin).order('timestamp', { ascending: false }).limit(1).single();
    const livePriceCents = intraday?.current_price || item.price_snapshot_cents || 0;

    // Atomic reserve via pgPool
    const pool = createPool();
    const pg = await pool.connect();
    let reservationId;
    try {
      await pg.query('BEGIN');
      const upd = await pg.query(`
        UPDATE gift_registry_items
           SET reserved_quantity = reserved_quantity + $1, updated_at = now()
         WHERE id = $2 AND status IN ('OPEN','PARTIALLY_FILLED')
           AND (filled_quantity + reserved_quantity + $1) <= target_quantity
         RETURNING id
      `, [quantity, itemId]);

      if (upd.rowCount === 0) { await pg.query('ROLLBACK'); return res.status(409).json({ error: 'No longer available', code: 'SOLD_OUT', remaining: 0 }); }

      const ins = await pg.query(`
        INSERT INTO gift_reservations (registry_item_id, gifter_user_id, quantity, expires_at, price_lock_cents)
        VALUES ($1, $2, $3, now() + interval '10 minutes', $4) RETURNING id
      `, [itemId, user.id, quantity, livePriceCents]);

      await pg.query('COMMIT');
      reservationId = ins.rows[0].id;
    } catch (e) { await pg.query('ROLLBACK'); throw e; } finally { pg.release(); }

    return res.status(200).json({ success: true, reservationId, livePriceCents, expiresInSeconds: 600 });
  } catch (e) {
    console.error('[gift-registry/reserve]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
