# Gift Registry — Build Plan & Suggestions

**Based on:** `MINT_GiftRegistry_Spec_1783325415113.docx` (v0.1 Draft)
**Status:** Planning — nothing built yet. Update this file before AND during build.
**Owner:** Lonwabo Damane
**Engineers:** Tsie Masilo, Lindelwa Radebe, Juan van Wyk

---

## Quick Summary of What's Building

The app already has **direct gifting** (send one share to one person by email + OTP). The Gift Registry is a completely separate, new feature — a shareable, live wishlist of shares and investments that multiple people can fund over time. **Zero of the registry is built.** Everything below needs to be created from scratch.

---

## ✅ Decisions Made (Confirmed by Lonwabo)

These are locked. Build to these rules. Do not guess or deviate.

---

### Decision 1 — No MINT number, no gifting
A gifter **must** have a MINT number to give a gift from a registry. There is no guest checkout, no anonymous gifting, no card payment without an account. Every gifter must be a signed-up, fully verified (KYC-complete) MINT user.

**What this means for build:**
- The public registry link (`/registry/:token`) shows the wishlist to anyone who opens it
- But the "Gift this" button is only enabled if the user is logged in AND KYC-complete
- If not logged in → redirect to login/signup with a message: "Sign up to gift from this registry"
- If logged in but not KYC-complete → show a message: "Complete your verification to gift"
- No guest payment flow needs to be built at all — simplifies Phase 3 significantly

---

### Decision 2 — Minimum amount = same as the app's existing minimums
The minimum a gifter must spend on each registry item matches exactly how the app already works:
- **Single share or ETF:** R10.00 minimum (same as `MIN_INVESTMENT = 1000` cents in `StockBuyPage.jsx`)
- **Strategy / basket:** Dynamic minimum based on the basket's composition — 1 share of each asset in the basket, plus the 8% cash sleeve markup (same logic as `strategyUtils.js`)

There is no separate gift-specific minimum. The registry simply enforces the same floor the normal investment flow uses. The spec's "R500 floor" mentioned in the draft is **replaced** by the app's actual minimums.

**What this means for build:**
- Reuse `MIN_INVESTMENT = 1000` (cents) for single assets
- Reuse the strategy minimum calculation from `src/lib/strategyUtils.js` for baskets
- `min_tranche_quantity` in `gift_registry_items` is computed using these same existing rules, not a hardcoded R500 floor
- The checkout sheet shows the same minimum as the normal buy flow for that asset

---

### Decision 3 — Gifters must be signed up AND fully KYC-verified
Not just signed up — **fully verified**. Same verification level required to invest on the app normally. If your KYC is pending or incomplete, you cannot gift from a registry.

**What this means for build:**
- Wrap the Gift button in the same auth + KYC guard used on the investment flows
- Reuse whatever `isKycComplete` / `onboardingComplete` check already exists in the app
- The creator of the registry must also be KYC-complete (already required to invest)

---

### Decision 4 — Unclaimed gifts follow the exact same flow as the existing direct gift
If a registry gift goes to someone who isn't on MINT yet (e.g. a non-KYC beneficiary), it follows the **same flow that already exists for direct gifts:**
- Gift is held as `pending_registration`
- Recipient gets an email with a claim link
- Recipient signs up, completes KYC, and claims
- If never claimed — the sender must manually trigger a refund (same as `api/gift/refund.js`)
- No auto-refund, no auto-release — same rules as today

**What this means for build:**
- No new unclaimed/expiry logic needed — point the registry contribution at the same `gift_claims` table and existing expiry/refund endpoints
- Price at claim time is stamped as `Expected_fill` from intraday prices — same as `api/gift/claim.js` already does

---

### Decision 5 — Mid-payment when registry expires: let them finish
If a gifter has started paying (reservation is HELD) and the registry's expiry time passes while they are in checkout — **they are allowed to complete the payment.** Their reservation is honoured until its own 10-minute TTL ends.

**What this means for build:**
- When the registry status moves to `EXPIRED`, do NOT cancel existing `HELD` reservations
- The sweeper cron only expires reservations past their own `expires_at`, not the event's `expiry_at`
- New reservations are blocked once the event is EXPIRED — only in-flight ones finish

---

