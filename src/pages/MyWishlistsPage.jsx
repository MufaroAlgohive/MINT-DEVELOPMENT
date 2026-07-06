import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Heart, Trash2, X, Copy, Check, Share2, Plus, QrCode } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getWishlists, saveWishlists, syncWishlistsFromCloud } from "../components/WishlistModal.jsx";
import GiftRegistryCreateSheet from "../components/GiftRegistryCreateSheet.jsx";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getShareUrl(list) {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/wishlist/${list.id}?name=${encodeURIComponent(list.name)}`;
}

function formatTag(key) {
  if (key.startsWith("strategy:")) return "Basket";
  if (key.startsWith("gift:")) return "Gift";
  return key.replace(/\.JO$/i, "").split(".")[0];
}

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

function QRImage({ url, size = 96 }) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&margin=3&bgcolor=f8f9fc&color=3b1b7a`;
  return (
    <img src={qrSrc} alt="QR code" width={size} height={size}
      className="rounded-lg object-contain" loading="lazy" />
  );
}

// ─── Detail Sheet ─────────────────────────────────────────────────────────────
function WishlistDetailSheet({ list, colorFrom, colorTo, onClose, onDelete, onRemoveItem }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareUrl = getShareUrl(list);
  const itemCount = list.items?.length || 0;

  function handleCopy() {
    navigator.clipboard?.writeText(shareUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const portalTarget = document.getElementById("modal-root") || document.body;

  return createPortal(
    <AnimatePresence>
      <motion.div className="fixed inset-0 flex items-end justify-center" style={{ zIndex: 99999 }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
        <motion.div className="absolute inset-0"
          style={{ background: "rgba(15,10,30,0.72)", backdropFilter: "blur(4px)" }}
          onClick={onClose} />

        <motion.div className="relative w-full max-w-sm rounded-t-[28px] bg-white shadow-2xl overflow-hidden"
          style={{ zIndex: 100000, maxHeight: "88dvh", display: "flex", flexDirection: "column" }}
          initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}>

          {/* Coloured header */}
          <div className="flex-shrink-0 px-5 pt-5 pb-5 rounded-t-[28px]"
            style={{ background: `linear-gradient(135deg, ${colorFrom}, ${colorTo})` }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                <Heart size={16} className="fill-white text-white" />
              </div>
              <button onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white">
                <X size={15} />
              </button>
            </div>
            <h2 className="text-[20px] font-bold text-white leading-tight">{list.name}</h2>
            <p className="text-[12px] text-white/70 mt-1">
              {itemCount} {itemCount === 1 ? "item" : "items"} saved
            </p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
            {/* Share link */}
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Share link</p>
              <div className="flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2.5">
                <QrCode size={13} className="text-slate-400 flex-shrink-0" />
                <p className="flex-1 text-[11px] font-medium text-slate-600 truncate">{shareUrl}</p>
                <button onClick={handleCopy}
                  className={`flex items-center gap-1 flex-shrink-0 rounded-xl px-2.5 py-1 text-[11px] font-bold transition-all
                    ${copied ? "bg-green-100 text-green-700" : "bg-[#6B21A8] text-white active:scale-95"}`}>
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {/* Items */}
            {itemCount > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Saved items</p>
                <div className="space-y-1.5">
                  {(list.items || []).map((key) => (
                    <div key={key} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                      <span className="text-[12px] font-medium text-slate-700 truncate">
                        {formatTag(key) === "Basket" ? "MINT Basket" : key.replace(/\.JO$/i, "")}
                      </span>
                      <button onClick={() => onRemoveItem(key)}
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 active:bg-red-100 transition-colors">
                        <X size={10} className="text-slate-500" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Delete */}
            <div className="border-t border-slate-100 pt-3">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-xs text-slate-500">Delete this wishlist?</p>
                  <button onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-600 rounded-xl bg-slate-100">
                    Cancel
                  </button>
                  <button onClick={onDelete}
                    className="px-3 py-1.5 text-xs font-semibold text-white rounded-xl bg-red-500">
                    Delete
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
                  <Trash2 size={13} />
                  Delete wishlist
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    portalTarget
  );
}

// ─── Small Category Card ──────────────────────────────────────────────────────
function WishlistCard({ list, index, onTap, onDelete }) {
  const [fromColor, toColor] = CARD_GRADIENTS[index % CARD_GRADIENTS.length];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const itemCount = list.items?.length || 0;

  function handleDeleteTap(e) {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete();
    } else {
      setConfirmDelete(true);
      // Auto-cancel confirmation after 3 seconds
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  }

  return (
    <motion.div
      layout
      className="relative rounded-2xl overflow-hidden shadow-sm"
      style={{
        background: `linear-gradient(135deg, ${fromColor}, ${toColor})`,
        aspectRatio: "1 / 1",
      }}
    >
      {/* Tap anywhere (except delete btn) to open detail */}
      <button
        className="absolute inset-0 p-3 flex flex-col justify-between w-full h-full text-left"
        onClick={() => !confirmDelete && onTap(list, fromColor, toColor)}
      >
        <Heart size={16} className="fill-white/60 text-white/60" />
        <div>
          <p className="text-[12px] font-bold text-white leading-tight line-clamp-2">{list.name}</p>
          <p className="text-[10px] text-white/70 mt-0.5">
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </p>
        </div>
      </button>

      {/* Delete button — top-right corner */}
      <button
        onClick={handleDeleteTap}
        className={[
          "absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full transition-all active:scale-90",
          confirmDelete
            ? "bg-red-500 shadow-lg"
            : "bg-black/25",
        ].join(" ")}
      >
        <Trash2 size={10} className="text-white" />
      </button>

      {/* Confirm overlay */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center rounded-2xl pointer-events-none"
            style={{ background: "rgba(0,0,0,0.35)" }}
          >
            <p className="text-[10px] font-bold text-white text-center px-2">Tap 🗑️ again<br/>to delete</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Plus Card ────────────────────────────────────────────────────────────────
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

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ onCreate }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 14 }}
        className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-md">
        <Heart size={32} className="fill-red-300 text-red-300" />
      </motion.div>
      <p className="text-[18px] font-bold text-slate-800 mb-2">No wishlists yet</p>
      <p className="text-sm text-slate-400 max-w-xs leading-relaxed mb-6">
        Tap ❤️ on any stock or basket to save it to a wishlist.
      </p>
      <button onClick={onCreate}
        className="flex items-center gap-2 rounded-2xl bg-[#6B21A8] px-5 py-3 text-sm font-bold text-white">
        <Plus size={15} />
        Create a wishlist
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MyWishlistsPage({ onBack }) {
  const [wishlists, setWishlists] = useState([]);
  const [detail, setDetail] = useState(null); // { list, fromColor, toColor }
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    setWishlists(getWishlists());
    syncWishlistsFromCloud().then(setWishlists).catch(() => {});
  }, []);

  const removeItem = useCallback((listId, itemKey) => {
    setWishlists(prev => {
      const updated = prev.map(l =>
        l.id !== listId ? l : { ...l, items: (l.items || []).filter(i => i !== itemKey) }
      );
      saveWishlists(updated);
      // update detail sheet if open
      if (detail?.list?.id === listId) {
        setDetail(d => d ? { ...d, list: updated.find(l => l.id === listId) || d.list } : null);
      }
      return updated;
    });
  }, [detail]);

  const deleteWishlist = useCallback((listId) => {
    setWishlists(prev => {
      const updated = prev.filter(l => l.id !== listId);
      saveWishlists(updated);
      return updated;
    });
    setDetail(null);
  }, []);

  const totalItems = wishlists.reduce((t, l) => t + (l.items?.length || 0), 0);

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
            <p className="text-[22px] font-bold text-white mt-0.5">{wishlists.length}</p>
          </div>
          <div className="flex-1 rounded-2xl bg-white/10 backdrop-blur-sm px-4 py-3">
            <p className="text-[11px] font-semibold text-white/60 uppercase tracking-wide">Saved Items</p>
            <p className="text-[22px] font-bold text-white mt-0.5">{totalItems}</p>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="px-4 pt-5 pb-24">
        {wishlists.length === 0 ? (
          <EmptyState onCreate={() => setShowCreate(true)} />
        ) : (
          <>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Categories
            </p>
            <div className="grid grid-cols-3 gap-3">
              {wishlists.map((list, i) => (
                <WishlistCard
                  key={list.id}
                  list={list}
                  index={i}
                  onTap={(l, from, to) => setDetail({ list: l, fromColor: from, toColor: to })}
                  onDelete={() => deleteWishlist(list.id)}
                />
              ))}
              <AddCard onTap={() => setShowCreate(true)} />
            </div>
          </>
        )}
      </div>

      {/* Detail sheet */}
      <AnimatePresence>
        {detail && (
          <WishlistDetailSheet
            key={detail.list.id}
            list={detail.list}
            colorFrom={detail.fromColor}
            colorTo={detail.toColor}
            onClose={() => setDetail(null)}
            onDelete={() => deleteWishlist(detail.list.id)}
            onRemoveItem={(itemKey) => removeItem(detail.list.id, itemKey)}
          />
        )}
      </AnimatePresence>

      {/* Create sheet */}
      <GiftRegistryCreateSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={(registry, title) => {
          setShowCreate(false);
          // Reload wishlists to pick up the new one
          syncWishlistsFromCloud().then(setWishlists).catch(() => {});
        }}
      />
    </div>
  );
}
