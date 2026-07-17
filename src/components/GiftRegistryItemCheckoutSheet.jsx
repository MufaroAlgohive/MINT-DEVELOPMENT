import React, { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, ArrowRight, X } from "lucide-react";
import { calcMinTrancheForAsset } from "../lib/giftRegistryUtils.js";
import { supabaseReady } from "../lib/supabase.js";
import { useFees } from "../lib/useFees.js";
import PaymentMethodModal from "./PaymentMethodModal.jsx";

const QUICK_EMOJIS = ["🎉", "🎂", "💜", "🌱", "🚀", "✨", "🙌", "❤️"];

/** Full-screen modal telling the user they need to finish onboarding before gifting. */
function KycRequiredModal({ onClose }) {
  function goToOnboarding() {
    onClose();
    window.dispatchEvent(
      new CustomEvent("navigate-within-app", { detail: { page: "userOnboarding" } })
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex items-center justify-center px-5 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          className="relative w-full max-w-sm bg-white rounded-3xl p-7 shadow-2xl text-center"
          initial={{ scale: 0.92, opacity: 0, y: 24 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 24 }}
          transition={{ type: "spring", damping: 22, stiffness: 320 }}
        >
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 transition"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Icon */}
          <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-5">
            <ShieldCheck className="w-8 h-8 text-purple-600" />
          </div>

          <h2 className="text-lg font-bold text-gray-900 mb-2">
            Verification required
          </h2>
          <p className="text-sm text-gray-500 leading-relaxed mb-6">
            To gift from a wishlist you need to complete your MINT verification first.
            It only takes a few minutes — pick up right where you left off.
          </p>

          {/* Primary CTA */}
          <button
            onClick={goToOnboarding}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] text-white text-sm font-semibold shadow-md active:scale-95 transition"
          >
            Complete verification
            <ArrowRight className="w-4 h-4" />
          </button>

          {/* Secondary dismiss */}
          <button
            onClick={onClose}
            className="mt-3 w-full py-2.5 rounded-2xl text-sm font-medium text-gray-400 hover:text-gray-600 transition"
          >
            Maybe later
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Bottom sheet checkout for a single registry item.
 * Fee breakdown and payment popup are identical to the Mint Baskets invest flow.
 *
 * Flow: reserve automatically on open → message → PaymentMethodModal (wallet / Ozow / EFT)
 */
export default function GiftRegistryItemCheckoutSheet({ item, registryId, onSuccess, onClose }) {
  const minQty = item.min_tranche_quantity ?? calcMinTrancheForAsset(item.price_snapshot_cents);

  const [step, setStep] = useState("reserving"); // "reserving" | "message"
  const [quantity] = useState(minQty);
  const [gifterMessage, setGifterMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reserved, setReserved] = useState(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showKycPrompt, setShowKycPrompt] = useState(false);
  const reserveTriggered = useRef(false);

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

  async function handleReserve() {
    setLoading(true);
    setError(null);
    try {
      const sb = await supabaseReady;
      let sessionData = (await sb.auth.getSession()).data?.session;
      // If no active session, try to refresh the token before giving up
      if (!sessionData?.access_token) {
        const { data: refreshed } = await sb.auth.refreshSession();
        sessionData = refreshed?.session;
      }
      const token = sessionData?.access_token;
      if (!token) {
        setError("Your session has expired. Please sign in again to gift.");
        return;
      }
      const res = await fetch("/api/gift-registry/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemId: item.id, quantity, registryId }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === "SOLD_OUT") setError("This item is no longer available to gift.");
        else if (json.code === "KYC_INCOMPLETE") {
          // Debug: fetch the onboarding status so we can see exactly what the server sees
          try {
            const sb2 = await supabaseReady;
            const { data: { session: s2 } } = await sb2.auth.getSession();
            if (s2?.access_token) {
              const dbg = await fetch('/api/onboarding/status', {
                headers: { Authorization: `Bearer ${s2.access_token}` },
              });
              const dbgJson = await dbg.json();
              console.warn('[GiftRegistry][KYC_DEBUG] reserve blocked — onboarding status:', {
                is_fully_onboarded: dbgJson.is_fully_onboarded,
                kyc_status: dbgJson.onboarding?.kyc_status,
                sumsub_raw_keys: dbgJson.onboarding?.sumsub_raw
                  ? Object.keys(typeof dbgJson.onboarding.sumsub_raw === 'string'
                      ? JSON.parse(dbgJson.onboarding.sumsub_raw)
                      : dbgJson.onboarding.sumsub_raw)
                  : null,
              });
            }
          } catch (dbgErr) {
            console.warn('[GiftRegistry][KYC_DEBUG] could not fetch onboarding status:', dbgErr.message);
          }
          setShowKycPrompt(true);
          return;
        }
        else if (res.status === 401) setError("Your session has expired. Please sign in again to gift.");
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

  // Reserve the item automatically as soon as the sheet opens — the quantity/fee
  // breakdown + "Confirm gift" step was redundant with PaymentMethodModal's own
  // confirm screen, so gifting now goes straight from opening the sheet into
  // writing a message, then choosing/confirming a payment method.
  useEffect(() => {
    if (reserveTriggered.current) return;
    reserveTriggered.current = true;
    handleReserve();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleWalletPayment(totalAmount) {
    setLoading(true);
    setError(null);
    try {
      const sb = await supabaseReady;
      let sessionData = (await sb.auth.getSession()).data?.session;
      if (!sessionData?.access_token) {
        const { data: refreshed } = await sb.auth.refreshSession();
        sessionData = refreshed?.session;
      }
      const token = sessionData?.access_token;
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
      const sb = await supabaseReady;
      let sessionData = (await sb.auth.getSession()).data?.session;
      if (!sessionData?.access_token) {
        const { data: refreshed } = await sb.auth.refreshSession();
        sessionData = refreshed?.session;
      }
      const token = sessionData?.access_token;
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

            {/* ── Step 1: Reserving the item (auto-runs on open, no extra confirm tap) ── */}
            {step === "reserving" && (
              <>
                <div className="flex items-center gap-3 mb-6">
                  {item.logo_url ? (
                    <img src={item.logo_url} className="w-10 h-10 rounded-xl border border-gray-100" alt={item.name} />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                      <span className="text-purple-700 font-bold">{(item.name || "?")[0]}</span>
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-gray-800">{item.name || item.isin}</p>
                  </div>
                </div>

                <div className="py-6 text-center">
                  {loading && !error && (
                    <>
                      <div className="w-8 h-8 border-2 border-[#6B21A8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                      <p className="text-sm text-gray-400">Reserving your gift…</p>
                    </>
                  )}
                  {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={onClose}
                    className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium"
                  >
                    Cancel
                  </button>
                  {error && (
                    <button
                      onClick={handleReserve}
                      disabled={loading}
                      className="flex-1 py-3 rounded-2xl bg-[#6B21A8] text-white text-sm font-semibold disabled:opacity-50"
                    >
                      Try again
                    </button>
                  )}
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
                    onClick={onClose}
                    className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium"
                  >
                    Cancel
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

      {/* ── KYC / onboarding required modal ── */}
      {showKycPrompt && (
        <KycRequiredModal onClose={() => { setShowKycPrompt(false); onClose(); }} />
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
