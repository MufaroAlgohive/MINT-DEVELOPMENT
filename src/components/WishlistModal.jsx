import React, { useState } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Heart, ArrowRight, List } from "lucide-react";

const STORAGE_KEY = "mint_wishlists";

export function getWishlists() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}

export function saveWishlists(lists) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
}

export function isInAnyWishlist(itemKey) {
  return getWishlists().some(l => l.items?.includes(itemKey));
}

export function getWishlistNameForItem(itemKey) {
  const list = getWishlists().find(l => l.items?.includes(itemKey));
  return list?.name || null;
}

export function addToWishlist(name, itemKey) {
  const lists = getWishlists();
  const trimmed = name.trim();
  const existing = lists.find(l => l.name === trimmed);
  if (existing) {
    if (!existing.items.includes(itemKey)) existing.items.push(itemKey);
  } else {
    lists.push({ id: `${Date.now()}`, name: trimmed, items: [itemKey] });
  }
  saveWishlists(lists);
}

export function removeFromWishlist(itemKey) {
  const lists = getWishlists();
  const updated = lists.map(l => ({ ...l, items: (l.items || []).filter(i => i !== itemKey) }));
  saveWishlists(updated);
}

export default function WishlistModal({ itemKey, onClose, onSaved, onViewWishlists }) {
  const year = new Date().getFullYear();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(`My Wishlist ${year}`);
  const [savedName, setSavedName] = useState("");

  function handleSave() {
    const trimmed = name.trim() || `My Wishlist ${year}`;
    addToWishlist(trimmed, itemKey);
    setSavedName(trimmed);
    onSaved?.(itemKey, trimmed);
    setStep(2);
  }

  function handleDone() {
    onClose();
  }

  function handleViewWishlists() {
    onClose();
    onViewWishlists?.();
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
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Step 1 of 2</span>
                </div>

                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 flex-shrink-0">
                    <Heart size={22} className="fill-red-500 text-red-500" />
                  </div>
                  <div>
                    <h2 className="text-[17px] font-bold text-slate-900 leading-tight">Name your wishlist</h2>
                    <p className="text-xs text-slate-400 mt-0.5">You can rename it anytime</p>
                  </div>
                </div>

                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-[15px] font-medium text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 transition"
                  placeholder={`My Wishlist ${year}`}
                  autoFocus
                  onKeyDown={e => e.key === "Enter" && handleSave()}
                />

                <button
                  onClick={handleSave}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white transition-all active:scale-95 hover:bg-slate-800"
                >
                  Save
                  <ArrowRight size={16} />
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

                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Step 2 of 2</span>
                </div>

                <div className="flex flex-col items-center text-center py-4">
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", damping: 12, stiffness: 200, delay: 0.1 }}
                    className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-red-50"
                  >
                    <Heart size={36} className="fill-red-500 text-red-500" />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <h2 className="text-[20px] font-bold text-slate-900 leading-tight mb-2">Saved!</h2>
                    <p className="text-sm text-slate-500">
                      Added to <span className="font-semibold text-slate-800">"{savedName}"</span>
                    </p>
                  </motion.div>
                </div>

                <div className="mt-6 space-y-3">
                  <button
                    onClick={handleViewWishlists}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white transition-all active:scale-95 hover:bg-slate-800"
                  >
                    <List size={16} />
                    View My Wishlists
                  </button>
                  <button
                    onClick={handleDone}
                    className="flex w-full items-center justify-center rounded-2xl bg-slate-100 py-3.5 text-sm font-semibold text-slate-700 transition-all active:scale-95 hover:bg-slate-200"
                  >
                    Done
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
