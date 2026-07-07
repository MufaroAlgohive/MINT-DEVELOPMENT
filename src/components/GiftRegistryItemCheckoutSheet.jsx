import React, { useState, useMemo } from "react";
import { centsToRand, calcMinTrancheForAsset } from "../lib/giftRegistryUtils.js";
import { supabaseReady } from "../lib/supabase.js";
import { useFees } from "../lib/useFees.js";
import PaymentMethodModal from "./PaymentMethodModal.jsx";

const QUICK_EMOJIS = ["🎉", "🎂", "💜", "🌱", "🚀", "✨", "🙌", "❤️"];

/**
 * Bottom sheet checkout for a single registry item.
 * Fee breakdown and payment popup are identical to the Mint Baskets invest flow.
 *
 * Flow: quantity (full fee breakdown) → message → PaymentMethodModal (wallet / Ozow / EFT)
 */
export default function GiftRegistryItemCheckoutSheet({ item, registryId, onSuccess, onClose }) {
  const minQty = item.min_tranche_quantity ?? calcMinTrancheForAsset(item.price_snapshot_cents);
  const maxQty = (item.target_quantity ?? 0) - (item.filled_quantity ?? 0) - (item.reserved_quantity ?? 0);

  const [step, setStep] = useState("quantity"); // "quantity" | "message"
  const [quantity, setQuantity] = useState(minQty);
  const [gifterMessage, setGifterMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reserved, setReserved] = useState(null);
  const [showPayment, setShowPayment] = useState(false);

  const {
    ISIN_FEE_PER_ASSET,
    BROKER_FEE_RATE,
    CASH_BUFFER_RATE,
    WALLET_TRANSACTION_FEE_RATE,
    OZOW_TRANSACTION_FEE_RATE,
    AUM_FEE_RATE,
  } = useFees();

  // price_snapshot_cents is the raw base price (BEFORE 8% markup), in cents
  const priceCents = item.price_snapshot_cents ?? 0;
  const numAssets = item.total_holdings || item.holdings_snapshot?.length || 1;

  // Identical fee logic to AdultInvestModal / PaymentMethodModal
  const fees = useMemo(() => {
    const baseAmount = (quantity * priceCents) / 100;
    const bufferedBase = baseAmount * (1 + CASH_BUFFER_RATE);
    const brokerAmount = bufferedBase * BROKER_FEE_RATE;
    const isinTotal = ISIN_FEE_PER_ASSET * numAssets;
    const walletTxFee = bufferedBase * WALLET_TRANSACTION_FEE_RATE;
    const ozowTxFee = bufferedBase * OZOW_TRANSACTION_FEE_RATE;
    const walletTotal = bufferedBase + brokerAmount + isinTotal + walletTxFee;
    const ozowTotal = bufferedBase + brokerAmount + isinTotal + ozowTxFee;
    return { baseAmount, bufferedBase, brokerAmount, isinTotal, walletTxFee, ozowTxFee, walletTotal, ozowTotal };
  }, [quantity, priceCents, numAssets, CASH_BUFFER_RATE, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, WALLET_TRANSACTION_FEE_RATE, OZOW_TRANSACTION_FEE_RATE]);

  function increment() { setQuantity(q => Math.min(maxQty, q + 1)); }
  function decrement() { setQuantity(q => Math.max(minQty, q - 1)); }

  const fmt = (v) =>
    `R${Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (r) => `${(r * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

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

  async function handleWalletPayment(totalAmount) {
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
          paymentMethod: "wallet",
          totalAmount,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Payment failed");
      setShowPayment(false);
      if (typeof onSuccess === "function") onSuccess(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOzowPayment(ozowAmount) {
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
          paymentMethod: "ozow",
          totalAmount: ozowAmount,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Payment failed");
      setShowPayment(false);
      if (typeof onSuccess === "function") onSuccess(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Main bottom sheet — hidden while PaymentMethodModal is open */}
      {!showPayment && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-t-3xl px-6 pt-6 pb-10 shadow-2xl">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

            {/* ── Step 1: Quantity + full fee breakdown ── */}
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

                {/* Full fee breakdown — identical to PaymentMethodModal wallet confirm layout */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-2 mb-4">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Investment (incl. 8% reserve)</span>
                    <span className="font-semibold text-slate-900">{fmt(fees.bufferedBase)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Brokerage fee ({pct(BROKER_FEE_RATE)})</span>
                    <span className="font-semibold text-slate-900">{fmt(fees.brokerAmount)}</span>
                  </div>
                  {fees.isinTotal > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Custody fee</span>
                      <span className="font-semibold text-slate-900">{fmt(fees.isinTotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">
                      Transaction fee ({pct(WALLET_TRANSACTION_FEE_RATE)}) — Wallet
                    </span>
                    <span className="font-semibold text-slate-900">{fmt(fees.walletTxFee)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">AUM fee ({pct(AUM_FEE_RATE)} p.a.)</span>
                    <span className="font-medium text-slate-400">monthly from cash</span>
                  </div>
                  <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between text-sm">
                    <span className="font-bold text-slate-700">Approx. total</span>
                    <span className="font-bold text-violet-700">{fmt(fees.walletTotal)}</span>
                  </div>
                </div>

                <p className="text-[10px] text-gray-400 mb-4 text-center">
                  Price is approximate. Order executes at market price — same as normal investing.
                </p>

                {error && <p className="text-sm text-red-600 mb-3 text-center">{error}</p>}

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
            )}

            {/* ── Step 2: Optional message ── */}
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
                    <button
                      key={e}
                      onClick={() => setGifterMessage(m => (m + e).slice(0, 120))}
                      className="text-xl active:scale-90 transition-transform"
                    >
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

                {error && <p className="text-sm text-red-600 mb-3 text-center">{error}</p>}

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep("quantity")}
                    className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setShowPayment(true)}
                    className="flex-1 py-3 rounded-2xl bg-[#6B21A8] text-white text-sm font-semibold"
                  >
                    Choose payment
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── PaymentMethodModal — exact same component as the invest flow ── */}
      <PaymentMethodModal
        isOpen={showPayment}
        onClose={() => setShowPayment(false)}
        amount={fees.baseAmount}
        baseAmount={fees.baseAmount}
        strategyName={item.name || item.isin}
        fees={{
          bufferedBase: fees.bufferedBase,
          brokerAmount: fees.brokerAmount,
          isinTotal: fees.isinTotal,
        }}
        onSelectWallet={handleWalletPayment}
        onSelectOzow={handleOzowPayment}
        onEFTConfirm={() => {}}
        onSelectEFT={() => {}}
      />
    </>
  );
}
