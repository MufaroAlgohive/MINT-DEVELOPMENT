import { supabaseAdmin, authenticateUser } from '../_lib/supabase.js';

// Fetch the latest intraday price (in rands) per security_id
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
      out[id] = Number(data.current_price) / 100;
    }
  }));
  return out;
}

// Create pending stock_holdings_c rows for the wishlist owner after a
// contribution is paid — mirrors the logic in api/gift/claim-v2.js.
//
// ownerFamilyMemberId: when the recipient child has no linked Supabase auth
// account, pass their family_members.id here. Holdings are then stored under
// the parent's user_id but tagged with family_member_id so they appear on
// ChildDashboardPage (which filters by family_member_id) rather than on the
// parent's personal dashboard (which filters family_member_id IS NULL).
async function createOwnerHoldings(db, { ownerUserId, ownerFamilyMemberId, item, amountCents, txId }) {
  try {
    if (item.instrument_type === 'BASKET') {
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
            const holdingRow = {
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
            };
            if (ownerFamilyMemberId) holdingRow.family_member_id = ownerFamilyMemberId;
            await db.from('stock_holdings_c').insert(holdingRow);
            created++;
          } catch (e) {
            console.warn(`[gift-registry/contribute] holding insert ${h.symbol}:`, e.message);
          }
        }
      }

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

      const holdingRow = {
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
      };
      if (ownerFamilyMemberId) holdingRow.family_member_id = ownerFamilyMemberId;
      await db.from('stock_holdings_c').insert(holdingRow);
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

    const { reservationId, registryId, paymentMethod, totalAmount } = req.body;
    if (!reservationId) return res.status(400).json({ error: 'Missing reservationId' });

    console.log(`[gift-registry/contribute] START gifter=${user.id} reservationId=${reservationId} paymentMethod=${paymentMethod} totalAmount=${totalAmount}`);

    // ── WALLET PAYMENT: deduct from gifter's wallet BEFORE consuming reservation ──
    // This mirrors the wallet deduction in api/record-investment.js. We do it
    // first so that if the balance is insufficient we can reject without side-effects.
    let walletRollbackBalance = null;
    if (paymentMethod === 'wallet') {
      if (!totalAmount || Number(totalAmount) <= 0) {
        return res.status(400).json({ error: 'Missing totalAmount for wallet payment' });
      }
      const chargeRands = Number(totalAmount);

      console.log(`[gift-registry/contribute] WALLET deduction: gifter=${user.id} chargeRands=R${chargeRands}`);

      const { data: wallet, error: walletErr } = await supabaseAdmin
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();

      if (walletErr || !wallet) {
        console.error('[gift-registry/contribute] WALLET not found for gifter:', user.id, walletErr?.message);
        return res.status(400).json({ error: 'Wallet not found' });
      }

      const originalBalance = Number(wallet.balance);
      if (originalBalance < chargeRands) {
        console.warn(`[gift-registry/contribute] WALLET insufficient: balance=R${originalBalance} required=R${chargeRands}`);
        return res.status(400).json({ error: 'Insufficient wallet funds', code: 'INSUFFICIENT_FUNDS', balance: originalBalance, required: chargeRands });
      }

      const newBalance = originalBalance - chargeRands;
      const { data: updatedWallet, error: deductErr } = await supabaseAdmin
        .from('wallets')
        .update({ balance: newBalance })
        .eq('user_id', user.id)
        .eq('balance', originalBalance) // optimistic lock — reject if balance changed concurrently
        .select('balance')
        .maybeSingle();

      if (deductErr || !updatedWallet) {
        console.error('[gift-registry/contribute] WALLET deduction failed (concurrent change?):', deductErr?.message);
        return res.status(409).json({ error: 'Wallet balance changed — please retry', code: 'WALLET_CONCURRENT_CHANGE' });
      }

      walletRollbackBalance = originalBalance;
      console.log(`[gift-registry/contribute] WALLET deducted R${chargeRands} from gifter ${user.id}. New balance: R${newBalance}`);
    }

    // Validate reservation still HELD and not expired
    const { data: reservation } = await supabaseAdmin
      .from('gift_reservations')
      .select('*')
      .eq('id', reservationId)
      .eq('gifter_user_id', user.id)
      .eq('status', 'HELD')
      .single();
    if (!reservation) return res.status(404).json({ error: 'Reservation not found or expired' });
    if (new Date(reservation.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Your reservation has expired. Please start again.', code: 'RESERVATION_EXPIRED' });
    }

    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(user.id);
    const gifterEmail = userData?.user?.email || '';
    const idempotencyKey = `${reservationId}:${user.id}`;

    // Idempotency check
    const { data: existing } = await supabaseAdmin
      .from('gift_contributions')
      .select('id, status')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
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

    // Step 1: Atomically consume the reservation (conditional on status=HELD + not expired)
    const { data: consumed, error: consumeErr } = await supabaseAdmin
      .from('gift_reservations')
      .update({ status: 'CONSUMED' })
      .eq('id', reservationId)
      .eq('gifter_user_id', user.id)
      .eq('status', 'HELD')
      .gt('expires_at', new Date().toISOString())
      .select('id, quantity, registry_item_id');

    if (consumeErr || !consumed?.length) {
      return res.status(410).json({ error: 'Reservation has expired or was already consumed', code: 'RESERVATION_EXPIRED' });
    }

    const qty = consumed[0].quantity;
    const itemId = consumed[0].registry_item_id;

    // Step 2: Update item filled/reserved quantities
    // Read current state first so we can compute new absolute values
    const { data: currentItem } = await supabaseAdmin
      .from('gift_registry_items')
      .select('filled_quantity, reserved_quantity, target_quantity, status')
      .eq('id', itemId)
      .single();

    if (currentItem) {
      const newFilled = (currentItem.filled_quantity || 0) + qty;
      const newReserved = Math.max(0, (currentItem.reserved_quantity || 0) - qty);
      const newStatus = newFilled >= currentItem.target_quantity ? 'FILLED'
        : newFilled > 0 ? 'PARTIALLY_FILLED'
        : currentItem.status;

      await supabaseAdmin
        .from('gift_registry_items')
        .update({
          filled_quantity: newFilled,
          reserved_quantity: newReserved,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId);
    }

    // Step 3: Insert contribution
    const { data: contribution, error: contribErr } = await supabaseAdmin
      .from('gift_contributions')
      .insert({
        registry_item_id: itemId,
        gifter_user_id: user.id,
        gifter_email: gifterEmail,
        quantity: qty,
        quoted_amount_cents: quotedAmountCents,
        fee_cents: feeCents,
        status: 'PAID',
        reservation_id: reservationId,
        idempotency_key: idempotencyKey,
      })
      .select('*')
      .single();

    if (contribErr || !contribution) {
      // Best-effort: un-consume the reservation so the user can retry
      await supabaseAdmin
        .from('gift_reservations')
        .update({ status: 'HELD' })
        .eq('id', reservationId);
      throw new Error('Failed to record contribution: ' + (contribErr?.message || 'unknown'));
    }

    // Mark registry COMPLETED if all items are filled
    const { data: allItems } = await supabaseAdmin
      .from('gift_registry_items')
      .select('status')
      .eq('gift_event_id', registryId)
      .neq('status', 'REMOVED');
    if (allItems?.every(i => i.status === 'FILLED')) {
      await supabaseAdmin
        .from('gift_events')
        .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
        .eq('id', registryId);
    }

    // Create pending holdings for the actual recipient + send notifications (best-effort)
    try {
      const [itemResult, registryResult, gifterResult] = await Promise.all([
        supabaseAdmin.from('gift_registry_items')
          .select('isin, instrument_type')
          .eq('id', contribution.registry_item_id)
          .maybeSingle(),
        supabaseAdmin.from('gift_events')
          .select('creator_user_id, title, beneficiary_type, beneficiary_ref, beneficiary_display_name, share_token')
          .eq('id', registryId)
          .maybeSingle(),
        supabaseAdmin.from('profiles')
          .select('first_name, last_name, mint_number')
          .eq('id', user.id)
          .maybeSingle(),
      ]);

      const item = itemResult.data;
      const reg = registryResult.data;
      const ownerUserId = reg?.creator_user_id;
      const registryTitle = reg?.title || 'your wishlist';
      const shareToken = reg?.share_token || '';

      // Resolve actual investment recipient: child account if CHILD registry.
      // If the child has a linked Supabase auth account (linked_user_id set),
      // route directly to their own user_id.
      // If not (linked_user_id is null), use the parent's user_id but set
      // family_member_id to the child's family_members row — the pattern that
      // ChildDashboardPage uses (filters by family_member_id, not user_id) to
      // separate child investments from the parent's personal holdings.
      let recipientUserId = ownerUserId;
      let recipientFamilyMemberId = null;
      if (reg?.beneficiary_type === 'CHILD' && reg?.beneficiary_ref) {
        const { data: famMember } = await supabaseAdmin
          .from('family_members')
          .select('id, linked_user_id, first_name')
          .eq('id', reg.beneficiary_ref)
          .maybeSingle();
        if (famMember?.linked_user_id) {
          // Child has their own auth account — route directly to it
          recipientUserId = famMember.linked_user_id;
          console.log(`[gift-registry/contribute] CHILD registry — routing to child account ${recipientUserId}`);
        } else if (famMember?.id) {
          // Child has no linked account — use parent user_id + family_member_id
          // so holdings appear on ChildDashboardPage but NOT on parent's dashboard
          recipientFamilyMemberId = famMember.id;
          console.log(`[gift-registry/contribute] CHILD registry — child (${famMember.first_name}) has no linked account, using family_member_id=${famMember.id} under parent ${ownerUserId}`);
        } else {
          console.warn(`[gift-registry/contribute] CHILD registry — family_member not found for ref=${reg.beneficiary_ref}, falling back to parent`);
        }
      }

      const gifterProfile = gifterResult.data;
      const gifterName = [gifterProfile?.first_name, gifterProfile?.last_name].filter(Boolean).join(' ') || gifterEmail.split('@')[0] || 'Someone';
      const mintPart = gifterProfile?.mint_number ? ` (${gifterProfile.mint_number})` : '';

      if (item && recipientUserId) {
        const investAmountCents = livePriceCents * contribution.quantity;

        let resolvedName = item.isin;
        if (item.instrument_type === 'BASKET') {
          const { data: stratRow } = await supabaseAdmin.from('strategies_c').select('name').eq('id', item.isin).maybeSingle();
          if (stratRow?.name) resolvedName = stratRow.name;
        } else {
          const { data: secRow } = await supabaseAdmin.from('securities_c').select('name, symbol').eq('isin', item.isin).maybeSingle();
          resolvedName = secRow?.name || secRow?.symbol || item.isin;
        }

        const now = new Date().toISOString();
        const txName = item.instrument_type === 'BASKET'
          ? `Strategy Investment: ${resolvedName}`
          : `Purchased ${resolvedName}`;

        // ── Gifter transaction (debit on their side) ──
        // Records the payment that left the gifter's wallet/Ozow account.
        try {
          const gifterTxRow = {
            user_id: user.id,
            direction: 'debit',
            name: `Gift: ${resolvedName}`,
            description: `Gifted ${resolvedName} from wishlist "${registryTitle}"`,
            amount: Math.round(Number(totalAmount || 0) * 100) || investAmountCents,
            store_reference: `REGISTRY-GIFT-${contribution.id}`,
            currency: 'ZAR',
            status: 'posted',
            transaction_date: now,
            created_at: now,
          };
          if (paymentMethod) gifterTxRow.payment_method = paymentMethod;
          await supabaseAdmin.from('transactions').insert(gifterTxRow);
          console.log(`[gift-registry/contribute] gifter tx recorded for ${user.id} method=${paymentMethod}`);
        } catch (e) {
          console.warn('[gift-registry/contribute] gifter tx insert:', e.message);
        }

        let recipientTxId = null;
        try {
          const txRow = {
            user_id: recipientUserId,
            direction: 'debit',
            name: txName,
            description: 'Investment received as wishlist gift',
            amount: investAmountCents,
            store_reference: `REGISTRY-CONTRIB-${contribution.id}`,
            currency: 'ZAR',
            status: 'posted',
            transaction_date: now,
            created_at: now,
          };
          // Tag with child's family_member_id when they have no linked account
          if (recipientFamilyMemberId) txRow.family_member_id = recipientFamilyMemberId;
          const txInsert = await supabaseAdmin.from('transactions').insert(txRow).select('id').single();
          recipientTxId = txInsert.data?.id || null;
        } catch (e) {
          console.warn('[gift-registry/contribute] recipient tx insert:', e.message);
        }

        const created = await createOwnerHoldings(supabaseAdmin, {
          ownerUserId: recipientUserId,
          ownerFamilyMemberId: recipientFamilyMemberId,
          item,
          amountCents: investAmountCents,
          txId: recipientTxId,
        });
        console.log(`[gift-registry/contribute] created ${created} pending holding(s) for recipient ${recipientUserId}`);

        // ── Notifications ──
        const notifPayload = {
          action: 'OPEN_GIFT_REGISTRY',
          registry_id: registryId,
          share_token: shareToken,
          deep_link: shareToken ? `/gift/${shareToken}` : null,
          gifter_user_id: user.id,
          gifter_name: gifterName,
          gifter_mint_number: gifterProfile?.mint_number || null,
        };

        const notifRows = [];

        // Notify the actual recipient (child or self-registry owner)
        if (recipientUserId && recipientUserId !== user.id) {
          notifRows.push({
            user_id: recipientUserId,
            title: `${gifterName} gifted you 🎁`,
            body: `${gifterName}${mintPart} gifted you ${resolvedName} from your "${registryTitle}" wishlist!`,
            type: 'system',
            payload: notifPayload,
          });
        }

        // Also notify the parent/creator if the registry was for a child
        if (ownerUserId && ownerUserId !== recipientUserId && ownerUserId !== user.id) {
          notifRows.push({
            user_id: ownerUserId,
            title: `${gifterName} gifted your child 🎁`,
            body: `${gifterName}${mintPart} gifted ${resolvedName} to ${reg?.beneficiary_display_name || 'your child'} from the "${registryTitle}" wishlist!`,
            type: 'system',
            payload: notifPayload,
          });
        }

        // Confirm to the gifter
        notifRows.push({
          user_id: user.id,
          title: 'Gift sent! 🎉',
          body: `You gifted ${resolvedName} from "${registryTitle}". They'll love it!`,
          type: 'system',
          payload: notifPayload,
        });

        if (notifRows.length > 0) {
          const { error: notifErr } = await supabaseAdmin.from('notifications').insert(notifRows);
          if (notifErr) console.error('[gift-registry/contribute] notification insert error:', notifErr.message);
          else console.log(`[gift-registry/contribute] sent ${notifRows.length} notification(s)`);
        }
      }
    } catch (e) {
      console.error('[gift-registry/contribute] post-payment error:', e.message);
    }

    console.log(`[gift-registry/contribute] SUCCESS gifter=${user.id} contribution=${contribution.id} paymentMethod=${paymentMethod}`);
    return res.status(200).json({ success: true, contribution });
  } catch (e) {
    console.error('[gift-registry/contribute] ERROR:', e.message);

    // Rollback wallet deduction if something failed after we already deducted
    if (walletRollbackBalance !== null) {
      try {
        await supabaseAdmin
          .from('wallets')
          .update({ balance: walletRollbackBalance })
          .eq('user_id', user?.id);
        console.log(`[gift-registry/contribute] WALLET rollback restored balance to R${walletRollbackBalance} for gifter ${user?.id}`);
      } catch (rbErr) {
        console.error('[gift-registry/contribute] WALLET ROLLBACK FAILED — manual fix needed for user', user?.id, rbErr.message);
      }
    }

    return res.status(500).json({ error: e.message });
  }
}
