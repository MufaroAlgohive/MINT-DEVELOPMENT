---
name: Gift wishlist heart state must be DB-derived
description: Why the wishlist "heart" indicator on strategy/security cards can go stale, and the fix pattern used.
---

The heart icon (wishlisted state) was originally a freeform preference array (`gift_wishlist_prefs.keys`) stored on the user, set once when an item was added via the picker sheet. It was never cleared when the underlying `gift_registry_items` row later changed status (removed, or fully filled/gifted), so hearts could show "liked" for items no longer actually present in any active wishlist category.

**Why:** Two independent sources of truth (a stored preference set vs. actual registry item rows) will always drift apart once either side changes without updating the other — removals, checkouts/fills, and registry cancellations all mutate item status without touching the preference array.

**How to apply:** Don't just intersect the stored preference array against a DB-confirmed set — some flows (e.g. "like an item while creating a brand-new wishlist") add the item straight to `gift_registry_items` without ever writing to the stored prefs array, so intersecting against an empty/stale stored set silently drops genuinely-liked items. Instead, on every read (`GET /api/gift-wishlist-prefs`, mirrored in `server/giftRegistryRoutes.cjs` and `api/gift-wishlist-prefs.js`), compute the confirmed set directly and solely from the DB (user's non-CANCELLED/EXPIRED registries' items with status OPEN or PARTIALLY_FILLED — FILLED/REMOVED don't count) and return that as `wishlistedKeys`, syncing storage to match afterward rather than filtering storage first. Apply this same pattern to any other feature that mirrors relational state into a denormalized per-user preference blob: prefer recomputing from source over trusting/filtering the cached copy.

Note: item keys use two prefix conventions for basket/strategy items across the codebase (`strategy:<id>` in MarketsPage.jsx, `gift:<id>` in GiftStrategyPickerPage.jsx) — the confirmed-set builder must add both prefixes for BASKET rows or valid keys will be silently dropped depending on which page rendered the heart.
