import React, { useState } from "react";
import { ArrowLeft, Gift, Plus, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useMyRegistries } from "../lib/useGiftRegistry.js";
import { OCCASION_LABELS } from "../lib/giftRegistryUtils.js";
import { supabaseReady } from "../lib/supabase.js";

// ─── Occasion colour map — used for the left accent bar ──────────────────────
const OCCASION_COLORS = {
  BIRTHDAY:   { bg: "bg-pink-100",   text: "text-pink-600",   bar: "#f472b6" },
  WEDDING:    { bg: "bg-rose-100",   text: "text-rose-600",   bar: "#fb7185" },
  BABY:       { bg: "bg-sky-100",    text: "text-sky-600",    bar: "#38bdf8" },
  GRADUATION: { bg: "bg-amber-100",  text: "text-amber-600",  bar: "#fbbf24" },
  FESTIVE:    { bg: "bg-green-100",  text: "text-green-600",  bar: "#34d399" },
  CUSTOM:     { bg: "bg-violet-100", text: "text-violet-600", bar: "#7c3aed" },
};

// ─── Registry (wishlist) card — Airbnb-style compact category card ─────────
function RegistryCard({ registry, onTap, onDelete, deletingId }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const items = (registry.items || []).filter(i => i.status !== "REMOVED");
  const occasionLabel = registry.occasion
    ? (OCCASION_LABELS[registry.occasion] ?? registry.occasion)
    : "Gift";
  const occasionColor = OCCASION_COLORS[registry.occasion] || OCCASION_COLORS.CUSTOM;
  const isDeleting = deletingId === registry.id;
  const isChildWishlist = registry.beneficiary_type === "CHILD";

  function handleDeleteTap(e) {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(registry.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  }

  return (
    <motion.div layout className="relative">
      <button
        onClick={() => !confirmDelete && onTap(registry)}
        className="w-full text-left active:scale-[0.98] transition-transform"
      >
        <div
          className="flex items-center gap-0 bg-white rounded-2xl overflow-hidden"
          style={{ border: "1px solid #e8edf2", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
        >
          {/* Left accent bar */}
          <div
            className="w-1 self-stretch shrink-0 rounded-l-2xl"
            style={{ backgroundColor: occasionColor.bar }}
          />

          {/* Occasion chip */}
          <div className={`shrink-0 mx-3 my-3.5 px-2.5 py-1 rounded-xl ${occasionColor.bg}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wider ${occasionColor.text}`}>
              {occasionLabel}
            </p>
          </div>

          {/* Title + item count */}
          <div className="flex-1 min-w-0 py-3.5 pr-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold text-slate-800 truncate leading-snug">
                {registry.title}
              </p>
              {isChildWishlist && (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700 flex-shrink-0">
                  <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                  </svg>
                  Child
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {isChildWishlist && registry.beneficiary_display_name
                ? `${registry.beneficiary_display_name} · `
                : ""}
              {items.length === 0 ? "No items yet" : `${items.length} ${items.length === 1 ? "item" : "items"}`}
            </p>
          </div>

          {/* Delete button */}
          <div className="shrink-0 pr-3">
            <button
              onClick={handleDeleteTap}
              disabled={isDeleting}
              className={[
                "flex h-7 w-7 items-center justify-center rounded-full transition-all active:scale-90 disabled:opacity-50",
                confirmDelete ? "bg-red-500 shadow" : "bg-slate-100 hover:bg-slate-200",
              ].join(" ")}
            >
              {isDeleting ? (
                <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
              ) : (
                <Trash2 size={11} className={confirmDelete ? "text-white" : "text-slate-400"} />
              )}
            </button>
          </div>
        </div>
      </button>

      {/* Confirm-delete tooltip */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute right-2 -top-8 z-30 rounded-lg bg-slate-800 px-2.5 py-1 text-[10px] font-semibold text-white shadow-lg pointer-events-none"
          >
            Tap again to delete
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── "New wishlist" add card ───────────────────────────────────────────────────
function AddCard({ onTap }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onTap}
      className="relative rounded-2xl bg-white flex flex-col items-center justify-center gap-2 py-8 transition-colors hover:bg-slate-50 active:bg-slate-100"
      style={{ border: "2px dashed #d6dce3" }}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-50 border border-slate-200">
        <Plus size={18} className="text-slate-400" />
      </div>
      <p
        style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: 10,
          color: "#94a3b8",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        New
      </p>
    </motion.button>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ onCreate }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 14 }}
        className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-md"
      >
        <Gift size={32} className="text-violet-300" />
      </motion.div>
      <p className="text-[18px] font-bold text-slate-800 mb-2">No wishlists yet</p>
      <p className="text-sm text-slate-400 max-w-xs leading-relaxed mb-6">
        Create a wishlist for a birthday, wedding, or any occasion and share it with friends and family.
      </p>
      <button
        onClick={onCreate}
        className="flex items-center gap-2 rounded-2xl bg-[#6B21A8] px-5 py-3 text-sm font-bold text-white"
      >
        <Plus size={15} />
        Create a wishlist
      </button>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function MyWishlistsPage({ onBack, onNavigate, childFamilyMemberId }) {
  const { registries: allRegistries, loading, reload } = useMyRegistries();

  // When opened from a child's context, show only that child's wishlists
  const registries = childFamilyMemberId
    ? allRegistries.filter(r => r.beneficiary_ref === childFamilyMemberId)
    : allRegistries;
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);

  function openCreate() {
    if (typeof onNavigate === "function") onNavigate("giftRegistryCreate");
  }

  const totalItems = registries.reduce((t, r) => {
    const active = (r.items || []).filter(i => i.status !== "REMOVED");
    return t + active.length;
  }, 0);

  function openRegistry(registry) {
    if (typeof onNavigate === "function") {
      onNavigate("giftRegistryDetail", { registryId: registry.id, registry });
    }
  }

  async function handleDelete(registryId) {
    setDeletingId(registryId);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch(`/api/gift-registry/${registryId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not delete wishlist");
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f5fa] pb-[env(safe-area-inset-bottom)]">
      {/* Header */}
      <div className="rounded-b-[36px] bg-gradient-to-b from-[#111111] via-[#3b1b7a] to-[#5b21b6] px-4 pb-8 pt-14 text-white">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm active:bg-white/25 transition-colors"
          >
            <ArrowLeft size={18} className="text-white" />
          </button>
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
              My Account
            </p>
            <h1 className="text-[22px] font-bold tracking-tight text-white leading-tight">
              My Wishlists
            </h1>
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex gap-3">
          <div className="flex-1 rounded-2xl bg-white/10 backdrop-blur-sm px-4 py-3">
            <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wide">
              Wishlists
            </p>
            <p className="text-[22px] font-bold text-white mt-0.5">{registries.length}</p>
          </div>
          <div className="flex-1 rounded-2xl bg-white/10 backdrop-blur-sm px-4 py-3">
            <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wide">
              Saved Items
            </p>
            <p className="text-[22px] font-bold text-white mt-0.5">{totalItems}</p>
          </div>
        </div>
      </div>

      {/* Card grid — max-w-md keeps cards from stretching on desktop */}
      <div className="mx-auto px-4 pt-5 pb-24" style={{ maxWidth: 480 }}>
        {loading && registries.length === 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {[1, 2].map(i => (
              <div
                key={i}
                className="rounded-3xl bg-white animate-pulse"
                style={{
                  border: "1px solid #e8edf2",
                  height: 220,
                }}
              />
            ))}
          </div>
        ) : registries.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Your wishlists
            </p>
            {error && (
              <p className="text-[11px] font-semibold text-red-500 mb-3">{error}</p>
            )}
            <div className="grid grid-cols-1 gap-4">
              <AnimatePresence>
                {registries.map((registry) => (
                  <RegistryCard
                    key={registry.id}
                    registry={registry}
                    onTap={openRegistry}
                    onDelete={handleDelete}
                    deletingId={deletingId}
                  />
                ))}
              </AnimatePresence>
              <AddCard onTap={openCreate} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
