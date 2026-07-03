import React, { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, Eye, EyeOff,
  Loader2, Trash2, User, XCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { isAdminPreview } from "../lib/adminPreview";

const REASONS = [
  { value: "no_longer_needed", label: "No longer needed" },
  { value: "moving_platform", label: "Moving to another platform" },
  { value: "fees", label: "Fees are too high" },
  { value: "other", label: "Other" },
];

function fmtRands(cents) {
  const val = (Number(cents) || 0) / 100;
  return `R\u202F${val.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtWallet(rands) {
  const val = Number(rands) || 0;
  return `R\u202F${val.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ChildDeleteAccountPage = ({ child, onBack, onDone }) => {
  const childName = [child?.first_name, child?.last_name].filter(Boolean).join(" ") || "Child";
  const childFirst = child?.first_name || "Child";

  const [step, setStep] = useState("checking");
  const [loadError, setLoadError] = useState("");

  const [hasBalance, setHasBalance] = useState(false);
  const [hasHoldings, setHasHoldings] = useState(false);
  const [balance, setBalance] = useState(0);
  const [holdingsCount, setHoldingsCount] = useState(0);
  const [pendingBlocker, setPendingBlocker] = useState(false);
  const [receivingAccounts, setReceivingAccounts] = useState([]);

  const [selectedReceiverId, setSelectedReceiverId] = useState(null);
  const [selectedReceiverType, setSelectedReceiverType] = useState(null);

  const [reason, setReason] = useState("");
  const [reasonOther, setReasonOther] = useState("");

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [confirmText, setConfirmText] = useState("");
  const [submitError, setSubmitError] = useState("");

  const fetchBlockers = useCallback(async () => {
    setStep("checking");
    setLoadError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setLoadError("Session expired. Please log in again."); setStep("error"); return; }

      const res = await fetch(`/api/account/delete-child?id=${child.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setLoadError(data.error || "Failed to check account status."); setStep("error"); return; }

      setHasBalance(data.hasBalance);
      setHasHoldings(data.hasHoldings);
      setBalance(data.balance || 0);
      setHoldingsCount(data.holdingsCount || 0);
      setPendingBlocker(!!data.pendingBlocker);
      setReceivingAccounts(data.receivingAccounts || []);

      if (data.pendingBlocker) {
        setStep("pending_blocker");
      } else if (data.hasBalance || data.hasHoldings) {
        setStep("transfer");
      } else {
        setStep("reason");
      }
    } catch {
      setLoadError("Could not connect. Please try again.");
      setStep("error");
    }
  }, [child.id]);

  useEffect(() => {
    fetchBlockers();
  }, [fetchBlockers]);

  const handlePasswordSubmit = async () => {
    setPasswordError("");
    if (!password.trim()) { setPasswordError("Please enter your password"); return; }
    if (!reason) { setPasswordError("Please select a reason"); return; }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/account/delete-child", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          childId: child.id,
          receivingAccountId: selectedReceiverId || null,
          receivingAccountType: selectedReceiverType || null,
          password,
          reason,
          reason_other: reasonOther,
          verifyOnly: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setPasswordError(data.error || "Incorrect password."); setSubmitting(false); return; }
      setStep("confirm");
    } catch {
      setPasswordError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  };

  const handleFinalClose = async () => {
    if (confirmText !== "DELETE") return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/account/delete-child", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          childId: child.id,
          receivingAccountId: selectedReceiverId || null,
          receivingAccountType: selectedReceiverType || null,
          password,
          reason,
          reason_other: reasonOther,
          verifyOnly: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error || "Something went wrong."); setSubmitting(false); return; }
      setStep("done");
      setTimeout(() => onDone?.(), 1800);
    } catch {
      setSubmitError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  };

  if (step === "done") {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-6 pb-24 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mb-6">
          <Check className="h-10 w-10 text-emerald-500" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3">Account Closed</h1>
        <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
          {childFirst}'s account has been closed.
          {selectedReceiverId && " Their assets have been transferred to the selected account."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 pt-12 pb-24">
      <header className="mb-8 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm transition active:scale-95"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold text-slate-900">Close {childFirst}'s Account</h1>
      </header>

      {step === "checking" && (
        <div className="flex flex-col items-center justify-center pt-24 gap-4">
          <Loader2 className="h-8 w-8 text-slate-400 animate-spin" />
          <p className="text-slate-500 text-sm">Checking account status…</p>
        </div>
      )}

      {step === "error" && (
        <div className="rounded-2xl bg-red-50 p-5 text-center">
          <p className="text-red-700 text-sm font-medium mb-3">{loadError}</p>
          <button onClick={fetchBlockers} className="text-sm font-semibold text-red-600 underline">Try again</button>
        </div>
      )}

      {step === "pending_blocker" && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800 mb-1">Pending transactions</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                {childFirst} has pending transactions. Please wait for them to settle before closing this account.
              </p>
            </div>
          </div>
          <button
            onClick={fetchBlockers}
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-600 shadow-sm transition active:scale-[0.99]"
          >
            Refresh status
          </button>
        </div>
      )}

      {step === "transfer" && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-violet-50 border border-violet-200 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-violet-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-violet-800 mb-1">
                {childFirst} still has assets
              </p>
              <ul className="text-xs text-violet-700 leading-relaxed space-y-1 mt-1">
                {hasBalance && <li>• Wallet balance: {fmtRands(balance)}</li>}
                {hasHoldings && <li>• {holdingsCount} active investment{holdingsCount !== 1 ? "s" : ""}</li>}
              </ul>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase text-slate-400 px-1 mb-3">Where should we send the assets?</p>
            <div className="space-y-2">
              {receivingAccounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => {
                    setSelectedReceiverId(acc.id);
                    setSelectedReceiverType(acc.type);
                  }}
                  className={`w-full rounded-2xl p-4 text-left flex items-center gap-3 shadow-sm transition ${
                    selectedReceiverId === acc.id
                      ? "bg-violet-600 text-white"
                      : "bg-white text-slate-800"
                  }`}
                >
                  <span className={`h-5 w-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    selectedReceiverId === acc.id ? "border-white bg-white" : "border-slate-300"
                  }`}>
                    {selectedReceiverId === acc.id && <span className="h-2.5 w-2.5 rounded-full bg-violet-600 block" />}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{acc.name}</p>
                    <p className={`text-xs mt-0.5 ${selectedReceiverId === acc.id ? "text-violet-200" : "text-slate-400"}`}>
                      {acc.label}
                      {acc.balance != null && ` · Balance: ${acc.type === "parent" ? fmtWallet(acc.balance) : fmtRands(acc.balance)}`}
                    </p>
                  </div>
                  <User className={`h-4 w-4 flex-shrink-0 ${selectedReceiverId === acc.id ? "text-violet-200" : "text-slate-300"}`} />
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setStep("reason")}
            disabled={!selectedReceiverId}
            className="w-full rounded-2xl bg-slate-900 py-4 text-sm font-semibold text-white disabled:opacity-40 transition active:scale-[0.99]"
          >
            Continue
          </button>
        </div>
      )}

      {step === "reason" && (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-bold uppercase text-slate-400 px-1 mb-3">
              Step {selectedReceiverId ? "2" : "1"} — Why are you closing this account?
            </p>
            <div className="space-y-2">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => { setReason(r.value); if (r.value !== "other") setReasonOther(""); }}
                  className={`w-full rounded-2xl p-4 text-left flex items-center gap-3 shadow-sm transition ${
                    reason === r.value ? "bg-violet-600 text-white" : "bg-white text-slate-800"
                  }`}
                >
                  <span className={`h-5 w-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    reason === r.value ? "border-white bg-white" : "border-slate-300"
                  }`}>
                    {reason === r.value && <span className="h-2.5 w-2.5 rounded-full bg-violet-600 block" />}
                  </span>
                  <span className="text-sm font-medium">{r.label}</span>
                </button>
              ))}
            </div>
            {reason === "other" && (
              <textarea
                value={reasonOther}
                onChange={(e) => setReasonOther(e.target.value)}
                placeholder="Tell us more…"
                rows={3}
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
              />
            )}
          </div>

          <button
            onClick={() => setStep("password")}
            disabled={!reason || (reason === "other" && !reasonOther.trim())}
            className="w-full rounded-2xl bg-slate-900 py-4 text-sm font-semibold text-white disabled:opacity-40 transition active:scale-[0.99]"
          >
            Continue
          </button>

          {(hasBalance || hasHoldings) && (
            <button onClick={() => setStep("transfer")} className="w-full text-center text-sm text-slate-500">
              ← Back
            </button>
          )}
        </div>
      )}

      {step === "password" && (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-bold uppercase text-slate-400 px-1 mb-3">Confirm your identity</p>
            <div className="rounded-2xl bg-white p-4 shadow-sm space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Enter <strong>your</strong> Mint password to authorise closing {childFirst}'s account.
              </p>
              {selectedReceiverId && (
                <div className="rounded-xl bg-violet-50 border border-violet-100 px-3 py-2.5">
                  <p className="text-xs text-violet-700">
                    Assets will be transferred to <strong>{receivingAccounts.find(a => a.id === selectedReceiverId)?.name}</strong>
                  </p>
                </div>
              )}
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(""); }}
                  placeholder="Your current password"
                  autoComplete="current-password"
                  className={`w-full rounded-xl border px-4 py-3 pr-12 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 ${
                    passwordError ? "border-red-300 focus:ring-red-200" : "border-slate-200 focus:ring-violet-300"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {passwordError && <p className="text-xs text-red-500">{passwordError}</p>}
            </div>
          </div>

          <button
            onClick={handlePasswordSubmit}
            disabled={submitting || !password.trim() || isAdminPreview()}
            className={`w-full rounded-2xl bg-slate-900 py-4 text-sm font-semibold text-white disabled:opacity-40 transition active:scale-[0.99] flex items-center justify-center gap-2${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify & Continue
          </button>

          <button onClick={() => setStep("reason")} className="w-full text-center text-sm text-slate-500">
            ← Back
          </button>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-5">
          <div className="rounded-2xl bg-red-50 border border-red-200 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <p className="text-sm font-bold text-red-800">This action is permanent</p>
            </div>
            <ul className="text-xs text-red-700 leading-relaxed space-y-1 pl-7 list-disc">
              <li>{childFirst}'s account will be permanently removed</li>
              {selectedReceiverId && (
                <li>All assets will be transferred to <strong>{receivingAccounts.find(a => a.id === selectedReceiverId)?.name}</strong></li>
              )}
              <li>Transaction records are retained for 5 years (FICA compliance)</li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold uppercase text-slate-400 px-1 mb-3">Final confirmation</p>
            <div className="rounded-2xl bg-white p-4 shadow-sm space-y-3">
              <p className="text-sm text-slate-600 leading-relaxed">
                Type <span className="font-bold text-slate-900">DELETE</span> below to permanently close {childFirst}'s account.
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => { setConfirmText(e.target.value); setSubmitError(""); }}
                placeholder='Type "DELETE" here'
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-300 font-mono tracking-widest"
              />
              {submitError && <p className="text-xs text-red-500">{submitError}</p>}
            </div>
          </div>

          <button
            onClick={handleFinalClose}
            disabled={submitting || confirmText !== "DELETE" || isAdminPreview()}
            className={`w-full rounded-2xl bg-red-500 py-4 text-sm font-semibold text-white disabled:opacity-40 transition active:scale-[0.99] flex items-center justify-center gap-2${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Close {childFirst}'s Account
          </button>

          <button
            onClick={() => { setStep("password"); setConfirmText(""); setSubmitError(""); }}
            className="w-full text-center text-sm text-slate-500"
          >
            ← Back
          </button>
        </div>
      )}
    </div>
  );
};

export default ChildDeleteAccountPage;
