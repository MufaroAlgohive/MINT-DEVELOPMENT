import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';
import { createPool } from '../_lib/pgPool.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { reservationId, registryId } = req.body;
    if (!reservationId) return res.status(400).json({ error: 'Missing reservationId' });

    const { data: reservation } = await supabaseAdmin
      .from('gift_reservations').select('*').eq('id', reservationId).eq('gifter_user_id', user.id).eq('status', 'HELD').single();
    if (!reservation) return res.status(404).json({ error: 'Reservation not found or expired' });
    if (new Date(reservation.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Your reservation has expired. Please start again.', code: 'RESERVATION_EXPIRED' });
    }

    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(user.id);
    const gifterEmail = userData?.user?.email || '';
    const idempotencyKey = `${reservationId}:${user.id}`;

    const { data: existing } = await supabaseAdmin.from('gift_contributions').select('id,status').eq('idempotency_key', idempotencyKey).single();
    if (existing) return res.status(200).json({ success: true, contribution: existing, duplicate: true });

    const livePriceCents = reservation.price_lock_cents;
    const baseRands = (livePriceCents * reservation.quantity) / 100;
    let feeCents = Math.round(baseRands * 0.006 * 100);
    try {
      const { computeFees } = await import('../_lib/fees.js');
      const result = computeFees(baseRands, 1);
      feeCents = result?.totalCents || feeCents;
    } catch { /* optional */ }

    const quotedAmountCents = livePriceCents * reservation.quantity + feeCents;

    // Single atomic transaction: consume reservation + update item + insert contribution
    const pool = createPool();
    const pg = await pool.connect();
    let contribution;
    try {
      await pg.query('BEGIN');

      // Idempotency inside transaction
      const dupCheck = await pg.query(`SELECT id, status FROM gift_contributions WHERE idempotency_key = $1`, [idempotencyKey]);
      if (dupCheck.rowCount > 0) {
        await pg.query('ROLLBACK');
        return res.status(200).json({ success: true, contribution: dupCheck.rows[0], duplicate: true });
      }

      // Consume reservation with re-validation guard
      const resUpdate = await pg.query(`
        UPDATE gift_reservations SET status = 'CONSUMED'
         WHERE id = $1 AND gifter_user_id = $2 AND status = 'HELD' AND expires_at > now()
         RETURNING id, quantity, registry_item_id
      `, [reservationId, user.id]);

      if (resUpdate.rowCount === 0) {
        await pg.query('ROLLBACK');
        return res.status(410).json({ error: 'Reservation has expired or was already consumed', code: 'RESERVATION_EXPIRED' });
      }

      const qty = resUpdate.rows[0].quantity;
      const itemId = resUpdate.rows[0].registry_item_id;

      await pg.query(`
        UPDATE gift_registry_items
           SET filled_quantity = filled_quantity + $1,
               reserved_quantity = GREATEST(0, reserved_quantity - $1),
               status = CASE WHEN filled_quantity + $1 >= target_quantity THEN 'FILLED'
                             WHEN filled_quantity + $1 > 0 THEN 'PARTIALLY_FILLED'
                             ELSE status END,
               updated_at = now()
         WHERE id = $2
      `, [qty, itemId]);

      const contribResult = await pg.query(`
        INSERT INTO gift_contributions
          (registry_item_id, gifter_user_id, gifter_email, quantity,
           quoted_amount_cents, fee_cents, status, reservation_id, idempotency_key)
        VALUES ($1, $2, $3, $4, $5, $6, 'PAID', $7, $8) RETURNING *
      `, [itemId, user.id, gifterEmail, qty, quotedAmountCents, feeCents, reservationId, idempotencyKey]);

      await pg.query('COMMIT');
      contribution = contribResult.rows[0];
    } catch (e) { await pg.query('ROLLBACK'); throw e; } finally { pg.release(); }

    // Check full completion
    const { data: allItems } = await supabaseAdmin.from('gift_registry_items').select('status').eq('gift_event_id', registryId).neq('status', 'REMOVED');
    if (allItems?.every(i => i.status === 'FILLED')) {
      await supabaseAdmin.from('gift_events').update({ status: 'COMPLETED', updated_at: new Date().toISOString() }).eq('id', registryId);
    }

    return res.status(200).json({ success: true, contribution });
  } catch (e) {
    console.error('[gift-registry/contribute]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
