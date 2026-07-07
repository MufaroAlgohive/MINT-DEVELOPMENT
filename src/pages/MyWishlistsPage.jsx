import React, { useState } from "react";
import { ArrowLeft, Gift, Plus, Trash2, Link2, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useMyRegistries } from "../lib/useGiftRegistry.js";
import { getRegistryProgress, REGISTRY_STATUS_META, OCCASION_LABELS, registryShareUrl } from "../lib/giftRegistryUtils.js";
import { supabaseReady } from "../lib/supabase.js";

// ─── Registry (wishlist) card — pricing-card aesthetic ───────────────────────
function RegistryCard({ registry, onTap, onDelete, deletingId }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const items = (registry.items || []).filter(i => i.status !== "REMOVED");
  const progress = getRegistryProgress(items);
  const occasionLabel = registry.occasion
    ? (OCCASION_LABELS[registry.occasion] ?? registry.occasion)
    : "Gift";
  const isDeleting = deletingId === registry.id;
  const hasShareLink = !!registry.share_token && ["ACTIVE", "PAUSED"].includes(registry.status);

  function handleDeleteTap(e) {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(registry.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  }

  async function handleShareLink(e) {
    e.stopPropagation();
    if (hasShareLink) {
      try {
        await navigator.clipboard.writeText(registryShareUrl(registry.share_token));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // fallback: open in new tab
        window.open(registryShareUrl(registry.share_token), "_blank");
      }
    } else {
      // DRAFT — navigate to detail to publish
      onTap(registry);
    }
  }

  const subtitleText = items.length === 0
    ? `${occasionLabel} · no items yet`
    : `${occasionLabel} · ${items.length} ${items.length === 1 ? "item" : "items"}`;

  return (
    <motion.div
      layout
      className="relative flex flex-col bg-white rounded-3xl"
      style={{ border: "1px solid #e8edf2" }}
    >
      {/* Delete button — top-right corner */}
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

      {/* Tappable body */}
      <button
        onClick={() => !confirmDelete && onTap(registry)}
        className="flex-1 text-left px-6 pt-8 pb-6 active:opacity-80 transition-opacity"
      >
        <div className="grid items-center justify-center w-full grid-cols-1 text-left">
          {/* Title + subtitle */}
          <div>
            <h2 className="text-lg font-medium tracking-tighter text-gray-600 leading-snug line-clamp-2 pr-6">
              {registry.title}
            </h2>
            <p className="mt-2 text-sm text-gray-500">{subtitleText}</p>
          </div>

          {/* Big number — funded % */}
          <div className="mt-6">
            <p>
              <span className="text-5xl font-light tracking-tight text-black">
                {progress.percent}
              </span>
              <span className="text-base font-medium text-gray-500">% funded</span>
            </p>
          </div>
        </div>
      </button>

      {/* Share Link button */}
      <div className="px-6 pb-8">
        <button
          onClick={handleShareLink}
          className="flex items-center justify-center gap-2 w-full px-6 py-2.5 text-center text-white duration-200 bg-black border-2 border-black rounded-full hover:bg-transparent hover:text-black focus:outline-none text-sm"
        >
          {copied ? (
            <><Check size={14} /> Copied!</>
          ) : hasShareLink ? (
            <><Link2 size={14} /> Share Link</>
          ) : (
            "Publish to Share"
          )}
        </button>
      </div>

      {/* Confirm-delete overlay */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center rounded-3xl pointer-events-none"
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
