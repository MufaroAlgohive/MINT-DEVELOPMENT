---
name: Gift registry child recipient routing
description: How wishlist gift purchases route holdings/transactions to child vs parent accounts; the family_member_id pattern for children without linked_user_id.
---

# Gift registry child recipient routing

## The rule
When a gift is purchased through a CHILD registry (wishlist created for a child):
- If child has `linked_user_id` set → use `user_id = child.linked_user_id`, `family_member_id = null`
- If child has `linked_user_id = null` (no own Supabase auth account) → use `user_id = parent`, `family_member_id = child's family_members.id`

**Why:** ChildDashboardPage and FamilyDashboardPage filter holdings/transactions by `family_member_id`, not by `user_id`. The parent's personal dashboard filters `.is('family_member_id', null)` to exclude child records. Using parent user_id + family_member_id is the established pattern for all child investments in this app.

**How to apply:** Check `server/giftRegistryRoutes.cjs` `contribute` endpoint — `recipientFamilyMemberId` variable controls this. Both `transactions` and `stock_holdings_c` inserts must include `family_member_id` when set.

## Bug 1 fixed (2026-07-20)
The contribute endpoint fell through silently when `linked_user_id` was null — it fell back to parent's `user_id` but set NO `family_member_id`. Result: the gift appeared as the parent's own personal investment.

**Data repaired:** 5 transactions + 22 holdings for tsiemasilo (parent) were updated to `family_member_id = Amara Smith's family_member id`.

## Bug 2 fixed (2026-07-20) — single-security isin=null lookup
`gift_registry_items.isin` stores the JSE ticker (e.g. `BHG.JO`), but many JSE securities in `securities_c` have `isin = null` with only a `symbol` set. The contribute endpoint's single-security path did `.eq('isin', itemIsin)` which returned nothing → holding silently skipped.

**Fix:** Both the `itemName` resolution (line ~1342) and the holding-creation lookup (line ~1450) in `giftRegistryRoutes.cjs` now fall back to `.eq('symbol', itemIsin)` when the isin lookup returns null.

**Data repaired:** 1 BHG.JO holding manually inserted for Amara Smith (family_member_id `27e0588e`), linked to the existing REGISTRY-CONTRIB transaction `a0756120`. The held-refresh cron confirmed it by updating 34 (up from 33) held securities.

## Key query patterns
- Parent personal dashboard: `.eq('user_id', uid).is('family_member_id', null)`
- Child dashboard: `.eq('family_member_id', child.id)` (no user_id filter needed)
- `/api/user/strategies`: queries transactions with `.is('family_member_id', null)` — REGISTRY-CONTRIB txs for a child must have family_member_id set or they pollute the parent's strategy view
