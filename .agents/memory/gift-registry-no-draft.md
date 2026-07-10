---
name: Gift registry DRAFT status removed
description: New wishlists/registries are created ACTIVE with a share_token immediately; there is no more DRAFT/publish step.
---

Registries used to be created with `status: 'DRAFT'` and required a separate `POST /:id/publish` call (generating `share_token`) before they could be shared. This produced two user-visible rough edges: a "Draft" badge on every new wishlist, and a black "Publish to Share" button on item cards that had to be tapped before the purple "Share your wishlist" banner would appear.

**Why:** The publish step added no real gate (any registry owner could publish immediately), so it was pure friction — an extra tap with a confusing intermediate state, not a meaningful moderation or validation step.

**How to apply:** `POST /api/gift-registry/create` (both `server/giftRegistryRoutes.cjs` and `api/gift-registry/create.js`) now inserts with `status: 'ACTIVE'` and generates `share_token` at creation time. UI conditions for the share banner/icon should key off `share_token` presence and `status not in (CANCELLED, EXPIRED)`, not off `status === 'ACTIVE'/'PAUSED'` specifically. The `/:id/publish` endpoint and `DRAFT` status/meta entries were left in place (harmless legacy/dead code) rather than deleted, since old rows could theoretically still reference DRAFT — any pre-existing DRAFT rows in the DB should be backfilled to ACTIVE + a generated share_token if this pattern resurfaces (e.g. after a restore).