### Decision 6 — Share splits / corporate actions: STILL NEEDS AN ANSWER ⚠️

**Lonwabo asked "what do you mean?" — here's the simple explanation:**

A share split is when a company decides to cut their shares into smaller pieces. Example: you own 1 Naspers share worth R3,000. Naspers does a "2-for-1 split" — now you own 2 Naspers shares each worth R1,500. Same total money, just more pieces.

**The question for the registry is:** If someone's wishlist says "I want 10 Naspers shares" (worth R30,000 total) and then Naspers does a 2-for-1 split — should the wishlist automatically update to say "I want 20 shares" (still worth R30,000)? Or should we pause the item and ask the creator to update it manually?

**Please confirm one of these:**
- **Option A:** Auto-update the quantity to keep the same rand value (20 shares after a 2-for-1 split) — smoother, no action needed from creator
- **Option B:** Pause the item and notify the creator to review it — safer, creator stays in control

*This decision doesn't block Phases 1–3. It only matters once a live corporate action hits a share on a registry, so it can be decided before Phase 4.*

---

### Decision 7 — Normal app fee applies
Gifting a share from a registry charges the **same fee as the existing gift flow on the app.** No discount, no markup, no separate gift fee. Whatever `computeFees` / `getFeeConfig` from `api/_lib/fees.js` returns for that asset — that's the fee.

**What this means for build:**
- Reuse `computeFees` from `api/_lib/fees.js` in the registry contribution endpoint
- Show the all-in cost (shares + fee) to the gifter before they confirm payment — same disclosure as the normal investment flow
- No new fee logic needed

---

### Decision 8 — Price movement: treat it exactly like normal investing
Between when the gifter sees the price and when the order actually executes on the JSE, the price can move. The registry handles this **identically to how normal investing already works on the app:**
- Price is captured from `stock_intraday_c` at the moment the gifter confirms
- That price is stamped as `Expected_fill` — same as `api/record-investment.js`
- The order goes through at market price
- Whatever the market returns is what settles — no price guarantee, no top-up, no refund for small movements
- The gifter sees "you are buying at approximately R120 per share" — same disclaimer language as the normal buy flow

**What this means for build:**
- Reuse `fetchLatestIntradayPrices` from `api/record-investment.js` at the reservation step
- Store the price in `gift_reservations.price_lock_cents` as a display reference (not a hard guarantee)
- The contribution's `executed_amount_cents` is filled in after the trade settles — same as `stock_holdings_c.Expected_fill`

---

### Decision 9 — Whole units only, same as normal app
Gifters can only buy whole shares and whole basket units — exactly as the normal investment flow works. No half units, no fractional shares.

**What this means for build:**
- `quantity` in `gift_registry_items` and `gift_contributions` is always an integer
- The quantity picker in the checkout sheet only allows whole number increments
- Basket gifting = whole basket units only (1 unit, 2 units, etc.) — same as how strategies are bought today

---

## What Needs to Be Built (Gap List)

### 1. Database Tables (nothing exists yet)

Four new tables are needed in Supabase:

#### `gift_events`
The registry itself — one row per wishlist a user creates.
```sql
CREATE TABLE gift_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id          uuid REFERENCES auth.users(id) NOT NULL,
  beneficiary_type         text CHECK (beneficiary_type IN ('SELF','CHILD','OTHER')) NOT NULL,
  beneficiary_ref          uuid,                -- account or custodial account id, nullable for non-KYC OTHER
  beneficiary_display_name text NOT NULL,       -- first name only, shown publicly
  beneficiary_mint_number  text,               -- e.g. LON...2026, nullable until resolved
  occasion                 text CHECK (occasion IN ('BIRTHDAY','WEDDING','BABY','GRADUATION','FESTIVE','CUSTOM')) NOT NULL,
  title                    text NOT NULL,       -- e.g. "Ncumolwethu turns 4"
  event_date               date NOT NULL,
  expiry_at                timestamptz NOT NULL,
  status                   text CHECK (status IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','EXPIRED','CANCELLED')) DEFAULT 'DRAFT',
  share_token              text UNIQUE NOT NULL, -- unguessable token for public link
  message                  text,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);
```
**Note:** Generate `share_token` server-side using `crypto.randomBytes(24).toString('base64url')` — never sequential, never guessable.

---

