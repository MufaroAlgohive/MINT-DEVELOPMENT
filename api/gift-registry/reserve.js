import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user, error: authError } = await authenticateUser(req);
    if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

    // KYC check — covers both Sumsub (kyc_status='verified') and Experian
    // (kyc_status='onboarding_complete') flows.  user_onboarding_pack_details
    // is Sumsub-only and must not be used here.
    const { data: onboarding } = await supabaseAdmin
      .from('user_onboarding')
      .select('kyc_status')
      .eq('user_id', user.id)
      .maybeSingle();
    const kycOk = onboarding && ['approved', 'onboarding_complete', 'verified'].includes(onboarding.kyc_status);
    if (!kycOk) return res.status(403).json({ error: 'Complete your verification to gift', code: 'KYC_INCOMPLETE' });

    const { itemId, quantity, registryId } = req.body;
    if (!itemId || !quantity || quantity < 1) return res.status(400).json({ error: 'Invalid request' });

    // Check registry ACTIVE
    const { data: reg } = await supabaseAdmin
      .from('gift_events').select('status').eq('id', registryId).single();
    if (!reg || reg.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Registry is not accepting gifts', code: 'REGISTRY_CLOSED' });
    }

    // Read current item state
    const { data: item } = await supabaseAdmin
      .from('gift_registry_items').select('*')
      .eq('id', itemId).eq('gift_event_id', registryId).single();
    if (!item) return res.status(404).json({ error: 'Item not found or does not belong to this registry' });

    // Auto-release the caller's OWN stale HELD reservation(s) on this item before
    // computing availability. Items are usually target_quantity=1, so an abandoned
    // checkout (user went back / closed the sheet) would otherwise block them from
    // gifting again until the 10-min hold expires.
    // Only ever touches reservations owned by this user — never another gifter's hold.
    const { data: ownHeld } = await supabaseAdmin
      .from('gift_reservations')
      .select('id, quantity')
      .eq('registry_item_id', itemId)
      .eq('gifter_user_id', user.id)
      .eq('status', 'HELD');

    if (ownHeld?.length) {
      const ownHeldQty = ownHeld.reduce((sum, r) => sum + (r.quantity || 0), 0);
      await supabaseAdmin
        .from('gift_reservations')
        .update({ status: 'RELEASED' })
        .in('id', ownHeld.map(r => r.id));
      item.reserved_quantity = Math.max(0, item.reserved_quantity - ownHeldQty);
      await supabaseAdmin
        .from('gift_registry_items')
        .update({ reserved_quantity: item.reserved_quantity, updated_at: new Date().toISOString() })
        .eq('id', itemId);
    }

    const available = item.target_quantity - item.filled_quantity - item.reserved_quantity;
    if (quantity > available) {
      return res.status(409).json({ error: 'Not enough shares available', code: 'SOLD_OUT', remaining: available });
    }

    const minTranche = item.min_tranche_quantity || 1;
    if (quantity < minTranche && quantity !== available) {
      return res.status(400).json({ error: `Minimum gift is ${minTranche} share(s)`, code: 'BELOW_MINIMUM' });
    }

    // Live price — BASKET items use the stored snapshot; shares use intraday
    let livePriceCents = item.price_snapshot_cents || 0;
    if (item.instrument_type !== 'BASKET') {
      const { data: intraday } = await supabaseAdmin
        .from('stock_intraday_c').select('current_price')
        .eq('isin', item.isin).order('timestamp', { ascending: false }).limit(1).maybeSingle();
      if (intraday?.current_price) livePriceCents = intraday.current_price;
    }

    // Atomic-ish reserve via optimistic locking on reserved_quantity.
    // We set the absolute new value and condition the update on the value we
    // just read — if any concurrent request changed it first, this affects 0
    // rows and we return SOLD_OUT.  No pgPool / direct-postgres needed.
    const maxReservedAllowed = item.target_quantity - item.filled_quantity - quantity;
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('gift_registry_items')
      .update({
        reserved_quantity: item.reserved_quantity + quantity,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId)
      .eq('reserved_quantity', item.reserved_quantity) // optimistic lock
      .lte('reserved_quantity', maxReservedAllowed)    // capacity guard
      .in('status', ['OPEN', 'PARTIALLY_FILLED'])
      .select('id');

    if (updateErr || !updated?.length) {
      return res.status(409).json({ error: 'No longer available', code: 'SOLD_OUT', remaining: 0 });
    }

    // Insert reservation record
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: reservation, error: resErr } = await supabaseAdmin
      .from('gift_reservations')
      .insert({
        registry_item_id: itemId,
        gifter_user_id: user.id,
        quantity,
        expires_at: expiresAt,
        price_lock_cents: livePriceCents,
      })
      .select('id')
      .single();

    if (resErr || !reservation) {
      // Best-effort rollback of the reserved_quantity increment
      await supabaseAdmin
        .from('gift_registry_items')
        .update({ reserved_quantity: item.reserved_quantity, updated_at: new Date().toISOString() })
        .eq('id', itemId);
      throw new Error('Failed to create reservation: ' + (resErr?.message || 'unknown'));
    }

    return res.status(200).json({
      success: true,
      reservationId: reservation.id,
      livePriceCents,
      expiresInSeconds: 600,
    });
  } catch (e) {
    console.error('[gift-registry/reserve]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
