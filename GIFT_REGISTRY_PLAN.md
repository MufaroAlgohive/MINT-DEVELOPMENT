# Gift Registry — Build Plan & Suggestions

**Based on:** `MINT_GiftRegistry_Spec_1783325415113.docx` (v0.1 Draft)
**Status:** Planning — nothing built yet
**Owner:** Lonwabo Damane
**Engineers:** Tsie Masilo, Lindelwa Radebe, Juan van Wyk

---

## Quick Summary of What's Missing

The app already has **direct gifting** (send one share to one person by email + OTP). The Gift Registry is a completely separate, new feature. Think of it like a wedding wishlist — but instead of a toaster, people gift you shares. **Zero of the registry is built.** Everything below needs to be created from scratch.

---

## What Needs to Be Built (Gap List)

### 1. Database Tables (nothing exists yet)

Four new tables are needed in Supabase:

#### `gift_events`
The registry itself — one row per wishlist a user creates.
```sql
CREATE TABLE gift_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id         uuid REFERENCES auth.users(id) NOT NULL,
  beneficiary_type        text CHECK (beneficiary_type IN ('SELF','CHILD','OTHER')) NOT NULL,
  beneficiary_ref         uuid,               -- account or custodial account id, nullable for non-KYC OTHER
  beneficiary_display_name text NOT NULL,     -- first name only, shown publicly
  beneficiary_mint_number  text,              -- e.g. LON...2026, nullable until resolved
  occasion                text CHECK (occasion IN ('BIRTHDAY','WEDDING','BABY','GRADUATION','FESTIVE','CUSTOM')) NOT NULL,
  title                   text NOT NULL,      -- e.g. "Ncumolwethu turns 4"
  event_date              date NOT NULL,
  expiry_at               timestamptz NOT NULL,
  status                  text CHECK (status IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','EXPIRED','CANCELLED')) DEFAULT 'DRAFT',
  share_token             text UNIQUE NOT NULL, -- unguessable token for public link
  message                 text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);
```
**Suggestion:** Generate `share_token` server-side using `crypto.randomBytes(24).toString('base64url')` — never sequential.

---

#### `gift_registry_items`
Each share/ETF/basket line on a wishlist.
```sql
CREATE TABLE gift_registry_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_event_id         uuid REFERENCES gift_events(id) ON DELETE CASCADE NOT NULL,
  isin                  text NOT NULL,
  instrument_type       text CHECK (instrument_type IN ('SHARE','ETF','BASKET')) NOT NULL,
  target_quantity       int NOT NULL CHECK (target_quantity > 0),
  filled_quantity       int NOT NULL DEFAULT 0,
  reserved_quantity     int NOT NULL DEFAULT 0,
  min_tranche_quantity  int,               -- recomputed on every read, stored as cache only
  price_snapshot_cents  int,               -- last known price in cents (ZAp for JSE)
  status                text CHECK (status IN ('OPEN','PARTIALLY_FILLED','FILLED','REMOVED','SUSPENDED')) DEFAULT 'OPEN',
  display_order         int DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  -- INVARIANT: filled_quantity + reserved_quantity <= target_quantity (enforced via atomic UPDATE)
  CONSTRAINT no_oversell CHECK (filled_quantity + reserved_quantity <= target_quantity)
);
```

---

#### `gift_reservations`
A 10-minute seat-hold while someone is paying. Prevents two people buying the same last share.
```sql
CREATE TABLE gift_reservations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_item_id  uuid REFERENCES gift_registry_items(id) NOT NULL,
  gifter_user_id    uuid REFERENCES auth.users(id),  -- nullable for guest path
  quantity          int NOT NULL CHECK (quantity > 0),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  status            text CHECK (status IN ('HELD','CONSUMED','RELEASED','EXPIRED')) DEFAULT 'HELD',
  price_lock_cents  int NOT NULL,  -- price at time of reservation, used for the quote
  created_at        timestamptz DEFAULT now()
);
```
**Suggestion:** Add a Supabase cron (pg_cron) or a server-side sweeper that runs every minute to expire stale reservations and release the quantity back to the item. Without this, sold-out items stay greyed out even after someone abandons checkout.

---