#### `gift_registry_items`
Each share/ETF/basket line on a wishlist.
```sql
CREATE TABLE gift_registry_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_event_id         uuid REFERENCES gift_events(id) ON DELETE CASCADE NOT NULL,
  isin                  text NOT NULL,
  instrument_type       text CHECK (instrument_type IN ('SHARE','ETF','BASKET')) NOT NULL,
  target_quantity       int NOT NULL CHECK (target_quantity > 0),  -- whole shares/units only
  filled_quantity       int NOT NULL DEFAULT 0,
  reserved_quantity     int NOT NULL DEFAULT 0,
  min_tranche_quantity  int,               -- recomputed on every read using app's existing MIN_INVESTMENT rules
  price_snapshot_cents  int,               -- last known price in cents (ZAp for JSE), refreshed on read
  status                text CHECK (status IN ('OPEN','PARTIALLY_FILLED','FILLED','REMOVED','SUSPENDED')) DEFAULT 'OPEN',
  display_order         int DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  -- CRITICAL INVARIANT: filled + reserved must never exceed target — enforced by atomic UPDATE (see reserve endpoint)
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
  gifter_user_id    uuid REFERENCES auth.users(id) NOT NULL,  -- always required (Decision 1 & 3: must be KYC-complete)
  quantity          int NOT NULL CHECK (quantity > 0),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  status            text CHECK (status IN ('HELD','CONSUMED','RELEASED','EXPIRED')) DEFAULT 'HELD',
  price_lock_cents  int NOT NULL,  -- intraday price captured at reservation time (for display only — Decision 8)
  created_at        timestamptz DEFAULT now()
);
```

---

#### `gift_contributions`
One row per successful payment against a registry item.
```sql
CREATE TABLE gift_contributions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_item_id      uuid REFERENCES gift_registry_items(id) NOT NULL,
  gifter_user_id        uuid REFERENCES auth.users(id) NOT NULL,  -- always set (Decision 1 & 3)
  gifter_email          text NOT NULL,
  quantity              int NOT NULL,                -- whole shares/units only (Decision 9)
  quoted_amount_cents   int NOT NULL,               -- all-in shown to gifter at checkout (shares + fee)
  executed_amount_cents int,                        -- actual cost after market execution (Expected_fill based)
  fee_cents             int,                        -- fee portion, computed via computeFees() (Decision 7)
  status                text CHECK (status IN (
    'INITIATED','RESERVED','PAID','EXECUTING','SETTLED','REFUNDED','FAILED','RESERVATION_EXPIRED'
  )) DEFAULT 'INITIATED',
  reservation_id        uuid REFERENCES gift_reservations(id),
  payment_ref           text,                       -- Paystack / Ozow reference
  order_ref             text,                       -- broker / OMS order reference
  idempotency_key       text UNIQUE NOT NULL,       -- prevents duplicate submissions
  created_at            timestamptz DEFAULT now()
);
```

---

### 2. API Endpoints (all missing)

All new endpoints live under `api/gift-registry/` — separate from the existing `api/gift/` which stays untouched.

| Endpoint | What it does |
|---|---|
| `POST /api/gift-registry/create` | Create a new registry (DRAFT status) |
| `PUT /api/gift-registry/:id` | Edit title, occasion, expiry, message |
| `POST /api/gift-registry/:id/publish` | DRAFT → ACTIVE, generate share_token |
| `POST /api/gift-registry/:id/pause` | ACTIVE → PAUSED |
| `POST /api/gift-registry/:id/resume` | PAUSED → ACTIVE |
| `POST /api/gift-registry/:id/cancel` | ACTIVE/PAUSED → CANCELLED, release HELD reservations |
| `GET /api/gift-registry/:id` | Full registry with live item state (auth required) |
| `GET /api/gift-registry/public/:token` | Public view via share_token — no auth required to VIEW, but auth required to GIFT |
| `GET /api/gift-registry/by-mint-number/:mintNumber` | Lookup all active registries for a MINT number |
| `POST /api/gift-registry/items` | Add an item to a registry |
| `DELETE /api/gift-registry/items/:itemId` | Remove an item |
| `POST /api/gift-registry/reserve` | **Atomic reservation** — the critical anti-oversell step |
| `POST /api/gift-registry/contribute` | Confirm payment, move reservation → PAID → EXECUTING |
| `GET /api/gift-registry/my-registries` | Creator sees all their registries |
| `GET /api/gift-registry/:id/contributions` | Creator sees who gifted what |

