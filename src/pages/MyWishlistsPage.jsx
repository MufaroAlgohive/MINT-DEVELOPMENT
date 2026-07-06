import React, { useState } from "react";
import { ArrowLeft, Heart, Plus, Gift } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useMyRegistries } from "../lib/useGiftRegistry.js";
import { getRegistryProgress, REGISTRY_STATUS_META, OCCASION_LABELS } from "../lib/giftRegistryUtils.js";
import GiftRegistryCreateSheet from "../components/GiftRegistryCreateSheet.jsx";

const CARD_GRADIENTS = [
  ["#7c3aed", "#6d28d9"],
  ["#db2777", "#be185d"],
  ["#0891b2", "#0e7490"],
  ["#059669", "#047857"],
  ["#d97706", "#b45309"],
  ["#4f46e5", "#7c3aed"],
  ["#be123c", "#9f1239"],
  ["#0369a1", "#075985"],
];

function RegistryCard({ registry, index, onTap }) {
  const [fromColor, toColor] = CARD_GRADIENTS[index % CARD_GRADIENTS.length];
  const items = registry.items || [];
  const progress = getRegistryProgress(items);
  const meta = REGISTRY_STATUS_META[registry.status] || REGISTRY_STATUS_META.DRAFT;
  const occasionLabel = registry.occasion ? OCCASION_LABELS[registry.occasion] || registry.occasion : null;

  return (
    <motion.button
      layout
      onClick={() => onTap(registry)}
      className="relative rounded-2xl overflow-hidden shadow-sm text-left p-3 flex flex-col justify-between"
      style={{
        background: `linear-gradient(135deg, ${fromColor}, ${toColor})`,
        aspectRatio: "1 / 1",
      }}
    >
      <div className="flex items-center justify-between">
        <Heart size={16} className="fill-white/60 text-white/60" />
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.color}`}>
          {meta.label}
        </span>
      </div>
      <div>
        <p className="text-[12px] font-bold text-white leading-tight line-clamp-2">{registry.title}</p>
        {occasionLabel && (
          <p className="text-[10px] text-white/70 mt-0.5">{occasionLabel}</p>
        )}
        <p className="text-[10px] text-white/70 mt-0.5">
          {items.length} {items.length === 1 ? "item" : "items"}
          {progress.total > 0 ? ` · ${progress.percent}% funded` : ""}
        </p>
      </div>
    </motion.button>
  );
}

function AddCard({ onTap }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onTap}
      className="relative rounded-2xl overflow-hidden text-left border-2 border-dashed border-slate-200 bg-white flex items-center justify-center"
      style={{ aspectRatio: "1 / 1" }}
    >
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100">
          <Plus size={18} className="text-slate-400" />
        </div>
        <p className="text-[10px] font-semibold text-slate-400">New</p>
      </div>
    </motion.button>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 14 }}
        className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-md">
        <Gift size={32} className="text-violet-300" />
      </motion.div>
      <p className="text-[18px] font-bold text-slate-800 mb-2">No wishlists yet</p>
      <p className="text-sm text-slate-400 max-w-xs leading-relaxed mb-6">
        Create a wishlist for a birthday, wedding, or any occasion and share it with friends and family.
      </p>
      <button onClick={onCreate}
        className="flex items-center gap-2 rounded-2xl bg-[#6B21A8] px-5 py-3 text-sm font-bold text-white">
        <Plus size={15} />
        Create a wishlist
      </button>
    </div>
  );
}

export default function MyWishlistsPage({ onBack, onNavigate }) {
  const { registries, loading, reload } = useMyRegistries();
  const [showCreate, setShowCreate] = useState(false);

  const totalItems = registries.reduce((t, r) => t + (r.items?.length || 0), 0);

  function openRegistry(registry) {
    if (typeof onNavigate === "function") {
      onNavigate("giftRegistryDetail", { registryId: registry.id, registry });
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f5fa] pb-[env(safe-area-inset-bottom)]">
      {/* Header */}
      <div className="rounded-b-[36px] bg-gradient-to-b from-[#111111] via-[#3b1b7a] to-[#5b21b6] px-4 pb-8 pt-14 text-white">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm active:bg-white/25 transition-colors">
            <ArrowLeft size={18} className="text-white" />
          </button>
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">My Account</p>
            <h1 className="text-[22px] font-bold tracking-tight text-white leading-tight">My Wishlists</h1>
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex gap-3">
          <div className="flex-1 rounded-2xl bg-white/10 backdrop-blur-sm px-4 py-3">
            <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wide">Wishlists</p>
            <p className="text-[22px] font-bold text-white mt-0.5">{registries.length}</p>
          </div>
          <div className="flex-1 rounded-2xl bg-white/10 backdrop-blur-sm px-4 py-3">
            <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wide">Saved Items</p>
            <p className="text-[22px] font-bold text-white mt-0.5">{totalItems}</p>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="px-4 pt-5 pb-24">
        {loading && registries.length === 0 ? (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-2xl bg-slate-100 animate-pulse" style={{ aspectRatio: "1 / 1" }} />
            ))}
          </div>
        ) : registries.length === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : (
          <>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Your wishlists
            </p>
            <div className="grid grid-cols-3 gap-3">
              <AnimatePresence>
                {registries.map((registry, i) => (
                  <RegistryCard
                    key={registry.id}
                    registry={registry}
                    index={i}
                    onTap={openRegistry}
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