#### `gift_contributions`
One row per successful payment against a registry item.
```sql
CREATE TABLE gift_contributions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_item_id      uuid REFERENCES gift_registry_items(id) NOT NULL,
  gifter_user_id        uuid REFERENCES auth.users(id),   -- nullable for non-KYC guest
  gifter_email          text NOT NULL,
  quantity              int NOT NULL,
  quoted_amount_cents   int NOT NULL,     -- what the gifter authorised (includes buffer + fees)
  executed_amount_cents int,              -- actual cost after market execution
  status                text CHECK (status IN (
    'INITIATED','RESERVED','PAID','EXECUTING','SETTLED','REFUNDED','FAILED','RESERVATION_EXPIRED'
  )) DEFAULT 'INITIATED',
  reservation_id        uuid REFERENCES gift_reservations(id),
  payment_ref           text,            -- Paystack / Ozow reference
  order_ref             text,            -- broker / OMS order reference
  idempotency_key       text UNIQUE NOT NULL,
  created_at            timestamptz DEFAULT now()
);
```

---

### 2. API Endpoints (all missing)

Currently the app has `api/gift/create.js`, `cancel.js`, `claim.js` etc. — those are all for the **direct gift flow** and are fine as-is. The registry needs entirely new endpoints under `api/gift-registry/`:

| Endpoint | What it does |
|---|---|
| `POST /api/gift-registry/create` | Create a new registry (DRAFT status) |
| `PUT /api/gift-registry/:id` | Edit title, occasion, expiry, message |
| `POST /api/gift-registry/:id/publish` | Move from DRAFT → ACTIVE, generate share_token |
| `POST /api/gift-registry/:id/pause` | ACTIVE → PAUSED |
| `POST /api/gift-registry/:id/resume` | PAUSED → ACTIVE |
| `POST /api/gift-registry/:id/cancel` | ACTIVE/PAUSED → CANCELLED, release reservations |
| `GET /api/gift-registry/:id` | Full registry with live item state (auth required) |
| `GET /api/gift-registry/public/:token` | Public view via share_token (no auth) |
| `GET /api/gift-registry/by-mint-number/:mintNumber` | Lookup registries for a MINT number |
| `POST /api/gift-registry/items` | Add an item to a registry |
| `DELETE /api/gift-registry/items/:itemId` | Remove an item |
| `POST /api/gift-registry/reserve` | **Atomic reservation** — the critical anti-oversell step |
| `POST /api/gift-registry/contribute` | Confirm payment, move reservation → contribution |
| `GET /api/gift-registry/my-registries` | Creator's dashboard — all their registries |
| `GET /api/gift-registry/:id/contributions` | Creator sees who gifted what |

**Suggestion for the atomic reservation** — this is the most important one to get right. It must use a single conditional `UPDATE` (not a SELECT then UPDATE) to prevent race conditions:
```sql
-- In api/gift-registry/reserve.js
UPDATE gift_registry_items
   SET reserved_quantity = reserved_quantity + $1
 WHERE id = $2
   AND status IN ('OPEN','PARTIALLY_FILLED')
   AND (filled_quantity + reserved_quantity + $1) <= target_quantity
RETURNING id;
-- If 0 rows returned → sold out, reject gracefully
-- If 1 row returned → reservation granted, insert into gift_reservations
```

---

### 3. Frontend Pages (all missing)

#### Creator side (building the registry)
| Page / Component | What it is |
|---|---|
| `GiftRegistryCreatePage.jsx` | Step 1 — pick occasion, beneficiary type (self / child / other), event date, expiry |
| `GiftRegistryBuilderPage.jsx` | Step 2 — search for shares/ETFs/baskets, set target quantity per item, reorder |
| `GiftRegistryPreviewPage.jsx` | Step 3 — review before publishing, see share link |
| `GiftRegistryDashboardPage.jsx` | Creator's home — list of all their registries, progress at a glance |
| `GiftRegistryDetailPage.jsx` | Creator drills into one registry — sees per-item progress, who gifted what |

**Suggestion:** Reuse the existing `GiftStrategyPickerPage.jsx` as the entry point — add a "Create a registry" card alongside "Send a gift" so it feels like one unified gifting hub.

---

#### Gifter side (funding someone's registry)
| Page / Component | What it is |
|---|---|
| `GiftRegistryPublicPage.jsx` | The shareable link page — live wishlist, progress bars, grey-out for filled items. Works without login. |
| `GiftRegistryItemCheckoutSheet.jsx` | Bottom sheet — pick quantity, see all-in cost, pay |
| `GiftRegistryMintNumberLookup.jsx` | In-app screen — enter a MINT number, see their registry (or choose from multiple) |

---

### 4. Real-Time Live Updates (missing)

