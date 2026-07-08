import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';
import { createPool } from '../_lib/pgPool.js';

// Fetch the latest intraday price (in rands) per security_id —
// same helper used by record-investment.js and claim-v2.js.
async function fetchLatestIntradayPrices(db, securityIds) {
  if (!securityIds || !securityIds.length) return {};
  const ids = [...new Set(securityIds.filter(Boolean))];
  const out = {};
  await Promise.all(ids.map(async (id) => {
    const { data } = await db
      .from('stock_intraday_c')
      .select('current_price')
      .eq('security_id', id)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.current_price != null) {
      // stock_intraday_c.current_price is stored in cents; return rands.
      out[id] = Number(data.current_price) / 100;
    }
  }));
  return out;
}

// Create pending stock_holdings_c rows for the wishlist owner after a
// contribution is paid — mirrors the logic in api/gift/claim-v2.js so
// the holding shows as a pending purple card on their dashboard immediately.
async function createOwnerHoldings(db, { ownerUserId, item, amountCents, txId }) {
  try {
    if (item.instrument_type === 'BASKET') {
      // Strategy basket — look up constituent holdings from strategies_c
      const { data: strategy } = await db
        .from('strategies_c')
        .select('id, name, holdings')
        .eq('id', item.isin)
        .maybeSingle();

      if (!strategy?.holdings?.length) {
        console.warn('[gift-registry/contribute] BASKET strategy not found or empty holdings for isin:', item.isin);
        return 0;
      }

      const strategyId = strategy.id;
      const symbols = strategy.holdings.map(h => h.symbol).filter(Boolean);
      const { data: securities } = await db
        .from('securities_c')
        .select('id, symbol, last_price')
        .in('symbol', symbols);

      const secMap = {};
      (securities || []).forEach(s => { secMap[s.symbol] = s; });

      const intradayPrices = await fetchLatestIntradayPrices(db, (securities || []).map(s => s.id));

      const investAmountRands = amountCents / 100;
      let totalBasketCost = 0;
      for (const h of strategy.holdings) {
        if (secMap[h.symbol]?.last_price) totalBasketCost += secMap[h.symbol].last_price * (h.weight || 1);
      }

      let created = 0;
      if (totalBasketCost > 0) {
        const scale = investAmountRands / totalBasketCost;
        for (const h of strategy.holdings) {
          const sec = secMap[h.symbol];
          if (!sec?.last_price) continue;
          const qty = Math.max(1, Math.round((h.weight || 1) * scale));
          try {
            await db.from('stock_holdings_c').insert({
              user_id: ownerUserId,
              security_id: sec.id,
              quantity: qty,
              avg_fill: null,
              market_value: 0,
              unrealized_pnl: 0,
              as_of_date: null,
              strategy_id: strategyId,
              Status: 'active',
              transaction_id: txId || null,
              Expected_fill: intradayPrices[sec.id] ?? null,
            });
            created++;
          } catch (e) {
            console.warn(`[gift-registry/contribute] holding insert ${h.symbol}:`, e.message);
          }
        }
      }

      // Upsert user_strategies so the strategy shows in their portfolio
      if (created > 0) {
        const nowTs = new Date().toISOString();
        const { data: existingUS } = await db
          .from('user_strategies')
          .select('id, invested_amount')
          .eq('user_id', ownerUserId)
          .eq('strategy_id', strategyId)
          .maybeSingle();

        if (existingUS) {
          await db.from('user_strategies')
            .update({ invested_amount: (existingUS.invested_amount || 0) + amountCents, updated_at: nowTs })
            .eq('id', existingUS.id);
        } else {
          await db.from('user_strategies').insert({
            user_id: ownerUserId,
            strategy_id: strategyId,
            invested_amount: amountCents,
            status: 'active',
            created_at: nowTs,
            updated_at: nowTs,
          });
        }
      }

      return created;
    } else {
      // Individual share — look up security by ISIN
      const { data: sec } = await db
        .from('securities_c')
        .select('id, symbol, last_price')
        .eq('isin', item.isin)
        .maybeSingle();

      if (!sec?.last_price) {
        console.warn('[gift-registry/contribute] security not found for isin:', item.isin);
        return 0;
      }

      const qty = Math.max(1, Math.floor((amountCents / 100) / (sec.last_price / 100)));
      const intradayPrices = await fetchLatestIntradayPrices(db, [sec.id]);

      await db.from('stock_holdings_c').insert({
        user_id: ownerUserId,
        security_id: sec.id,
        quantity: qty,
        avg_fill: null,
        market_value: 0,
        unrealized_pnl: 0,
        as_of_date: null,
        Status: 'active',
        transaction_id: txId || null,
        Expected_fill: intradayPrices[sec.id] ?? null,
      });
      return 1;
    }
  } catch (e) {
    console.error('[gift-registry/contribute] createOwnerHoldings error:', e.message);
    return 0;
  }
}

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

    // ── CREATE PENDING HOLDINGS FOR THE WISHLIST OWNER ──────────────────────
    // Fetch the registry item details and the owner's user ID so we can
    // create stock_holdings_c rows immediately — the same way a normal
    // strategy purchase does — so the pending purple card appears on their
    // home dashboard right away without requiring a separate "claim" step.
    try {
      const [itemResult, registryResult] = await Promise.all([
        supabaseAdmin.from('gift_registry_items')
          .select('isin, instrument_type')
          .eq('id', contribution.registry_item_id)
          .maybeSingle(),
        supabaseAdmin.from('gift_events')
          .select('creator_user_id')
          .eq('id', registryId)
          .maybeSingle(),
      ]);

      const item = itemResult.data;
      const ownerUserId = registryResult.data?.creator_user_id;

      if (item && ownerUserId) {
        // Investment amount = price paid for this contribution (excluding fee)
        const investAmountCents = livePriceCents * contribution.quantity;

        // Resolve display name for the transaction — must match /api/user/strategies
        // which filters by "Strategy Investment: <exact strategy name>".
        let resolvedName = item.isin;
        if (item.instrument_type === 'BASKET') {
          const { data: stratRow } = await supabaseAdmin.from('strategies_c').select('name').eq('id', item.isin).maybeSingle();
          if (stratRow?.name) resolvedName = stratRow.name;
        } else {
          const { data: secRow } = await supabaseAdmin.from('securities_c').select('name, symbol').eq('isin', item.isin).maybeSingle();
          resolvedName = secRow?.name || secRow?.symbol || item.isin;
        }

        // Insert a transaction for the owner so holdings have a transaction_id
        const now = new Date().toISOString();
        const txName = item.instrument_type === 'BASKET'
          ? `Strategy Investment: ${resolvedName}`
          : `Purchased ${resolvedName}`;

        let ownerTxId = null;
        try {
          const txInsert = await supabaseAdmin.from('transactions').insert({
            user_id: ownerUserId,
            direction: 'debit',
            name: txName,
            description: 'Investment received as wishlist gift',
            amount: investAmountCents,
            store_reference: `REGISTRY-CONTRIB-${contribution.id}`,
            currency: 'ZAR',
            status: 'posted',
            transaction_date: now,
            created_at: now,
          }).select('id').single();
          ownerTxId = txInsert.data?.id || null;
        } catch (e) {
          console.warn('[gift-registry/contribute] owner tx insert:', e.message);
        }

        const created = await createOwnerHoldings(supabaseAdmin, {
          ownerUserId,
          item,
          amountCents: investAmountCents,
          txId: ownerTxId,
        });

        console.log(`[gift-registry/contribute] created ${created} pending holding(s) for owner ${ownerUserId}`);
      } else {
        console.warn('[gift-registry/contribute] could not resolve item or owner for holdings creation', { item, ownerUserId });
      }
    } catch (e) {
      // Holdings creation is best-effort — the contribution is already paid,
      // so we log but do not fail the response.
      console.error('[gift-registry/contribute] post-payment holdings creation error:', e.message);
    }

    return res.status(200).json({ success: true, contribution });
  } catch (e) {
    console.error('[gift-registry/contribute]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
