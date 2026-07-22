import React, { useEffect, useState, useRef, useCallback } from "react";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, Landmark, CreditCard, Wallet } from "lucide-react";
import { useProfile } from "../lib/useProfile";
import { supabase } from "../lib/supabase";
import PaymentMethodModal from "../components/PaymentMethodModal";
import PaymentPendingPage from "./PaymentPendingPage.jsx";
import { checkOnboardingComplete } from "../lib/checkOnboardingComplete";
import { useFees } from "../lib/useFees";

const PaymentPage = ({
  onBack,
  strategy,
  amount,
  baseAmount,
  shareCount,
  onSuccess,
  onCancel,
  onOpenDeposit,
  initialMethod,
  fees,
  childId,
  childFamilyMemberId,
}) => {
  const { profile } = useProfile();
  const [paymentStatus, setPaymentStatus] = useState(
    initialMethod
      ? initialMethod === "wallet"
        ? "wallet-pending"
        : "eft-instructions"
      : "method-selection",
  );
  const [selectedMethod, setSelectedMethod] = useState(initialMethod || null);
  const [errorMessage, setErrorMessage] = useState("");
  const hasInitialized = useRef(false);
  const isMounted = useRef(true);
  const isSubmittingWallet = useRef(false);
  const [isMethodModalOpen, setIsMethodModalOpen] = useState(!initialMethod);
  const isChildWalletPurchase = !!childFamilyMemberId;

  // Wallet state
  const [childWalletBalance, setChildWalletBalance] = useState(0);
  const [childWalletName, setChildWalletName] = useState("Child");
  const walletBalance = isChildWalletPurchase
    ? childWalletBalance
    : (profile?.wallet_balance || 0);
  const [walletLoading, setWalletLoading] = useState(true);

  // Sync loading state with profile loading
  useEffect(() => {
    if (!isChildWalletPurchase) {
      if (profile?.id) setWalletLoading(false);
      return;
    }

    let cancelled = false;
    const loadChildWallet = async () => {
      setWalletLoading(true);
      try {
        const res = await fetch(`/api/child-wallet?family_member_id=${encodeURIComponent(childFamilyMemberId)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load child wallet");
        if (cancelled) return;
        setChildWalletBalance((Number(json?.balance || 0)) / 100);
        setChildWalletName(json?.first_name || "Child");
      } catch (e) {
        console.error("[payment] child wallet load error:", e);
      } finally {
        if (!cancelled) setWalletLoading(false);
      }
    };

    loadChildWallet();
    return () => {
      cancelled = true;
    };
  }, [childFamilyMemberId, isChildWalletPurchase, profile?.id]);

  // Wallet modal state
  const [walletConfirmOpen, setWalletConfirmOpen] = useState(false);
  const [autoProcessWallet, setAutoProcessWallet] = useState(false);
  const [walletSuccessOpen, setWalletSuccessOpen] = useState(false);
  const [walletNewBalance, setWalletNewBalance] = useState(0);
  const [walletAmountDeducted, setWalletAmountDeducted] = useState(0);
  const [eftReference, setEftReference] = useState("");
  const [eftSuccessOpen, setEftSuccessOpen] = useState(false);

  // Ozow confirm modal state
  const [ozowConfirmOpen, setOzowConfirmOpen] = useState(false);

  const handleInitiateOzow = useCallback(async (ozowAmount) => {
    setOzowConfirmOpen(false);
    setPaymentStatus("initializing");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      const baseUrl = window.location.origin;
      const resp = await fetch("/api/ozow/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: ozowAmount || amount,
          strategyName: strategy?.name || "",
          strategyId: strategy?.id || null,
          userId: user?.id || null,
          userEmail: user?.email || null,
          successUrl: `${baseUrl}/?ozow=success`,
          cancelUrl: `${baseUrl}/?ozow=cancel`,
          errorUrl: `${baseUrl}/?ozow=error`,
        }),
      });
      const data = await resp.json();
      if (data.success && data.action_url) {
        sessionStorage.setItem("ozow_pending", JSON.stringify({
          transactionRef: data.TransactionReference,
          strategyId: strategy?.id || null,
          amount: ozowAmount || amount,
          strategyName: strategy?.name || "",
        }));
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.action_url;
        Object.entries(data).forEach(([key, value]) => {
          if (["success", "action_url"].includes(key)) return;
          const input = document.createElement("input");
          input.type = "hidden"; input.name = key; input.value = value;
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
      } else {
        setPaymentStatus("failed");
        setErrorMessage(data.error || "Failed to initiate Ozow payment.");
        setIsMethodModalOpen(true);
      }
    } catch (err) {
      console.error("[ozow] initiate error:", err);
      setPaymentStatus("failed");
      setErrorMessage("Could not connect to Ozow. Please try another payment method.");
      setIsMethodModalOpen(true);
    }
  }, [amount, strategy]);

  const handleMethodSelection = useCallback((method) => {
    setSelectedMethod(method);
    setIsMethodModalOpen(false);
    if (method === "wallet") {
      setPaymentStatus("wallet-pending");
      setAutoProcessWallet(true);
      return;
    }
    if (method === "ozow") {
      setPaymentStatus("ozow-pending");
      setOzowConfirmOpen(true);
      return;
    }
    if (method === "direct_eft") {
      const uniqueRef = `EFT-${Date.now()}-${profile?.mint_number || "X"}`;
      setEftReference(uniqueRef);
      setPaymentStatus("eft-instructions");
      
      // Phase 1: Save intent to DB immediately
      const recordEftIntent = async () => {
        try {
          await fetch('/api/eft-deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount,
              baseAmount,
              reference: uniqueRef,
              strategyId: strategy?.id,
              symbol: strategy?.symbol,
              name: strategy?.name,
              shareCount,
              intent: true
            })
          });
        } catch (err) {
          console.warn("[EFT] Failed to save pre-payment intent:", err.message);
        }
      };
      recordEftIntent();
      return;
    }
    setPaymentStatus("eft-instructions");
  }, [profile, amount, baseAmount, strategy, shareCount]);

  useEffect(() => {
    if (initialMethod && !hasInitialized.current) {
      handleMethodSelection(initialMethod);
    }
  }, [initialMethod, handleMethodSelection]);

  useEffect(() => {
    // Other initial profile-based effects can go here
  }, [profile?.id]);


  const isStrategyPurchase = !!(
    strategy?.holdings ||
    strategy?.risk_level ||
    strategy?.slug
  );

  const recordInvestment = useCallback(
    async (paymentReference = "", method = null, overrideAmount = null) => {
      const maxRetries = 5;
      const finalMethod = method || selectedMethod;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          let { data: { session } } = await supabase.auth.getSession();
          // Always try to refresh on the first attempt to get the freshest token.
          // If the session is invalidated server-side the refresh may fail, but the
          // server's JWT decode fallback will still accept the existing token.
          if (attempt === 1) {
            try {
              const { data: refreshData } = await supabase.auth.refreshSession();
              if (refreshData?.session) session = refreshData.session;
            } catch (_) {
              // Refresh failed — proceed with existing session token
            }
          }
          const token = session?.access_token;
          const stratId =
            strategy?.strategyId ||
            (isStrategyPurchase ? strategy?.id : null);
          const recordData = {
            symbol: strategy?.symbol || strategy?.short_name || "",
            name: strategy?.name || "",
            amount: overrideAmount || amount,
            baseAmount: baseAmount || amount,
            paymentReference,
            paymentMethod: finalMethod,
            ...(shareCount ? { shareCount: Number(shareCount) } : {}),
            ...(childId ? { childUserId: childId } : {}),
            ...(childFamilyMemberId ? { childFamilyMemberId } : {}),
            ...(fees ? {
              feesBreakdown: {
                bufferedBase: fees.bufferedBase,
                brokerAmount: fees.brokerAmount,
                isinTotal: fees.isinTotal,
                transactionAmount: fees.transactionAmount,
                totalFees: (fees.brokerAmount || 0) + (fees.isinTotal || 0) + (fees.transactionAmount || 0)
              }
            } : {}),
          };

          if (isStrategyPurchase) {
            recordData.strategyId = strategy?.id;
          } else {
            recordData.securityId = strategy?.id;
          }

          console.log("Recording investment with body:", recordData);

          const headers = { "Content-Type": "application/json" };
          if (token) headers.Authorization = `Bearer ${token}`;

          const res = await fetch("/api/record-investment", {
            method: "POST",
            headers,
            body: JSON.stringify(recordData),
          });

          if (res.ok || res.status === 409) {
            const data = await res.json();
            return { success: true, ...data };
          }

          const errorBody = await res.json().catch(() => ({ error: "Unknown error" }));
          console.warn(
            `Record attempt ${attempt}/${maxRetries} failed (${res.status}):`,
            errorBody,
          );
          if (res.status === 400) return { success: false, ...errorBody };
        } catch (recordError) {
          console.warn(
            `Record attempt ${attempt}/${maxRetries} network error:`,
            recordError.message,
          );
        }

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      return { success: false, error: "Retries exhausted" };
    },
    [amount, baseAmount, childFamilyMemberId, childId, isStrategyPurchase, selectedMethod, shareCount, strategy],
  );


  /**
   * IMPORTANT: Fee Architecture Note
   * 
   * The 'amount' prop comes from InvestAmountPage (or StockBuyPage). 
   * It already includes all fees: 8% silent buffer, brokerage, custody, and transaction fees.
   */
  const handleWalletConfirm = async (walletSpecificAmount) => {
    const totalToDeduct = walletSpecificAmount || amount;

    if (isSubmittingWallet.current || paymentStatus === "processing") return;
    isSubmittingWallet.current = true;

    setWalletConfirmOpen(false);
    setPaymentStatus("processing");

    try {
      const walletRef = `WALLET-${Date.now()}`;
      const recorded = await recordInvestment(walletRef, "wallet", totalToDeduct);
      
      console.log("Wallet payment API response:", recorded);

      if (!recorded.success) {
        if (recorded.error === "Insufficient funds" || recorded.error === "Insufficient child wallet funds") {
          throw new Error(
            isChildWalletPurchase
              ? "You have insufficient child wallet funds for this investment"
              : "You have insufficient wallet funds for this investment"
          );
        }
        throw new Error(recorded.error || "Failed to record investment");
      }

      // Dispatch events for immediate UI updates
      window.dispatchEvent(new Event("wallet-updated"));
      window.dispatchEvent(new Event("profile-updated"));
      window.dispatchEvent(new Event("financial-data-updated"));

      const finalNewBalance = recorded.newWalletBalance ?? (walletBalance - totalToDeduct);
      setWalletNewBalance(finalNewBalance);
      setWalletAmountDeducted(totalToDeduct);
      if (isChildWalletPurchase) {
        setChildWalletBalance(finalNewBalance);
      }
      setPaymentStatus("wallet-done");
      try {
        sessionStorage.setItem("ozow_pending", JSON.stringify({ strategyName: strategy?.name || "Investment" }));
      } catch {}
      onSuccess?.({ reference: `WALLET-${Date.now()}`, method: "wallet" });
    } catch (err) {
      console.error("Wallet payment error:", err);
      isSubmittingWallet.current = false;
      setPaymentStatus("failed");
      setErrorMessage(err.message || "Wallet payment failed");
    }
  };


  const [eftRef, setEftRef] = useState("");

  /**
   * IMPORTANT: EFT Flow Note
   * 
   * EFT follows a 'Pending' flow. 
   * 1. Selecting EFT generates a unique reference and records an 'intent' via /api/eft-deposit (status: pending).
   * 2. Clicking 'I have paid' confirms this intent but does NOT update holdings yet.
   * 3. Holdings and user_strategies are ONLY updated when an admin manually confirms 
   *    the transaction via /api/confirm-eft-deposit after funds reflect.
   */
  const handleEftConfirm = () => {
    // Intent was already recorded when EFT was selected (Phase 1).
    // Just show the "waiting for payment" modal — do NOT call the API again
    // and do NOT update holdings or navigate to paymentSuccess.
    setPaymentStatus("eft-pending");
    setEftSuccessOpen(true);
  };

  useEffect(() => {
    if (!autoProcessWallet) return;
    setAutoProcessWallet(false);
    handleWalletConfirm();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoProcessWallet]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);



  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Wallet Confirmation Modal */}
      <WalletConfirmModal
        isOpen={walletConfirmOpen}
        amount={amount}
        baseAmount={baseAmount}
        fees={fees}
        strategyName={strategy?.name}
        walletBalance={walletBalance}
        walletLabel={isChildWalletPurchase ? `${childWalletName}'s wallet` : "Wallet Balance"}
        walletLoading={walletLoading}
        isProcessing={paymentStatus === "processing"}
        isSingleSecurity={!isStrategyPurchase}
        onCancel={() => {
          setWalletConfirmOpen(false);
          setIsMethodModalOpen(true);
          setPaymentStatus("method-selection");
          setSelectedMethod(null);
        }}
        onConfirm={handleWalletConfirm}
        onNavigateToDeposit={onOpenDeposit}
      />

      {/* Ozow Confirmation Modal */}
      <OzowConfirmModal
        isOpen={ozowConfirmOpen}
        baseAmount={baseAmount}
        fees={fees}
        strategyName={strategy?.name}
        isProcessing={paymentStatus === "initializing"}
        isSingleSecurity={!isStrategyPurchase}
        onCancel={() => {
          setOzowConfirmOpen(false);
          setIsMethodModalOpen(true);
          setPaymentStatus("method-selection");
          setSelectedMethod(null);
        }}
        onConfirm={handleInitiateOzow}
      />

      <EFTSuccessModal
        isOpen={eftSuccessOpen}
        strategyName={strategy?.name}
        amount={amount}
        reference={eftReference}
        onDone={() => {
          setEftSuccessOpen(false);
          // EFT is pending — do NOT call onSuccess (which would update the portfolio).
          // Just dismiss and go back to home.
          onCancel?.();
        }}
      />
      <WalletSuccessModal
        isOpen={walletSuccessOpen}
        strategyName={strategy?.name}
        amountDeducted={walletAmountDeducted}
        newBalance={walletNewBalance}
        balanceLabel={isChildWalletPurchase ? `${childWalletName}'s wallet` : "New Balance"}
        onDone={() => {
          setWalletSuccessOpen(false);
          onSuccess?.({ reference: `WALLET-${Date.now()}`, method: "wallet" });
        }}
      />

      <div className="mx-auto flex w-full max-w-sm flex-col px-3 pt-12 md:max-w-md md:px-6">
        <header className="flex items-center justify-center gap-3 mb-6 relative">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm flex-shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">Payment</h1>
        </header>

        <PaymentMethodModal
          isOpen={isMethodModalOpen}
          onClose={() => onBack?.()}
          amount={amount}
          baseAmount={baseAmount}
          fees={fees}
          strategyName={strategy?.name}
          childFamilyMemberId={childFamilyMemberId}
          childFirstName={isChildWalletPurchase ? childWalletName : null}
          childWalletBalanceCents={isChildWalletPurchase ? Math.round(walletBalance * 100) : null}
          onSelectPaystack={() => handleMethodSelection("paystack")}
          onSelectWallet={(total) => {
            setSelectedMethod("wallet");
            setIsMethodModalOpen(false);
            setPaymentStatus("processing");
            handleWalletConfirm(total || amount);
          }}
          onEFTConfirm={() => { setIsMethodModalOpen(false); onCancel?.(); }}
          onSelectOzow={(total) => {
            setSelectedMethod("ozow");
            setIsMethodModalOpen(false);
            handleInitiateOzow(total || amount);
          }}
        />

        <section className="mt-20 rounded-3xl border border-slate-100 bg-white p-8 shadow-sm text-center">
          {(paymentStatus === "method-selection" || paymentStatus === "wallet-pending" || paymentStatus === "ozow-pending") && (
            <>
              <Loader2 className="h-16 w-16 mx-auto text-violet-600 animate-spin mb-4" />
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Waiting for selection
              </h2>
              <p className="text-sm text-slate-600">
                Please choose a funding method to continue
              </p>
            </>
          )}

          {paymentStatus === "initializing" && (
            <>
              <Loader2 className="h-16 w-16 mx-auto text-violet-600 animate-spin mb-4" />
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Initializing Payment
              </h2>
              <p className="text-sm text-slate-600">Please wait...</p>
            </>
          )}

          {paymentStatus === "processing" && (
            <>
              <Loader2 className="h-16 w-16 mx-auto text-violet-600 animate-spin mb-4" />
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Processing Payment
              </h2>
              <p className="text-sm text-slate-600">
                Complete payment in the popup window
              </p>
            </>
          )}

          {paymentStatus === "eft-instructions" && (
            <div className="text-left">
              <h2 className="text-lg font-semibold text-slate-900 mb-2 text-center">
                Direct EFT details
              </h2>
              <p className="text-xs text-slate-600 mb-4 text-center">
                Use these details to pay, then confirm below.
              </p>
              <div className="rounded-2xl border border-slate-200 p-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Account Name</span>
                  <span className="font-semibold text-slate-900">
                    MINT PLATFORMS (PTY) LTD
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Bank</span>
                  <span className="font-semibold text-slate-900">
                    Standard Bank
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Account Number</span>
                  <span className="font-semibold text-slate-900">
                    02 154 470 0
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Branch Code</span>
                  <span className="font-semibold text-slate-900">002064</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">SWIFT Code</span>
                  <span className="font-semibold text-slate-900">SBZAZAJJ</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Payment Reference</span>
                  <span className="font-bold text-violet-700 bg-violet-50 px-2 rounded">
                    {eftReference || "Generating..."}
                  </span>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-slate-500 text-center">
                Please use the reference shown above when making your payment.
              </p>
              <button
                type="button"
                onClick={() => onOpenDeposit?.()}
                className="mt-3 w-full rounded-2xl border border-violet-200 bg-violet-50 py-3 text-xs font-semibold text-violet-700"
              >
                View Deposit Page Details
              </button>
              <button
                type="button"
                onClick={handleEftConfirm}
                className="mt-5 w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-3 text-sm font-semibold text-white shadow-lg"
              >
                I have paid by EFT
              </button>
            </div>
          )}

          {(paymentStatus === "success" || paymentStatus === "wallet-done") && (
            <>
              <CheckCircle2 className="h-16 w-16 mx-auto text-emerald-600 mb-4" />
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Payment Successful!
              </h2>
              <p className="text-sm text-slate-600">
                Your investment is being processed
              </p>
            </>
          )}

          {paymentStatus === "failed" && (
            <>
              <XCircle className="h-16 w-16 mx-auto text-rose-600 mb-4" />
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Payment Failed
              </h2>
              <p className="text-sm text-slate-600">
                {errorMessage || "Something went wrong"}
              </p>
              <button
                type="button"
                onClick={onBack}
                className="mt-6 w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-3 text-sm font-semibold text-white shadow-lg"
              >
                Try Again
              </button>
            </>
          )}
        </section>

        <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-slate-600">Strategy</span>
              <span className="text-xs font-semibold text-slate-900">
                {strategy?.name || "N/A"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-600">
                Total Cost (incl. fees)
              </span>
              <span className="text-xs font-semibold text-slate-900">
                {strategy?.currency || "R"}
                {amount?.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }) || "0.00"}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-600">Payment Method</span>
              <span className="text-xs font-semibold text-slate-900">
                {selectedMethod === "direct_eft"
                  ? "Direct EFT"
                  : selectedMethod === "ozow"
                      ? "Ozow"
                      : selectedMethod === "wallet"
                        ? "Wallet"
                        : "Not selected"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── WalletConfirmModal ────────────────────────────────────────────────────────
const WalletConfirmModal = ({
  isOpen,
  amount,
  baseAmount,
  fees,
  strategyName,
  walletBalance,
  walletLabel,
  walletLoading,
  isProcessing,
  onCancel,
  onConfirm,
  onNavigateToDeposit,
  isSingleSecurity,
}) => {
  const { WALLET_TRANSACTION_FEE_RATE, AUM_FEE_RATE } = useFees();

  const bufferedBase = fees?.bufferedBase ?? (isSingleSecurity ? (baseAmount || 0) : (baseAmount || 0) * 1.08);
  const brokerFee    = fees?.brokerAmount ?? 0;
  const isinTotal    = fees?.isinTotal    ?? 0;
  const txFee        = bufferedBase * WALLET_TRANSACTION_FEE_RATE;
  const walletTotal  = bufferedBase + brokerFee + isinTotal + txFee;

  const hasEnoughFunds = walletBalance >= walletTotal;

  const fmt = (v) =>
    `R${Number(v).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const pct = (r) => `${(r * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-center mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100">
            <Wallet className="h-6 w-6 text-violet-600" />
          </div>
        </div>

        <h2 className="text-lg font-semibold text-slate-900 text-center mb-1">
          Confirm Purchase
        </h2>
        <p className="text-xs text-slate-500 text-center mb-5">
          {strategyName || "Investment Asset"}
        </p>

        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 mb-5 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">{isSingleSecurity ? "Investment Amount" : "Investment (incl. 8% reserve)"}</span>
            <span className="font-semibold text-slate-900">{fmt(bufferedBase)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Brokerage fee (0.25%)</span>
            <span className="font-semibold text-slate-900">{fmt(brokerFee)}</span>
          </div>
          {isinTotal > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Custody fee</span>
              <span className="font-semibold text-slate-900">{fmt(isinTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Transaction fee ({pct(WALLET_TRANSACTION_FEE_RATE)}) — Wallet</span>
            <span className="font-semibold text-slate-900">{fmt(txFee)}</span>
          </div>
          {/* AUM fee only applies to strategies, not single securities */}
          {!isSingleSecurity && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">AUM fee ({pct(AUM_FEE_RATE)} p.a.)</span>
              <span className="font-medium text-slate-400">monthly from cash</span>
            </div>
          )}
          <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between text-sm">
            <span className="font-bold text-slate-700">Total to Deduct</span>
            <span className="font-bold text-violet-700">{fmt(walletTotal)}</span>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between items-center px-1">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">{walletLabel || "Wallet Balance"}</span>
            <span className="text-xs font-bold text-slate-700">{walletLoading ? "..." : fmt(walletBalance)}</span>
          </div>
          
          {!walletLoading && !hasEnoughFunds ? (
            <div className="rounded-xl bg-rose-50 border border-rose-100 p-3">
              <p className="text-[11px] text-rose-600 text-center font-medium">
                Insufficient funds — please top up your wallet
              </p>
            </div>
          ) : !walletLoading && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
              <p className="text-[11px] text-emerald-600 text-center font-medium">
                Remaining balance after: {fmt(walletBalance - walletTotal)}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onConfirm(walletTotal)}
            disabled={isProcessing || (!walletLoading && !hasEnoughFunds)}
            className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-3.5 text-sm font-semibold text-white shadow-lg transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? "Processing..." : "Confirm Purchase"}
          </button>
          
          {!walletLoading && !hasEnoughFunds ? (
            <button
              type="button"
              onClick={onNavigateToDeposit}
              className="w-full rounded-2xl border-2 border-violet-200 py-3.5 text-sm font-semibold text-violet-700 transition active:scale-95"
            >
              Top Up Now
            </button>
          ) : (
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-2.5 text-sm font-semibold text-slate-400"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── OzowConfirmModal ──────────────────────────────────────────────────────────
const OzowConfirmModal = ({
  isOpen,
  baseAmount,
  fees,
  strategyName,
  isProcessing,
  onCancel,
  onConfirm,
  isSingleSecurity,
}) => {
  const { OZOW_TRANSACTION_FEE_RATE, AUM_FEE_RATE } = useFees();

  const bufferedBase = fees?.bufferedBase ?? (isSingleSecurity ? (baseAmount || 0) : (baseAmount || 0) * 1.08);
  const brokerFee    = fees?.brokerAmount ?? 0;
  const isinTotal    = fees?.isinTotal    ?? 0;
  const txFee        = bufferedBase * OZOW_TRANSACTION_FEE_RATE;
  const ozowTotal    = bufferedBase + brokerFee + isinTotal + txFee;

  const fmt = (v) =>
    `R${Number(v).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const pct = (r) => `${(r * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-center mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl overflow-hidden border border-slate-100 shadow-sm bg-white p-1">
            <img src="/ozow-logo.png" alt="Ozow" className="w-full h-full object-contain" />
          </div>
        </div>

        <h2 className="text-lg font-semibold text-slate-900 text-center mb-1">
          Confirm Purchase
        </h2>
        <p className="text-xs text-slate-500 text-center mb-1">
          {strategyName || "Investment Asset"}
        </p>
        <p className="text-[11px] text-violet-600 text-center mb-5 font-medium">
          Pay via Ozow instant bank transfer
        </p>

        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 mb-5 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">{isSingleSecurity ? "Investment Amount" : "Investment (incl. 8% reserve)"}</span>
            <span className="font-semibold text-slate-900">{fmt(bufferedBase)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Brokerage fee (0.25%)</span>
            <span className="font-semibold text-slate-900">{fmt(brokerFee)}</span>
          </div>
          {isinTotal > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Custody fee</span>
              <span className="font-semibold text-slate-900">{fmt(isinTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Transaction fee ({pct(OZOW_TRANSACTION_FEE_RATE)}) — Ozow</span>
            <span className="font-semibold text-slate-900">{fmt(txFee)}</span>
          </div>
          {/* AUM fee only applies to strategies, not single securities */}
          {!isSingleSecurity && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">AUM fee ({pct(AUM_FEE_RATE)} p.a.)</span>
              <span className="font-medium text-slate-400">monthly from cash</span>
            </div>
          )}
          <div className="border-t border-slate-200 mt-2 pt-2 flex justify-between text-sm">
            <span className="font-bold text-slate-700">Total</span>
            <span className="font-bold text-violet-700">{fmt(ozowTotal)}</span>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 text-center mb-5">
          You'll be redirected to Ozow to complete the payment securely.
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onConfirm(ozowTotal)}
            disabled={isProcessing}
            className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-3.5 text-sm font-semibold text-white shadow-lg transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? "Connecting to Ozow..." : "Confirm & Pay with Ozow"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2.5 text-sm font-semibold text-slate-400"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ── WalletSuccessModal ────────────────────────────────────────────────────────
const WalletSuccessModal = ({ isOpen, strategyName, amountDeducted, newBalance, balanceLabel, onDone }) => {
  const fmt = (v) =>
    `R${Number(v).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl text-center">
        <div className="flex flex-col items-center pt-2 pb-6">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-emerald-100">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            Purchase Successful!
          </h2>
          <p className="text-sm text-slate-500">Thank you for your purchase</p>
        </div>

        <div className="rounded-2xl bg-slate-50 p-5 mb-8 text-left space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Strategy</span>
            <span className="text-xs font-bold text-slate-900">{strategyName || "Investment"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Amount Deducted</span>
            <span className="text-xs font-bold text-rose-600">-{fmt(amountDeducted)}</span>
          </div>
          <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">{balanceLabel || "New Balance"}</span>
            <span className="text-sm font-bold text-emerald-600">{fmt(newBalance)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-4 text-sm font-bold text-white shadow-lg transition active:scale-95"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
};

// ── EFTSuccessModal ────────────────────────────────────────────────────────
const EFTSuccessModal = ({ isOpen, strategyName, amount, reference, onDone }) => {
  const fmt = (v) =>
    `R${Number(v).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl text-center">
        <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-violet-50 mb-4">
          <Clock className="h-8 w-8 text-violet-500 animate-pulse" />
        </div>

        <h2 className="text-xl font-semibold text-slate-900 mb-2">
          Investment Pending
        </h2>

        <p className="text-sm text-slate-600 mb-4">
          We have recorded your intent to invest <span className="font-bold text-slate-900">{fmt(amount)}</span> in <span className="font-semibold text-slate-900">{strategyName || "your selected asset"}</span>.
        </p>

        <div className="bg-slate-50 rounded-2xl p-4 mb-6 border border-slate-100">
          <p className="text-xs text-slate-500 mb-2">Your payment reference is:</p>
          <p className="text-base font-bold text-violet-700 tracking-wider mb-2">
            {reference}
          </p>
          <p className="text-[10px] text-slate-400 italic">
            Please ensure you have made the transfer using this exact reference.
          </p>
        </div>

        <p className="text-xs text-slate-500 mb-8 leading-relaxed">
          We will confirm your purchase once your payment reflects in our account. 
          This typically takes 1-2 business days.
        </p>

        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-3 text-sm font-semibold text-white shadow-lg transition active:scale-95"
        >
          Done
        </button>
      </div>
    </div>
  );
};

export default PaymentPage;