---

#### The atomic reservation — most critical endpoint in the whole feature

This is the part that prevents two people buying the same last share at the same millisecond. It uses a single conditional database UPDATE — not a SELECT then UPDATE — so only one person can ever win:

```js
// api/gift-registry/reserve.js
// Step 1: Auth check — must be logged in AND KYC-complete (Decision 1 & 3)
// Step 2: Fetch live price from stock_intraday_c (same as fetchLatestIntradayPrices in record-investment.js)
// Step 3: Validate quantity >= min_tranche_quantity (using app's MIN_INVESTMENT rules — Decision 2)
// Step 4: Atomic reserve:

const { data, error } = await supabase.rpc('atomic_reserve_registry_item', {
  p_item_id: itemId,
  p_qty: quantity,
  p_gifter_user_id: userId,
  p_price_cents: livePriceCents,
  p_ttl_minutes: 10
});
// Returns reservation id if successful, null if sold out
// If null → return typed error, client offers remaining quantity or next open item
```

```sql
-- Postgres function: atomic_reserve_registry_item
CREATE OR REPLACE FUNCTION atomic_reserve_registry_item(
  p_item_id uuid, p_qty int, p_gifter_user_id uuid, p_price_cents int, p_ttl_minutes int DEFAULT 10
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_reservation_id uuid;
BEGIN
  -- Atomic conditional update — zero rows = sold out
  UPDATE gift_registry_items
     SET reserved_quantity = reserved_quantity + p_qty,
         updated_at = now()
   WHERE id = p_item_id
     AND status IN ('OPEN','PARTIALLY_FILLED')
     AND (filled_quantity + reserved_quantity + p_qty) <= target_quantity;

  IF NOT FOUND THEN RETURN NULL; END IF;  -- sold out

  INSERT INTO gift_reservations (registry_item_id, gifter_user_id, quantity, expires_at, price_lock_cents)
  VALUES (p_item_id, p_gifter_user_id, p_qty, now() + (p_ttl_minutes || ' minutes')::interval, p_price_cents)
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;
```

---

#### Minimum tranche calculation — uses app's existing rules (Decision 2)

```js
// src/lib/giftRegistryUtils.js

const MIN_INVESTMENT_CENTS = 1000; // R10.00 — same as StockBuyPage.jsx

// Single share or ETF
export function calcMinTrancheForAsset(livePriceCents) {
  return Math.ceil(MIN_INVESTMENT_CENTS / livePriceCents);
}

// Basket/strategy — reuse existing strategy minimum logic from strategyUtils.js
export { calcStrategyMinimum } from './strategyUtils';

// What state is the item in right now?
export function getItemGiftState(item) {
  const available = item.target_quantity - item.filled_quantity - item.reserved_quantity;
  const min = item.min_tranche_quantity ?? 1;
  if (available === 0)    return { state: 'GREYED_OUT', available: 0 };
  if (available < min)    return { state: 'REMAINDER_ONLY', available };
  return { state: 'OPEN', available };
}
```

---

### 3. Frontend Pages (all missing)

#### Creator side
| Page | What it does |
|---|---|
| `GiftRegistryCreatePage.jsx` | Pick occasion, beneficiary (self / child / other), event date, expiry date, optional message |
| `GiftRegistryBuilderPage.jsx` | Search shares/ETFs/baskets, add to list, set target quantity per item, reorder |
| `GiftRegistryPreviewPage.jsx` | Review everything before publishing. Shows share link. WhatsApp / copy / email share options |
| `GiftRegistryDashboardPage.jsx` | All my registries — status, progress at a glance |
| `GiftRegistryDetailPage.jsx` | Drill into one registry — per-item progress bars, list of who gifted what |

**Suggestion:** Add "Create a registry" as a new card on the existing `GiftStrategyPickerPage.jsx` alongside "Send a gift" — keeps gifting in one place.

---

