import React, { useState, useMemo, useEffect, useRef } from "react";
import { ArrowLeft, Info, Plus, Minus, ChevronDown, ChevronUp, X, Download } from "lucide-react";
import { formatCurrency } from "../lib/formatCurrency";
import PdfViewer from "../components/PdfViewer";
import { supabase } from "../lib/supabase";
import { useOnboardingStatus } from "../lib/useOnboardingStatus";
import GiftToggleV2 from "../components/GiftToggleV2";
import { useFees } from "../lib/useFees";

const InvestAmountPage = ({ onBack, strategy, onContinue, paymentMethod, startWithGiftOpen = false, onGiftDone }) => {
  const currentStrategy = strategy || {
    name: "",
    tickers: [],
    description: "",
  };
  const isAdditionalStrategy = !!currentStrategy.isAdditionalStrategy;
  const { ISIN_FEE_PER_ASSET, BROKER_FEE_RATE, TRANSACTION_FEE_RATE, CASH_BUFFER_RATE } = useFees();

  const minimumInvestment =
    currentStrategy.calculatedMinInvestment ||
    currentStrategy.min_investment ||
    null;
  const currency = currentStrategy.currency || "R";

  // ── FIX 2: Lazy initialiser — avoids R0.00 flash while strategy loads ────
  const [amount, setAmount] = useState(() => minimumInvestment || 0);
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [showMandateModal, setShowMandateModal] = useState(false);
  const [feeExpanded, setFeeExpanded] = useState(false);
  const [giftEnabled, setGiftEnabled] = useState(startWithGiftOpen);
  const [giftSheetOpen, setGiftSheetOpen] = useState(startWithGiftOpen);
  const giftSheetRef = useRef(null);

  useEffect(() => {
    if (minimumInvestment && minimumInvestment > 0) {
      setAmount(minimumInvestment);
    }
  }, [minimumInvestment]);

  const { onboardingComplete: isFullyOnboarded, loading: isLoadingStatus } =
    useOnboardingStatus();

  const holdingsData =
    currentStrategy.holdingsWithLogos || currentStrategy.holdings || [];
  const numAssets = holdingsData.length || 0;
  const extraHoldings = holdingsData.length > 3 ? holdingsData.length - 3 : 0;

  const fees = useMemo(() => {
    const bufferedBase = amount * (1 + CASH_BUFFER_RATE);
    const brokerAmount = bufferedBase * BROKER_FEE_RATE;
    const isinTotal = ISIN_FEE_PER_ASSET * numAssets;
    const transactionAmount = bufferedBase * TRANSACTION_FEE_RATE;
    const totalCost = bufferedBase + brokerAmount + isinTotal + transactionAmount;
    
    return { brokerAmount, isinTotal, transactionAmount, totalCost, bufferedBase };
  }, [amount, numAssets, isAdditionalStrategy, CASH_BUFFER_RATE, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, TRANSACTION_FEE_RATE]);

  const step = minimumInvestment || 0;

  const handleIncrement = () => {
    if (step > 0) setAmount((prev) => prev + step);
  };

  const handleDecrement = () => {
    if (step > 0 && amount > step) {
      setAmount((prev) => prev - step);
    }
  };

  // ── Dynamic info banner text based on payment method and strategy type ────
  const getInfoText = () => {
    if (paymentMethod === "wallet") {
      return "Your wallet balance will be used to complete this investment instantly.";
    }
    if (paymentMethod === "direct_eft") {
      return "You'll receive banking details to complete your EFT payment.";
    }
    // Default — no payment method selected yet, hide the banner
    return null;
  };

  // ── FIX 4: Pass baseAmount and shareCount through to PaymentPage ──────────
  // shareCount is calculated here as amount / pricePerShare if available,
  // otherwise left null and handled downstream
  const handleContinue = () => {
    const sharePrice =
      currentStrategy.price_per_share ||
      currentStrategy.pricePerShare ||
      null;
    const shareCount =
      sharePrice && sharePrice > 0
        ? Math.floor(amount / sharePrice)
        : null;

    onContinue?.(
      fees.totalCost,   // total cost including all fees
      amount,           // base investment amount before fees
      shareCount,       // number of shares if calculable
      fees              // pass full fees breakdown for accurate transaction splitting
    );
  };

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

        {/* Strategy Card */}
        <section className="mb-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 overflow-hidden">
              <img
                src="https://s3-symbol-logo.tradingview.com/country/ZA--big.svg"
                alt="South Africa"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-slate-900">
                {currentStrategy.name}
              </h2>
              <p className="text-xs text-slate-600 mt-2">
                {currentStrategy.description?.split(".")[0] ||
                  "Investment strategy"}
              </p>
              <p className="text-xs font-semibold text-slate-600 mt-1">
                {minimumInvestment
                  ? `Min. ${formatCurrency(minimumInvestment * (1 + CASH_BUFFER_RATE), currency)}`
                  : "Calculating..."}
              </p>
            </div>
          </div>

          {/* Holdings Snapshot */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <div className="flex items-center -space-x-2">
              {holdingsData.slice(0, 3).map((holding) => {
                const symbol = holding.ticker || holding.symbol || holding;
                const logoUrl = holding.logo_url;
                return (
                  <div
                    key={symbol}
                    className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-100 overflow-hidden flex-shrink-0"
                  >
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt={symbol}
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          e.target.style.display = "none";
                          e.target.parentElement.textContent =
                            symbol.charAt(0);
                        }}
                      />
                    ) : (
                      <span className="text-[10px] font-bold text-slate-500">
                        {symbol.charAt(0)}
                      </span>
                    )}
                  </div>
                );
              })}
              {extraHoldings > 0 && (
                <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-300 text-white text-[10px] font-bold flex-shrink-0">
                  +{extraHoldings}
                </div>
              )}
            </div>
            <span className="text-xs font-semibold text-slate-600">
              Holdings snapshot
            </span>
          </div>
        </section>

        {/* Amount Input */}
        <section className="mb-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleDecrement}
                disabled={
                  !minimumInvestment ||
                  amount <= minimumInvestment ||
                  !isFullyOnboarded
                }
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:enabled:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <Minus className="h-5 w-5" />
              </button>

              <div className="text-center flex-1">
                <p className="text-xs font-semibold text-slate-600 mb-1">
                  Investment Amount
                </p>
                <p className="text-3xl font-bold text-slate-900">
                  {formatCurrency(amount * (1 + CASH_BUFFER_RATE), currency)}
                </p>
              </div>

              <button
                type="button"
                onClick={handleIncrement}
                disabled={!isFullyOnboarded}
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] text-white hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>
        </section>


        {/* Agreement Checkbox */}
        <section className="mb-6 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
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
                  onClick={(e) => {
                    e.preventDefault();
                    setShowMandateModal(true);
                  }}
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

        {/* Strategy Mandate PDF Modal — always mounted so PDF pre-loads in background */}
        <div
          className="fixed inset-0 flex flex-col bg-white"
          style={{ zIndex: 100, display: showMandateModal ? "flex" : "none" }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">
              Strategy Mandate
            </h2>
            <div className="flex items-center gap-1">
              <a
                href="/strategy-disclosures.pdf"
                download="Strategy-Mandate.pdf"
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
            <PdfViewer
              file="/strategy-disclosures.pdf"
              style={{ height: "100%" }}
            />
          </div>
        </div>

        {/* ── FIX 3: Dynamic info banner ── */}
        {getInfoText() && (
          <div className="mb-6 flex items-start gap-2 rounded-lg bg-violet-50 p-3">
            <Info className="h-4 w-4 flex-shrink-0 text-violet-600 mt-0.5" />
            <p className="text-xs text-violet-700">{getInfoText()}</p>
          </div>
        )}

        <GiftToggleV2
          enabled={giftEnabled}
          onToggle={(val) => { setGiftEnabled(val); if (!val) setGiftSheetOpen(false); }}
          onSheetOpenChange={setGiftSheetOpen}
          giftSheetRef={giftSheetRef}
          onDone={onGiftDone}
          security={{ id: currentStrategy.id, symbol: currentStrategy.name, name: currentStrategy.name }}
          assetType="strategy"
          totalCostCents={Math.round(fees.totalCost * 100)}
          amountDisplay={formatCurrency(fees.totalCost, currency)}
          fees={fees}
        />

        <div className="mt-4" />

        {/* Continue Button or Onboarding Block — show when gift mode is off OR sheet is closed */}
        {(!giftEnabled || !giftSheetOpen) && !isLoadingStatus && !isFullyOnboarded ? (
          <div className="w-full rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center">
            <h3 className="text-sm font-semibold text-rose-800 mb-2">
              Onboarding Required
            </h3>
            <p className="text-xs text-rose-700 mb-4">
              You must complete your profile setup and verify your identity
              before investing in strategies.
            </p>
            <button
              type="button"
              onClick={() => {
                const navEvent = new CustomEvent("navigate-within-app", {
                  detail: { page: "userOnboarding" },
                });
                window.dispatchEvent(navEvent);
              }}
              className="w-full rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 transition"
            >
              Complete Onboarding
            </button>
          </div>
        ) : (!giftEnabled || !giftSheetOpen) && (
          <button
            type="button"
            onClick={() => {
              if (giftEnabled && !giftSheetOpen) {
                // Gift mode is on but sheet was closed — re-open it so user can pick a recipient
                giftSheetRef.current?.open();
              } else {
                handleContinue();
              }
            }}
            disabled={!agreementChecked || isLoadingStatus}
            className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-3 text-sm font-semibold text-white shadow-lg shadow-violet-200/60 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:-translate-y-0.5 transition"
          >
            {isLoadingStatus ? "Checking status..." : giftEnabled && !giftSheetOpen ? "Select Recipient" : "Continue"}
          </button>
        )}
      </div>
    </div>
  );
};

export default InvestAmountPage;