The spec says when one person funds an item, everyone else viewing that registry should see the progress bar move instantly — no refresh needed. This requires a live channel per registry event.

**Suggestion:** Use Supabase Realtime (already set up in the app for notifications). Add a subscription to the `gift_registry_items` table filtered by `gift_event_id`. When `filled_quantity` or `reserved_quantity` changes, push the delta to all connected clients.

```js
// In GiftRegistryPublicPage.jsx
supabase
  .channel(`registry:${eventId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'gift_registry_items',
    filter: `gift_event_id=eq.${eventId}`
  }, (payload) => {
    updateItemInState(payload.new);
  })
  .subscribe();
```

The client then applies this rule:
- `available == 0` → grey out, disable Gift button
- `0 < available < min_tranche` → show "Complete this gift (N left)" button
- `available >= min_tranche` → normal, show progress bar

---

### 5. Minimum Tranche Calculation (missing)

The app doesn't yet calculate the minimum number of shares a gifter must buy (R500 floor). This needs to run on every read because prices change intraday.

```js
// Reusable utility — src/lib/giftRegistryUtils.js
export function calcMinTranche(livePriceCents) {
  // R500 = 50000 cents
  return Math.ceil(50000 / livePriceCents);
}

// Remainder rule — when remaining < min_tranche
export function getItemGiftState(item) {
  const available = item.target_quantity - item.filled_quantity - item.reserved_quantity;
  if (available === 0) return { state: 'GREYED_OUT' };
  if (available < item.min_tranche_quantity) return { state: 'REMAINDER_ONLY', available };
  return { state: 'OPEN', available };
}
```

**Suggestion:** Recompute `min_tranche_quantity` on the server when serving registry items — pull live price from `securities_c.last_price` (already in the DB), divide, ceil. Store it back as a cache but always recompute on read.

---

### 6. Reservation Sweeper / Expiry Job (missing)

When someone starts checkout but abandons it, their 10-minute reservation must expire and the quantity returned to the item. Without this, items stay incorrectly greyed out.

**Suggestion:** Add to the existing Express server scheduler in `server/index.cjs` (already has AUM and EOD cron jobs):

```js
// In server/index.cjs — run every 60 seconds
cron.schedule('* * * * *', async () => {
  // Expire reservations past their TTL
  const { data: expired } = await supabase
    .from('gift_reservations')
    .update({ status: 'EXPIRED' })
    .eq('status', 'HELD')
    .lt('expires_at', new Date().toISOString())
    .select('id, registry_item_id, quantity');

  // For each expired reservation, decrement reserved_quantity on the item
  for (const r of expired ?? []) {
    await supabase.rpc('release_reservation', {
      p_item_id: r.registry_item_id,
      p_qty: r.quantity
    });
  }
});
```

---

### 7. Notifications (partially missing)

The app already fires `gift_received` and `gift_claimed` notifications. The registry needs additional notification types:

| Event | Who gets it | Message |
|---|---|---|
| Item funded | Creator | "Sipho gifted 5 MTN shares to your Birthday registry 🎁" |
| Registry completed | Creator | "Your registry is fully funded! 🎉" |
| Expiry reminder (3 days out) | Creator | "Your registry expires in 3 days — 2 items still open" |
| Registry expired | Creator | "Your Birthday registry has closed" |
| Gift received | Beneficiary (if different from creator) | "You received 5 MTN shares from Sipho 🎁" |
| Contribution receipt | Gifter | Email + in-app receipt with full cost breakdown |

**Suggestion:** Add these as new notification types to the existing `NotificationsContext.jsx` and the existing Resend email templates.

---

### 8. Public Registry Page Privacy Rules (missing)

The public page must only show:
- Beneficiary **first name only** (not full name, no ID, no email)
- Occasion and dates
- Items with progress bars and min tranche
- MINT number for gifting

It must **never** show:
- Full identity or contact details
- Other holdings outside this registry
- Other registries owned by the same person

**Suggestion:** The `GET /api/gift-registry/public/:token` endpoint should have a strict allowlist of fields it returns — never join to `users` or `holdings` tables beyond what's explicitly listed.

---

## Build Order Suggestion (Phases)

### Phase 1 — Foundation (do this first, everything depends on it)
1. Create the 4 database tables in Supabase
2. Add the atomic reservation Postgres function (`release_reservation` RPC)
3. Add the reservation sweeper cron to `server/index.cjs`
4. Build core API endpoints: create, publish, get by ID, reserve, contribute

### Phase 2 — Creator Flow
5. `GiftRegistryCreatePage.jsx` — occasion + beneficiary picker
6. `GiftRegistryBuilderPage.jsx` — add shares/baskets, set quantities
7. `GiftRegistryPreviewPage.jsx` — review + publish + copy link
8. `GiftRegistryDashboardPage.jsx` — my registries overview

### Phase 3 — Gifter Flow
9. `GiftRegistryPublicPage.jsx` — shareable public link with progress bars
10. `GiftRegistryItemCheckoutSheet.jsx` — quantity picker + payment
11. `GiftRegistryMintNumberLookup.jsx` — find a registry by MINT number

### Phase 4 — Live & Polish
12. Supabase Realtime subscription for live grey-out
13. Notification types (creator alerts, gifter receipt, expiry reminders)
14. Child/custodial beneficiary path
15. Edge cases: partial fills, price slippage buffer, stale price guard

---

## Open Decisions (needs sign-off before build)

These are marked **DECISION** in the spec and need Lonwabo + Sibusiso + Kevin to confirm before the relevant phase is built:

| # | Decision | Why it matters |
|---|---|---|
| 1 | Can a non-MINT-user gift without KYC? (guest path) | AML/FICA risk — third-party funding of securities is regulated |
| 2 | Sub-R500 final tranche allowed for "complete this gift"? | Compliance minimum investment rules |
| 3 | Execute on gift or on claim for non-KYC recipients? | Price exposure risk — who bears the price movement while in escrow? |
| 4 | Claim window for unclaimed gifts (60 days?) | What happens to the money if never claimed — refund, suspense, or redirect? |
| 5 | Reservation honoured or hard-stopped at exact expiry? | Fairness for gifter mid-checkout at the moment the registry closes |
| 6 | Share split — auto-scale target quantity or pause for creator review? | Operational and communication question |
| 7 | Standard fee, reduced fee, or no fee on gifted trades? | Must be shown clearly at payment authorisation (TCF obligation) |
| 8 | Price slippage buffer size and behaviour on gap-up beyond buffer? | Determines refund vs partial execution logic |
| 9 | Gifters may fund partial basket units, or whole units only? | Excluded in v1 per spec but needs explicit confirmation |

---

## Files to Create (Full List)

```
src/pages/
  GiftRegistryCreatePage.jsx
  GiftRegistryBuilderPage.jsx
  GiftRegistryPreviewPage.jsx
  GiftRegistryPublicPage.jsx
  GiftRegistryDashboardPage.jsx
  GiftRegistryDetailPage.jsx
  GiftRegistryMintNumberLookup.jsx

