import React, { useState, useMemo, useRef, useEffect } from "react";
import { ArrowLeft, Minus, Plus, X, Download } from "lucide-react";
import { formatCurrency } from "../lib/formatCurrency";
import PdfViewer from "../components/PdfViewer";
import GiftToggleV2 from "../components/GiftToggleV2";
import { useOnboardingStatus } from "../lib/useOnboardingStatus";
import { useFees } from "../lib/useFees";
import { motion, AnimatePresence } from "framer-motion";

const GiftSecurityInvestPage = ({ onBack, security, onGiftDone }) => {
  const [quantity, setQuantity] = useState(1);
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [shakeAgreement, setShakeAgreement] = useState(false);
  const [showMandateModal, setShowMandateModal] = useState(false);
  const [giftSheetOpen, setGiftSheetOpen] = useState(true); // starts open
  const [showGiftLockedToast, setShowGiftLockedToast] = useState(false);
  const toastTimerRef = useRef(null);
  const giftSheetRef = useRef(null);

  const { onboardingComplete: isFullyOnboarded, loading: isLoadingStatus } =
    useOnboardingStatus();

  const { ISIN_FEE_PER_ASSET, BROKER_FEE_RATE, TRANSACTION_FEE_RATE, CASH_BUFFER_RATE } = useFees();

  const pricePerShare = security?.currentPrice ?? security?.last_price ?? 0;
  const baseAmount = quantity * pricePerShare;

  const fees = useMemo(() => {
    // Single securities: no cash buffer reserve — invest the exact stated amount
    const bufferedBase = baseAmount;
    const brokerAmount = bufferedBase * BROKER_FEE_RATE;
    const isinTotal = ISIN_FEE_PER_ASSET * 1; // single security
    const transactionAmount = bufferedBase * TRANSACTION_FEE_RATE;
    const totalCost = bufferedBase + brokerAmount + isinTotal + transactionAmount;
    return { bufferedBase, brokerAmount, isinTotal, transactionAmount, totalCost };
  }, [baseAmount, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, TRANSACTION_FEE_RATE]);

  const totalCostCents = Math.round(fees.totalCost * 100);

  const handleIncrement = () => setQuantity((q) => q + 1);
  const handleDecrement = () => setQuantity((q) => Math.max(1, q - 1));

  const symbol = security?.symbol || "";
  const name = security?.short_name || security?.name || symbol;
  const logoUrl = security?.logo_url || null;

  function showLockedToast() {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setShowGiftLockedToast(true);
    toastTimerRef.current = setTimeout(() => setShowGiftLockedToast(false), 2500);
  }

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  return (
    <div className="min-h-screen bg-slate-50 pb-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-sm flex-col px-3 pt-12 md:max-w-md md:px-6">

        {/* Header */}
        <header className="flex items-center justify-center gap-3 mb-6 relative">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm flex-shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">Complete Investment</h1>
        </header>

        {/* Security Card */}
        <section className="mb-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-slate-100 bg-slate-50 overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt={symbol} className="h-full w-full object-cover" />
              ) : (
                <span className="text-sm font-bold text-slate-500 uppercase">
                  {symbol.slice(0, 2)}
                </span>
              )}
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-slate-900 leading-tight">
                {name}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {symbol}{security?.exchange ? ` · ${security.exchange}` : ""}
              </p>
              {pricePerShare > 0 && (
                <p className="text-xs font-semibold text-slate-600 mt-1">
                  Price per share:{" "}
                  <span className="text-slate-900">
                    {formatCurrency(pricePerShare, "R")}
                  </span>
                </p>
              )}
            </div>
            {security?.changePct != null && (
              <span
                className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded-full ${
                  security.changePct >= 0
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-red-50 text-red-500"
                }`}
              >
                {security.changePct >= 0 ? "+" : ""}
                {security.changePct.toFixed(2)}%
              </span>
            )}
          </div>

          {security?.sector && (
            <div className="pt-3 border-t border-slate-100">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-600">
                {security.sector}
              </span>
            </div>
          )}
        </section>

        {/* Quantity Input */}
        <section className="mb-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleDecrement}
                disabled={quantity <= 1}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:enabled:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <Minus className="h-5 w-5" />
              </button>

              <div className="text-center flex-1">
                <p className="text-xs font-semibold text-slate-500 mb-1">
                  Number of Shares
                </p>
                <p className="text-3xl font-bold text-slate-900 leading-none">
                  {quantity}
                </p>
                {pricePerShare > 0 && (
                  <p className="text-xs text-slate-400 mt-1">
                    Total:{" "}
                    <span className="font-semibold text-slate-700">
                      {formatCurrency(fees.totalCost, "R")}
                    </span>
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={handleIncrement}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] text-white hover:shadow-lg transition"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>

        {/* Agreement Checkbox */}
        <section
          className={`mb-6 rounded-2xl border p-4 shadow-sm transition-colors duration-300 ${
            shakeAgreement ? "border-rose-400 bg-rose-50" : "border-slate-100 bg-white"
          }`}
          style={shakeAgreement ? { animation: "shake 0.4s ease" } : {}}
          onAnimationEnd={() => setShakeAgreement(false)}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreementChecked}
              onChange={(e) => setAgreementChecked(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 flex-shrink-0"
            />
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-900">
                I agree to Risk Disclosure, Fee Schedule &{" "}
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setShowMandateModal(true); }}
                  className="underline text-violet-700 hover:text-violet-900"
                >
                  Strategy Mandate
                </button>
              </p>
              <p className="text-xs text-slate-600 mt-1">
                By continuing, you confirm you have reviewed and agree to all
                terms and conditions
              </p>
            </div>
          </label>
        </section>

        {/* PDF Modal */}
        <div
          className="fixed inset-0 flex flex-col bg-white"
          style={{ zIndex: 100, display: showMandateModal ? "flex" : "none" }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Risk Disclosure</h2>
            <div className="flex items-center gap-1">
              <a
                href="/strategy-disclosures.pdf"
                download="Risk-Disclosure.pdf"
                className="p-1.5 rounded-full hover:bg-slate-100 transition-colors"
                aria-label="Download PDF"
              >
                <Download className="h-5 w-5 text-slate-600" />
              </a>
              <button
                type="button"
                onClick={() => setShowMandateModal(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 transition-colors"
              >
                <X className="h-5 w-5 text-slate-600" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <PdfViewer file="/strategy-disclosures.pdf" style={{ height: "100%" }} />
          </div>
        </div>

        {/* Gift Toggle — always ON, locked. Toast shown on toggle-off attempt. */}
        <GiftToggleV2
          enabled={true}
          onToggle={(val) => {
            if (!val) showLockedToast();
            // always stays enabled — no-op on toggle off
          }}
          onSheetOpenChange={setGiftSheetOpen}
          giftSheetRef={giftSheetRef}
          onDone={onGiftDone}
          security={{ id: security?.id, symbol, name }}
          assetType="stock"
          totalCostCents={totalCostCents}
          amountDisplay={formatCurrency(fees.totalCost, "R")}
          fees={fees}
          singleSecurity={true}
        />

        <div className="mt-4" />

        {/* CTA — only when gift sheet is closed */}
        {!giftSheetOpen && !isLoadingStatus && !isFullyOnboarded ? (
          <div className="w-full rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center">
            <h3 className="text-sm font-semibold text-rose-800 mb-2">Onboarding Required</h3>
            <p className="text-xs text-rose-700 mb-4">
              Complete your profile and verify your identity before gifting.
            </p>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("navigate-within-app", { detail: { page: "userOnboarding" } })
                )
              }
              className="w-full rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 transition"
            >
              Complete Onboarding
            </button>
          </div>
        ) : !giftSheetOpen ? (
          <button
            type="button"
            onClick={() => {
              if (!agreementChecked) { setShakeAgreement(true); return; }
              giftSheetRef.current?.open();
            }}
            disabled={isLoadingStatus}
            className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-3 text-sm font-semibold text-white shadow-lg shadow-violet-200/60 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:-translate-y-0.5 transition"
          >
            {isLoadingStatus ? "Checking status…" : "Select Recipient"}
          </button>
        ) : null}
      </div>

      {/* Toast — gift mode locked */}
      <AnimatePresence>
        {showGiftLockedToast && (
          <motion.div
            key="gift-locked-toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[20000] flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 shadow-xl"
          >
            <span className="text-base">🎁</span>
            <p className="text-sm font-semibold text-white whitespace-nowrap">
              Gift mode is always on for this flow
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default GiftSecurityInvestPage;
