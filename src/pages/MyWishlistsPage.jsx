import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Heart, Trash2, X, Copy, Check, QrCode, Share2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getWishlists, saveWishlists } from "../components/WishlistModal.jsx";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getShareUrl(list) {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/wishlist/${list.id}?name=${encodeURIComponent(list.name)}`;
}

function formatTag(key) {
  if (key.startsWith("strategy:")) return "MINT Basket";
  if (key.startsWith("gift:")) return "Gift Strategy";
  return key.replace(/\.JO$/i, "").split(".")[0];
}

function QRImage({ url, size = 96 }) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&margin=3&bgcolor=f8f9fc&color=3b1b7a`;
  return (
    <img
      src={qrSrc}
      alt="QR code"
      width={size}
      height={size}
      className="rounded-lg object-contain"
      loading="lazy"
    />
  );
}

// ─── QR Expanded Modal ────────────────────────────────────────────────────────
function QRModal({ list, onClose }) {
  const url = getShareUrl(list);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleOpen() {
    window.open(url, "_blank", "noopener,noreferrer");
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
          style={{ background: "rgba(15,10,30,0.72)", backdropFilter: "blur(4px)" }}
          onClick={onClose}
        />

        {/* Sheet */}
        <motion.div
          className="relative w-full max-w-sm rounded-t-[28px] bg-white shadow-2xl overflow-hidden"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}
        >
          {/* Gradient strip */}
          <div className="h-1 w-full" style={{ background: "linear-gradient(90deg,#7c3aed,#6366f1,#8b5cf6)" }} />

          {/* Drag handle */}
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="h-[3px] w-9 rounded-full bg-slate-200" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Share Wishlist</p>
              <h2 className="text-[17px] font-bold text-slate-900 leading-tight mt-0.5">{list.name}</h2>
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
            >
              <X size={15} />
            </button>
          </div>

          {/* QR code */}
          <div className="flex flex-col items-center px-5 pt-2 pb-4">
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", damping: 18, stiffness: 280, delay: 0.1 }}
              className="rounded-3xl bg-slate-50 border border-slate-100 p-5 shadow-inner"
            >
              <QRImage url={url} size={200} />
            </motion.div>
            <p className="mt-3 text-[11px] text-slate-400 text-center">
              Scan to open this wishlist on any device
            </p>
          </div>

          {/* Link row */}
          <div className="px-5 pb-2">
            <div className="flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
              <p className="flex-1 text-[12px] font-medium text-slate-600 truncate">{url}</p>
              <button
                onClick={handleCopy}
                className={[
                  "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all",
                  copied
                    ? "bg-green-100 text-green-700"
                    : "bg-[#6B21A8] text-white active:scale-95",
                ].join(" ")}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {/* Open button */}
          <div className="px-5 pt-2 pb-8">
            <button
              onClick={handleOpen}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white active:scale-95 transition-transform"
            >
              <Share2 size={15} />
              Open Wishlist Link
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    portalTarget
  );
}

