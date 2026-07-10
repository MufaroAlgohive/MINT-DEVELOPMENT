---
name: Wishlist save/display debugging
description: Root causes found when wishlist saved but "no wishlist yet" shown
---

## Root causes found (three separate bugs)

**1. MarketsPage heart button never saved anything**
`toggleWishlistItem` in MarketsPage called `onContinueToRegistry?.(itemKey)` on add — just updated local React state and navigated away. No localStorage write, no WishlistModal opened. Fix: open `WishlistModal` (`wishlistModalKey` state) directly from MarketsPage.

**2. GiftStrategyPickerPage `handleWishlistSaved` killed step 2**
Called `setWishlistModal(null)` in `onSaved` callback, which unmounted WishlistModal before `setStep(2)` could render. Users never saw "Saved! / View My Wishlists". Fix: remove `setWishlistModal(null)` from `handleWishlistSaved`; let user close modal via step-2 buttons or X.

**3. `updateUserById({ user_metadata: { wishlists } })` overwrites ALL metadata**
Must read existing user_metadata first and spread-merge: `{ ...existingMeta, wishlists }`. Otherwise any onboarding/KYC data stored in user_metadata can be silently wiped.

**Why:** `saveWishlists` writes localStorage synchronously then POSTs to server. Even if server fails, localStorage should persist. The real gap was that no WishlistModal was ever triggered from MarketsPage.

## How to apply
- Any page that has a ❤️ heart button must render its own `WishlistModal` and await `addToWishlist` inside `handleSave`
- `onSaved` callback from WishlistModal should NOT close the modal — only update parent state (wishlistedKeys set)
- All `supabaseAdmin.auth.admin.updateUserById(id, { user_metadata: ... })` calls must read-then-merge
