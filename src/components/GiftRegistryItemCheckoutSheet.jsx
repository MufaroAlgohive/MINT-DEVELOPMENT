import React, { useState, useEffect } from "react";
import { centsToRand, calcMinTrancheForAsset } from "../lib/giftRegistryUtils.js";
import { supabaseReady } from "../lib/supabase.js";

/**
 * Bottom sheet checkout for a single registry item.
 * Decision 2: minimum = same as app's R10 floor
 * Decision 7: fee via /api/gift-registry/reserve (computeFees server-side)
 * Decision 8: price at confirmation time, market order, no guarantee
 * Decision 9: whole units only
 */
export default function GiftRegistryItemCheckoutSheet({ item, registryId, onSuccess, onClose }) {
  const minQty = item.min_tranche_quantity ?? calcMinTrancheForAsset(item.price_snapshot_cents);
  const maxQty = (item.target_quantity ?? 0) - (item.filled_quantity ?? 0) - (item.reserved_quantity ?? 0);

  const [quantity, setQuantity] = useState(minQty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reserved, setReserved] = useState(null); // reservation id after reserve step
  const [confirming, setConfirming] = useState(false);

  const priceCents = item.price_snapshot_cents ?? 0;
  const subtotalCents = quantity * priceCents;
  // Fee estimate (server computes exact; show approximate here)
  const feeEstimateCents = Math.round(subtotalCents * 0.006); // ~0.6% estimate
  const totalCents = subtotalCents + feeEstimateCents;

  function increment() { setQuantity((q) => Math.min(maxQty, q + 1)); }
  function decrement() { setQuantity((q) => Math.max(minQty, q - 1)); }

  async function handleReserve() {
    setLoading(true);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch("/api/gift-registry/reserve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemId: item.id,
          quantity,
          registryId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === "SOLD_OUT") {
          setError(`Only ${json.remaining ?? 0} shares left — try a smaller quantity.`);
        } else if (json.code === "KYC_INCOMPLETE") {
          setError("Complete your MINT verification to gift from a registry.");
        } else {
          setError(json.error || "Could not reserve. Please try again.");
        }
        return;
      }
      setReserved(json.reservationId);
      setConfirming(true);
    } catch (e) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmPayment() {
    setLoading(true);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch("/api/gift-registry/contribute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reservationId: reserved,
          registryId,
          itemId: item.id,
          quantity,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Payment failed");
      if (typeof onSuccess === "function") onSuccess(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-t-3xl px-6 pt-6 pb-10 shadow-2xl">
        {/* Handle */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

        {!confirming ? (
          <>
            {/* Item header */}
            <div className="flex items-center gap-3 mb-5">
              {item.logo_url ? (
                <img src={item.logo_url} className="w-10 h-10 rounded-xl border border-gray-100" alt={item.name} />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                  <span className="text-purple-700 font-bold">{(item.name || "?")[0]}</span>
                </div>
              )}
              <div>
                <p className="font-semibold text-gray-800">{item.name || item.isin}</p>
                <p className="text-xs text-gray-400">~{centsToRand(priceCents)} / share</p>
              </div>
            </div>

            {/* Quantity picker */}
            <p className="text-xs text-gray-500 mb-2 font-medium">Number of shares (whole units only)</p>
            <div className="flex items-center justify-between bg-gray-50 rounded-2xl p-3 mb-4">
              <button
                onClick={decrement}
                disabled={quantity <= minQty}
                className="w-10 h-10 rounded-xl bg-white border border-gray-200 text-xl font-semibold text-gray-700 disabled:opacity-30"
              >
                −
              </button>
              <div className="text-center">
                <span className="text-2xl font-bold text-gray-800">{quantity}</span>
                <p className="text-[10px] text-gray-400">Min {minQty}</p>
              </div>
              <button
                onClick={increment}
                disabled={quantity >= maxQty}
                className="w-10 h-10 rounded-xl bg-[#6B21A8] text-white text-xl font-semibold disabled:opacity-30"
              >
                +
              </button>
            </div>

            {/* Cost breakdown */}
            <div className="bg-purple-50 rounded-2xl p-4 mb-5 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">{quantity} × {centsToRand(priceCents)}</span>
                <span className="text-gray-800 font-medium">{centsToRand(subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Est. fee</span>
                <span className="text-gray-500">{centsToRand(feeEstimateCents)}</span>
              </div>
              <div className="border-t border-purple-100 pt-1.5 flex justify-between">
                <span className="text-sm font-semibold text-gray-700">Approx. total</span>
                <span className="text-sm font-bold text-[#6B21A8]">{centsToRand(totalCents)}</span>
              </div>
            </div>

            {/* Disclaimer */}
            <p className="text-[10px] text-gray-400 mb-4 text-center">
              Price is approximate. Order executes at market price — same as normal investing.
            </p>

            {error && (
              <p className="text-sm text-red-600 mb-3 text-center">{error}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleReserve}
                disabled={loading || quantity < minQty || quantity > maxQty}
                className="flex-1 py-3 rounded-2xl bg-[#6B21A8] text-white text-sm font-semibold disabled:opacity-50"
              >
                {loading ? "Reserving…" : "Confirm gift"}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Payment confirmation step */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🎁</span>
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-1">Confirm your gift</h3>
              <p className="text-sm text-gray-500">
                {quantity} share{quantity !== 1 ? "s" : ""} of {item.name || item.isin} — ~{centsToRand(totalCents)}
              </p>
              <p className="text-[10px] text-gray-400 mt-2">
                Your spot is held for 10 minutes. Complete payment to secure it.
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-600 mb-3 text-center">{error}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPayment}
                disabled={loading}
                className="flex-1 py-3 rounded-2xl bg-[#6B21A8] text-white text-sm font-semibold disabled:opacity-50"
              >
                {loading ? "Processing…" : "Pay now"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
