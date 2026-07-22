import React, { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRight } from "lucide-react";

/**
 * WishlistQuantitySheet
 *
 * Step 1 of the heart→wishlist flow. Opens before WishlistPickerSheet so the
 * user can choose how many baskets / shares they want before selecting a
 * registry. Mirrors the investment-amount picker UI used in PaymentMethodModal.
 *
 * Props:
 *   itemKey        – "strategy:<uuid>" | symbol string
 *   itemName       – display name for the header
 *   pricePerUnit   – cost of ONE unit in Rand (number)
 *   isStrategy     – true → "basket", false → "share"
 *   onClose        – () => void
 *   onConfirm      – (quantity: number) => void
 */
export default function WishlistQuantitySheet({
  itemKey,
  itemName,
  pricePerUnit = 0,
  isStrategy = false,
  onClose,
  onConfirm,
}) {
  const [qty, setQty] = useState(1);
  const MIN_QTY = 1;
  const MAX_QTY = 99;

  const unitLabel = isStrategy ? (qty === 1 ? "basket" : "baskets") : (qty === 1 ? "share" : "shares");
  const totalAmount = pricePerUnit * qty;

  function fmt(amount) {
    if (!amount || isNaN(amount)) return "—";
    return "R\u202F" + Number(amount).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
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
          style={{ zIndex: 100000 }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-[4px] w-10 rounded-full bg-slate-200" />
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
          >
            <X size={15} />
          </button>

          {/* Header */}
          <div className="px-6 pt-3 pb-5">
            <h2 className="text-[17px] font-bold text-slate-900 leading-tight">
              How many {isStrategy ? "baskets" : "shares"}?
            </h2>
            {itemName && (
              <p className="text-xs text-slate-400 mt-0.5 truncate">{itemName}</p>
            )}
          </div>

          {/* Investment amount card — mirrors PaymentMethodModal quantity picker */}
          <div className="mx-5 mb-6 rounded-2xl border border-slate-100 bg-[#f8f9fc] px-5 py-5 flex items-center justify-between gap-3">
            {/* Minus */}
            <button
              onClick={() => setQty(q => Math.max(MIN_QTY, q - 1))}
              disabled={qty <= MIN_QTY}
              className="w-14 h-14 rounded-2xl border border-slate-200 bg-white flex items-center justify-center text-slate-600 text-2xl font-medium active:scale-95 transition shadow-sm disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            >
              −
            </button>

            {/* Amount display */}
            <div className="flex-1 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                Investment Amount
              </p>
              <p className="text-[28px] font-bold text-slate-900 tracking-tight leading-none">
                {fmt(totalAmount)}
              </p>
              <p className="text-[12px] text-slate-400 mt-1.5">
                {qty} {unitLabel}
                {pricePerUnit > 0 && (
                  <span> × {fmt(pricePerUnit)}</span>
                )}
              </p>
            </div>

            {/* Plus */}
            <button
              onClick={() => setQty(q => Math.min(MAX_QTY, q + 1))}
              disabled={qty >= MAX_QTY}
              className="w-14 h-14 rounded-2xl bg-[#6B21A8] flex items-center justify-center text-white text-2xl font-medium active:scale-95 transition shadow-md disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            >
              +
            </button>
          </div>

          {/* Confirm button */}
          <div className="px-5 pb-10">
            <button
              onClick={() => onConfirm(qty)}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#111111] py-4 text-sm font-bold text-white active:scale-[0.97] transition-transform"
            >
              Choose a wishlist <ArrowRight size={16} />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    portalTarget
  );
}
