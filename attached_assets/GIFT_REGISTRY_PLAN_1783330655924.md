# Gift Registry — Build Plan & Suggestions

**Based on:** `MINT_GiftRegistry_Spec_1783325415113.docx` (v0.1 Draft)
**Status:** Phases 1-3 built. UI/UX redesign locked below.
**Owner:** Lonwabo Damane
**Engineers:** Tsie Masilo, Lindelwa Radebe, Juan van Wyk

---

## Quick Summary of What's Building

The app already has **direct gifting** (send one share to one person by email + OTP). The Gift Registry is a completely separate, new feature — a shareable, live wishlist of shares and investments that multiple people can fund over time.

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

### Decision 2 — Minimum gift = app minimum
Use the same minimum as the main buy flow. For individual shares/ETFs: `MIN_INVESTMENT = 1000` cents (R10). For baskets: use `strategyUtils.js` `calculateMinInvestmentSync`. No separate minimum for the registry.

---

### Decision 3 — Gifter must be KYC complete ✅ (confirmed above in Decision 1)

---

### Decision 4 — Unclaimed gifts use existing gift_claims flow
When a gifter completes payment, the contribution is recorded. No new claim mechanism. The existing `gift_claims` table and flow handles redemption on the beneficiary side.

---

### Decision 5 — No mid-payment cancellation on event expiry
If a reservation is HELD (mid-payment, 10-min window) when the event expires, the sweeper does NOT cancel that reservation. The sweeper only acts on its own TTL. The user completes or times out naturally.

---

### Decision 6 — Corporate actions: pause item + notify creator (Phase 4)
If a stock in a registry undergoes a corporate action (split, rights issue etc.), the item is paused and the creator is notified. This is Phase 4 only.

---

### Decision 7 — Fees via existing computeFees
Use `computeFees` from `api/_lib/fees.js`. Do not build a separate fee calculator.

---

### Decision 8 — Price at confirmation, market order
Price is fetched from `stock_intraday_c` at the moment of confirmation. Stamped as `Expected_fill`. Market order. No price guarantee.

---

### Decision 9 — Whole units only
All quantities throughout the registry are whole integers. No fractional shares.

---

## ✅ UI/UX Design Decisions (Locked July 2026)

### Decision UI-1 — Bottom Sheet, not a full page, for registry creation
The "Create a Registry" wizard is a **bottom sheet** (same portal + spring-animation pattern as `AdultInvestModal`), not a full-page route. It is triggered by a wishlist icon button in the Gift a Basket page header — not a banner card in the basket list.

**What this means:**
- Remove the "Create a Gift Registry" banner card from the basket scroll list
- Add a `BookMarked` icon button to the right side of the Gift a Basket header (alongside the search icon)
- The sheet slides up over the current page (no page nav)
- On completion → navigate to the Builder page as before

### Decision UI-2 — No emojis anywhere
Replace all emoji usage with Lucide React icons. Occasion cards use icon + label layout. No 🎂🎓💍 anywhere.

**Occasion icons (Lucide):**
- Birthday → `Cake`
- Wedding → `Heart`
- New Baby → `Baby`
- Graduation → `GraduationCap`
- Festive → `Sparkles`
- Custom → `PenLine`

### Decision UI-3 — No culturally specific placeholder text
Remove `e.g. Ncumolwethu` from any input placeholder. Use neutral copy:
- Name field: `"First name only"`
- Title field: auto-generates from name + occasion (shown as placeholder)

### Decision UI-4 — Custom date picker, no native `<input type="date">`
Both "Event date" and "Registry closes" use a custom inline calendar component (month grid, prev/next arrows). Past days are greyed and unselectable. The "closes" field defaults to smart duration pills (+7 days, +14 days, +1 month, +2 months) calculated from the event date, with a Custom option showing a second calendar.

### Decision UI-5 — Sheet content matches app's glass/slate visual language
- Sheet background: white, `rounded-t-[28px]`
- Gradient accent strip at top (violet → indigo)
- Drag handle pill
- Input fields: `bg-slate-50 border-slate-200 rounded-2xl` with violet focus ring
- Buttons: `bg-[#6B21A8] rounded-2xl`
- Occasion cards: icon-centered 2×3 grid, selected state: violet border + tint
- No flat-list layout — use grid/card metaphor throughout

