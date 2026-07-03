import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, X, ChevronDown, ChevronUp, Download, Wallet, BarChart3, AlertCircle } from "lucide-react";
import { formatCurrency } from "../lib/formatCurrency";
import PdfViewer from "./PdfViewer";
import OcrScanModal from "./OcrScanModal";
import { supabase } from "../lib/supabase.js";
import { calculateMinInvestmentSync, buildHoldingsBySymbol, getHoldingsArray } from "../lib/strategyUtils";
import GiftToggleV2 from "./GiftToggleV2";
import { useDiscretionType } from "../lib/useDiscretionType";
import { useFees } from "../lib/useFees";
import { isAdminPreview } from "../lib/adminPreview";
import { scanOverlays } from "../lib/overlayDebug";

const fmt = (n) => Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Live, on-screen debug HUD — shows current modal state plus the result of
// the most recent overlay scan, so the "stuck / unclickable" bug can be
// diagnosed visually without opening devtools. Toggle-able and draggable-free
// (fixed bottom-left), rendered at the highest z-index in the app.
function DebugPanel({ isOpen, isGift, gate }) {
  const [scan, setScan] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const handler = (e) => setScan(e.detail);
    window.addEventListener("gtv-overlay-scan", handler);
    return () => window.removeEventListener("gtv-overlay-scan", handler);
  }, []);

  const hasBlockers = scan && scan.blockingCount > 1; // 1 = the sheet itself is expected

  return (
    <div
      style={{
        position: "fixed",
        left: 8,
        bottom: 8,
        zIndex: 2147483647,
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 1.4,
        background: hasBlockers ? "rgba(127,29,29,0.95)" : "rgba(15,23,42,0.9)",
        color: "#e2e8f0",
        borderRadius: 8,
        padding: collapsed ? "4px 8px" : "8px 10px",
        maxWidth: 260,
        pointerEvents: "auto",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        border: hasBlockers ? "1px solid #ef4444" : "1px solid #475569",
      }}
      onClick={() => setCollapsed((c) => !c)}
    >
      <div style={{ fontWeight: "bold", color: "#f59e0b" }}>
        🐞 Invest Debug {collapsed ? "(tap to expand)" : "(tap to collapse)"}
      </div>
      {!collapsed && (
        <>
          <div>isOpen: {String(isOpen)} | isGift: {String(isGift)} | gate: {gate}</div>
          {scan ? (
            <>
              <div>last scan: {scan.label}</div>
              <div style={{ color: hasBlockers ? "#fca5a5" : "#86efac" }}>
                blocking overlays: {scan.blockingCount} / {scan.totalSuspects}
              </div>
              {scan.centerEl && (
                <div>center hit: {scan.centerEl.tag}{scan.centerEl.className ? `.${scan.centerEl.className.split(" ")[0]}` : ""}</div>
              )}
            </>
          ) : (
            <div>no scan yet…</div>
          )}
          <div
            style={{ marginTop: 4, textDecoration: "underline", cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); scanOverlays("manual click"); }}
          >
            rescan now
          </div>
        </>
      )}
    </div>
  );
}

