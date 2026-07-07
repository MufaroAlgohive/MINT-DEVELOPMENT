import React, { useState } from "react";
import { ArrowLeft, Gift, Plus, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useMyRegistries } from "../lib/useGiftRegistry.js";
import { getRegistryProgress, REGISTRY_STATUS_META, OCCASION_LABELS } from "../lib/giftRegistryUtils.js";
import GiftRegistryCreateSheet from "../components/GiftRegistryCreateSheet.jsx";
import { supabaseReady } from "../lib/supabase.js";

// ─── Sparkline bar chart ──────────────────────────────────────────────────────
// One bar per item (capped at 7); height = funded %. Violet-themed.
function RegistryBars({ items }) {
  const PALETTE = {
    full:    "#6d28d9", // deep violet — fully funded
    partial: "#a78bfa", // medium violet — partially funded
    empty:   "#ede9fe", // light violet — unfunded
    ghost:   "#f1f0fb", // placeholder bar
  };

  let bars;
  if (items.length === 0) {
    // Decorative placeholder — mirrors the reference card's visual rhythm
    bars = [
      { h: 28, c: PALETTE.ghost },
      { h: 42, c: PALETTE.ghost },
      { h: 65, c: PALETTE.empty },
      { h: 100, c: PALETTE.empty },
      { h: 55, c: PALETTE.ghost },
      { h: 38, c: PALETTE.ghost },
      { h: 80, c: PALETTE.empty },
    ];
  } else {
    bars = items.slice(0, 7).map(item => {
      const pct = item.target_quantity > 0
        ? (item.filled_quantity ?? 0) / item.target_quantity
        : 0;
      const h = Math.max(8, Math.round(pct * 100));
      const c = pct >= 1 ? PALETTE.full : pct > 0 ? PALETTE.partial : PALETTE.empty;
      return { h, c };
    });
    // Pad to at least 5 bars so the chart area always looks full (deterministic heights)
    const PAD_HEIGHTS = [22, 38, 18, 30, 14];
    while (bars.length < 5) bars.push({ h: PAD_HEIGHTS[bars.length % PAD_HEIGHTS.length], c: PALETTE.ghost });
  }

  return (
    <div
      className="flex items-end gap-[3px]"
      style={{ height: 44, flex: 1, maxWidth: 88 }}
      aria-hidden="true"
    >
      {bars.map((bar, i) => (
        <div
          key={i}
          className="flex-1 rounded-[3px]"
          style={{ height: `${bar.h}%`, background: bar.c, minHeight: 5 }}
        />
      ))}
    </div>
  );
}

// ─── Registry (wishlist) card — KPI tile aesthetic ────────────────────────────
function RegistryCard({ registry, onTap, onDelete, deletingId }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const items = (registry.items || []).filter(i => i.status !== "REMOVED");
  const progress = getRegistryProgress(items);
  const meta = REGISTRY_STATUS_META[registry.status] || REGISTRY_STATUS_META.DRAFT;
  const occasionLabel = registry.occasion
    ? (OCCASION_LABELS[registry.occasion] ?? registry.occasion)
    : "Gift";
  const isDeleting = deletingId === registry.id;

  // Funding badge colour — green when fully funded, violet otherwise
  const isFunded = progress.percent >= 100 && items.length > 0;
  const badgeStyle = isFunded
    ? { background: "#d1fae5", color: "#059669" }
    : registry.status === "ACTIVE"
    ? { background: "#ede9fe", color: "#7c3aed" }
    : { background: "#f1f5f9", color: "#64748b" };

  const badgeLabel = items.length === 0
    ? "New"
    : isFunded
    ? "Funded ✓"
    : `${progress.percent}%`;

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
    <motion.div
      layout
      className="relative rounded-2xl bg-white overflow-hidden"
      style={{
        border: "1px solid #e8edf2",
        boxShadow: "0 1px 0 rgba(11,16,21,0.04), 0 1px 3px rgba(11,16,21,0.06)",
      }}
    >
      {/* Tappable body */}
      <button
        onClick={() => !confirmDelete && onTap(registry)}
        className="w-full text-left px-4 pt-4 pb-4 flex flex-col gap-3 active:bg-slate-50 transition-colors"
      >
        {/* ── Head: occasion + status | funding pill ── */}
        <div className="flex items-center justify-between gap-2 pr-5">
          <span
            className="truncate"
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 10,
              color: "#8b9aad",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {occasionLabel} / {meta.label}
          </span>
          <span
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 10,
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: 999,
              flexShrink: 0,
              ...badgeStyle,
            }}
          >
            {badgeLabel}
          </span>
        </div>

        {/* ── Value: registry title (the "big number" equivalent) ── */}
        <div
          className="font-bold leading-tight line-clamp-2 text-slate-900"
          style={{ fontSize: 18, letterSpacing: "-0.015em", minHeight: "2.25rem" }}
        >
          {registry.title}
        </div>

        {/* ── Footer: item count | sparkline ── */}
        <div className="flex items-end justify-between gap-2">
          <span
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: 10,
              color: "#8b9aad",
              lineHeight: 1.4,
            }}
          >
            {items.length === 0
              ? "No items yet"
              : `${items.length} ${items.length === 1 ? "item" : "items"} saved`}
            {progress.total > 0 && progress.percent > 0 && (
              <><br />{`${progress.percent}% funded`}</>
            )}
          </span>
          <RegistryBars items={items} />
        </div>
      </button>

      {/* Delete button — top-right */}
      <button
        onClick={handleDeleteTap}
        disabled={isDeleting}
        className={[
          "absolute top-3 right-3 z-20 flex h-6 w-6 items-center justify-center rounded-full transition-all active:scale-90 disabled:opacity-50",
          confirmDelete ? "bg-red-500 shadow-md" : "bg-slate-100 hover:bg-slate-200",
        ].join(" ")}
      >
        {isDeleting ? (
          <div className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
        ) : (
          <Trash2 size={10} className={confirmDelete ? "text-white" : "text-slate-400"} />
        )}
      </button>

      {/* Confirm-delete overlay */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center rounded-2xl pointer-events-none"
            style={{ background: "rgba(255,255,255,0.88)" }}
          >
            <p className="text-[11px] font-bold text-slate-700 text-center leading-snug">
              Tap 🗑️ again<br />to delete
            </p>
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
export default function MyWishlistsPage({ onBack, onNavigate }) {
  const { registries, loading, reload } = useMyRegistries();
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);

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

      {/* Card grid */}
      <div className="px-4 pt-5 pb-24">
        {loading && registries.length === 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div
                key={i}
                className="rounded-2xl bg-white animate-pulse"
                style={{
                  border: "1px solid #e8edf2",
                  height: 150,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              />
            ))}
          </div>
        ) : registries.length === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : (
          <>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Your wishlists
            </p>
            {error && (
              <p className="text-[11px] font-semibold text-red-500 mb-3">{error}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
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
              <AddCard onTap={() => setShowCreate(true)} />
            </div>
          </>
        )}
      </div>

      {/* Create sheet */}
      <GiftRegistryCreateSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={() => {
          setShowCreate(false);
          reload();
        }}
      />
    </div>
  );
}
