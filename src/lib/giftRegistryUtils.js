/**
 * Gift Registry utilities
 * Prices are in cents (ZAp for JSE). See memory: securities_c.last_price is cents.
 * Quantities are always whole integers (Decision 9).
 */

export const MIN_INVESTMENT_CENTS = 1000; // R10.00 — matches StockBuyPage.jsx

/**
 * Minimum whole-share quantity for a single share/ETF.
 * Uses the same R10 floor as the normal buy flow (Decision 2).
 */
export function calcMinTrancheForAsset(livePriceCents) {
  if (!livePriceCents || livePriceCents <= 0) return 1;
  return Math.max(1, Math.ceil(MIN_INVESTMENT_CENTS / livePriceCents));
}

/**
 * Availability state of a registry item.
 * Returns { state, available } — drives UI grey-out and button copy.
 *
 * Visual state (GREYED_OUT / REMAINDER_ONLY / OPEN) is based solely on
 * filled_quantity — items in someone else's checkout (reserved_quantity > 0)
 * should still appear OPEN so multiple people can tap "Gift This".
 * The backend's optimistic lock on /api/gift-registry/reserve ensures only
 * one buyer wins at payment time; everyone else gets a friendly SOLD_OUT.
 *
 * `available` accounts for active reservations so the checkout sheet knows
 * the real remaining capacity when it calls the reserve API.
 */
export function getItemGiftState(item) {
  // How many shares are genuinely unfilled (actual purchases only)
  const filledRemaining =
    (item.target_quantity ?? 0) - (item.filled_quantity ?? 0);
  // Real remaining after subtracting active checkout holds
  const realAvailable = Math.max(
    0,
    filledRemaining - (item.reserved_quantity ?? 0)
  );
  const min = item.min_tranche_quantity ?? 1;

  // Fully purchased → grey out
  if (filledRemaining <= 0) return { state: "GREYED_OUT", available: 0 };
  // Unfilled remainder too small to gift at minimum tranche → grey out
  if (filledRemaining < min) return { state: "REMAINDER_ONLY", available: realAvailable };
  return { state: "OPEN", available: realAvailable };
}

/**
 * Percent funded for a progress bar (0–100).
 */
export function getItemFillPercent(item) {
  if (!item.target_quantity || item.target_quantity === 0) return 0;
  return Math.min(
    100,
    Math.round(((item.filled_quantity ?? 0) / item.target_quantity) * 100)
  );
}

/**
 * Total registry funding progress across all items.
 * Returns { funded, total, percent }.
 */
export function getRegistryProgress(items = []) {
  const total = items.reduce((s, i) => s + (i.target_quantity ?? 0), 0);
  const funded = items.reduce((s, i) => s + (i.filled_quantity ?? 0), 0);
  const percent = total > 0 ? Math.round((funded / total) * 100) : 0;
  return { funded, total, percent };
}

/** Cents → "R 120.00" display string */
export function centsToRand(cents) {
  if (cents == null) return "R 0.00";
  return `R ${(cents / 100).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Occasion display labels (no emoji — icons are rendered per component) */
export const OCCASION_LABELS = {
  BIRTHDAY:   "Birthday",
  WEDDING:    "Wedding",
  BABY:       "New Baby",
  GRADUATION: "Graduation",
  FESTIVE:    "Festive Season",
  CUSTOM:     "Custom",
};

/** Status badge colour/label map */
export const REGISTRY_STATUS_META = {
  DRAFT:     { label: "Draft",     color: "bg-gray-200 text-gray-600" },
  ACTIVE:    { label: "Active",    color: "bg-green-100 text-green-700" },
  PAUSED:    { label: "Paused",    color: "bg-yellow-100 text-yellow-700" },
  COMPLETED: { label: "Completed", color: "bg-purple-100 text-purple-700" },
  EXPIRED:   { label: "Expired",   color: "bg-red-100 text-red-600" },
  CANCELLED: { label: "Cancelled", color: "bg-gray-100 text-gray-500" },
};

/**
 * Generate a registry share URL from a token.
 * Always produces an app.mymint.co.za URL in production,
 * and a mint-development.vercel.app URL in all other environments
 * (Replit dev, localhost, staging, etc.) so QR codes are always scannable
 * from outside the Replit preview sandbox.
 */
export function registryShareUrl(token) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const isLive = origin === "https://app.mymint.co.za";
  const base = isLive
    ? "https://app.mymint.co.za"
    : "https://mint-development.vercel.app";
  return `${base}/registry/${token}`;
}
