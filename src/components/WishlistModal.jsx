import React, { useState } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Heart, ArrowRight, List } from "lucide-react";

const STORAGE_KEY = "mint_wishlists";

// ─── Auth token helper ────────────────────────────────────────────────────────
async function getAuthToken() {
  try {
    const { supabaseReady } = await import("../lib/supabase.js");
    const sb = await supabaseReady;
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

// ─── Local cache (sync) ───────────────────────────────────────────────────────
export function getWishlists() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    return parsed;
  } catch (e) {
    console.error("[wishlist] getWishlists localStorage error:", e);
    return [];
  }
}

// ─── Server-backed persistence ────────────────────────────────────────────────

/**
 * Save wishlists to localStorage immediately (fast) then persist to the server.
 * Returns a promise that resolves when the server save completes.
 */
export async function saveWishlists(lists) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
  } catch {
    // localStorage blocked (private mode, sandboxed iframe, quota exceeded)
    // Fall through — server save will still run so data isn't fully lost
  }
  try {
    const token = await getAuthToken();
    if (!token) return;
    await fetch("/api/wishlists", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ wishlists: lists }),
    });
  } catch {
    // Server save failed — local copy (if writable) is still intact
  }
}

/**
 * Load wishlists from the server (source of truth).
 * Falls back to localStorage on error or when signed out.
 * Never overwrites local data with an empty cloud response if local has items.
 */
export async function syncWishlistsFromCloud() {
  try {
    const token = await getAuthToken();
    if (!token) return getWishlists();
    const res = await fetch("/api/wishlists", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return getWishlists();
    const { wishlists: cloud } = await res.json();
    if (!Array.isArray(cloud)) return getWishlists();
    // Merge rule: cloud wins unless it's empty and we have local data
    const local = getWishlists();
    const merged = cloud.length > 0 ? cloud : local;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return getWishlists();
  }
}

// ─── Wishlist item helpers ────────────────────────────────────────────────────

export async function addToWishlist(name, itemKey) {
  const lists = getWishlists();
  const trimmed = name.trim();
  const existing = lists.find((l) => l.name === trimmed);
  if (existing) {
    if (!existing.items.includes(itemKey)) existing.items.push(itemKey);
  } else {
    lists.push({ id: `${Date.now()}`, name: trimmed, items: [itemKey] });
  }
  await saveWishlists(lists);
}

export function isInAnyWishlist(itemKey) {
  return getWishlists().some((l) => l.items?.includes(itemKey));
}

export function getWishlistNameForItem(itemKey) {
  const list = getWishlists().find((l) => l.items?.includes(itemKey));
  return list?.name || null;
}

export async function removeFromWishlist(itemKey) {
  const lists = getWishlists();
  const updated = lists.map((l) => ({
    ...l,
    items: (l.items || []).filter((i) => i !== itemKey),
  }));
  await saveWishlists(updated);
}

// ─── WishlistModal component ──────────────────────────────────────────────────

export default function WishlistModal({
  itemKey,
  onClose,
  onSaved,
  onViewWishlists,
  onContinueToRegistry,
}) {
  const year = new Date().getFullYear();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(`My Wishlist ${year}`);
  const [savedName, setSavedName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const trimmed = name.trim() || `My Wishlist ${year}`;
      await addToWishlist(trimmed, itemKey);
      setSavedName(trimmed);
      onSaved?.(itemKey, trimmed);
      setStep(2);
    } finally {
      setSaving(false);
    }
  }

  function handleDone() {
    onClose();
  }

  function handleViewWishlists() {
    onClose();
    onViewWishlists?.();
  }

  function handleContinueToRegistry() {
    onClose();
    onContinueToRegistry?.(itemKey);
  }

  const modal = (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 flex items-end justify-center"
        style={{ zIndex: 99999 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={step === 1 ? onClose : undefined}
        />
        <motion.div
          className="relative w-full max-w-sm rounded-t-3xl bg-white shadow-2xl overflow-hidden"
          style={{ zIndex: 100000 }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 280 }}
        >
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="px-6 pt-5 pb-10"
              >
                <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-slate-200" />

                <button
                  onClick={onClose}
                  className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100"
                >
                  <X size={15} className="text-slate-600" />
                </button>

                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Step 1 of 2
                  </span>
                </div>

                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 flex-shrink-0">
                    <Heart size={22} className="fill-red-500 text-red-500" />
                  </div>
                  <div>
                    <h2 className="text-[17px] font-bold text-slate-900 leading-tight">
                      Name your wishlist
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      You can rename it anytime
                    </p>
                  </div>
                </div>

                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-[15px] font-medium text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 transition"
                  placeholder={`My Wishlist ${year}`}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                />

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white transition-all active:scale-95 hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                  {!saving && <ArrowRight size={16} />}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="px-6 pt-5 pb-10"
              >
                <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-slate-200" />

                <button
                  onClick={handleDone}
                  className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100"
                >
                  <X size={15} className="text-slate-600" />
                </button>

                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Step 2 of 2
                  </span>
                </div>

                <div className="flex flex-col items-center text-center py-4">
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      type: "spring",
                      damping: 12,
                      stiffness: 200,
                      delay: 0.1,
                    }}
                    className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-red-50"
                  >
                    <Heart size={36} className="fill-red-500 text-red-500" />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <h2 className="text-[20px] font-bold text-slate-900 leading-tight mb-2">
                      Saved!
                    </h2>
                    <p className="text-sm text-slate-500">
                      Added to{" "}
                      <span className="font-semibold text-slate-800">
                        "{savedName}"
                      </span>
                    </p>
                  </motion.div>
                </div>

                <div className="mt-6 space-y-3">
                  <button
                    onClick={handleContinueToRegistry}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white transition-all active:scale-95 hover:bg-slate-800"
                  >
                    <ArrowRight size={16} />
                    Build my registry
                  </button>
                  <button
                    onClick={handleViewWishlists}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 py-3.5 text-sm font-semibold text-slate-700 transition-all active:scale-95 hover:bg-slate-200"
                  >
                    <List size={16} />
                    View My Wishlists
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return ReactDOM.createPortal(modal, document.body);
}