export default function AdultInvestModal({
  isOpen,
  onClose,
  strategy,
  onContinue,
  onUpdateMandate,
}) {
  const currency = strategy?.currency || "R";
  const isAdditionalStrategy = !!strategy?.isAdditionalStrategy;
  const readOnly = isAdminPreview();
  const { isLimited: isLimitedDiscretion } = useDiscretionType();
  const { ISIN_FEE_PER_ASSET, BROKER_FEE_RATE, TRANSACTION_FEE_RATE, CASH_BUFFER_RATE } = useFees();
  const [showDiscretionModal, setShowDiscretionModal] = useState(false);

  const [minimum, setMinimum] = useState(null);
  const [minimumLoading, setMinimumLoading] = useState(false);
  const [units, setUnits] = useState(1);
  const [feeExpanded, setFeeExpanded] = useState(false);
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [agreementError, setAgreementError] = useState(false);
  const [shakeAgreement, setShakeAgreement] = useState(false);
  const [showMandateModal, setShowMandateModal] = useState(false);
  const [walletBalance, setWalletBalance] = useState(null);
  const [isGift, setIsGift] = useState(false);
  // Gate for secondary-strategy buys that may need an ID-document scan first:
  //   'checking' = waiting on the ocr-required check (invest sheet held back)
  //   'scan'     = showing the in-frame ID scan (invest sheet still held back)
  //   'open'     = the invest sheet (agreement/fees/payment) is visible
  // Non-additional buys start — and stay — at 'open'.
  const [gate, setGate] = useState("open");

  // Load minimum + wallet balance when opened
  useEffect(() => {
    if (!isOpen) return;
    setUnits(1);
    setFeeExpanded(false);
    setAgreementChecked(false);
    setAgreementError(false);
    setShakeAgreement(false);
    setShowMandateModal(false);
    setIsGift(false);
    // Gate the sheet until we know whether to show the ID-document scan. The scan
    // fires on a SECONDARY strategy purchase — detected here (not just from the
    // isAdditionalStrategy prop) so it works from EVERY buy entry point, not only
    // the FactsheetPage upgrade modal. Fails open (no gate) on any error.
    setGate("checking");

    // Fetch wallet balance
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

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) { setGate("open"); return; }
        // Secondary strategy buy? Either the caller flagged it, or the user
        // already holds an active strategy other than the one being bought.
        let additional = isAdditionalStrategy;
        if (!additional) {
          const curId = strategy?.id || strategy?.strategyId || null;
          const { data: hs } = await supabase
            .from("stock_holdings_c")
            .select("strategy_id")
            .eq("user_id", session.user.id)
            .eq("is_active", true)
            .is("family_member_id", null);
          additional = (hs || []).some((h) => h.strategy_id && h.strategy_id !== curId);
        }
        if (!additional) { setGate("open"); return; } // first strategy → no scan
        const res = await fetch("/api/experian/ocr-required", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        setGate(data?.required ? "scan" : "open");
      } catch { setGate("open"); /* never block a purchase on this check */ }
    })();

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
  }, [isOpen, strategy]);

  const holdingsData = strategy?.holdingsWithLogos || strategy?.holdings || [];
  const numAssets = holdingsData.length || 0;

  // Amount = units × minimum
  const baseAmount = units * (minimum || 0);

  const fees = useMemo(() => {
    const bufferedBase = baseAmount * (1 + CASH_BUFFER_RATE);
    const brokerAmount = bufferedBase * BROKER_FEE_RATE;
    const isinTotal = ISIN_FEE_PER_ASSET * numAssets;
    const transactionAmount = bufferedBase * TRANSACTION_FEE_RATE;
    const totalCost = bufferedBase + brokerAmount + isinTotal + transactionAmount;
    return { bufferedBase, brokerAmount, isinTotal, transactionAmount, totalCost };
  }, [baseAmount, numAssets, CASH_BUFFER_RATE, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, TRANSACTION_FEE_RATE]);

  const totalCostCents = Math.round(fees.totalCost * 100);
  const insufficient = walletBalance !== null && fees.totalCost > walletBalance;

  const proceed = () => {
    const sharePrice = strategy?.price_per_share || strategy?.pricePerShare || null;
    const shareCount = sharePrice && sharePrice > 0 ? Math.floor(baseAmount / sharePrice) : null;
    onContinue?.(fees.totalCost, baseAmount, shareCount, fees);
  };

  const handleConfirm = () => {
    if (isLimitedDiscretion) { setShowDiscretionModal(true); return; }
    proceed();
  };

  // Scan done (or skipped) → reveal the invest sheet so the user can continue.
  const finishOcr = () => { setGate("open"); };

  const handleGiftToggle = (val) => {
    console.log(`[AdultInvestModal] handleGiftToggle(${val}) called | agreementChecked=${agreementChecked} isLimitedDiscretion=${isLimitedDiscretion}`);
    if (val && !agreementChecked && !isLimitedDiscretion) {
      console.log("[AdultInvestModal] gift toggle BLOCKED — agreement not checked");
      setAgreementError(true);
      setShakeAgreement(true);
      setTimeout(() => setShakeAgreement(false), 500);
      return;
    }
    setIsGift(val);
  };

  useEffect(() => {
    console.log(`%c[AdultInvestModal] isOpen=${isOpen} isGift=${isGift} gate=${gate}`, "color:#4f46e5;font-weight:bold");
    const t1 = setTimeout(() => scanOverlays(`AdultInvestModal isOpen=${isOpen} isGift=${isGift}`), 60);
    const t2 = setTimeout(() => scanOverlays(`AdultInvestModal +500ms isOpen=${isOpen} isGift=${isGift}`), 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isOpen, isGift, gate]);

  const portalTarget = document.getElementById("modal-root") || document.body;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <DebugPanel isOpen={isOpen} isGift={isGift} gate={gate} />
          {/* Backdrop */}
          <motion.div
            key="adult-invest-backdrop"
            className="fixed inset-0"
            style={{ zIndex: 9998, background: "rgba(15,10,30,0.65)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* While the secondary-buy ID check runs (or the scan is showing), keep
              the invest sheet hidden so the user lands on the scan first. */}
          {gate !== "open" ? (
            <motion.div
              key="adult-invest-loading"
              className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md flex-col items-center justify-center rounded-t-[28px] bg-white shadow-2xl"
              style={{ zIndex: 9999, height: 220, paddingBottom: "env(safe-area-inset-bottom)" }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
            >
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-r-transparent mb-3" />
              <p className="text-sm text-slate-500">Preparing your investment…</p>
            </motion.div>
          ) : (
          <motion.div
            key="adult-invest-sheet"
            className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md flex-col rounded-t-[28px] bg-white shadow-2xl overflow-hidden"
            style={{ zIndex: 9999, maxHeight: "92dvh", paddingBottom: "env(safe-area-inset-bottom)", pointerEvents: isGift ? "none" : "auto" }}
            initial={{ y: "100%" }}
            animate={{ y: isGift ? "110%" : 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            {/* Gradient accent strip */}
            <div className="h-1 w-full flex-shrink-0" style={{ background: "linear-gradient(90deg,#7c3aed,#6366f1,#8b5cf6)" }} />

            {/* Drag handle */}
            <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
              <div className="h-[3px] w-9 rounded-full bg-slate-200" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
              <div>
                <h2 className="text-[15px] font-bold text-slate-900 leading-tight">Confirm Investment</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">{strategy?.short_name || strategy?.name}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-5" style={{ WebkitOverflowScrolling: "touch" }}>

              {/* Strategy Card */}
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
                        <div key={sym} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 overflow-hidden flex-shrink-0">
                          {h.logo_url ? (
                            <img src={h.logo_url} alt={sym} className="h-full w-full object-cover" onError={e => { e.target.style.display = "none"; e.target.parentElement.textContent = String(sym).charAt(0); }} />
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
                <div className="flex-1 rounded-2xl p-3.5 border border-slate-100" style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)" }}>
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
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center mb-4">Investment Amount</p>
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
                      {minimum && fees.bufferedBase > 0 ? `R${fmt(fees.bufferedBase)}` : "R0.00"}
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



              {/* Agreement */}
              <motion.div
                className={`mb-4 rounded-2xl border p-4 ${agreementError && !agreementChecked ? "border-red-300 bg-red-50" : "border-slate-100 bg-white"}`}
                animate={shakeAgreement ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
                transition={{ duration: 0.45, ease: "easeInOut" }}
              >
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreementChecked}
                    onChange={e => { setAgreementChecked(e.target.checked); if (e.target.checked) setAgreementError(false); }}
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
                    <AlertCircle size={11} />Please tick this box before sending a gift
                  </p>
                )}
              </motion.div>


              {/* Send as a gift */}
              <div className="mb-5">
                <GiftToggleV2
                  enabled={isGift}
                  onToggle={handleGiftToggle}
                  onDone={() => { setIsGift(false); onClose?.(); }}
                  security={{ id: strategy?.id, name: strategy?.name, symbol: strategy?.name }}
                  totalCostCents={totalCostCents}
                  amountDisplay={`R ${fmt(fees.totalCost)}`}
                  assetType="strategy"
                />
              </div>

              {/* CTA — hidden when gift mode is active */}
              {!isGift && (
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={readOnly || (isLimitedDiscretion ? false : (!agreementChecked || !minimum))}
                  className={`w-full rounded-2xl py-4 text-sm font-bold text-white shadow-lg active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed${readOnly ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
                  style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}
                >
                  Continue
                </button>
              )}
            </div>
          </motion.div>
          )}

          {/* Strategy Mandate PDF — full-screen overlay above the sheet */}
          <AnimatePresence>
            {showMandateModal && (
              <motion.div
                key="mandate-overlay"
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

          {/* Secondary-strategy ID-document scan (skippable, non-blocking) */}
          <OcrScanModal
            isOpen={gate === "scan"}
            onVerified={finishOcr}
            onSkip={finishOcr}
          />

          {/* Limited-discretion block */}
          <AnimatePresence>
            {showDiscretionModal && (
              <motion.div
                key="discretion-overlay"
                className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
                style={{ zIndex: 10001 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowDiscretionModal(false)}
              >
                <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-center text-lg font-semibold text-slate-900 mb-2">Update your discretionary</h3>
                  <p className="text-center text-sm text-slate-600 mb-6">
                    You selected <span className="font-semibold text-slate-900">limited discretion</span>, which doesn&rsquo;t allow investing in our strategies. Please{" "}
                    <button
                      type="button"
                      onClick={() => { setShowDiscretionModal(false); if (onUpdateMandate) onUpdateMandate(); }}
                      className="font-semibold text-violet-600 underline"
                    >
                      update your discretionary
                    </button>{" "}
                    to invest in strategies.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setShowDiscretionModal(false); if (onUpdateMandate) onUpdateMandate(); }}
                    className="w-full rounded-2xl py-3 text-sm font-semibold text-white shadow-lg"
                    style={{ background: "linear-gradient(135deg,#5b21b6,#7c3aed)" }}
                  >
                    Update my discretionary
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDiscretionModal(false)}
                    className="w-full mt-2 rounded-2xl py-3 text-sm font-semibold text-slate-500"
                  >
                    Not now
                  </button>
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
