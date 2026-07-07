/**
 * Lightweight utility functions for the gift-registry feature.
 * Keep this file free of heavy imports — it is used by multiple pages.
 */

export const OCCASION_LABELS = {
  birthday:    "Birthday",
  wedding:     "Wedding",
  baby_shower: "Baby Shower",
  graduation:  "Graduation",
  anniversary: "Anniversary",
  christmas:   "Christmas",
  other:       "Other",
};

/**
 * Returns { funded, total, pct } for a list of registry items.
 */
export function getRegistryProgress(items = []) {
  const active = items.filter(i => i.status !== "REMOVED");
  const total   = active.reduce((s, i) => s + (i.target_quantity  || 0), 0);
  const funded  = active.reduce((s, i) => s + (i.filled_quantity  || 0), 0);
  const pct     = total > 0 ? Math.min(100, Math.round((funded / total) * 100)) : 0;
  return { funded, total, pct };
}

/**
 * Convert cents to a rand display string.
 */
export function centsToRand(cents) {
  if (cents == null) return "R0.00";
  return `R${(cents / 100).toFixed(2)}`;
}

/**
 * Generate a registry share URL from a token.
 * Always produces an app.mymint.co.za URL in production,
 * and a mint-development.vercel.app URL in all other environments
 * (localhost, Replit dev, staging, etc.).
 */
export function registryShareUrl(token) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const isLive = origin === "https://app.mymint.co.za";
  const base = isLive
    ? "https://app.mymint.co.za"
    : "https://mint-development.vercel.app";
  return `${base}/registry/${token}`;
}