src/components/
  GiftRegistryItemCard.jsx       — single item with progress bar + grey-out
  GiftRegistryItemCheckoutSheet.jsx
  GiftRegistryProgressBar.jsx
  GiftRegistryShareSheet.jsx     — WhatsApp / email / copy link

src/lib/
  giftRegistryUtils.js           — min tranche calc, availability state, share token helpers
  useGiftRegistry.js             — data fetching hook
  useGiftRegistryRealtime.js     — Supabase Realtime subscription hook

api/gift-registry/
  create.js
  [id].js                        — GET full registry (auth)
  publish.js
  pause.js
  resume.js
  cancel.js
  items.js                       — POST add item / DELETE remove item
  reserve.js                     — ATOMIC reservation
  contribute.js                  — confirm payment
  public/[token].js              — GET public view (no auth)
  by-mint-number/[mintNumber].js
  my-registries.js
  [id]/contributions.js
```

---

## Notes for Engineers

- **Prices are in cents** throughout (`last_price` in `securities_c` is ZAp = South African cents). Do not multiply by 100 for JSE stocks — they are already in cents. See memory note on Yahoo/JSE price units.
- **Money in the registry tables** is also stored in cents (ZAp) to avoid floating-point drift.
- **Quantities are always integers** — whole shares or whole basket units only (v1 spec explicitly excludes fractional shares).
- **The atomic reservation UPDATE is the single most critical piece** — if this is done wrong (SELECT then UPDATE instead of conditional UPDATE), two gifters can oversell the same last share. Do not skip the invariant check.
- **Reuse existing infrastructure** — Supabase Realtime (already live for notifications), Resend (already live for emails), Paystack/Ozow (already live for payments). No new payment or comms providers needed.
- **Do not change `server/` directory without explicit instruction** (per user preferences in `replit.md`). The reservation sweeper cron is the only server-side addition needed in Phase 1.
