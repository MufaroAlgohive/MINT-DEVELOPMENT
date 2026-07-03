# Admin Preview Mode — Mint App Changes

## What this does
When an admin opens a client's profile from the CRM (via "Open as [Name] in Mint"), the CRM generates a magic link that includes `?admin_preview=1` in the URL. The changes below make the Mint app detect that flag and disable all transactional buttons — invest, gift, save goal, edit goal, add/delete child, refund, cancel — while keeping the full app navigable and viewable.

---

## TASK FOR REPLIT AGENT

Apply the following changes to this codebase. Read each file listed, make only the changes described, and do not alter anything else.

---

## 1. CREATE this new file

**File path:** `lib/adminPreview.ts`  
(If your project uses `.js` files instead of `.ts`, save it as `lib/adminPreview.js` and remove the type annotations)

```ts
/**
 * Admin Preview Mode
 *
 * When the Mint CRM opens a client session via impersonation, it appends
 * ?admin_preview=1 to the magic link redirect URL.
 *
 * initAdminPreview() — call once on app load. Detects the flag in the URL
 *   and saves it to localStorage so it survives client-side navigation.
 *
 * isAdminPreview() — call in any component to check if this is a read-only
 *   admin session. Returns true when the admin preview flag is active.
 *
 * clearAdminPreview() — call on sign-out to clean up the flag so a real
 *   client logging in on the same browser gets a normal session.
 */

export function initAdminPreview(): void {
  if (typeof window === 'undefined') return;
  if (new URLSearchParams(window.location.search).has('admin_preview')) {
    localStorage.setItem('mint_admin_preview', '1');
  }
}

export function isAdminPreview(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('mint_admin_preview') === '1';
}

export function clearAdminPreview(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('mint_admin_preview');
  }
}
```

---

## 2. EDIT the root layout or `_app` file

**File to find:** `app/layout.tsx` OR `pages/_app.tsx` — whichever exists in this project.

**Add this near the top of the file (with other imports):**
```ts
import { initAdminPreview } from '@/lib/adminPreview';
```

**Add this inside the root component (inside a `useEffect` that runs once):**
```ts
useEffect(() => {
  initAdminPreview();
}, []);
```

If there is already a `useEffect` that runs on mount (empty dependency array `[]`), add the `initAdminPreview()` call inside that existing one instead of creating a duplicate.

---

## 3. EDIT the sign-out / logout function

**File to find:** Search the codebase for `signOut` or `logout` — find the function that signs the user out of Supabase (likely calls `supabase.auth.signOut()`).

**Add this import at the top of that file:**
```ts
import { clearAdminPreview } from '@/lib/adminPreview';
```

**Add this line immediately before or after the signOut call:**
```ts
clearAdminPreview();
```

---

## 4. DISABLE the invest / purchase button

**File to find:** Search the codebase for the component that renders the "Choose a method" modal or the invest/purchase confirmation flow. Look for text like `"Choose a method"`, `"Invest"`, `"Purchase"`, or `"Buy"` in JSX files.

**Add this import:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add this inside the component:**
```ts
const readOnly = isAdminPreview();
```

**On every button that submits/confirms an investment or method selection, add:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

**If the options are rendered as a list/cards (e.g. EFT, Card, Wallet), wrap them like this:**
```tsx
<div className={readOnly ? 'opacity-40 pointer-events-none select-none' : ''}>
  {/* existing method options here */}
</div>
```

---

## 5. DISABLE the gift invest button

**File to find:** Search for the gift screen component — look for text like `"Send a gift"`, `"Gift"`, or `"Invest as gift"` in JSX files.

**Add this import:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add inside the component:**
```ts
const readOnly = isAdminPreview();
```

**On the gift invest/send button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

---

## 6. DISABLE save/edit goal buttons

**File to find:** Search for the goal creation and goal editing components — look for `"Save goal"`, `"Create goal"`, `"Update goal"`, or `"Edit goal"` in JSX files.

**Add this import to each file:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add inside each component:**
```ts
const readOnly = isAdminPreview();
```

**On the Save / Update / Create Goal button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

**On goal input fields (to make them uneditable):**
```tsx
readOnly={readOnly}
className={readOnly ? 'pointer-events-none opacity-60' : ''}
```

---

## 7. DISABLE add child and delete child buttons

**File to find:** Search for the child account component — look for `"Add child"`, `"Create child"`, `"Minor"`, or `"Delete child"` in JSX files.

**Add this import:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add inside the component:**
```ts
const readOnly = isAdminPreview();
```

**On the Add Child button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

**On the Delete / Remove Child button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

---

## 8. DISABLE refund and cancel buttons

**File to find:** Search for transaction detail or order management components — look for `"Refund"`, `"Cancel order"`, or `"Cancel investment"` in JSX files.

**Add this import:**
```ts
import { isAdminPreview } from '@/lib/adminPreview';
```

**Add inside the component:**
```ts
const readOnly = isAdminPreview();
```

**On the Refund button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

**On the Cancel button:**
```tsx
disabled={readOnly}
className={readOnly ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''}
```

---

## Summary of all files to change

| Action | File |
|---|---|
| Create new file | `lib/adminPreview.ts` |
| Call `initAdminPreview()` on app load | `app/layout.tsx` or `pages/_app.tsx` |
| Call `clearAdminPreview()` on sign-out | Wherever `supabase.auth.signOut()` is called |
| Disable invest/purchase buttons | Component with "Choose a method" / invest flow |
| Disable gift invest button | Gift screen component |
| Disable save/edit goal buttons | Goal creation + goal editing components |
| Disable add/delete child buttons | Child account component |
| Disable refund/cancel buttons | Transaction detail / order component |

---

## How to verify it worked

1. Open the Mint CRM admin portal
2. Go to Studio, open any client with "Open as [Name] in Mint"
3. In the phone preview, navigate to the invest tab — the "Choose a method" options should be grayed out and unclickable
4. Navigate to goals — Save/Edit buttons should be grayed out
5. Navigate to gifting — the invest/send button should be grayed out
6. Navigate to child accounts — Add and Delete buttons should be grayed out
7. Scrolling, tab switching, viewing factsheets, PDFs, transaction history — all should work normally
