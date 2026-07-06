import React, { useState, useEffect } from "react";
import { ArrowLeft, Heart, Trash2, ChevronDown, ChevronUp, X, TrendingUp, Gift, BarChart2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getWishlists, saveWishlists } from "../components/WishlistModal.jsx";

function formatItemLabel(key) {
  if (key.startsWith("strategy:")) {
    return { label: "Mint Basket", sub: "Investment strategy", icon: "basket" };
  }
  if (key.startsWith("gift:")) {
    return { label: "Mint Basket", sub: "Gift strategy", icon: "gift" };
  }
  return { label: key.replace(/\.JO$/i, ""), sub: key.includes(".") ? key.split(".").pop() + " listed" : "Stock", icon: "stock" };
}

function ItemIcon({ type }) {
  if (type === "basket") {
    return (
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-violet-100">
        <TrendingUp size={16} className="text-violet-600" />
      </div>
    );
  }
  if (type === "gift") {
    return (
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
        <Gift size={16} className="text-amber-600" />
      </div>
    );
  }
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-100">
      <BarChart2 size={16} className="text-blue-600" />
    </div>
  );
}

function WishlistCard({ list, isExpanded, onToggle, onRemoveItem, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const itemCount = list.items?.length || 0;

  return (
    <motion.div
      layout
      className="overflow-hidden rounded-3xl bg-white shadow-[0_2px_16px_-2px_rgba(0,0,0,0.08)] border border-slate-100"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-4 text-left active:bg-slate-50 transition-colors"
      >
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-red-50">
          <Heart size={18} className="fill-red-500 text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 truncate">{list.name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{itemCount} item{itemCount !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isExpanded ? (
            <ChevronUp size={18} className="text-slate-400" />
          ) : (
            <ChevronDown size={18} className="text-slate-400" />
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="border-t border-slate-100">
              {itemCount === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-slate-400">No items in this list</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {list.items.map((key) => {
                    const { label, sub, icon } = formatItemLabel(key);
                    return (
                      <div key={key} className="flex items-center gap-3 px-5 py-3.5">
                        <ItemIcon type={icon} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-slate-900 truncate">{label}</p>
                          <p className="text-[11px] text-slate-400">{sub}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveItem(key)}
                          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 active:bg-red-100 transition-colors"
                        >
                          <X size={13} className="text-slate-500" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="border-t border-slate-100 px-5 py-3">
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <p className="flex-1 text-xs text-slate-500">Delete this wishlist?</p>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 rounded-xl bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={onDelete}
                      className="px-3 py-1.5 text-xs font-semibold text-white rounded-xl bg-red-500"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-red-500"
                  >
                    <Trash2 size={13} />
                    Delete wishlist
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-red-50">
        <Heart size={32} className="fill-red-300 text-red-300" />
      </div>
      <p className="text-[18px] font-bold text-slate-800 mb-2">No wishlists yet</p>
      <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
        Tap the ❤️ on any stock or basket to save it to a wishlist.
      </p>
    </div>
  );
}

export default function MyWishlistsPage({ onBack }) {
  const [wishlists, setWishlists] = useState([]);
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    const lists = getWishlists();
    setWishlists(lists);
    if (lists.length === 1) setExpanded(new Set([lists[0].id]));
  }, []);

  function toggleExpand(id) {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function removeItem(listId, itemKey) {
    const updated = wishlists.map(l =>
      l.id !== listId ? l : { ...l, items: (l.items || []).filter(i => i !== itemKey) }
    );
    setWishlists(updated);
    saveWishlists(updated);
  }

  function deleteWishlist(listId) {
    const updated = wishlists.filter(l => l.id !== listId);
    setWishlists(updated);
    saveWishlists(updated);
    setExpanded(prev => { const n = new Set(prev); n.delete(listId); return n; });
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)]">
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-lg px-5 pt-14 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 active:bg-slate-200 transition-colors"
          >
            <ArrowLeft size={18} className="text-slate-700" />
          </button>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-slate-900">My Wishlists</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {wishlists.length} {wishlists.length === 1 ? "list" : "lists"} · {wishlists.reduce((t, l) => t + (l.items?.length || 0), 0)} saved items
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-5 pb-24 space-y-3">
        {wishlists.length === 0 ? (
          <EmptyState />
        ) : (
          wishlists.map((list) => (
            <WishlistCard
              key={list.id}
              list={list}
              isExpanded={expanded.has(list.id)}
              onToggle={() => toggleExpand(list.id)}
              onRemoveItem={(itemKey) => removeItem(list.id, itemKey)}
              onDelete={() => deleteWishlist(list.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
