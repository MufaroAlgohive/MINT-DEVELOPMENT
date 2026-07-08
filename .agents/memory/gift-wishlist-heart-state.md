---
name: Gift wishlist heart state must be DB-derived
description: Why the wishlist "heart" indicator on strategy/security cards can go stale, and the fix pattern used.
---

The heart icon (wishlisted state) was originally a freeform preference array (`gift_wishlist_prefs.keys`) stored on the user, set once when an item was added via the picker sheet. It was never cleared when the underlying `gift_registry_items` row later changed status (removed, or fully filled/gifted), so hearts could show "liked" for items no longer actually present in any active wishlist category.

**Why:** Two independent sources of truth (a stored preference set vs. actual registry item rows) will always drift apart once either side changes without updating the other — removals, checkouts/fills, and registry cancellations all mutate item status without touching the preference array.

**How to apply:** Treat the stored preference array as a *candidate* set only. On every read (`GET /api/gift-wishlist-prefs`, mirrored in `server/giftRegistryRoutes.cjs` and `api/gift-wishlist-prefs.js`), intersect it against a DB-confirmed set built from the user's non-CANCELLED/EXPIRED registries' items with status OPEN or PARTIALLY_FILLED (FILLED/REMOVED items don't count as "still wishlisted"). Prune confirmed-stale keys back into storage opportunistically. Apply this same pattern to any other feature that mirrors a relational state into a denormalized per-user preference blob.

Note: item keys use two prefix conventions for basket/strategy items across the codebase (`strategy:<id>` in MarketsPage.jsx, `gift:<id>` in GiftStrategyPickerPage.jsx) — the confirmed-set builder must add both prefixes for BASKET rows or the intersection will silently drop valid keys depending on which page rendered the heart.