#### Gifter side
| Page | What it does |
|---|---|
| `GiftRegistryPublicPage.jsx` | The shareable link page. Live wishlist, progress bars, grey-out for completed items. Anyone can VIEW. Only KYC-complete MINT users can GIFT (Decision 1 & 3) |
| `GiftRegistryItemCheckoutSheet.jsx` | Bottom sheet — pick quantity (whole numbers only), shows live price + fee (same fee as app — Decision 7), confirms all-in cost |
| `GiftRegistryMintNumberLookup.jsx` | In-app — type a MINT number, see their active registries, choose one |

---

### 4. Real-Time Live Updates (missing)

When one person funds an item, everyone else viewing the same registry sees the progress bar move instantly without refreshing. Uses Supabase Realtime — already running in the app for notifications.

```js
// src/lib/useGiftRegistryRealtime.js
export function useGiftRegistryRealtime(eventId, onItemUpdate) {
  useEffect(() => {
    const channel = supabase
      .channel(`registry:${eventId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'gift_registry_items',
        filter: `gift_event_id=eq.${eventId}`
      }, (payload) => onItemUpdate(payload.new))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [eventId]);
}
```

Client display rule:
- `available === 0` → grey out, disable Gift button
- `0 < available < min_tranche` → "Complete this gift (N left)" button — one all-or-nothing action
- `available >= min_tranche` → normal, show progress bar + Gift button

---

### 5. Reservation Sweeper Cron (missing)

When someone starts checkout but abandons it, their 10-minute hold must expire and the quantity returned to the item. Add to existing scheduler in `server/index.cjs` (already has AUM and EOD cron jobs — do not restructure, just add):

```js
// server/index.cjs — add alongside existing cron jobs
// Runs every 60 seconds — releases expired gift registry reservations
cron.schedule('* * * * *', async () => {
  const { data: expired } = await supabase
    .rpc('release_expired_registry_reservations');
  if (expired?.length) {
    console.log(`[gift-registry] Released ${expired.length} expired reservations`);
  }
});
```

```sql
-- Postgres function: release_expired_registry_reservations
CREATE OR REPLACE FUNCTION release_expired_registry_reservations()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_count int := 0;
BEGIN
  -- Expire the reservations
  UPDATE gift_reservations SET status = 'EXPIRED'
   WHERE status = 'HELD' AND expires_at < now()
  RETURNING id; -- count via GET DIAGNOSTICS

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Release the reserved_quantity back on each item
  UPDATE gift_registry_items gri
     SET reserved_quantity = GREATEST(0, reserved_quantity - sub.qty),
         updated_at = now()
    FROM (
      SELECT registry_item_id, SUM(quantity) as qty
        FROM gift_reservations
       WHERE status = 'EXPIRED' AND expires_at < now() + interval '1 minute'
       GROUP BY registry_item_id
    ) sub
   WHERE gri.id = sub.registry_item_id;

  RETURN v_count;
