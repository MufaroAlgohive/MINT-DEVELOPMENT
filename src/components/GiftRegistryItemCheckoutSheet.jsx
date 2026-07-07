import React, { useState } from "react";
import { centsToRand, calcMinTrancheForAsset } from "../lib/giftRegistryUtils.js";
import { supabaseReady } from "../lib/supabase.js";

const QUICK_EMOJIS = ["🎉", "🎂", "💜", "🌱", "🚀", "✨", "🙌", "❤️"];

/**
 * Bottom sheet checkout for a single registry item.
 * Decision 2: minimum = same as app's R10 floor
 * Decision 7: fee via /api/gift-registry/reserve (computeFees server-side)
 * Decision 8: price at confirmation time, market order, no guarantee
 * Decision 9: whole units only
 *
 * Flow: quantity → message → pay
 */
export default function GiftRegistryItemCheckoutSheet({ item, registryId, onSuccess, onClose }) {
  const minQty = item.min_tranche_quantity ?? calcMinTrancheForAsset(item.price_snapshot_cents);
  const maxQty = (item.target_quantity ?? 0) - (item.filled_quantity ?? 0) - (item.reserved_quantity ?? 0);

  const [step, setStep] = useState("quantity"); // "quantity" | "message" | "pay"
  const [quantity, setQuantity] = useState(minQty);
  const [gifterMessage, setGifterMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reserved, setReserved] = useState(null);

  const priceCents = item.price_snapshot_cents ?? 0;
  const subtotalCents = quantity * priceCents;
  const feeEstimateCents = Math.round(subtotalCents * 0.006);
  const totalCents = subtotalCents + feeEstimateCents;

  function increment() { setQuantity(q => Math.min(maxQty, q + 1)); }
  function decrement() { setQuantity(q => Math.max(minQty, q - 1)); }

  async function handleReserve() {
    setLoading(true);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch("/api/gift-registry/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemId: item.id, quantity, registryId }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === "SOLD_OUT") setError(`Only ${json.remaining ?? 0} shares left — try a smaller quantity.`);
        else if (json.code === "KYC_INCOMPLETE") setError("Complete your MINT verification to gift from a wishlist.");
        else setError(json.error || "Could not reserve. Please try again.");
        return;
      }
      setReserved(json.reservationId);
      setStep("message");
    } catch {
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          reservationId: reserved,
          registryId,
          itemId: item.id,
          quantity,
          gifterMessage: gifterMessage.trim() || null,
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
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

        {step === "quantity" && (
          <>
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

            <p className="text-xs text-gray-500 mb-2 font-medium">Number of shares (whole units only)</p>
            <div className="flex items-center justify-between bg-gray-50 rounded-2xl p-3 mb-4">
              <button onClick={decrement} disabled={quantity <= minQty}
                className="w-10 h-10 rounded-xl bg-white border border-gray-200 text-xl font-semibold text-gray-700 disabled:opacity-30">
                −
              </button>
              <div className="text-center">
                <span className="text-2xl font-bold text-gray-800">{quantity}</span>
                <p className="text-[10px] text-gray-400">Min {minQty}</p>
              </div>
              <button onClick={increment} disabled={quantity >= maxQty}
                className="w-10 h-10 rounded-xl bg-[#6B21A8] text-white text-xl font-semibold disabled:opacity-30">
                +
              </button>
            </div>

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

            <p className="text-[10px] text-gray-400 mb-4 text-center">
              Price is approximate. Order executes at market price — same as normal investing.
            </p>

            {error && <p className="text-sm text-red-600 mb-3 text-center">{error}</p>}

            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium">
                Cancel
              </button>
              <button onClick={handleReserve} disabled={loading || quantity < minQty || quantity > maxQty}
                className="flex-1 py-3 rounded-2xl bg-[#6B21A8] text-white text-sm font-semibold disabled:opacity-50">
                {loading ? "Reserving…" : "Confirm gift"}
              </button>
            </div>
          </>
        )}

        {step === "message" && (
          <>
            <div className="text-center mb-5">
              <div className="w-14 h-14 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">💌</span>
              </div>
              <h3 className="text-base font-bold text-gray-800 mb-1">Leave a note</h3>
              <p className="text-sm text-gray-400">Optional — your message will be shared with the wishlist owner</p>
            </div>

            <div className="flex flex-wrap gap-2 mb-3 justify-center">
              {QUICK_EMOJIS.map(e => (
                <button key={e}
                  onClick={() => setGifterMessage(m => (m + e).slice(0, 120))}
                  className="text-xl active:scale-90 transition-transform">
                  {e}
                </button>
              ))}
            </div>

            <textarea
              value={gifterMessage}
              onChange={e => setGifterMessage(e.target.value.slice(0, 120))}
              placeholder="Write a short message… (optional)"
              rows={3}
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm outline-none resize-none mb-1"
            />
            <p className="text-[10px] text-gray-400 text-right mb-4">{gifterMessage.length}/120</p>

            <div className="flex gap-3">
              <button onClick={() => setStep("quantity")}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium">
                Back
              </button>
              <button onClick={() => setStep("pay")}
                className="flex-1 py-3 rounded-2xl bg-[#6B21A8] text-white text-sm font-semibold">
                Next
              </button>
            </div>
          </>
        )}

        {step === "pay" && (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🎁</span>
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-1">Confirm your gift</h3>
              <p className="text-sm text-gray-500">
                {quantity} share{quantity !== 1 ? "s" : ""} of {item.name || item.isin} — ~{centsToRand(totalCents)}
              </p>
              {gifterMessage && (
                <div className="mt-3 bg-purple-50 rounded-xl px-4 py-2.5 text-left">
                  <p className="text-[10px] text-purple-400 font-medium mb-0.5">Your note</p>
                  <p className="text-sm text-gray-700 italic">"{gifterMessage}"</p>
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-3">
                Your spot is held for 10 minutes. Complete payment to secure it.
              </p>
            </div>

            {error && <p className="text-sm text-red-600 mb-3 text-center">{error}</p>}

            <div className="flex gap-3">
              <button onClick={() => setStep("message")}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium">
                Back
              </button>
              <button onClick={handleConfirmPayment} disabled={loading}
                className="flex-1 py-3 rounded-2xl bg-[#6B21A8] text-white text-sm font-semibold disabled:opacity-50">
                {loading ? "Processing…" : "Pay now"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