// ─── Wishlist Card (Strategy-card style) ──────────────────────────────────────
function WishlistCard({ list, onRemoveItem, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [qrPressed, setQrPressed] = useState(false);

  const shareUrl = getShareUrl(list);
  const itemCount = list.items?.length || 0;
  const tags = [...new Set((list.items || []).map(formatTag))].slice(0, 3);
  const extraCount = Math.max(0, [...new Set((list.items || []).map(formatTag))].length - 3);

  function handleCopy(e) {
    e.stopPropagation();
    navigator.clipboard?.writeText(shareUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleQRPress() {
    setQrPressed(true);
    setTimeout(() => {
      setQrPressed(false);
      setShowQR(true);
    }, 200);
  }

  return (
    <>
      <motion.div
        layout
        className="relative w-full rounded-2xl border border-slate-100 bg-white shadow-sm p-4"
      >
        {/* Top row: name + QR */}
        <div className="flex items-start gap-3">
          <div className="flex-1 flex items-start justify-between gap-3">
            <div className="text-left space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-50">
                  <Heart size={14} className="fill-red-500 text-red-500" />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900 truncate">
                  {list.name}
                </p>
              </div>
              <div className="pl-10">
                <p className="text-xs text-slate-500">
                  {itemCount} {itemCount === 1 ? "item" : "items"} saved
                </p>
                <p className="text-[11px] text-slate-400">Tap QR to share</p>
              </div>
            </div>

            {/* QR tile — replacing mini chart */}
            <motion.button
              type="button"
              animate={{ scale: qrPressed ? 0.88 : 1 }}
              transition={{ type: "spring", damping: 18, stiffness: 400 }}
              onClick={handleQRPress}
              className="flex-shrink-0 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-100 overflow-hidden active:ring-2 active:ring-violet-300 transition-shadow"
              style={{ width: 72, height: 56 }}
            >
              <QRImage url={shareUrl} size={52} />
            </motion.button>
          </div>
        </div>

        {/* Copy link row — replacing "YTD return" */}
        <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <QrCode size={12} className="text-slate-400 flex-shrink-0" />
            <span className="text-[11px] font-medium text-slate-500 truncate">{shareUrl}</span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className={[
              "flex items-center gap-1 flex-shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all",
              copied
                ? "bg-green-100 text-green-700"
                : "bg-[#6B21A8] text-white active:scale-95",
            ].join(" ")}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        {/* Tags row — item types as chips */}
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
              >
                {tag}
              </span>
            ))}
            {extraCount > 0 && (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-600">
                +{extraCount} more
              </span>
            )}
          </div>
        )}

        {/* Items list (expandable) — kept as subtle inline list */}
        {itemCount > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-3 space-y-1.5">
            {(list.items || []).slice(0, 4).map((key) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-slate-600 truncate">
                  {formatTag(key) === "MINT Basket" ? "MINT Basket" : key.replace(/\.JO$/i, "")}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveItem(key)}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 active:bg-red-50 transition-colors"
                >
                  <X size={11} className="text-slate-400" />
                </button>
              </div>
            ))}
            {itemCount > 4 && (
              <p className="text-[11px] text-slate-400">+{itemCount - 4} more items</p>
            )}
          </div>
        )}

        {/* Delete row */}
        <div className="mt-3 border-t border-slate-100 pt-3">
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
      </motion.div>

      {showQR && <QRModal list={list} onClose={() => setShowQR(false)} />}
    </>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 14 }}
        className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-md"
      >
        <Heart size={32} className="fill-red-300 text-red-300" />
      </motion.div>
      <p className="text-[18px] font-bold text-slate-800 mb-2">No wishlists yet</p>
      <p className="text-sm text-slate-400 max-w-xs leading-relaxed">
        Tap ❤️ on any stock or basket to save it to a new wishlist.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MyWishlistsPage({ onBack }) {
  const [wishlists, setWishlists] = useState([]);

  useEffect(() => {
    setWishlists(getWishlists());
  }, []);

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
  }

  const totalItems = wishlists.reduce((t, l) => t + (l.items?.length || 0), 0);

  return (
    <div className="min-h-screen bg-[#f4f5fa] pb-[env(safe-area-inset-bottom)]">
      {/* Purple gradient header — matches Baskets section style */}
      <div className="rounded-b-[36px] bg-gradient-to-b from-[#111111] via-[#3b1b7a] to-[#5b21b6] px-4 pb-8 pt-14 text-white">
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm active:bg-white/25 transition-colors"
          >
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

      {/* Cards */}
      <div className="px-4 pt-5 pb-24 space-y-3">
        {wishlists.length === 0 ? (
          <EmptyState />
        ) : (
          wishlists.map((list) => (
            <WishlistCard
              key={list.id}
              list={list}
              onRemoveItem={(itemKey) => removeItem(list.id, itemKey)}
              onDelete={() => deleteWishlist(list.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
