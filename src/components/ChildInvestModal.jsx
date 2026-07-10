import React, { useState, useMemo, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowLeft, Wallet, BarChart3, Check, ChevronDown, ChevronUp, TrendingUp, Sparkles, Info } from "lucide-react";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "../lib/supabase.js";
import { calculateMinInvestmentSync, buildHoldingsBySymbol, getHoldingsArray } from "../lib/strategyUtils";
import { useDiscretionType } from "../lib/useDiscretionType";
import { useFees } from "../lib/useFees";
import { isAdminPreview } from "../lib/adminPreview";

export default function ChildInvestModal({
  child,
  strategy,
  initialStep = "preview",
  onClose,
  onOpenFactsheet,
  onUpdateMandate,
}) {
  const gradientId = useId();
  const readOnly = isAdminPreview();
  const { isLimited: isLimitedDiscretion } = useDiscretionType();
  const { ISIN_FEE_PER_ASSET, BROKER_FEE_RATE, TRANSACTION_FEE_RATE, CASH_BUFFER_RATE } = useFees();
  const [showDiscretionModal, setShowDiscretionModal] = useState(false);
  const [step, setStep] = useState(initialStep);
  const [units, setUnits] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Server said this basket already has an unfilled purchase — ask before re-buying.
  const [dupPending, setDupPending] = useState(false);
  const [feeExpanded, setFeeExpanded] = useState(false);

  const [minimum, setMinimum] = useState(strategy?.calculatedMinInvestment || null);
  const [minimumLoading, setMinimumLoading] = useState(!strategy?.calculatedMinInvestment);

  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [activeLabel, setActiveLabel] = useState(null);

  const [showFeeModal, setShowFeeModal] = useState(false);
  const [feeChecking, setFeeChecking] = useState(false);

  const childBalance = child?.available_balance || 0;
  const childFirstName = child?.first_name || "Child";

  const minInvCents = minimum ? minimum * 100 : 0;
  const baseAmountCents = units * minInvCents;
  const baseAmount = baseAmountCents / 100;

  const numAssets = useMemo(() => {
    const list = getHoldingsArray(strategy);
    return Array.isArray(list) ? list.length : 0;
  }, [strategy]);

  const fees = useMemo(() => {
    const bufferedBase = baseAmount * (1 + CASH_BUFFER_RATE);
    const brokerAmount = bufferedBase * BROKER_FEE_RATE;
    const isinTotal = ISIN_FEE_PER_ASSET * numAssets;
    const transactionAmount = bufferedBase * TRANSACTION_FEE_RATE;
    const totalCost = bufferedBase + brokerAmount + isinTotal + transactionAmount;
    return { bufferedBase, brokerAmount, isinTotal, transactionAmount, totalCost };
  }, [baseAmount, numAssets, CASH_BUFFER_RATE, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, TRANSACTION_FEE_RATE]);

  const totalCostCents = Math.round(fees.totalCost * 100);
  const insufficient = totalCostCents > childBalance;

  useEffect(() => {
    if (strategy?.calculatedMinInvestment) {
      setMinimum(strategy.calculatedMinInvestment);
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
  }, [strategy]);

  useEffect(() => {
    if (step !== "preview" || !strategy || !supabase) return;
    let mounted = true;
    setAnalyticsLoading(true);
    (async () => {
      try {
        const strategyId = strategy.id || strategy.strategy_id;
        if (!strategyId) return;
        const yearStart = `${new Date().getFullYear()}-01-01`;
        const { data } = await supabase
          .from("strategies_returns_c")
          .select("strategy_id, as_of_date, \"1d_pct\"")
          .eq("strategy_id", strategyId)
          .gte("as_of_date", yearStart)
          .order("as_of_date", { ascending: true });
        if (!mounted || !data?.length) return;
        let cumulative = 0;
        const curves = { YTD: data.map(d => { cumulative += (d["1d_pct"] || 0) / 100; return { d: d.as_of_date, v: Number((cumulative * 100).toFixed(2)) }; }) };
        if (mounted) setAnalytics({ curves });
      } catch { } finally { if (mounted) setAnalyticsLoading(false); }
    })();
    return () => { mounted = false; };
  }, [step, strategy]);

  const { chartData, chartDomain, chartBaseValue } = useMemo(() => {
    const fallbackLen = 140;
    const fallback = Array.from({ length: fallbackLen }, (_, i) => ({
      d: new Date(Date.now() - (fallbackLen - i) * 86400000).toISOString(),
      v: Number((100 + Math.sin(i / 18) * 1.1 + (i / fallbackLen) * 1.6).toFixed(2)),
    }));
    let series = analytics?.curves?.YTD?.length ? analytics.curves.YTD : fallback;
    const labelIndices = [0, Math.floor(series.length / 2), series.length - 1];
    const values = series.map(p => p.v ?? 0);
    const min = Math.min(...values); const max = Math.max(...values);
    const pad = (max - min) * 0.2;
    const mapped = series.map((p, i) => {
      const date = p.d ? new Date(p.d) : null;
      return {
        label: i + 1,
        dateLabel: labelIndices.includes(i) && date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
        returnPct: p.v ?? 0,
      };
    });
    return { chartData: mapped, chartDomain: [min - pad, max + pad], chartBaseValue: values[0] ?? null };
  }, [analytics]);

  const ytdNum = strategy?.r_ytd != null ? (Math.abs(strategy.r_ytd) <= 1 ? strategy.r_ytd * 100 : strategy.r_ytd) : null;
  const lineColor = (ytdNum ?? 0) > 0 ? "#10b981" : (ytdNum ?? 0) < 0 ? "#ef4444" : "#94a3b8";

  async function handleInvest(force = false) {
    if (isLimitedDiscretion) { setShowDiscretionModal(true); return; }
    if (baseAmountCents <= 0) { setError("Select a valid investment amount."); return; }
    if (insufficient) { setError("Insufficient funds in child's wallet."); return; }
    if (saving) return; // double-tap guard
    setSaving(true); setError(""); setDupPending(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/child-invest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          family_member_id: child.id,
          strategy_id: strategy.id,
          amount: totalCostCents,
          base_amount: baseAmountCents,
          units,
          force,
        }),
      });
      const json = await res.json();
      // Same basket already pending broker fill → confirm before buying again
      // (this is what caused accidental double purchases).
      if (res.status === 409 && json.pending_exists) { setDupPending(true); return; }
      if (!res.ok) { setError(json.error || "Investment failed."); return; }
      // Let any mounted child views (dashboard/portfolio) refetch immediately so
      // the pending card shows without leaving and re-entering the app.
      try { window.dispatchEvent(new CustomEvent("mint:child-invested", { detail: { familyMemberId: child.id, ...json } })); } catch {}
      setStep("success");
    } catch { setError("Something went wrong."); } finally { setSaving(false); }
  }

  async function handleInvestNowClick() {
    if (isLimitedDiscretion) { setShowDiscretionModal(true); return; }
    if (!minimum || feeChecking) return;
    setFeeChecking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { setStep("amount"); return; }

      const { data: childHoldings } = await supabase
        .from("stock_holdings_c")
        .select("strategy_id")
        .eq("family_member_id", child.id);

      const childStrategyIds = new Set(
        (childHoldings || []).map(h => h.strategy_id).filter(Boolean)
      );
      const alreadyHasThisStrategy = strategy?.id && childStrategyIds.has(strategy.id);

      if (!alreadyHasThisStrategy && childStrategyIds.size >= 1) {
        setShowFeeModal(true);
      } else {
        setStep("amount");
      }
    } catch {
      setStep("amount");
    } finally {
      setFeeChecking(false);
    }
  }

  const portalTarget = document.getElementById("modal-root") || document.body;

  const tags = Array.isArray(strategy?.tags) && strategy.tags.length > 0
    ? strategy.tags
    : [strategy?.risk_level, strategy?.sector].filter(Boolean);

  const holdings = useMemo(() => {
    const hArr = getHoldingsArray(strategy);
    return hArr.map(h => {
      const sym = h.ticker || h.symbol || h;
      return { ...h, symbol: sym, name: h.name || sym, logo_url: h.logo_url || null };
    });
  }, [strategy]);

  const fmt = (n) => n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] flex items-end justify-center"
        style={{ background: "rgba(15,10,30,0.65)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          className="relative flex w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl"
          style={{ maxHeight: "92vh" }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
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
            <div className="flex items-center gap-2.5">
              {step === "amount" && initialStep !== "amount" && (
                <button
                  type="button"
                  onClick={() => setStep("preview")}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition active:scale-95"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <div>
                <h2 className="text-[15px] font-bold text-slate-900 leading-tight">
                  {step === "success" ? "Investment Placed!" : step === "amount" ? "Confirm Investment" : (strategy?.short_name || strategy?.name)}
                </h2>
                {step === "preview" && minimum && (
                  <p className="text-[11px] text-slate-400 mt-0.5">Min. R{fmt(minimum * (1 + CASH_BUFFER_RATE))} per basket</p>
                )}
                {step === "amount" && (
                  <p className="text-[11px] text-slate-400 mt-0.5">{strategy?.short_name || strategy?.name}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── SUCCESS ── */}
          {step === "success" && (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              <motion.div
                className="flex flex-col items-center px-6 pt-6 pb-8"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 280, damping: 24 }}
              >
                {/* Icon */}
                <div className="relative mb-5">
                  <div className="h-20 w-20 rounded-3xl flex items-center justify-center shadow-lg" style={{ background: "linear-gradient(135deg,#7c3aed,#6366f1)" }}>
                    <Check className="h-10 w-10 text-white" strokeWidth={2.5} />
                  </div>
                  <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-emerald-400 flex items-center justify-center shadow">
                    <Sparkles className="h-3 w-3 text-white" />
                  </div>
                </div>

                <p className="text-xl font-bold text-slate-900 mb-1">All done!</p>
                <p className="text-sm text-slate-500 text-center leading-relaxed mb-6">
                  <span className="font-semibold text-slate-700">R{fmt(baseAmount)}</span> invested in{" "}
                  <span className="font-semibold text-slate-700">{strategy?.name}</span> for {childFirstName}.
                </p>

                {/* Summary card */}
                <div className="w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 mb-6 space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500">Strategy</span>
                    <span className="text-xs font-semibold text-slate-800">{strategy?.name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500">Invested for</span>
                    <span className="text-xs font-semibold text-slate-800">{childFirstName}</span>
                  </div>
                  <div className="h-px bg-slate-200" />
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-600">Base amount</span>
                    <span className="text-xs font-bold text-slate-900">R{fmt(baseAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-slate-600">Total charged</span>
                    <span className="text-xs font-bold text-slate-900">R{fmt(fees.totalCost)}</span>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="w-full rounded-2xl py-4 text-sm font-bold text-white shadow-lg active:scale-[0.98] transition-transform"
                  style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}
                >
                  Done
                </button>
              </motion.div>
            </div>
          )}

          {/* ── PREVIEW ── */}
          {step === "preview" && (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-6" style={{ WebkitOverflowScrolling: "touch" }}>

              {/* Balance pill */}
              <div className="flex items-center gap-2 rounded-2xl px-4 py-3 mb-5" style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)" }}>
                <div className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#7c3aed,#6366f1)" }}>
                  <Wallet className="h-3.5 w-3.5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wide">{childFirstName}'s wallet</p>
                  <p className="text-sm font-bold text-purple-900 tabular-nums">
                    R{(childBalance / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                {minimum && (
                  <div className="text-right">
                    <p className="text-[10px] text-purple-400 uppercase tracking-wide">Min. invest</p>
                    <p className="text-sm font-bold text-purple-800">R{fmt(minimum * (1 + CASH_BUFFER_RATE))}</p>
                  </div>
                )}
              </div>

              {/* Chart */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">YTD Performance</span>
                  </div>
                  {ytdNum != null && (
                    <span className={`text-sm font-bold ${ytdNum > 0 ? "text-emerald-600" : ytdNum < 0 ? "text-rose-500" : "text-slate-500"}`}>
                      {ytdNum >= 0 ? "+" : ""}{ytdNum.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="h-40 w-full rounded-2xl overflow-hidden bg-slate-50 border border-slate-100">
                  {analyticsLoading ? (
                    <div className="flex h-full items-end gap-1.5 p-4">
                      {[40, 60, 35, 75, 50, 65, 45, 85, 55, 70, 80, 90].map((h, i) => (
                        <div key={i} className="flex-1 rounded-sm animate-pulse" style={{ height: `${h}%`, background: "linear-gradient(180deg,#ddd6fe,#ede9fe)" }} />
                      ))}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 24 }} onMouseMove={s => s?.activeLabel && setActiveLabel(s.activeLabel)} onMouseLeave={() => setActiveLabel(null)}>
                        <defs>
                          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <ReferenceLine y={100} stroke="#e2e8f0" strokeDasharray="3 3" />
                        {activeLabel && <ReferenceLine x={activeLabel} stroke="#c4b5fd" strokeOpacity={0.7} strokeDasharray="3 3" />}
                        {activeLabel && (
                          <Tooltip
                            contentStyle={{ backgroundColor: "#fff", border: "none", borderRadius: "14px", padding: "4px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}
                            labelStyle={{ display: "none" }}
                            formatter={v => { if (!chartBaseValue) return [`${Number(v).toFixed(2)}`, ""]; const d = ((Number(v) - chartBaseValue) / chartBaseValue) * 100; return [`${d >= 0 ? "+" : ""}${d.toFixed(2)}%`, ""]; }}
                          />
                        )}
                        <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} height={20} />
                        <YAxis hide domain={chartDomain} />
                        <Area type="monotone" dataKey="returnPct" stroke="transparent" fill={`url(#${gradientId})`} dot={false} />
                        <Line type="monotone" dataKey="returnPct" stroke={lineColor} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: lineColor, strokeWidth: 0 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {tags.map(tag => (
                    <span key={tag} className="rounded-full px-3 py-1 text-[11px] font-semibold text-purple-700 border border-purple-100" style={{ background: "#f5f3ff" }}>{tag}</span>
                  ))}
                </div>
              )}

              {/* Holdings */}
              {holdings.slice(0, 5).length > 0 && (
                <div className="mb-5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Top Holdings</p>
                  <div className="space-y-2">
                    {holdings.slice(0, 5).map((h, idx) => (
                      <div key={h.symbol} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: idx % 2 === 0 ? "#fafafa" : "#fff" }}>
                        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-white shadow-sm flex-shrink-0">
                          {h.logo_url
                            ? <img src={h.logo_url} alt={h.symbol} className="h-full w-full object-cover" />
                            : <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-slate-600" style={{ background: "linear-gradient(135deg,#ede9fe,#ddd6fe)" }}>{h.symbol?.substring(0, 2)}</div>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{h.name}</p>
                          <p className="text-[11px] text-slate-400">{h.symbol}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2.5 pt-1">
                <button
                  onClick={handleInvestNowClick}
                  disabled={readOnly || !minimum || feeChecking}
                  className={`w-full rounded-2xl py-4 text-sm font-bold text-white shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed${readOnly ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
                  style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}
                >
                  {minimumLoading || feeChecking ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      {feeChecking ? "Checking..." : "Loading..."}
                    </span>
                  ) : "Invest Now"}
                </button>
                {onOpenFactsheet && (
                  <button
                    onClick={() => { onClose(); onOpenFactsheet(strategy); }}
                    className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition-all"
                  >
                    View Factsheet
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── AMOUNT ── */}
          {step === "amount" && (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-6" style={{ WebkitOverflowScrolling: "touch" }}>

              {/* Balance + strategy row */}
              <div className="flex gap-3 mb-5">
                <div className="flex-1 rounded-2xl p-3.5 border border-slate-100" style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)" }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Wallet className="h-3 w-3 text-purple-400" />
                    <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wide">{childFirstName}'s balance</p>
                  </div>
                  <p className="text-base font-bold text-purple-900 tabular-nums">
                    R{(childBalance / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                    <p className="text-[11px] text-slate-400 mt-1">{units} basket{units !== 1 ? "s" : ""} × R{minimum ? fmt(minimum * (1 + CASH_BUFFER_RATE)) : "0.00"}</p>
                  </div>
                  <button
                    onClick={() => setUnits(u => u + 1)}
                    disabled={!minimum || insufficient}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl text-white text-xl font-semibold disabled:opacity-30 disabled:cursor-not-allowed active:scale-90 transition-all shadow-md"
                    style={{ background: "linear-gradient(135deg,#6366f1,#7c3aed)" }}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Total cost */}
              <div className="mb-4 rounded-2xl overflow-hidden" style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)" }}>
                <div className="flex items-center justify-between px-4 py-3.5">
                  <p className="text-xs font-bold text-purple-700">Total Due Today</p>
                  <p className="text-base font-black text-purple-900">R{fmt(fees.totalCost)}</p>
                </div>
              </div>

              {/* Errors */}
              {insufficient && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 mb-4 flex items-start gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-red-400 mt-1.5 flex-shrink-0" />
                  <p className="text-xs font-semibold text-red-600">
                    Insufficient funds — {childFirstName} needs R{fmt(fees.totalCost - childBalance / 100)} more.
                  </p>
                </div>
              )}
              {error && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 mb-4 flex items-start gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-red-400 mt-1.5 flex-shrink-0" />
                  <p className="text-xs font-semibold text-red-600">{error}</p>
                </div>
              )}

              {/* Duplicate-pending confirm — the same basket already has an
                  unfilled purchase; make buying again an explicit choice. */}
              {dupPending && (
                <div className="rounded-xl bg-violet-50 border border-violet-200 px-4 py-3 mb-4">
                  <p className="text-xs font-bold text-violet-800">You already have a pending purchase of this basket</p>
                  <p className="text-[11px] text-violet-600 mt-1">
                    {childFirstName}'s earlier order is waiting for the broker to fill — it can take a little while to show as invested. Buy it again anyway?
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setDupPending(false)}
                      className="flex-1 rounded-xl border border-violet-200 bg-white py-2.5 text-xs font-bold text-violet-700 active:scale-[0.98]"
                    >
                      No, keep waiting
                    </button>
                    <button
                      onClick={() => handleInvest(true)}
                      disabled={saving}
                      className="flex-1 rounded-xl py-2.5 text-xs font-bold text-white active:scale-[0.98] disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}
                    >
                      Yes, buy again
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={() => handleInvest(false)}
                disabled={insufficient || baseAmountCents <= 0 || saving || !minimum}
                className="w-full rounded-2xl py-4 text-sm font-bold text-white shadow-lg active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Processing…
                  </span>
                ) : "Confirm Investment"}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>

      {/* Additional Strategy Fee bottom sheet */}
      <AnimatePresence>
        {showFeeModal && (
          <motion.div
            className="fixed inset-0 z-[10000] flex items-end justify-center"
            style={{ background: "rgba(15,10,30,0.55)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowFeeModal(false)}
          >
            <motion.div
              className="relative w-full max-w-md rounded-t-[28px] bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl overflow-hidden"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Gradient accent strip */}
              <div className="h-1 w-full" style={{ background: "linear-gradient(90deg,#7c3aed,#6366f1,#8b5cf6)" }} />
              {/* Drag handle */}
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="h-[3px] w-9 rounded-full bg-slate-200" />
              </div>

              <div className="px-6 pt-4 pb-6">
                {/* Icon */}
                <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 opacity-20 animate-pulse" />
                  <Info className="h-8 w-8 text-violet-600 relative z-10" />
                </div>

                <h3 className="text-center text-lg font-bold text-slate-900 mb-1">Add Another Strategy</h3>
                <p className="text-center text-sm text-slate-600 mb-4">
                  {childFirstName} already holds an active strategy. You're about to invest in an additional strategy:{" "}
                  <span className="font-semibold text-slate-900">{strategy?.name}</span>.
                </p>

                <button
                  type="button"
                  onClick={() => { setShowFeeModal(false); setStep("amount"); }}
                  className="w-full rounded-2xl py-3 text-sm font-semibold text-white shadow-lg shadow-violet-200/60 mb-2"
                  style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}
                >
                  I Understand, Continue
                </button>
                <button
                  type="button"
                  onClick={() => setShowFeeModal(false)}
                  className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-600"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Limited-discretion block */}
      <AnimatePresence>
        {showDiscretionModal && (
          <motion.div
            className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
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
    </AnimatePresence>,
    portalTarget
  );
}