---

## Phase 1 — Infrastructure ✅ DONE

### Database (4 new tables, auto-created at server start via pgPool + NOTIFY pgrst)

> ⚠️ Tables must also be run manually in **Supabase Dashboard → SQL Editor** on first deploy.
> pgPool creates them but Supabase's PostgREST schema cache needs the direct creation.

**gift_events** — one row per registry event  
**gift_registry_items** — one row per share/ETF on the wishlist  
**gift_reservations** — 10-min hold while gifter is in checkout  
**gift_contributions** — one row per completed payment  

### Server wiring
- `server/giftRegistryRoutes.cjs` — all routes + migration + sweeper
- `server/index.cjs` — require + ensureGiftRegistryTables + cron + registerGiftRegistryRoutes

---

## Phase 2 — Creator flow ✅ DONE

### Pages
- `GiftRegistryDashboardPage` — list all my registries
- `GiftRegistryCreateSheet` — **bottom sheet** 3-step wizard (replaces GiftRegistryCreatePage full-page)
- `GiftRegistryBuilderPage` — add/remove shares
- `GiftRegistryPreviewPage` — preview + publish + share
- `GiftRegistryDetailPage` — owner view (per-item progress, contributions, pause/resume/cancel)

---

## Phase 3 — Gifter flow ✅ DONE

### Pages / components
- `GiftRegistryPublicPage` — public shareable page (auth/KYC gate)
- `GiftRegistryItemCheckoutSheet` — bottom sheet checkout (quantity, fees, reserve → confirm)
- `GiftRegistryMintNumberLookup` — search by MINT number
- `useGiftRegistryRealtime` — Supabase Realtime live progress updates

---

## Phase 4 — Notifications + corporate actions (NOT YET BUILT)

- Creator notified when an item is fully funded
- Creator notified when registry expires with unfunded items
- Corporate action handler: pause item + notify creator (Decision 6)
- Push notification deep-links to `/registry/:token`

---

## Entry Points

| Surface | How to reach |
|---|---|
| Gift a Basket page | `BookMarked` icon button in header → `GiftRegistryCreateSheet` |
| Gift a Basket page | After creating → `GiftRegistryBuilderPage` |
| App.jsx routing | `giftRegistryDashboard`, `giftRegistryBuilder`, `giftRegistryPreview`, `giftRegistryDetail`, `giftRegistryPublic`, `giftRegistryLookup` |
| WhatsApp/share link | `/registry/:token` → `giftRegistryPublic` |
| MINT number lookup | `giftRegistryLookup` |

---

## API Routes (Express dev / Vercel prod)

```
POST   /api/gift-registry/create
GET    /api/gift-registry/my-registries
GET    /api/gift-registry/:id
POST   /api/gift-registry/items
DELETE /api/gift-registry/items/:itemId
POST   /api/gift-registry/reserve         ← ATOMIC — do not change to SELECT+UPDATE
POST   /api/gift-registry/contribute      ← ATOMIC transaction (reservation+item+contribution)
GET    /api/gift-registry/public/:token
GET    /api/gift-registry/by-mint-number/:mintNumber
GET    /api/gift-registry/:id/contributions
POST   /api/gift-registry/:id/publish
POST   /api/gift-registry/:id/pause
POST   /api/gift-registry/:id/resume
POST   /api/gift-registry/:id/cancel
```

---

## Important Notes for Engineers

- **Prices are in cents** throughout. `last_price` in `securities_c` is ZAp (South African cents). Do NOT multiply by 100 for JSE stocks.
- **Money in registry tables** is stored in cents to avoid floating-point drift.
- **Quantities are always integers** — whole shares/units only (Decision 9).
- **The atomic reservation is the single most critical piece** — conditional UPDATE before INSERT, inside a pgPool transaction. Do not convert to SELECT then UPDATE.
- **Contribute endpoint** is a single pgPool transaction: consume reservation + update item + insert contribution. Do not split.
- **Reuse existing infrastructure** — `computeFees`, `strategyUtils.js`, Supabase Realtime, Resend, Paystack/Ozow.
- **Do not restructure `server/index.cjs`** — only add alongside existing patterns.
- **Do not touch `api/gift/`** — existing direct gift flow is separate.
- **Phase 4 corporate actions** depends on Decision 6 — do not build until confirmed.
