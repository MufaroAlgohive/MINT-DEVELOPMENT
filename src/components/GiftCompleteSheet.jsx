import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, BarChart3, AlertCircle, Download, ArrowLeft, Gift } from "lucide-react";
import { formatCurrency } from "../lib/formatCurrency";
import PdfViewer from "./PdfViewer";
import GiftToggleV2 from "./GiftToggleV2";
import { supabase } from "../lib/supabase.js";
import { calculateMinInvestmentSync, buildHoldingsBySymbol, getHoldingsArray } from "../lib/strategyUtils";
import { useFees } from "../lib/useFees";

const fmt = (n) =>
  Number(n).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * GiftCompleteSheet
 *
 * A bottom-sheet that looks *identical* to AdultInvestModal but is always in
 * gift mode.  Handles both Mint Basket (assetType="strategy") and single-
 * security (assetType="stock") gift flows.
 *
 * Flow:
 *   1. Sheet slides up → user picks amount + ticks agreement
 *   2. "Send as Gift" → sheet slides away, GiftToggleV2 takes over
 *   3. GiftToggleV2: Who? → Beneficiary → Confirm → Success
 */
export default function GiftCompleteSheet({
  isOpen,
  onClose,
  strategy,   // populated when assetType="strategy"
  security,   // populated when assetType="stock"
  assetType = "strategy",
  onGiftDone,
}) {
  const { ISIN_FEE_PER_ASSET, BROKER_FEE_RATE, TRANSACTION_FEE_RATE, CASH_BUFFER_RATE } = useFees();

  /* ── Strategy fields ─────────────────────────────────── */
  const [minimum, setMinimum] = useState(null);
  const [minimumLoading, setMinimumLoading] = useState(false);
  const [units, setUnits] = useState(1);
  const [walletBalance, setWalletBalance] = useState(null);

  /* ── Security fields ─────────────────────────────────── */
  const [quantity, setQuantity] = useState(1);

  /* ── Shared ──────────────────────────────────────────── */
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [agreementError, setAgreementError] = useState(false);
  const [shakeAgreement, setShakeAgreement] = useState(false);
  const [showMandateModal, setShowMandateModal] = useState(false);
  const [isGift, setIsGift] = useState(false); // slides sheet away, GiftToggleV2 opens

  const giftSheetRef = useRef(null);

  /* ── Reset on open ───────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) return;
    setUnits(1);
    setQuantity(1);
    setAgreementChecked(false);
    setAgreementError(false);
    setShakeAgreement(false);
    setShowMandateModal(false);
    setIsGift(false);
    setWalletBalance(null);

    // Fetch wallet balance (for strategy mode, same as AdultInvestModal)
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const { data } = await supabase
          .from("wallets")
          .select("balance")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (data) setWalletBalance(data.balance ?? 0);
      } catch { /* ignore */ }
    })();

    if (assetType !== "strategy") return;

    // Resolve minimum investment
    const preCalc = strategy?.calculatedMinInvestment || strategy?.min_investment;
    if (preCalc) {
      setMinimum(preCalc);
      setMinimumLoading(false);
      return;
    }
    if (!strategy || !supabase) { setMinimumLoading(false); return; }
    setMinimumLoading(true);
    (async () => {
      try {
        const holdings = getHoldingsArray(strategy);
        const symbols = [...new Set(holdings.map(h => h.symbol || h.ticker).filter(Boolean))];
        let secMap = {};
        if (symbols.length > 0) {
          const { data } = await supabase.from("securities_c").select("symbol, last_price").in("symbol", symbols);
          (data || []).forEach(s => { secMap[s.symbol] = s; });
        }
        const hMap = buildHoldingsBySymbol(Object.values(secMap).filter(s => s.last_price != null));
        setMinimum(calculateMinInvestmentSync(strategy, hMap));
      } catch { setMinimum(null); } finally { setMinimumLoading(false); }
    })();
  }, [isOpen, strategy, assetType]);

  /* ── Fee calculation ─────────────────────────────────── */
  const holdingsData = strategy?.holdingsWithLogos || strategy?.holdings || [];
  const numAssets = holdingsData.length || 0;

  // Strategy fees
  const strategyFees = useMemo(() => {
    const baseAmount = units * (minimum || 0);
    const bufferedBase = baseAmount * (1 + CASH_BUFFER_RATE);
    const brokerAmount = bufferedBase * BROKER_FEE_RATE;
    const isinTotal = ISIN_FEE_PER_ASSET * numAssets;
    const transactionAmount = bufferedBase * TRANSACTION_FEE_RATE;
    const totalCost = bufferedBase + brokerAmount + isinTotal + transactionAmount;
    return { bufferedBase, brokerAmount, isinTotal, transactionAmount, totalCost };
  }, [units, minimum, numAssets, CASH_BUFFER_RATE, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, TRANSACTION_FEE_RATE]);

  // Security fees
  const pricePerShare = security?.currentPrice ?? security?.last_price ?? 0;
  const securityFees = useMemo(() => {
    const bufferedBase = quantity * pricePerShare;
    const brokerAmount = bufferedBase * BROKER_FEE_RATE;
    const isinTotal = ISIN_FEE_PER_ASSET * 1;
    const transactionAmount = bufferedBase * TRANSACTION_FEE_RATE;
    const totalCost = bufferedBase + brokerAmount + isinTotal + transactionAmount;
    return { bufferedBase, brokerAmount, isinTotal, transactionAmount, totalCost };
  }, [quantity, pricePerShare, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, TRANSACTION_FEE_RATE]);

  const fees = assetType === "strategy" ? strategyFees : securityFees;
  const totalCostCents = Math.round(fees.totalCost * 100);

  /* ── "Send as Gift" handler ──────────────────────────── */
  const handleSendAsGift = () => {
    if (!agreementChecked) {
      setAgreementError(true);
      setShakeAgreement(true);
      setTimeout(() => setShakeAgreement(false), 500);
      return;
    }
    setIsGift(true); // slides sheet down; GiftToggleV2 auto-opens via enabled=true
  };

  /* ── Gift item for GiftToggleV2 ──────────────────────── */
  const giftItem = assetType === "strategy"
    ? { id: strategy?.id, name: strategy?.name, symbol: strategy?.name }
    : { id: security?.id, symbol: security?.symbol, name: security?.short_name || security?.name || security?.symbol };

  const amountDisplay = `R ${fmt(fees.totalCost)}`;

  const portalTarget = document.getElementById("modal-root") || document.body;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── Backdrop ─────────────────────────────────── */}
          <motion.div
            key="gift-sheet-backdrop"
            className="fixed inset-0"
            style={{ zIndex: 9998, background: "rgba(15,10,30,0.65)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={!isGift ? onClose : undefined}
          />

          {/* ── Complete Investment sheet ─────────────────── */}
          <motion.div
            key="gift-complete-sheet"
            className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md flex-col rounded-t-[28px] bg-white shadow-2xl overflow-hidden"
            style={{
              zIndex: 9999,
              maxHeight: "92dvh",
              paddingBottom: "env(safe-area-inset-bottom)",
              pointerEvents: isGift ? "none" : "auto",
            }}
            initial={{ y: "100%" }}
            animate={{ y: isGift ? "110%" : 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            {/* Gradient accent strip — identical to AdultInvestModal */}
            <div
              className="h-1 w-full flex-shrink-0"
              style={{ background: "linear-gradient(90deg,#7c3aed,#6366f1,#8b5cf6)" }}
            />

            {/* Drag handle */}
            <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
              <div className="h-[3px] w-9 rounded-full bg-slate-200" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
              <div>
                <h2 className="text-[15px] font-bold text-slate-900 leading-tight">
                  Complete Investment
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {assetType === "strategy"
                    ? (strategy?.short_name || strategy?.name)
                    : (security?.short_name || security?.name || security?.symbol)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-5"
              style={{ WebkitOverflowScrolling: "touch" }}
            >

              {/* ── STRATEGY view ──────────────────────────────── */}
              {assetType === "strategy" && (
                <>
                  {/* Strategy card */}
                  <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl overflow-hidden">
                        <img
                          src="https://s3-symbol-logo.tradingview.com/country/ZA--big.svg"
                          alt="ZA"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{strategy?.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                          {strategy?.description?.split(".")[0] || "Investment strategy"}
                        </p>
                      </div>
                    </div>
                    {/* Holdings avatars */}
                    <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                      <div className="flex items-center -space-x-2">
                        {holdingsData.slice(0, 3).map((h) => {
                          const sym = h.ticker || h.symbol || h;
                          return (
                            <div
                              key={sym}
                              className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 overflow-hidden flex-shrink-0"
                            >
                              {h.logo_url ? (
                                <img
                                  src={h.logo_url}
                                  alt={sym}
                                  className="h-full w-full object-cover"
                                  onError={e => { e.target.style.display = "none"; e.target.parentElement.textContent = String(sym).charAt(0); }}
                                />
                              ) : (
                                <span className="text-[9px] font-bold text-slate-500">{String(sym).charAt(0)}</span>
                              )}
                            </div>
                          );
                        })}
                        {holdingsData.length > 3 && (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-300 text-white text-[9px] font-bold flex-shrink-0">
                            +{holdingsData.length - 3}
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] font-semibold text-slate-500">Holdings snapshot</span>
                    </div>
                  </div>

                  {/* Stat chips */}
                  <div className="flex gap-3 mb-4">
                    <div
                      className="flex-1 rounded-2xl p-3.5 border border-slate-100"
                      style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)" }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Wallet className="h-3 w-3 text-purple-400" />
                        <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wide">My balance</p>
                      </div>
                      <p className="text-base font-bold text-purple-900 tabular-nums">
                        {walletBalance === null ? "…" : `R${fmt(walletBalance)}`}
                      </p>
                    </div>
                    <div className="flex-1 rounded-2xl p-3.5 border border-slate-100 bg-white">
                      <div className="flex items-center gap-1.5 mb-1">
                        <BarChart3 className="h-3 w-3 text-indigo-400" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Min. per basket</p>
                      </div>
                      <p className="text-base font-bold text-slate-900 tabular-nums">
                        {minimumLoading ? "…" : minimum ? `R${fmt(minimum * (1 + CASH_BUFFER_RATE))}` : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Amount stepper */}
                  <div className="rounded-3xl border border-slate-100 bg-white shadow-sm p-5 mb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center mb-4">
                      Investment Amount
                    </p>
                    <div className="flex items-center justify-center gap-5 mb-3">
                      <button
                        type="button"
                        onClick={() => setUnits(u => Math.max(1, u - 1))}
                        disabled={units <= 1 || !minimum}
                        className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 text-xl font-semibold disabled:opacity-30 disabled:cursor-not-allowed active:scale-90 transition-all shadow-sm"
                      >
                        −
                      </button>
                      <div className="flex-1 text-center">
                        <p className="text-4xl font-black text-slate-900 tabular-nums tracking-tight">
                          {minimum && strategyFees.bufferedBase > 0 ? `R${fmt(strategyFees.bufferedBase)}` : "R0.00"}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {units} basket{units !== 1 ? "s" : ""} × R{minimum ? fmt(minimum * (1 + CASH_BUFFER_RATE)) : "0.00"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUnits(u => u + 1)}
                        disabled={!minimum}
                        className="flex h-11 w-11 items-center justify-center rounded-2xl text-white text-xl font-semibold disabled:opacity-30 disabled:cursor-not-allowed active:scale-90 transition-all shadow-md"
                        style={{ background: "linear-gradient(135deg,#6366f1,#7c3aed)" }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* ── SECURITY view ───────────────────────────────── */}
              {assetType === "stock" && (
                <>
                  {/* Security card */}
                  <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-slate-100 bg-white overflow-hidden">
                        {security?.logo_url ? (
                          <img src={security.logo_url} alt={security.symbol} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-sm font-bold text-slate-500 uppercase">
                            {(security?.symbol || "").slice(0, 2)}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {security?.short_name || security?.name || security?.symbol}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {security?.symbol}{security?.exchange ? ` · ${security.exchange}` : ""}
                        </p>
                        {pricePerShare > 0 && (
                          <p className="text-xs font-semibold text-slate-600 mt-1">
                            Price per share:{" "}
                            <span className="text-slate-900">{formatCurrency(pricePerShare, "R")}</span>
                          </p>
                        )}
                      </div>
                      {security?.changePct != null && (
                        <span
                          className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded-full ${
                            security.changePct >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
                          }`}
                        >
                          {security.changePct >= 0 ? "+" : ""}{security.changePct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                    {security?.sector && (
                      <div className="pt-3 mt-3 border-t border-slate-200">
                        <span className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-[10px] font-medium text-slate-600">
                          {security.sector}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Stat chips */}
                  <div className="flex gap-3 mb-4">
                    <div
                      className="flex-1 rounded-2xl p-3.5 border border-slate-100"
                      style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)" }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Wallet className="h-3 w-3 text-purple-400" />
                        <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wide">My balance</p>
                      </div>
                      <p className="text-base font-bold text-purple-900 tabular-nums">
                        {walletBalance === null ? "…" : `R${fmt(walletBalance)}`}
                      </p>
                    </div>
                    <div className="flex-1 rounded-2xl p-3.5 border border-slate-100 bg-white">
                      <div className="flex items-center gap-1.5 mb-1">
                        <BarChart3 className="h-3 w-3 text-indigo-400" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Price / share</p>
                      </div>
                      <p className="text-base font-bold text-slate-900 tabular-nums">
                        {pricePerShare > 0 ? `R${fmt(pricePerShare)}` : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Share quantity stepper */}
                  <div className="rounded-3xl border border-slate-100 bg-white shadow-sm p-5 mb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center mb-4">
                      Number of Shares
                    </p>
                    <div className="flex items-center justify-center gap-5 mb-3">
                      <button
                        type="button"
                        onClick={() => setQuantity(q => Math.max(1, q - 1))}
                        disabled={quantity <= 1}
                        className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 text-xl font-semibold disabled:opacity-30 disabled:cursor-not-allowed active:scale-90 transition-all shadow-sm"
                      >
                        −
                      </button>
                      <div className="flex-1 text-center">
                        <p className="text-4xl font-black text-slate-900 tabular-nums tracking-tight">
                          {quantity}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {pricePerShare > 0
                            ? `Total: R${fmt(securityFees.totalCost)}`
                            : "No pricing data"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setQuantity(q => q + 1)}
                        className="flex h-11 w-11 items-center justify-center rounded-2xl text-white text-xl font-semibold active:scale-90 transition-all shadow-md"
                        style={{ background: "linear-gradient(135deg,#6366f1,#7c3aed)" }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* ── Agreement checkbox — identical to AdultInvestModal ── */}
              <motion.div
                className={`mb-4 rounded-2xl border p-4 ${
                  agreementError && !agreementChecked
                    ? "border-red-300 bg-red-50"
                    : "border-slate-100 bg-white"
                }`}
                animate={shakeAgreement ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
                transition={{ duration: 0.45, ease: "easeInOut" }}
              >
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreementChecked}
                    onChange={e => {
                      setAgreementChecked(e.target.checked);
                      if (e.target.checked) setAgreementError(false);
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 flex-shrink-0"
                  />
                  <div>
                    <p className="text-xs font-semibold text-slate-800">
                      I agree to Risk Disclosure, Fee Schedule &{" "}
                      <button
                        type="button"
                        onClick={e => { e.preventDefault(); setShowMandateModal(true); }}
                        className="underline text-violet-600"
                      >
                        Strategy Mandate
                      </button>
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      By continuing, you confirm you have reviewed and agree to all terms and conditions
                    </p>
                  </div>
                </label>
                {agreementError && !agreementChecked && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-red-500">
                    <AlertCircle size={11} />
                    Please tick this box before sending a gift
                  </p>
                )}
              </motion.div>

              {/* ── GiftToggleV2 — hidden toggle row; opens sheet when isGift=true ── */}
              <div className="mb-5">
                <GiftToggleV2
                  enabled={isGift}
                  onToggle={() => {}}          // gift mode is locked on in this flow
                  onDone={() => { setIsGift(false); onClose?.(); onGiftDone?.(); }}
                  giftSheetRef={giftSheetRef}
                  security={giftItem}
                  totalCostCents={totalCostCents}
                  amountDisplay={amountDisplay}
                  assetType={assetType}
                  fees={fees}
                  singleSecurity={assetType === "stock"}
                  hideToggleRow           // hide the toggle UI row — we drive it from our CTA
                />
              </div>

              {/* ── Send as Gift CTA ─────────────────────────────── */}
              <button
                type="button"
                onClick={handleSendAsGift}
                className="w-full rounded-2xl py-4 text-sm font-bold text-white shadow-lg active:scale-[0.98] transition-all"
                style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}
              >
                <span className="flex items-center justify-center gap-2">
                  <Gift className="h-4 w-4" />
                  Send as Gift
                </span>
              </button>
            </div>
          </motion.div>

          {/* ── Strategy Mandate PDF overlay ─────────────────────── */}
          <AnimatePresence>
            {showMandateModal && (
              <motion.div
                key="gift-mandate-overlay"
                className="fixed inset-0 flex flex-col bg-white"
                style={{ zIndex: 10000 }}
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowMandateModal(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <h2 className="text-sm font-semibold text-slate-900">Strategy Mandate</h2>
                  <a
                    href="/strategy-disclosures.pdf"
                    download="Strategy-Mandate.pdf"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
                <div className="flex-1 overflow-hidden">
                  <PdfViewer file="/strategy-disclosures.pdf" style={{ height: "100%" }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>,
    portalTarget
  );
}