END;
$$;
```

**Note per Decision 5:** This sweeper does NOT expire reservations just because the event expired — it only expires them when their own 10-minute TTL is up. Mid-payment gifters always get their full 10 minutes.

---

### 6. Notifications (partially missing)

The app already fires `gift_received` and `gift_claimed`. Add these new types for the registry:

| Event | Who gets it | Message |
|---|---|---|
| Item funded | Creator | "Sipho gifted 5 MTN shares to your Birthday registry 🎁" |
| Registry completed | Creator | "Your registry is fully funded! 🎉" |
| Expiry reminder (3 days out) | Creator | "Your registry expires in 3 days — 2 items still open" |
| Registry expired | Creator | "Your Birthday registry has closed" |
| Gift received | Beneficiary (if different from creator) | "You received 5 MTN shares from Sipho 🎁" |
| Contribution receipt | Gifter | Email + in-app receipt with shares bought, rand cost, fee breakdown |

Reuse existing `NotificationsContext.jsx` and Resend email templates — just add new notification types.

---

### 7. Public Page Privacy Rules

The public page (`/registry/:token`) shows only:
- Beneficiary **first name only**
- Occasion and dates
- Items with live progress bars and minimum tranche
- MINT number for gifting
- "Gift this" button (only active if logged in + KYC-complete — Decision 1 & 3)

It **never** shows:
- Full name, ID, email, or any personal details
- Holdings or investments outside this registry
- Other registries owned by the same person

The `GET /api/gift-registry/public/:token` endpoint must have a strict allowlist — never join to `users` or `holdings` tables beyond what is explicitly listed above.

---

## Build Order (Phases)

### Phase 1 — Foundation 🧱 *(do this first, everything depends on it)*
1. Create 4 database tables in Supabase
2. Create the two Postgres RPC functions (`atomic_reserve_registry_item`, `release_expired_registry_reservations`)
3. Add reservation sweeper cron to `server/index.cjs`
4. Build core API endpoints: create, publish, get by ID, reserve, contribute

### Phase 2 — Creator Flow 🏗️
5. `GiftRegistryCreatePage.jsx`
6. `GiftRegistryBuilderPage.jsx`
7. `GiftRegistryPreviewPage.jsx`
8. `GiftRegistryDashboardPage.jsx`
9. Add "Create a registry" entry point on `GiftStrategyPickerPage.jsx`

### Phase 3 — Gifter Flow 🎁
10. `GiftRegistryPublicPage.jsx` (with auth/KYC gate on Gift button)
11. `GiftRegistryItemCheckoutSheet.jsx`
12. `GiftRegistryMintNumberLookup.jsx`

### Phase 4 — Live & Polish ✨
13. Supabase Realtime hook (`useGiftRegistryRealtime.js`)
14. Wire real-time updates into `GiftRegistryPublicPage.jsx`
15. Notification types (creator alerts, gifter receipt, expiry reminders)
16. Child/custodial beneficiary path
17. Corporate actions handling (pending Decision 6 answer)

---

## One Open Decision Remaining ⚠️

| # | Decision | Options |
|---|---|---|
| 6 | Share split — auto-update wishlist quantity or pause for creator review? | ✅ **Option B confirmed:** Pause the item, notify the creator to review and update it manually. Do not auto-scale. |

*Handle in Phase 4. When a corporate action (split/consolidation) is detected on an instrument that appears in an active registry item, set that item's status to `SUSPENDED`, fire a notification to the creator, and wait for them to update the target quantity and resume the item.*

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
  GiftRegistryItemCard.jsx            — single wishlist item with progress bar + grey-out state
  GiftRegistryItemCheckoutSheet.jsx   — quantity picker + fee disclosure + pay button
  GiftRegistryProgressBar.jsx         — reusable progress bar component
  GiftRegistryShareSheet.jsx          — WhatsApp / email / copy link

src/lib/
  giftRegistryUtils.js                — min tranche calc, availability state, share token helpers
  useGiftRegistry.js                  — data fetching hook for registry + items
  useGiftRegistryRealtime.js          — Supabase Realtime subscription hook

api/gift-registry/
  create.js
  [id].js                             — GET full registry (auth required)
  publish.js
  pause.js
  resume.js
  cancel.js
  items.js                            — POST add / DELETE remove item
  reserve.js                          — ATOMIC reservation (most critical)
  contribute.js                       — confirm payment → PAID → EXECUTING
  public/[token].js                   — GET public view (view: no auth | gift: KYC required)
  by-mint-number/[mintNumber].js
  my-registries.js
  [id]/contributions.js
```

---

## Important Notes for Engineers

- **Prices are in cents** throughout. `last_price` in `securities_c` is ZAp (South African cents). Do NOT multiply by 100 for JSE stocks. See memory note on Yahoo/JSE price units.
- **Money in registry tables** is stored in cents to avoid floating-point drift.
- **Quantities are always integers** — whole shares/units only (Decision 9).
- **The atomic reservation Postgres function is the single most critical piece** — if done as SELECT then UPDATE instead of a conditional UPDATE, two gifters can oversell the same last share. Use the RPC function above exactly.
- **Reuse existing infrastructure** — `computeFees` from `api/_lib/fees.js` (Decision 7), `fetchLatestIntradayPrices` logic from `api/record-investment.js` (Decision 8), `strategyUtils.js` minimums (Decision 2), Supabase Realtime, Resend, Paystack/Ozow. No new providers needed.
- **Do not restructure `server/index.cjs`** — only add the new cron job alongside existing ones (per user preferences in `replit.md`).
- **Do not touch `api/gift/`** — existing direct gift flow is separate and stays untouched.
- **Phase 4 corporate actions handling** depends on Decision 6 — do not guess, wait for Lonwabo's answer.
