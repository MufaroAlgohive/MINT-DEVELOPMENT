import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Heart, Plus, Check } from "lucide-react";
import { getWishlists, addToWishlist, syncWishlistsFromCloud } from "./WishlistModal.jsx";

const CARD_GRADIENTS = [
  ["#7c3aed", "#6d28d9"],
  ["#db2777", "#be185d"],
  ["#0891b2", "#0e7490"],
  ["#059669", "#047857"],
  ["#d97706", "#b45309"],
  ["#7c3aed", "#4f46e5"],
];

export default function WishlistPickerSheet({ itemKey, onClose, onSaved, onCreateNew }) {
  const [wishlists, setWishlists] = useState([]);
  const [saving, setSaving] = useState(null);
  const [savedId, setSavedId] = useState(null);

  useEffect(() => {
    setWishlists(getWishlists());
    syncWishlistsFromCloud().then(setWishlists).catch(() => {});
  }, []);

  async function handlePick(list) {
    if (saving) return;
    setSaving(list.id);
    try {
      await addToWishlist(list.name, itemKey);
      setSavedId(list.id);
      setTimeout(() => {
        onSaved?.(itemKey, list.name);
        onClose();
      }, 550);
    } finally {
      setSaving(null);
    }
  }

  function handleCreateNew() {
    onClose();
    onCreateNew?.();
  }

  const portalTarget = document.getElementById("modal-root") || document.body;

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
          {/* Gradient accent strip */}
          <div className="h-1 w-full flex-shrink-0" style={{ background: "linear-gradient(90deg,#7c3aed,#6366f1,#8b5cf6)" }} />

          {/* Drag handle */}
          <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
            <div className="h-[3px] w-9 rounded-full bg-slate-200" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
            <div>
              <h2 className="text-[17px] font-bold text-slate-900 leading-tight">Save to wishlist</h2>
              {wishlists.length > 0 && (
                <p className="text-[11px] text-slate-400 mt-0.5">Pick a category or create a new one</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
            >
              <X size={15} />
            </button>
          </div>

          {/* Wishlist grid */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3">
            {wishlists.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
                  <Heart size={24} className="text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-600 mb-1">No wishlists yet</p>
                <p className="text-xs text-slate-400">Create your first wishlist below</p>
              </div>
            ) : (
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
                        minHeight: 100,
                        background: `linear-gradient(135deg, ${fromColor}, ${toColor})`,
                      }}
                    >
                      {/* Check overlay on save */}
                      <AnimatePresence>
                        {isSaved && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="absolute inset-0 flex items-center justify-center rounded-2xl"
                            style={{ background: "rgba(0,0,0,0.3)" }}
                          >
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white">
                              <Check size={20} className="text-[#6B21A8]" />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="flex items-start justify-between mb-2">
                        <Heart size={16} className="fill-white/60 text-white/60" />
                        {isSaving && !isSaved && (
                          <div className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        )}
                      </div>
                      <p className="text-[13px] font-bold text-white leading-tight line-clamp-2 pr-1">{list.name}</p>
                      <p className="text-[11px] text-white/70 mt-1">
                        {list.items?.length || 0} {(list.items?.length || 0) === 1 ? "item" : "items"}
                      </p>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Create new button — always visible at bottom */}
          <div className="flex-shrink-0 px-5 pt-3 pb-8 border-t border-slate-100">
            <button
              onClick={handleCreateNew}
              className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 py-4 text-sm font-semibold text-slate-600 active:bg-slate-50 transition-colors hover:border-violet-300 hover:text-violet-700"
            >
              <Plus size={16} />
              Create a new wishlist
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    portalTarget
  );
}
