import { supabase } from "./supabase.js";

/*
 * DB-backed "seen once, ever" gate for one-time tutorial animations.
 *
 * Why: these tutorials used to gate purely on localStorage, which is per-
 * browser/per-device and gets cleared — so the same user saw them again and
 * again. The source of truth is now the `animation` table (one row per
 * user_id + animation_key). localStorage is kept ONLY as a synchronous fast
 * cache so a repeat visitor never sees a flash of the animation before the DB
 * round-trip resolves.
 *
 * Fail-open: if the table doesn't exist yet or the read fails, we treat the
 * animation as "not seen" (it plays), exactly as before — so this is safe to
 * ship before the SQL migration is run.
 */

const isTruthyFlag = (v) => v === "true" || v === "1";

export async function hasSeenAnimation(key, localStorageKey) {
  // Fast path — local cache (covers users who saw it before the table existed).
  try {
    if (localStorageKey && isTruthyFlag(localStorage.getItem(localStorageKey))) return true;
  } catch {}

  try {
    if (!supabase?.auth) return false;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data, error } = await supabase
      .from("animation")
      .select("id")
      .eq("user_id", user.id)
      .eq("animation_key", key)
      .maybeSingle();
    if (error) return false; // fail-open (e.g. table not created yet)
    const seen = !!data;
    if (seen && localStorageKey) { try { localStorage.setItem(localStorageKey, "true"); } catch {} }
    return seen;
  } catch {
    return false;
  }
}

export async function markAnimationSeen(key, localStorageKey) {
  // Cache locally first so the current session is instantly gated.
  if (localStorageKey) { try { localStorage.setItem(localStorageKey, "true"); } catch {} }

  try {
    if (!supabase?.auth) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("animation")
      .upsert(
        { user_id: user.id, animation_key: key },
        { onConflict: "user_id,animation_key", ignoreDuplicates: true }
      );
  } catch {
    /* best-effort — localStorage already gates the current device */
  }
}
