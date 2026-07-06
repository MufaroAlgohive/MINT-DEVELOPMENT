import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Heart, Plus, Check, ArrowRight } from "lucide-react";
import WishlistPreviewGrid from "./WishlistPreviewGrid.jsx";

const CARD_GRADIENTS = [
  ["#7c3aed", "#6d28d9"],
  ["#db2777", "#be185d"],
  ["#0891b2", "#0e7490"],
  ["#059669", "#047857"],
  ["#d97706", "#b45309"],
  ["#7c3aed", "#4f46e5"],
];

const year = new Date().getFullYear();

export default function WishlistPickerSheet({ itemKey, onClose, onSaved, onCreateNew }) {
  const [wishlists, setWishlists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [savedId, setSavedId] = useState(null);

  // Step-1 form state (shown when no wishlists exist)
  const [name, setName] = useState(`My Wishlist ${year}`);
  const [savingNew, setSavingNew] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    async function load() {
      // For authenticated users, the source of truth is gift registries from the API.
      // mint_wishlists localStorage is just a legacy cache and can contain ghost entries,
      // so we only fall back to it when the user is not signed in.
      try {
        const { supabaseReady } = await import("../lib/supabase.js");
        const sb = await supabaseReady;
        if (sb) {
          const { data } = await sb.auth.getSession();
          const token = data?.session?.access_token;
          if (token) {
            const res = await fetch("/api/gift-registry/my-registries", {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const { registries } = await res.json();
              if (Array.isArray(registries)) {
                const registryLists = registries.map((r) => ({
                  id: r.id,
                  name: r.title,
                  items: (r.items || []).filter((i) => i.isin && i.status !== 'REMOVED').map((i) => ({
                    isin: i.isin,
                    name: i.name || i.isin,
                    logo_url: i.logo_url || null,
                  })),
                }));
                setWishlists(registryLists);
                setLoading(false);
                return;
              }
            }
          }
        }
      } catch {
        // fall through to local cache
      }

      // No auth session — show empty state so user can create their first registry
      setWishlists([]);
      setLoading(false);
    }
    load();
  }, []);

  // Auto-focus input when empty-state form is shown
  useEffect(() => {
    if (wishlists.length === 0 && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [wishlists.length]);

  async function handlePick(list) {
    if (saving) return;
    setSaving(list.id);
    try {
      // list.id is a real registry UUID — write the item to gift_registry_items
      const { supabaseReady } = await import("../lib/supabase.js");
      const sb = await supabaseReady;
      const { data: sessionData } = await sb.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (token && list.id) {
        const res = await fetch("/api/gift-registry/items/by-key", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ registryId: list.id, itemKey }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || "Failed to save item");
        }
      }

      setSavedId(list.id);
      setTimeout(() => {
        onSaved?.(itemKey, list.name);
        onClose();
      }, 550);
    } catch (e) {
      console.error("[WishlistPicker] handlePick error:", e.message);
    } finally {
      setSaving(null);
    }
  }

  // Called from the inline Step-1 form (empty state) — first wishlist ever created.
  // Save the name, then hand off to Step 2 of the gift registry flow instead of
  // just closing, so the user continues straight into building their registry.
  async function handleSaveNew() {
    if (savingNew) return;
    setSavingNew(true);
    try {
      const trimmed = name.trim() || `My Wishlist ${year}`;
      onClose();
      onCreateNew?.(trimmed);
    } finally {
      setSavingNew(false);
    }
  }

  function handleCreateNew() {
    onClose();
    onCreateNew?.(null);
  }

  const portalTarget = document.getElementById("modal-root") || document.body;
  const hasWishlists = wishlists.length > 0;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 flex items-end justify-center"
        style={{ zIndex: 99999 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0"
          style={{ background: "rgba(15,10,30,0.72)", backdropFilter: "blur(6px)" }}
          onClick={onClose}
        />

        {/* Sheet */}
        <motion.div
          className="relative w-full max-w-sm rounded-t-[28px] bg-white shadow-2xl overflow-hidden"
          style={{ zIndex: 100000, maxHeight: "88dvh", display: "flex", flexDirection: "column" }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="h-[4px] w-10 rounded-full bg-slate-200" />
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
          >
            <X size={15} />
          </button>

          {loading ? (
            /* ── Loading: spinner while API fetch completes ── */
            <div className="flex items-center justify-center py-16">
              <div className="h-6 w-6 rounded-full border-2 border-slate-200 border-t-[#6B21A8] animate-spin" />
            </div>
          ) : hasWishlists ? (
            /* ── Has wishlists: show grid + create button ── */
            <>
              {/* Header */}
              <div className="px-5 py-3 flex-shrink-0">
                <h2 className="text-[17px] font-bold text-slate-900 leading-tight">Save to wishlist</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Pick a category or create a new one</p>
              </div>

              {/* Wishlist grid */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3">
                <div className="grid grid-cols-2 gap-3">
                  {wishlists.map((list, i) => {
                    const [fromColor, toColor] = CARD_GRADIENTS[i % CARD_GRADIENTS.length];
                    const isSaved = savedId === list.id;
                    const isSaving = saving === list.id;
                    return (
                      <motion.button
                        key={list.id}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handlePick(list)}
                        disabled={!!saving}
                        className="relative rounded-2xl p-4 text-left shadow-sm overflow-hidden"
                        style={{
                          minHeight: 110,
                          background: `linear-gradient(135deg, ${fromColor}, ${toColor})`,
                        }}
                      >
                        {/* Asset mosaic preview */}
                        <WishlistPreviewGrid
                          items={Array.isArray(list.items) ? list.items.filter(it => it && it.logo_url) : []}
                          fromColor={fromColor}
                          toColor={toColor}
                        />

                        <AnimatePresence>
                          {isSaved && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.7 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="absolute inset-0 flex items-center justify-center rounded-2xl z-20"
                              style={{ background: "rgba(0,0,0,0.45)" }}
                            >
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white">
                                <Check size={20} className="text-[#6B21A8]" />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Text content — sits above the mosaic via z-index */}
                        <div className="relative z-10 flex flex-col h-full justify-between">
                          <div className="flex items-start justify-between mb-2">
                            <Heart size={16} className="fill-white/70 text-white/70 drop-shadow" />
                            {isSaving && !isSaved && (
                              <div className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                            )}
                          </div>
                          <div>
                            <p className="text-[13px] font-bold text-white leading-tight line-clamp-2 pr-1 drop-shadow">{list.name}</p>
                            <p className="text-[11px] text-white/80 mt-0.5 drop-shadow">
                              {list.items?.filter(i => i.status !== 'REMOVED')?.length || list.items?.length || 0} {((list.items?.filter(i => i.status !== 'REMOVED')?.length || list.items?.length || 0) === 1) ? "item" : "items"}
                            </p>
                          </div>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Create new — solid dark button */}
              <div className="flex-shrink-0 px-5 pt-3 pb-8 border-t border-slate-100">
                <button
                  onClick={handleCreateNew}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#111111] py-4 text-sm font-bold text-white active:scale-95 transition-transform"
                >
                  <Plus size={16} />
                  Create a new wishlist
                </button>
              </div>
            </>
          ) : (
            /* ── No wishlists: Step 1 inline form ── */
            <div className="px-6 pt-2 pb-10">
              {/* Step label */}
              <div className="mb-1 mt-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Step 1 of 2
                </span>
              </div>

              {/* Icon + title */}
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

              {/* Name input */}
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSaveNew()}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-[15px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300 mb-4"
                placeholder={`My Wishlist ${year}`}
                maxLength={60}
              />

              {/* Save button */}
              <button
                onClick={handleSaveNew}
                disabled={savingNew || !name.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#111111] py-4 text-sm font-bold text-white active:scale-95 transition-transform disabled:opacity-50"
              >
                {savingNew ? "Saving…" : (
                  <>Save <ArrowRight size={16} /></>
                )}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    portalTarget
  );
}
