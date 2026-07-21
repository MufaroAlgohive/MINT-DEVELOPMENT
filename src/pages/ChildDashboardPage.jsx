import React, { useState, useEffect, useRef, useMemo, useId, lazy, Suspense } from "react";

const MarketsPage = lazy(() => import("./MarketsPage.jsx"));
const MorePage = lazy(() => import("./MorePage.jsx"));
const NewsArticlePage = lazy(() => import("./NewsArticlePage.jsx"));
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ArrowUpRight, ArrowDownLeft, X,
  Wallet, BarChart3, ChevronRight, ChevronDown, ChevronUp,
  RefreshCw, Search, Star, AlertCircle, Check, ClipboardList,
  BookOpen, LayoutGrid, ArrowDownToLine, Target, FileSignature, Plus, Heart, Gift,
} from "lucide-react";
import GiftRegistryCreateSheet from "../components/GiftRegistryCreateSheet.jsx";
import NotificationBell from "../components/NotificationBell";
import FamilyDropdown from "../components/FamilyDropdown";
import Navbar from "../components/Navbar";
import ChildPortfolioTab from "../components/ChildPortfolioTab";
import SwipeableBalanceCard from "../components/SwipeableBalanceCard";
import Skeleton from "../components/Skeleton";
import { useProfile } from "../lib/useProfile";
import { supabase } from "../lib/supabase";
import { isAdminPreview } from "../lib/adminPreview";
import { useFees } from "../lib/useFees";
import MinorProofOfAddressDeclaration from "../components/MinorProofOfAddressDeclaration";
import ChildResponsibilityAgreement from "../components/ChildResponsibilityAgreement";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { calculateMinInvestmentSync, buildHoldingsBySymbol, getHoldingsArray, normalizeSymbol, enrichSecuritiesWithIntradayPrices } from "../lib/strategyUtils.js";

// --- helpers ----------------------------------------------------------------

function getAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function fmt(cents) {
  const val = (cents || 0) / 100;
  return `R\u202F${val.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtRands(rands) {
  const absNum = Math.abs(Number(rands || 0));
  const truncated = Math.floor(absNum * 100) / 100;
  return `R\u202F${truncated.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function withTimeout(promise, ms, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function fetchWithTimeout(url, options, ms, message) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), ms);

  return fetch(url, { ...options, signal: controller.signal })
    .catch((error) => {
      if (error?.name === "AbortError") throw new Error(message);
      throw error;
    })
    .finally(() => window.clearTimeout(timeoutId));
}

const CHILD_KYC_PENDING_MESSAGE = "Please wait until this child's KYC is verified before browsing strategies.";

function getChildKycState(child) {
  const kycStatus = String(child?.kyc_status || "pending").toLowerCase();
  const certificateStatus = String(child?.certificate_verification_status || "pending_review").toLowerCase();
  const verified = certificateStatus === "verified" || kycStatus === "completed";
  const rejected = kycStatus === "rejected" || certificateStatus === "rejected";

  if (verified) {
    return {
      status: "verified",
      label: "Verified",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
      pulse: false,
      verified: true,
    };
  }

  if (rejected) {
    return {
      status: "rejected",
      label: "KYC Rejected",
      className: "bg-red-50 text-red-700 border-red-200",
      pulse: false,
      verified: false,
    };
  }

  return {
    status: "pending",
    label: "KYC Pending",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    pulse: true,
    verified: false,
  };
}

// --- Animation variants -----------------------------------------------------

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 340, damping: 28 } },
};

function TransferModal({ child, parentBalance, balancesLoading, onTransfer, onClose }) {
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const childFirstName = child?.first_name || "Child";

  const numAmount = parseFloat(amount) || 0;
  const amountCents = Math.round(numAmount * 100);
  const insufficient = !balancesLoading && amountCents > (parentBalance || 0);

  async function handleSubmit() {
    if (numAmount <= 0) { setError("Enter a valid amount."); return; }
    if (insufficient) { setError("Insufficient wallet balance."); return; }
    setSaving(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/child-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "transfer",
          family_member_id: child.id,
          amount: amountCents,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Transfer failed."); return; }
      setSuccess(true);
      onTransfer(json);
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-lg font-bold text-slate-800 text-center placeholder-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition tabular-nums";

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-md bg-white rounded-t-3xl shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >
        <div className="flex justify-center pt-3 pb-1"><div className="h-1 w-10 rounded-full bg-slate-200" /></div>

        <div className="px-6 pt-3 pb-[calc(var(--navbar-height,80px)+1.5rem)]">
          {!success ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#6ee7b7,#34d399)" }}>
                    <ArrowDownLeft className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-slate-900">Transfer Funds</p>
                    <p className="text-xs text-slate-400">
                      {`To ${childFirstName}'s account`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition active:scale-95"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Balance info */}
              <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 mb-4 border border-slate-100">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Your Wallet</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                    {balancesLoading ? "Loading..." : fmt(parentBalance)}
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-300" />
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{`${childFirstName}'s Wallet`}</p>
                  <p className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                    {balancesLoading ? "Loading..." : fmt(child.available_balance || 0)}
                  </p>
                </div>
              </div>

              {/* Amount input */}
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 ml-0.5">
                Amount (ZAR)
              </label>
              <div className="relative mb-4">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">R</span>
                <input
                  id="child-transfer-amount"
                  name="child-transfer-amount"
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputCls + " pl-10"}
                  autoFocus
                />
              </div>

              {/* Quick amounts */}
              <div className="flex gap-2 mb-5">
                {[50, 100, 250, 500].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(String(v))}
                    disabled={balancesLoading}
                    className="flex-1 rounded-lg py-2 text-xs font-bold text-purple-600 bg-purple-50 border border-purple-100 hover:bg-purple-100 transition active:scale-95"
                  >
                    R{v}
                  </button>
                ))}
              </div>

              {insufficient && (
                <div className="flex items-start gap-2 rounded-xl bg-purple-50 px-4 py-3 border border-purple-100 mb-3">
                  <AlertCircle className="h-3.5 w-3.5 text-purple-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-purple-600">Amount exceeds your wallet balance.</p>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 border border-red-100 mb-3">
                  <X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-500">{error}</p>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={balancesLoading || saving || numAmount <= 0 || insufficient}
                className="w-full rounded-xl py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
              >
                {saving ? "Transferring..." : `Transfer R${numAmount.toFixed(2)}`}
              </button>
            </>
          ) : (
            <motion.div
              className="text-center py-4"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <div className="h-16 w-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#e9d5ff,#d8b4fe)" }}>
                <Check className="h-8 w-8 text-purple-600" />
              </div>
              <p className="text-lg font-bold text-slate-900">Transfer Complete!</p>
              <p className="text-sm text-slate-500 mt-2">
                {`R${numAmount.toFixed(2)} has been transferred to ${childFirstName}'s wallet.`}
              </p>
              <button
                onClick={onClose}
                className="mt-6 w-full rounded-xl py-3.5 text-sm font-bold text-white active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
              >
                Done
              </button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Invest Modal (bottom-sheet) - browse strategies & invest ----------------

// Fee rates come from useFees() (CRM-configurable) so child & parent flows quote
// identical totals for a given base investment + holdings count.
function InvestModal({ child, onInvest, onClose, onOpenFactsheet }) {
  const { ISIN_FEE_PER_ASSET, BROKER_FEE_RATE, TRANSACTION_FEE_RATE, CASH_BUFFER_RATE } = useFees();
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [step, setStep] = useState("browse");
  const [selectedStrategyAnalytics, setSelectedStrategyAnalytics] = useState(null);
  const [selectedStrategyAnalyticsLoading, setSelectedStrategyAnalyticsLoading] = useState(false);
  const [selectedStrategyActiveLabel, setSelectedStrategyActiveLabel] = useState(null);
  const [selectedStrategyMinimum, setSelectedStrategyMinimum] = useState(null);
  const [strategyMinimums, setStrategyMinimums] = useState({}); // Minimums for browse list
  const [minimumLoading, setMinimumLoading] = useState(true);
  const previewGradientId = useId();
  const [units, setUnits] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const childFirstName = child?.first_name || "Child";
  const childBalance = child.available_balance || 0;
  const minInvCents = selectedStrategyMinimum ? selectedStrategyMinimum * 100 : 0;
  const baseAmountCents = units * minInvCents;        // user-selected base (units × min)
  const baseAmount = baseAmountCents / 100;            // rands

  // Mirror the parent flow's fee model so child quotes are identical for a
  // given base + holdings count. Fees stack onto the buffered base (base × 1.08).
  const numAssets = useMemo(() => {
    const list = selected?.holdingsList || selected?.holdings || [];
    return Array.isArray(list) ? list.length : 0;
  }, [selected]);

  const fees = useMemo(() => {
    const bufferedBase = baseAmount * (1 + CASH_BUFFER_RATE);
    const brokerAmount = bufferedBase * BROKER_FEE_RATE;
    const isinTotal = ISIN_FEE_PER_ASSET * numAssets;
    const transactionAmount = bufferedBase * TRANSACTION_FEE_RATE;
    const totalCost = bufferedBase + brokerAmount + isinTotal + transactionAmount;
    return { bufferedBase, brokerAmount, isinTotal, transactionAmount, totalCost };
  }, [baseAmount, numAssets, CASH_BUFFER_RATE, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, TRANSACTION_FEE_RATE]);

  const totalCostCents = Math.round(fees.totalCost * 100);
  const numAmount = baseAmount; // kept for compatibility with downstream usage
  const insufficient = totalCostCents > childBalance;
  const [feeExpanded, setFeeExpanded] = useState(false);

  useEffect(() => {
    fetchStrategies();
  }, []);

  async function fetchStrategies() {
    setLoading(true);
    setMinimumLoading(true);
    try {
      if (!supabase) return;
      const { data } = await supabase
        .from("strategies_c")
        .select("id, name, short_name, description, risk_level, sector, tags, min_investment, is_featured, holdings")
        .eq("status", "active")
        .eq("is_kid_strategy", true)
        .order("is_featured", { ascending: false })
        .order("name");

      const rows = data || [];

      // Collect all holding symbols — we need logo_url AND last_price so that
      // calculateMinInvestmentSync can compute the minimum from live prices,
      // matching the factsheet's behaviour exactly.
      const allSymbols = [...new Set(
        rows.flatMap(s => (Array.isArray(s.holdings) ? s.holdings : []).map(h => h.symbol || h.ticker).filter(Boolean))
      )];
      let secMap = {};
      if (allSymbols.length > 0) {
        const { data: secs } = await supabase
          .from("securities_c")
          .select("id, symbol, name, logo_url, last_price")
          .in("symbol", allSymbols);
        const enrichedSecs = await enrichSecuritiesWithIntradayPrices(secs || []);
        enrichedSecs.forEach(s => { secMap[s.symbol] = s; });
      }

      // Fetch latest YTD returns from strategies_returns_c, newest row per strategy.
      const strategyIds = rows.map(s => s.id).filter(Boolean);
      const ytdById = {};
      if (strategyIds.length > 0) {
        const { data: returns } = await supabase
          .from("strategy_returns_effective_c")
          .select("strategy_id, ytd_pct, as_of_date")
          .in("strategy_id", strategyIds)
          .order("as_of_date", { ascending: false });
        (returns || []).forEach((ret) => {
          if (!ytdById[ret.strategy_id]) {
            ytdById[ret.strategy_id] = {
              ytd: ret.ytd_pct != null ? Number(ret.ytd_pct) / 100 : null,
              as_of_date: ret.as_of_date,
            };
          }
        });
      }

      const enriched = rows.map(s => {
        const ytdData = ytdById[s.id];
        const r_ytd = ytdData?.ytd ?? null;
        const ytd_as_of_date = ytdData?.as_of_date ?? null;
        const holdingsList = (Array.isArray(s.holdings) ? s.holdings : [])
          .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
          .map(h => {
            const symbol = h.symbol || h.ticker;
            const security = secMap[symbol] || {};
            return {
              ...h,
              symbol,
              name: security.name || h.name || symbol,
              logo_url: security.logo_url || null,
              last_price: security.last_price ?? null,
            };
          });
        return { ...s, r_ytd, ytd_return: r_ytd, ytd_as_of_date, holdingsList, _secMap: secMap };
      });

      setStrategies(enriched);

      // Calculate minimums using live prices — same as factsheet
      calculateAllStrategiesMinimums(enriched, secMap);
    } catch (e) { console.error("[child-invest] strategies", e); }
    finally { setLoading(false); }
  }

  function calculateAllStrategiesMinimums(strategies, secMap = {}) {
    try {
      const minimums = {};
      // Build a holdingsBySymbol map with last_price so calculateMinInvestmentSync
      // can compute from live prices — matching the factsheet exactly.
      const holdingsMap = buildHoldingsBySymbol(
        Object.values(secMap).filter(s => s.last_price != null)
      );
      for (const strategy of strategies) {
        minimums[strategy.id] = calculateMinInvestmentSync(strategy, holdingsMap);
      }
      setStrategyMinimums(minimums);
    } catch (error) {
      console.error("Error calculating strategy minimums:", error);
    } finally {
      setMinimumLoading(false);
    }
  }

  async function handleInvest() {
    if (!selected) return;
    if (baseAmountCents <= 0) { setError("Select a valid investment amount."); return; }
    if (insufficient) { setError("Insufficient funds in child's wallet."); return; }

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/child-invest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          family_member_id: child.id,
          strategy_id: selected.id,
          amount: totalCostCents,         // includes 8% buffer + broker + custody + transaction fees
          base_amount: baseAmountCents,   // user-selected base for record keeping
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Investment failed."); return; }
      setSuccess(true);
      onInvest(json);
    } catch {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  const filtered = strategies.filter(s =>
    s.name?.toLowerCase().includes(search.toLowerCase())
  );

  // Calculate minimum investment for selected strategy
  useEffect(() => {
    if (!selected || !supabase) {
      setSelectedStrategyMinimum(null);
      return;
    }

    // Build a live-price map from the holdings already enriched in fetchStrategies
    // and compute via calculateMinInvestmentSync — same path as the factsheet.
    const secMap = selected?._secMap || {};
    const holdingsMap = buildHoldingsBySymbol(
      Object.values(secMap).filter(s => s.last_price != null)
    );
    setSelectedStrategyMinimum(calculateMinInvestmentSync(selected, holdingsMap));
  }, [selected]);

  useEffect(() => {
    if (!selected || step !== "preview") {
      setSelectedStrategyAnalytics(null);
      setSelectedStrategyAnalyticsLoading(false);
      setSelectedStrategyActiveLabel(null);
      return;
    }

    let isMounted = true;
    const fetchAnalytics = async () => {
      if (!supabase) {
        if (isMounted) setSelectedStrategyAnalytics(null);
        return;
      }

      setSelectedStrategyAnalyticsLoading(true);

      try {
        const strategyId = selected.id || selected.strategy_id;
        if (!strategyId) {
          setSelectedStrategyAnalytics(null);
          return;
        }

        const currentYear = new Date().getFullYear();
        const yearStart = `${currentYear}-01-01`;
        const { data: dailyReturns, error } = await supabase
          .from("strategy_returns_effective_c")
          .select("strategy_id, as_of_date, \"1d_pct\"")
          .eq("strategy_id", strategyId)
          .gte("as_of_date", yearStart)
          .order("as_of_date", { ascending: true });

        if (error) throw error;

        if (!dailyReturns || dailyReturns.length === 0) {
          if (isMounted) setSelectedStrategyAnalytics(null);
          return;
        }

        const cumulativeData = [];
        let cumulative = 0;
        dailyReturns.forEach((day) => {
          const dailyReturn = day["1d_pct"] ? day["1d_pct"] / 100 : 0;
          cumulative += dailyReturn;
          cumulativeData.push({
            d: day.as_of_date,
            v: Number((cumulative * 100).toFixed(2)),
          });
        });

        if (isMounted) {
          setSelectedStrategyAnalytics({
            strategy_id: strategyId,
            as_of_date: dailyReturns[dailyReturns.length - 1].as_of_date,
            curves: { YTD: cumulativeData },
          });
        }
      } catch (e) {
        console.error("[child-invest] strategy analytics", e);
        if (isMounted) setSelectedStrategyAnalytics(null);
      } finally {
        if (isMounted) setSelectedStrategyAnalyticsLoading(false);
      }
    };

    fetchAnalytics();
    return () => {
      isMounted = false;
    };
  }, [selected, step]);

  const { previewChartData, previewChartDomain, previewBaseIndexValue } = useMemo(() => {
    const previewFallbackLength = 140;
    const curves = selectedStrategyAnalytics?.curves || {};
    const fallbackSeries = Array.from({ length: previewFallbackLength }, (_, index) => {
      const wave = Math.sin(index / 18) * 1.1 + Math.cos(index / 9) * 0.4;
      const drift = (index / previewFallbackLength) * 1.6;
      const noise = ((index % 7) - 3) * 0.03;
      return {
        d: new Date(Date.now() - (previewFallbackLength - index) * 86400000).toISOString(),
        v: Number((100 + wave + drift + noise).toFixed(2)),
      };
    });

    let series = Array.isArray(curves.YTD) && curves.YTD.length > 0 ? curves.YTD : fallbackSeries;
    if (series.length > 1) {
      const firstVal = series[0]?.v ?? 0;
      const lastVal = series[series.length - 1]?.v ?? 0;
      const firstDate = series[0]?.d ? new Date(series[0].d) : null;
      const lastDate = series[series.length - 1]?.d ? new Date(series[series.length - 1].d) : null;
      if (firstDate && lastDate && firstDate > lastDate) {
        series = [...series].reverse();
      } else if (firstVal > lastVal * 1.05) {
        series = [...series].reverse();
      }
    }

    const labelIndices = series.length ? [0, Math.floor(series.length / 2), series.length - 1] : [];
    const values = series.map((point) => point?.v ?? 0);
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;
    const padding = (maxValue - minValue) * 0.2;
    const domain = values.length ? [minValue - padding, maxValue + padding] : [0, 0];
    const mapped = series.map((point, index) => {
      const date = point?.d ? new Date(point.d) : null;
      const dateLabel = labelIndices.includes(index) && date
        ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "";
      return {
        label: index + 1,
        dateLabel,
        returnPct: point?.v ?? 0,
      };
    });

    return {
      previewChartData: mapped,
      previewChartDomain: domain,
      previewBaseIndexValue: values.length ? values[0] : null,
    };
  }, [selectedStrategyAnalytics]);

  const getYtdPct = (strategy) => {
    if (strategy?.r_ytd == null) return null;
    const value = Number(strategy.r_ytd);
    if (!Number.isFinite(value)) return null;
    return Math.abs(value) > 1 ? value : value * 100;
  };

  const selectedYtdPct = getYtdPct(selected);
  const previewChartLineColor = (selectedYtdPct ?? 0) > 0
    ? "#16a34a"
    : (selectedYtdPct ?? 0) < 0
      ? "#dc2626"
      : "#94a3b8";

  const getPreviewTags = (strategy) => {
    const tags = Array.isArray(strategy?.tags)
      ? strategy.tags
      : typeof strategy?.tags === "string"
        ? strategy.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
        : [];
    return tags.length ? tags : [strategy?.risk_level || "Balanced", strategy?.sector].filter(Boolean);
  };

  const goBackOneStep = () => {
    setError("");
    if (step === "amount") {
      setStep("preview");
      return;
    }
    if (step === "preview") {
      setSelected(null);
      setStep("browse");
      setUnits(1);
    }
  };

  const closePreview = () => {
    setSelected(null);
    setStep("browse");
    setUnits(1);
    setError("");
  };

  const openFactsheet = () => {
    if (!selected || !onOpenFactsheet) return;
    onClose();
    onOpenFactsheet({
      ...selected,
      calculatedMinInvestment: selectedStrategyMinimum,
      holdingsWithLogos: (selected.holdingsList || []).map((h) => ({
        ...h,
        ticker: h.ticker || h.symbol,
        logo_url: h.logo_url || null,
      })),
    });
  };

  const inputCls =
    "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition";

  if (selected && step === "preview") {
    return (
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 overscroll-contain"
        style={{ paddingBottom: "calc(var(--navbar-height, 64px) + 8px)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <button
          type="button"
          className="absolute inset-0 h-full w-full cursor-default"
          aria-label="Close preview"
          onClick={closePreview}
        />
        <motion.div
          className="relative z-10 flex w-full max-w-sm flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl"
          style={{ maxHeight: "calc(90vh - var(--navbar-height, 64px) - 16px)" }}
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ type: "spring", stiffness: 380, damping: 38 }}
        >
          <button
            type="button"
            onClick={closePreview}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 z-10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <div className="flex items-start gap-3 mb-6">
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-slate-900">{selected.name}</h2>
                <p className="text-sm text-slate-500">
                  {selectedStrategyMinimum ? `Min. R${(selectedStrategyMinimum * (1 + CASH_BUFFER_RATE)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Calculating..."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-6">
              {selectedStrategyMinimum ? (
                <>
                  <p className="text-2xl font-semibold text-slate-900">R{(selectedStrategyMinimum * (1 + CASH_BUFFER_RATE)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-500">
                    Min. investment
                  </span>
                </>
              ) : null}
            </div>

            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
                <span>YTD return</span>
                <div className="flex flex-col items-end gap-1">
                  <span className={selectedYtdPct > 0 ? "text-emerald-600" : selectedYtdPct < 0 ? "text-rose-600" : "text-slate-500"}>
                    {selectedYtdPct != null ? `${selectedYtdPct >= 0 ? "+" : ""}${selectedYtdPct.toFixed(2)}%` : "-"}
                  </span>
                  {selected.ytd_as_of_date && (
                    <span className="text-[10px] text-slate-400">
                      {new Date(selected.ytd_as_of_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
              </div>
              <div className="h-44 w-full">
                {selectedStrategyAnalyticsLoading ? (
                  <div className="flex h-full items-end gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
                    {[45, 65, 35, 80, 55, 70, 40, 90, 60, 50, 75, 85].map((h, i) => (
                      <div key={i} className="flex-1 rounded-sm bg-slate-200 animate-pulse" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={previewChartData}
                      margin={{ top: 12, right: 16, left: 8, bottom: 28 }}
                      onMouseMove={(state) => {
                        if (state?.activeLabel) setSelectedStrategyActiveLabel(state.activeLabel);
                      }}
                      onMouseLeave={() => setSelectedStrategyActiveLabel(null)}
                    >
                      <defs>
                        <linearGradient id={previewGradientId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={previewChartLineColor} stopOpacity={0.25} />
                          <stop offset="70%" stopColor={previewChartLineColor} stopOpacity={0.1} />
                          <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <ReferenceLine y={100} stroke="#e2e8f0" strokeDasharray="3 3" />
                      {selectedStrategyActiveLabel ? (
                        <>
                          <ReferenceLine
                            x={selectedStrategyActiveLabel}
                            stroke="#CBD5E1"
                            strokeOpacity={0.6}
                            strokeDasharray="3 3"
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "#ffffff",
                              border: "none",
                              borderRadius: "20px",
                              padding: "3px 8px",
                              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                            }}
                            labelStyle={{ display: "none" }}
                            formatter={(value) => {
                              if (!previewBaseIndexValue) return [`${Number(value).toFixed(2)}`, "Index"];
                              const delta = ((Number(value) - previewBaseIndexValue) / previewBaseIndexValue) * 100;
                              return [`${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`, "Change"];
                            }}
                            cursor={{ strokeDasharray: "3 3" }}
                          />
                        </>
                      ) : null}
                      <XAxis
                        dataKey="dateLabel"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={{ stroke: "#e2e8f0" }}
                        tickLine={false}
                        height={24}
                      />
                      <YAxis hide domain={previewChartDomain} />
                      <Area
                        type="monotone"
                        dataKey="returnPct"
                        stroke="transparent"
                        fill={`url(#${previewGradientId})`}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="returnPct"
                        stroke={previewChartLineColor}
                        strokeWidth={2}
                        dot={false}
                        activeDot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              {getPreviewTags(selected).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                >
                  {tag}
                </span>
              ))}
            </div>

            {selected.holdingsList?.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Top Holdings</p>
                <div className="mt-3 space-y-2">
                  {selected.holdingsList.slice(0, 5).map((holding) => (
                    <div key={holding.symbol} className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-white">
                        {holding.logo_url ? (
                          <img src={holding.logo_url} alt={holding.symbol} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-slate-100 text-xs font-bold text-slate-600">
                            {holding.symbol?.substring(0, 2)}
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900">{holding.name || holding.symbol}</p>
                        <p className="text-xs text-slate-500">{holding.symbol}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 space-y-3">
              <button
                onClick={() => setStep("amount")}
                disabled={!selectedStrategyMinimum || isAdminPreview()}
                className={`w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-4 font-semibold text-white shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
              >
                Invest Now
              </button>
              <button
                onClick={openFactsheet}
                className="w-full rounded-2xl border border-slate-300 bg-white py-3 font-semibold text-slate-700 shadow-sm transition-all active:scale-95"
              >
                View Factsheet
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto"
        initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >

        <div className="px-6 pt-3 pb-8 overflow-y-auto" style={{ maxHeight: "calc(85vh - 24px)" }}>
          {!success ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {selected && (
                    <button
                      onClick={goBackOneStep}
                      className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition active:scale-95 mr-1"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#a78bfa,#7c3aed)" }}>
                    <BarChart3 className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-slate-900">
                      {step === "amount" ? "Invest Amount" : step === "preview" ? "Strategy Preview" : `Invest for ${childFirstName}`}
                    </p>
                    <p className="text-xs text-slate-400">
                      {selected ? selected.name : "Choose a strategy to invest in"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition active:scale-95"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Available balance pill */}
              <div className="flex items-center gap-2 rounded-xl bg-purple-50 border border-purple-100 px-4 py-2.5 mb-4">
                <Wallet className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-xs font-semibold text-purple-600">{`${childFirstName}'s balance:`}</span>
                <span className="text-xs font-bold text-purple-800 ml-auto tabular-nums">{fmt(childBalance)}</span>
              </div>

              {/* Strategy list */}
              {step === "browse" && (
                <>
                  {/* Search */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      id="child-strategy-search"
                      name="child-strategy-search"
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search strategies..."
                      className={inputCls + " pl-10"}
                    />
                  </div>

                  {loading ? (
                    <div className="space-y-3">
                      {[0, 1].map(i => (
                        <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 space-y-3 animate-pulse">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-2 flex-1">
                              <div className="h-4 w-32 bg-slate-100 rounded" />
                              <div className="h-3 w-48 bg-slate-100 rounded" />
                              <div className="h-3 w-24 bg-slate-100 rounded" />
                            </div>
                            <div className="h-12 w-24 bg-slate-100 rounded-xl" />
                          </div>
                          <div className="flex gap-2">
                            <div className="h-6 w-16 bg-slate-100 rounded-full" />
                            <div className="h-6 w-20 bg-slate-100 rounded-full" />
                          </div>
                          <div className="h-9 bg-slate-50 rounded-xl" />
                        </div>
                      ))}
                    </div>
                  ) : filtered.length === 0 ? (
                    <p className="text-center text-sm text-slate-400 py-8">No strategies found.</p>
                  ) : (
                    <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-0.5">
                      {filtered.map((s) => {
                        const ytdPct = getYtdPct(s);
                        const isUp = (ytdPct ?? 0) >= 0;
                        return (
                          <button
                            key={s.id}
                            onClick={() => { setSelected(s); setStep("preview"); setUnits(1); setError(""); }}
                            className="w-full rounded-2xl border border-slate-100 bg-white shadow-sm p-4 text-left hover:shadow-md hover:border-violet-200 transition active:scale-[0.98]"
                          >
                            {/* Header row */}
                            <div className="flex items-start gap-3 mb-3">
                              <div className="flex-1 min-w-0 space-y-0.5">
                                <p className="text-sm font-semibold text-slate-900 truncate">{s.short_name || s.name}</p>
                                <p className="text-xs text-slate-500 line-clamp-1">
                                  {s.risk_level || "Balanced"}{s.description ? ` - ${s.description.substring(0, 60)}${s.description.length > 60 ? "..." : ""}` : ""}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  {minimumLoading ? "Calculating..." : (strategyMinimums[s.id] ? `Min. R${(strategyMinimums[s.id] * (1 + CASH_BUFFER_RATE)).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—")}
                                </p>
                              </div>
                              {/* Sparkline */}
                              <div className="flex-shrink-0 rounded-xl bg-slate-50 px-2 py-1.5">
                                <svg width="64" height="32" viewBox="0 0 64 32">
                                  <defs>
                                    <linearGradient id={`sg-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor={isUp ? "#7c3aed" : "#e11d48"} stopOpacity="0.15" />
                                      <stop offset="100%" stopColor={isUp ? "#7c3aed" : "#e11d48"} stopOpacity="0" />
                                    </linearGradient>
                                  </defs>
                                  <polyline
                                    points="0,28 10,22 20,24 30,14 40,10 50,16 64,6"
                                    fill="none"
                                    stroke={isUp ? "#7c3aed" : "#e11d48"}
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <circle cx="64" cy="6" r="2.5" fill={isUp ? "#7c3aed" : "#e11d48"} />
                                </svg>
                              </div>
                            </div>
                            {/* Badges */}
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {s.risk_level && (
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600">{s.risk_level}</span>
                              )}
                              {s.sector && (
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600">{s.sector}</span>
                              )}
                              {s.is_featured && (
                                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-600">Featured</span>
                              )}
                            </div>
                            {/* YTD return */}
                            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 mb-3">
                              <span className="text-xs font-semibold text-slate-600">YTD return</span>
                              <div className="flex items-center gap-2">
                                {ytdPct != null ? (
                                  <span className={`text-xs font-semibold ${isUp ? "text-emerald-600" : "text-red-500"}`}>
                                    {isUp ? "+" : ""}{ytdPct.toFixed(2)}%
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">-</span>
                                )}
                                {s.ytd_as_of_date && (
                                  <span className="text-[10px] text-slate-400">
                                    {new Date(s.ytd_as_of_date).toLocaleDateString("en-ZA", { month: "short", day: "numeric" })}
                                  </span>
                                )}
                              </div>
                            </div>
                            {/* Holdings snapshot */}
                            {s.holdingsList?.length > 0 && (
                              <div className="flex items-center gap-2">
                                <div className="flex -space-x-2">
                                  {s.holdingsList.slice(0, 3).map((h) => (
                                    <div key={h.symbol} className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm">
                                      {h.logo_url ? (
                                        <img src={h.logo_url} alt={h.symbol} className="h-full w-full object-cover" />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">
                                          {h.symbol?.substring(0, 2)}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {s.holdingsList.length > 3 && (
                                    <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[10px] font-semibold text-slate-500">
                                      +{s.holdingsList.length - 3}
                                    </div>
                                  )}
                                </div>
                                <span className="text-xs font-semibold text-slate-500">Holdings snapshot</span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Amount selection step */}
              {step === "amount" && selected && (
                <>
                  {/* Strategy info card */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#ede9fe,#ddd6fe)" }}>
                        <BarChart3 className="h-5 w-5 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900">{selected.short_name || selected.name}</p>
                        <p className="text-xs text-slate-500 mt-1">{selected.description?.substring(0, 60)}</p>
                      </div>
                    </div>
                    <div className="pt-3 border-t border-slate-100">
                      <p className="text-xs text-slate-500 mb-1">Minimum investment</p>
                      <p className="text-sm font-semibold text-slate-900">
                        {selectedStrategyMinimum ? `R${selectedStrategyMinimum.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Calculating..."}
                      </p>
                    </div>
                  </div>

                  {/* Amount selector */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Investment Amount</p>
                    <div className="flex items-center justify-center gap-4">
                      <button
                        onClick={() => setUnits(Math.max(1, units - 1))}
                        disabled={units <= 1 || !selectedStrategyMinimum}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition text-xl font-semibold leading-none"
                        aria-label="Decrease units"
                      >
                        −
                      </button>
                      <div className="flex-1 text-center">
                        <p className="text-3xl font-bold text-slate-900 tabular-nums">
                          R{selectedStrategyMinimum && numAmount > 0 ? numAmount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">{units} unit{units !== 1 ? "s" : ""}</p>
                      </div>
                      <button
                        onClick={() => setUnits(units + 1)}
                        disabled={!selectedStrategyMinimum || insufficient}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Total cost */}
                  <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-700">Total Due Today</p>
                    <p className="text-sm font-bold text-slate-900">
                      R{fees.totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>

                  {insufficient && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-4">
                      <p className="text-xs font-semibold text-red-700">
                        Insufficient funds. {childFirstName} needs R{(fees.totalCost - childBalance / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} more.
                      </p>
                    </div>
                  )}

                  {/* Terms checkbox */}
                  <div className="flex items-start gap-3 mb-4">
                    <input
                      type="checkbox"
                      id="terms"
                      className="mt-1 h-5 w-5 rounded border-slate-300"
                    />
                    <label htmlFor="terms" className="text-xs text-slate-600">
                      <span className="font-semibold">I agree to Risk Disclosure, Fee Schedule & Strategy Mandate</span>
                      <p className="mt-1">By continuing, you confirm you have reviewed and agree to all terms and conditions</p>
                    </label>
                  </div>

                  {error && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-4">
                      <p className="text-xs font-semibold text-red-700">{error}</p>
                    </div>
                  )}

                  {/* Continue button */}
                  <button
                    onClick={handleInvest}
                    disabled={insufficient || baseAmountCents <= 0 || saving || !selectedStrategyMinimum}
                    className="w-full rounded-2xl bg-purple-600 py-3.5 font-semibold text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {saving ? "Processing..." : "Continue"}
                  </button>
                </>
              )}

            </>
          ) : (
            <motion.div
              className="text-center py-4"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <div className="h-16 w-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#e9d5ff,#d8b4fe)" }}>
                <Check className="h-8 w-8 text-purple-600" />
              </div>
              <p className="text-lg font-bold text-slate-900">Investment Placed!</p>
              <p className="text-sm text-slate-500 mt-2">
                {`R${numAmount.toFixed(2)} invested in ${selected?.name} for ${childFirstName}.`}
              </p>
              <button
                onClick={onClose}
                className="mt-6 w-full rounded-xl py-3.5 text-sm font-bold text-white active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
              >
                Done
              </button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}




// --- TransactionRow ----------------------------------------------------------

function TransactionRow({ tx }) {
  const isCredit = tx.direction === "credit";
  const date = tx.created_at ? new Date(tx.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "";
  return (
    <div className="flex items-center gap-3.5 py-3.5">
      <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-purple-100">
        {isCredit
          ? <ArrowDownLeft className="h-4.5 w-4.5 text-purple-600" />
          : <ArrowUpRight className="h-4.5 w-4.5 text-purple-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{tx.description || tx.name || "Transaction"}</p>
        <p className="text-[11px] text-slate-600 mt-0.5">{date}</p>
      </div>
      <p className="text-sm font-bold tabular-nums text-purple-600">
        {isCredit ? "+" : "-"}{fmt(Math.round(Math.abs(tx.amount || 0)))}
      </p>
    </div>
  );
}

// --- AllTransactionsModal ----------------------------------------------------

function TxIcon({ isIn }) {
  return (
    <div
      className="h-[42px] w-[42px] rounded-2xl flex items-center justify-center flex-shrink-0"
      style={{
        background: isIn ? "rgba(34,197,94,0.10)" : "rgba(124,58,237,0.08)",
        color: isIn ? "#16a34a" : "#7c3aed",
      }}
    >
      {isIn
        ? <ArrowDownLeft className="h-[18px] w-[18px]" />
        : <ArrowUpRight className="h-[18px] w-[18px]" />}
    </div>
  );
}

function TxAmount({ amount, isIn }) {
  const rands = Math.abs(Number(amount || 0));
  const display = "R " + (rands > 10000 ? rands / 100 : rands).toLocaleString("en-ZA", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return (
    <p className="text-[13px] font-bold tabular-nums whitespace-nowrap flex-shrink-0"
      style={{ color: isIn ? "#16a34a" : "#181820" }}>
      {isIn ? "+" : "−"}{display}
    </p>
  );
}

function txDate(tx, long = false) {
  const d = new Date(tx.created_at || tx.transaction_date || 0);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-ZA", {
    day: "numeric", month: "short", ...(long ? { year: "numeric" } : {}),
  });
}

function txDateGroup(tx) {
  const d = new Date(tx.created_at || tx.transaction_date || 0);
  if (isNaN(d)) return "Earlier";
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const txDay = new Date(d); txDay.setHours(0,0,0,0);
  if (txDay.getTime() === today.getTime()) return "Today";
  if (txDay.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
}

function AllTransactionsModal({ transactions, childName, onClose }) {
  const [filter, setFilter] = useState("all");
  const [expandedGroup, setExpandedGroup] = useState(null);

  const filtered = useMemo(() => {
    if (filter === "in")  return transactions.filter(t => t.direction === "credit");
    if (filter === "out") return transactions.filter(t => t.direction !== "credit");
    return transactions;
  }, [transactions, filter]);

  // Group by name — same name = stack
  const groups = useMemo(() => {
    const map = new Map();
    for (const tx of filtered) {
      const key = (tx.name || tx.description || "Transaction").trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(tx);
    }
    const seen = new Set();
    const result = [];
    for (const tx of filtered) {
      const key = (tx.name || tx.description || "Transaction").trim();
      if (!seen.has(key)) {
        seen.add(key);
        const entries = [...map.get(key)].sort((a, b) =>
          new Date(b.created_at || b.transaction_date || 0) -
          new Date(a.created_at || a.transaction_date || 0)
        );
        result.push({ key, entries, dateGroup: txDateGroup(entries[0]) });
      }
    }
    return result;
  }, [filtered]);

  // Group by date label for section headers
  const sections = useMemo(() => {
    const order = [];
    const map = new Map();
    for (const g of groups) {
      if (!map.has(g.dateGroup)) { map.set(g.dateGroup, []); order.push(g.dateGroup); }
      map.get(g.dateGroup).push(g);
    }
    return order.map(label => ({ label, items: map.get(label) }));
  }, [groups]);

  const tabs = [
    { id: "all", label: "All" },
    { id: "in",  label: "Money In" },
    { id: "out", label: "Money Out" },
  ];

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 280 }}
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#f4f4f6" }}
    >
      {/* Header */}
      <div className="bg-white px-5 pt-12 pb-3 border-b border-slate-100"
        style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 flex items-center justify-center rounded-2xl bg-slate-100 text-slate-600 active:bg-slate-200 transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{childName}</p>
            <p className="text-[15px] font-bold text-slate-900 leading-tight">Activity</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className="rounded-full px-4 py-1.5 text-[12px] font-semibold transition"
              style={filter === t.id
                ? { background: "linear-gradient(135deg,#3b1d72,#7c3aed)", color: "#fff" }
                : { background: "#f1f0f5", color: "#6b7280" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {sections.length === 0 && (
          <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center mt-4">
            <p className="text-[13px] text-slate-400">No transactions here yet.</p>
          </div>
        )}
        {sections.map(({ label, items }) => (
          <div key={label} className="mb-5">
            {/* Date section header */}
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 px-1 mb-2">{label}</p>
            <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden"
              style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
              {items.map(({ key, entries }, gi) => {
                const isStack = entries.length > 1;
                const isExpanded = expandedGroup === key;
                const top = entries[0];
                const isIn = top.direction === "credit";

                if (isStack && !isExpanded) {
                  return (
                    <div key={key}>
                      {gi > 0 && <div className="h-px bg-slate-100 mx-4" />}
                      <button
                        type="button"
                        onClick={() => setExpandedGroup(key)}
                        className="w-full text-left px-4 py-3.5 active:bg-slate-50 transition relative"
                      >
                        {/* Stack shadow layers */}
                        <div className="absolute left-6 right-6 bottom-1 h-[6px] rounded-b-xl bg-slate-100" />
                        <div className="absolute left-4 right-4 bottom-0.5 h-[4px] rounded-b-xl bg-slate-200/60" />
                        <div className="relative flex items-center gap-3">
                          <TxIcon isIn={isIn} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-slate-900 truncate">
                              {top.description || top.name || "Transaction"}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-[11px] text-slate-400">{txDate(top)}</p>
                              <span className="text-[10px] font-bold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5">
                                {entries.length}×
                              </span>
                            </div>
                          </div>
                          <TxAmount amount={top.amount} isIn={isIn} />
                        </div>
                      </button>
                    </div>
                  );
                }

                if (isStack && isExpanded) {
                  return (
                    <div key={key}>
                      {gi > 0 && <div className="h-px bg-slate-100 mx-4" />}
                      {/* Collapse header */}
                      <button
                        type="button"
                        onClick={() => setExpandedGroup(null)}
                        className="w-full flex items-center gap-2 px-4 py-2.5 bg-violet-50 active:bg-violet-100 transition"
                      >
                        <ChevronUp className="h-3.5 w-3.5 text-violet-500" />
                        <p className="text-[11px] font-bold text-violet-600">
                          {top.description || top.name} · {entries.length} purchases
                        </p>
                      </button>
                      {entries.map((tx, ei) => {
                        const txIn = tx.direction === "credit";
                        return (
                          <div key={tx.id}>
                            <div className="h-px bg-slate-100 mx-4" />
                            <div className="flex items-center gap-3 px-4 py-3.5 bg-violet-50/30">
                              <TxIcon isIn={txIn} />
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold text-slate-900 truncate">
                                  {tx.description || tx.name || "Transaction"}
                                </p>
                                <p className="text-[11px] text-slate-400 mt-0.5">{txDate(tx, true)}</p>
                              </div>
                              <TxAmount amount={tx.amount} isIn={txIn} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                // Single row
                return (
                  <div key={key}>
                    {gi > 0 && <div className="h-px bg-slate-100 mx-4" />}
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <TxIcon isIn={isIn} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-slate-900 truncate">
                          {top.description || top.name || "Transaction"}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{txDate(top)}</p>
                      </div>
                      <TxAmount amount={top.amount} isIn={isIn} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="h-8" />
      </div>
    </motion.div>
  );
}

// --- StrategyDetailModal -----------------------------------------------------
// Shows "Best performing assets in {Strategy}" — the holdings inside a single
// strategy, ranked by unrealized PnL %.

function StrategyDetailModal({ data, onClose }) {
  const { strategy, holdings } = data;
  const totalValueCents = holdings.reduce((s, h) => s + (h.marketCents || 0), 0);
  const totalCostCents = holdings.reduce((s, h) => s + (h.costCents || 0), 0);
  const totalPnlCents = totalValueCents - totalCostCents;
  const totalPnlPct = totalCostCents > 0 ? (totalPnlCents / totalCostCents) * 100 : 0;
  const stratIsUp = totalPnlCents >= 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 280 }}
        className="relative w-full max-w-xl bg-white rounded-t-3xl shadow-2xl max-h-[85vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-4 border-b border-slate-100 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg,#ede9fe,#ddd6fe)" }}>
                <BarChart3 className="h-5 w-5 text-purple-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Best performing in</p>
                <p className="text-sm font-bold text-slate-900 truncate">{strategy.short_name || strategy.name || "Strategy"}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Strategy total */}
          <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Strategy value</p>
              <p className="text-base font-bold text-slate-900 tabular-nums">{fmt(totalValueCents)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Unrealized PnL</p>
              <p className={`text-sm font-bold tabular-nums ${stratIsUp ? "text-emerald-600" : "text-red-500"}`}>
                {stratIsUp ? "+" : ""}{fmt(totalPnlCents)} ({stratIsUp ? "+" : ""}{totalPnlPct.toFixed(2)}%)
              </p>
            </div>
          </div>
        </div>

        {/* Holdings list ranked by PnL % */}
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ paddingBottom: "calc(var(--navbar-height, 64px) + 1rem)" }}>
          {holdings.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-slate-500">No filled holdings yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {holdings.map((h, idx) => {
                const isUp = h.pnlR >= 0;
                return (
                  <div key={h.id} className="flex items-center gap-3 rounded-2xl bg-white border border-slate-100 shadow-sm p-3.5">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-700">
                      {idx + 1}
                    </div>
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
                      {h.logo_url ? (
                        <img src={h.logo_url} alt={h.name} className="h-9 w-9 object-contain" />
                      ) : (
                        <span className="text-[10px] font-bold text-slate-600">{h.symbol?.substring(0, 3)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{h.symbol}</p>
                      <p className="text-[10px] text-slate-500 truncate">{h.name}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-bold tabular-nums ${isUp ? "text-emerald-500" : "text-red-500"}`}>
                        {isUp ? "+" : ""}{fmt(Math.round(h.pnlR * 100))}
                      </p>
                      <p className={`text-[10px] font-semibold tabular-nums ${isUp ? "text-emerald-500" : "text-red-500"}`}>
                        ({isUp ? "+" : ""}{h.pnlP.toFixed(2)}%)
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- CompleteProfileModal ----------------------------------------------------


function CompleteProfileModal({ child, parentProfile, onUpdate, onClose }) {
  const poaComplete = !!child.poa_declaration_url;
  const agreementComplete = !!child.signed_agreement_url;
  const [step, setStep] = useState(() => {
    if (!child.id_number) return "id";
    if (!poaComplete) return "poa";
    if (!agreementComplete) return "agreement";
    // Nothing actually missing ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â fall back to agreement but caller should
    // never open the modal in this state (banner is gated on missingItems).
    return "agreement";
  });
  const [idInput, setIdInput] = useState("");
  const [idError, setIdError] = useState("");
  const [flowError, setFlowError] = useState("");
  const [saving, setSaving] = useState(false);

  const childName =
    [child.first_name, child.last_name].filter(Boolean).join(" ") || "your child";

  function verifyId(id) {
    const clean = String(id || "").replace(/\D/g, "");
    if (clean.length !== 13) return { ok: false, msg: "ID number must be exactly 13 digits." };
    if (child.date_of_birth) {
      const yy = clean.substring(0, 2);
      const mm = clean.substring(2, 4);
      const dd = clean.substring(4, 6);
      const y = parseInt(yy, 10);
      const fullYear = y <= new Date().getFullYear() % 100 ? `20${yy}` : `19${yy}`;
      const idDob = `${fullYear}-${mm}-${dd}`;
      if (idDob !== child.date_of_birth)
        return { ok: false, msg: "Date of birth in ID does not match the child's record." };
    }
    return { ok: true, clean };
  }

  async function handleIdSave() {
    const { ok, msg, clean } = verifyId(idInput);
    if (!ok) { setIdError(msg); return; }
    setSaving(true);
    setFlowError("");
    try {
      await fetch(`/api/family-members/${child.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_number: clean }),
      });
      onUpdate({ ...child, id_number: clean });
      if (!child.poa_declaration_url) { setStep("poa"); }
      else if (!child.signed_agreement_url) { setStep("agreement"); }
      else {
        // All steps already done - mark address_completed
        await fetch(`/api/family-members/${child.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address_completed: true }),
        });
        onUpdate({ ...child, id_number: clean, address_completed: true });
        onClose();
      }
    } catch { setIdError("Save failed. Please try again."); }
    finally { setSaving(false); }
  }

  async function handlePoaComplete({ livesWithParent, pdfBuffer, fileUpload, signedAt }) {
    setSaving(true);
    setFlowError("");
    try {
      let poaUrl = null;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token && pdfBuffer) {
        throw new Error("Session expired. Please sign in again.");
      }

      if (pdfBuffer) {
        // Use chunked fromCharCode to avoid freezing the JS thread on mobile
        const uint8 = new Uint8Array(pdfBuffer);
        const CHUNK = 0x8000;
        let bin = "";
        for (let i = 0; i < uint8.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
        }
        const pdfBase64 = btoa(bin);
        const res = await fetchWithTimeout("/api/onboarding/upload-agreement", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ pdfBase64, subjectId: child.id }),
        }, 45000, "Upload is taking too long. Please check your connection and retry.");
        const j = await res.json();
        if (!res.ok || !j.publicUrl) {
          throw new Error(j?.error || "Failed to upload proof of address.");
        }
        poaUrl = j.publicUrl;
      } else if (fileUpload && supabase) {
        const safeName = fileUpload.name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
        const path = `poa/${child.id}/${Date.now()}-${safeName}`;
        const { error: upErr } = await withTimeout(
          supabase.storage.from("birth-certificates").upload(path, fileUpload, { upsert: true }),
          45000,
          "Document upload is taking too long. Please check your connection and retry."
        );
        if (upErr) {
          throw new Error(upErr.message || "Failed to upload proof document.");
        }
        poaUrl = `storage://birth-certificates/${path}`;
      }
      if (poaUrl) {
        const patchRes = await fetchWithTimeout(`/api/family-members/${child.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            poa_declaration_url: poaUrl,
            address_completed: true,
          }),
        }, 30000, "Saving proof of address is taking too long. Please retry.");
        if (!patchRes.ok) {
          const patchJson = await patchRes.json().catch(() => ({}));
          throw new Error(patchJson?.error || "Failed to save proof of address.");
        }
        onUpdate({ ...child, poa_declaration_url: poaUrl, address_completed: true });
      }
      onClose();
    } catch (e) {
      console.error("[complete-poa]", e);
      const message = e?.message || "Proof of address upload failed. Please try again.";
      setFlowError(message);
      throw new Error(message);
    } finally { setSaving(false); }
  }

  async function handleAgreementComplete({ pdfBuffer, signedAt }) {
    setSaving(true);
    setFlowError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const uint8 = new Uint8Array(pdfBuffer);
      const CHUNK = 0x8000;
      let bin = "";
      for (let i = 0; i < uint8.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
      }
      const pdfBase64 = btoa(bin);
      const uploadRes = await fetchWithTimeout("/api/onboarding/upload-agreement", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pdfBase64, subjectId: child.id }),
      }, 45000, "Upload is taking too long. Please check your connection and retry.");
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok || !uploadJson.publicUrl) {
        throw new Error(uploadJson?.error || "Failed to upload signed agreement.");
      }

      const patchRes = await fetchWithTimeout(`/api/family-members/${child.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signed_agreement_url: uploadJson.publicUrl, signed_at: signedAt, address_completed: true }),
      }, 30000, "Saving signed agreement is taking too long. Please retry.");
      if (!patchRes.ok) {
        const patchJson = await patchRes.json().catch(() => ({}));
        throw new Error(patchJson?.error || "Failed to save signed agreement.");
      }

      onUpdate({ ...child, signed_agreement_url: uploadJson.publicUrl, address_completed: true });
      onClose();
    } catch (e) {
      console.error("[complete-agreement]", e);
      const message = e?.message || "Signing failed. Please try again.";
      setFlowError(message);
      throw new Error(message);
    } finally { setSaving(false); }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { if (!saving) onClose(); }} />
      <motion.div
        className="relative w-full max-w-md bg-white rounded-[32px] shadow-2xl max-h-[85vh] overflow-y-auto"
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg,#8b5cf6,#6366f1)" }} />
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        <div className="px-6 pt-2 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#a78bfa,#7c3aed)" }}>
                <ClipboardList className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">Complete Profile</p>
                <p className="text-xs text-slate-400">
                  {step === "id" ? "Step 1 - ID number" :
                   step === "poa" ? "Proof of address" :
                   "Responsibility agreement"}
                </p>
              </div>
            </div>
            <button onClick={onClose} disabled={saving} className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition disabled:opacity-50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {flowError && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 mb-4">{flowError}</p>
          )}

          {/* Step: ID number */}
          {step === "id" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Please provide <strong>{`${childName}'s`}</strong> SA ID number to complete their profile.
              </p>
              <input
                id="child-id-number"
                name="child-id-number"
                type="text"
                inputMode="numeric"
                maxLength={13}
                value={idInput}
                onChange={(e) => { setIdInput(e.target.value.replace(/\D/g, "")); setIdError(""); }}
                placeholder="13-digit ID number"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100 transition"
              />
              {idError && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">{idError}</p>
              )}
              <button
                onClick={handleIdSave}
                disabled={saving || idInput.length !== 13}
                className="w-full rounded-xl py-3.5 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
              >
                {saving ? "Saving..." : "Save & Continue"}
              </button>
            </div>
          )}

          {/* Step: POA */}
          {step === "poa" && (
            <MinorProofOfAddressDeclaration
              childData={child}
              parentProfile={parentProfile}
              saving={saving}
              onComplete={handlePoaComplete}
              onBack={() => {
                if (!child.id_number) setStep("id");
                else onClose();
              }}
            />
          )}

          {/* Step: Agreement */}
          {step === "agreement" && (
            <ChildResponsibilityAgreement
              parentProfile={parentProfile}
              childData={child}
              saving={saving}
              onBack={onClose}
              onComplete={handleAgreementComplete}
            />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Main Page ---------------------------------------------------------------

export default function ChildDashboardPage({ child: initialChild, onBack, onOpenFactsheet, onTabChange, onWithdraw, onOpenNotifications }) {
  const { profile } = useProfile();
  const isMounted = useRef(true);
  const [child, setChild] = useState(initialChild);

  // Sync when the parent switches to a different child (e.g. via FamilyDropdown)
  useEffect(() => {
    if (initialChild?.id && initialChild.id !== child?.id) {
      setChild(initialChild);
      setHoldings([]);
      setTransactions([]);
      setChildWishlists([]);
      setChildWishlistsLoading(false);
      setLoading(true);
      setActiveChildTab("home");
      setStrategyDetailId(null);
      setExpandedStrategyStack(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChild?.id]);
  const [holdings, setHoldings] = useState([]);
  const [childLivePriceMap, setChildLivePriceMap] = useState({});
  const [strategyMap, setStrategyMap] = useState({});
  const [transactions, setTransactions] = useState([]);
  const [parentBalance, setParentBalance] = useState(null);
  const [parentBalanceLoading, setParentBalanceLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showTransfer, setShowTransfer] = useState(false);
  const [openingTransfer, setOpeningTransfer] = useState(false);
  const [showInvest, setShowInvest] = useState(false);
  const [strategyDetailId, setStrategyDetailId] = useState(null);
  const [expandedStrategyStack, setExpandedStrategyStack] = useState(null);
  const [strategySparklines, setStrategySparklines] = useState({});
  const [strategyYearStartBasket, setStrategyYearStartBasket] = useState({});
  const [purpleCardYtdMetrics, setPurpleCardYtdMetrics] = useState(null);
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showGoalsModal, setShowGoalsModal] = useState(false);
  const [goals, setGoals] = useState([]);
  const [loadingGoals, setLoadingGoals] = useState(false);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [newGoal, setNewGoal] = useState({ name: "", target_amount: "", target_date: "" });
  const [childFriendlyStrategies, setChildFriendlyStrategies] = useState([]);
  const [childFriendlyMinimums, setChildFriendlyMinimums] = useState({});
  const [childFriendlyLoading, setChildFriendlyLoading] = useState(true);
  const [kycNotice, setKycNotice] = useState("");
  const [activeChildTab, setActiveChildTab] = useState("home");
  const [childNewsArticleId, setChildNewsArticleId] = useState(null);

  // Wishlist state
  const [showChildWishlistCreate, setShowChildWishlistCreate] = useState(false);
  const [showWishlistOptions, setShowWishlistOptions] = useState(false);
  const [childWishlists, setChildWishlists] = useState([]);
  const [childWishlistsLoading, setChildWishlistsLoading] = useState(false);

  useEffect(() => {
    if (childNewsArticleId) {
      document.body.classList.add("child-article-open");
    } else {
      document.body.classList.remove("child-article-open");
    }
    return () => document.body.classList.remove("child-article-open");
  }, [childNewsArticleId]);

  useEffect(() => {
    document.body.style.overflow = strategyDetailId ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [strategyDetailId]);

  const childName = [child?.first_name, child?.last_name].filter(Boolean).join(" ") || "Child";
  const age = getAge(child?.date_of_birth);
  const parentName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "Parent";
  const parentMintNumber = profile?.mintNumber || "";
  const childBalance = child?.available_balance || 0;
  const childKyc = getChildKycState(child);

  const poaDone = !!child?.poa_declaration_url;
  const missingItems = [
    !child?.id_number && "ID number",
    !poaDone && "proof of address",
    !child?.signed_agreement_url && "responsibility agreement",
  ].filter(Boolean);
  // Derive from the actual fields rather than the address_completed flag ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â
  // onboarding flows don't always set that flag, so we'd otherwise show the
  // "Complete profile" prompt even when every doc is signed.
  const isProfileIncomplete = missingItems.length > 0;

  useEffect(() => {
    isMounted.current = true;
    fetchAll();
    return () => { isMounted.current = false; };
  }, [child?.id]);

  useEffect(() => {
    if (showGoalsModal && child?.id) {
      fetchGoals();
    }
  }, [showGoalsModal, child?.id]);

  useEffect(() => {
    fetchChildFriendlyStrategies();
  }, []);

  // Fetch wishlists created for this child
  useEffect(() => {
    if (!child?.id) return;
    setChildWishlistsLoading(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const res = await fetch("/api/gift-registry/my-registries", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        const all = json.registries || [];
        const childFirstNameLower = (child.first_name || '').toLowerCase().trim();
        setChildWishlists(all.filter(r =>
          r.beneficiary_ref === child.id ||
          // Fallback for legacy records created before beneficiary_ref was stored:
          // match by display name when beneficiary_ref was never set
          (r.beneficiary_ref === null &&
            r.beneficiary_type === 'CHILD' &&
            childFirstNameLower &&
            (r.beneficiary_display_name || '').toLowerCase().trim().startsWith(childFirstNameLower))
        ));
      } catch (e) {
        console.error("[ChildDashboard] Failed to fetch child wishlists:", e.message);
      } finally {
        setChildWishlistsLoading(false);
      }
    })();
  }, [child?.id, showChildWishlistCreate]);

  async function fetchChildFriendlyStrategies() {
    if (!supabase) return;
    setChildFriendlyLoading(true);
    try {
      const { data } = await supabase
        .from("strategies_c")
        .select("id, name, short_name, description, risk_level, sector, tags, min_investment, is_featured, holdings")
        .eq("status", "active")
        .eq("is_kid_strategy", true)
        .order("is_featured", { ascending: false })
        .order("name");

      const rows = data || [];
      // Fetch latest YTD returns from strategies_returns_c, newest row per strategy.
      const strategyIds = rows.map(s => s.id).filter(Boolean);
      const ytdById = {};
      if (strategyIds.length > 0) {
        const { data: returns } = await supabase
          .from("strategy_returns_effective_c")
          .select("strategy_id, ytd_pct, as_of_date")
          .in("strategy_id", strategyIds)
          .order("as_of_date", { ascending: false });
        (returns || []).forEach((ret) => {
          if (!ytdById[ret.strategy_id]) {
            ytdById[ret.strategy_id] = {
              ytd: ret.ytd_pct != null ? Number(ret.ytd_pct) / 100 : null,
              as_of_date: ret.as_of_date,
            };
          }
        });
      }

      // Fetch logos AND intraday price so calculateMinInvestmentSync uses live prices
      const allSymbols = [...new Set(
        rows.flatMap(s => (Array.isArray(s.holdings) ? s.holdings : []).map(h => h.symbol || h.ticker).filter(Boolean))
      )];
      let secMap = {};
      if (allSymbols.length > 0) {
        const { data: secs } = await supabase
          .from("securities_c")
          .select("id, symbol, name, logo_url, last_price")
          .in("symbol", allSymbols);
        const enrichedSecs = await enrichSecuritiesWithIntradayPrices(secs || []);
        enrichedSecs.forEach(s => { secMap[s.symbol] = s; });
      }

      const enriched = rows.map(s => {
        const ytdData = ytdById[s.id];
        const r_ytd = ytdData?.ytd ?? null;
        const ytd_as_of_date = ytdData?.as_of_date ?? null;
        const holdingsList = (Array.isArray(s.holdings) ? s.holdings : [])
          .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0))
          .map(h => {
            const symbol = h.symbol || h.ticker;
            const security = secMap[symbol] || {};
            return {
              ...h,
              symbol,
              name: security.name || h.name || symbol,
              logo_url: security.logo_url || null,
              last_price: security.last_price ?? null,
            };
          });
        return { ...s, r_ytd, ytd_as_of_date, holdingsList };
      });

      if (isMounted.current) {
        setChildFriendlyStrategies(enriched);
      }

      // Calculate minimums using live prices — matches factsheet behaviour
      if (enriched.length > 0) {
        calculateAllChildFriendlyMinimums(enriched, secMap);
      }
    } catch (e) {
      console.error("[child-dash] fetchChildFriendlyStrategies error", e);
    } finally {
      if (isMounted.current) {
        setChildFriendlyLoading(false);
      }
    }
  }

  async function calculateAllChildFriendlyMinimums(strategies, secMap = {}) {
    if (!supabase) return;
    try {
      const minimums = {};
      const holdingsMap = buildHoldingsBySymbol(
        Object.values(secMap).filter(s => s.last_price != null)
      );
      for (const strategy of strategies) {
        minimums[strategy.id] = calculateMinInvestmentSync(strategy, holdingsMap);
      }

      if (isMounted.current) {
        setChildFriendlyMinimums(minimums);
      }
    } catch (error) {
      console.error("Error calculating child-friendly minimums:", error);
    }
  }

  async function fetchAll() {
    setLoading(true);
    try {
      await withTimeout(
        Promise.allSettled([
          fetchHoldings(),
          fetchParentWallet(),
          fetchTransactions(),
          fetchChildBalance(),
          fetchChildProfile(),
        ]),
        12000,
        "Child dashboard load timed out"
      );
    } catch (e) {
      console.error("[child-dash] fetchAll error", e);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }

  async function fetchChildBalance() {
    try {
      const res = await fetchWithTimeout(
        `/api/child-wallet?family_member_id=${child.id}`,
        {},
        8000,
        "Child wallet balance timed out"
      );
      const json = await res.json();
      if (json.balance !== undefined && isMounted.current) {
        setChild(prev => ({ ...prev, available_balance: json.balance }));
      }
    } catch (e) { console.error("[child-dash] balance", e); }
  }

  async function fetchChildProfile() {
    try {
      if (!supabase || !child?.id) return;
      const { data, error } = await supabase
        .from("family_members")
        .select("id, available_balance, certificate_verification_status, kyc_status, kyc_pending, certificate_url, updated_at, id_number, poa_declaration_url, signed_agreement_url, signed_at, address_completed")
        .eq("id", child.id)
        .maybeSingle();
      if (error) throw error;
      if (data && isMounted.current) {
        const nextChild = { ...child, ...data };
        setChild(prev => ({ ...prev, ...data }));
        return nextChild;
      }
    } catch (e) {
      console.error("[child-dash] child profile", e);
    }
    return child;
  }

  async function fetchHoldings() {
    try {
      if (!supabase) return;
      const linkedUserId = child?.linked_user_id || null;
      const holdingsSelect = "id, user_id, family_member_id, security_id, quantity, avg_fill, Expected_fill, market_value, unrealized_pnl, strategy_id, Fill_date, Status, created_at, transaction_id, rebalance_batch_id";
      const familyHoldingsQuery = supabase
        .from("stock_holdings_c")
        .select(holdingsSelect)
        .eq("family_member_id", child.id)
        .eq("Status", "active")
        .order("market_value", { ascending: false });
      const linkedHoldingsQuery = linkedUserId
        ? supabase
            .from("stock_holdings_c")
            .select(holdingsSelect)
            .eq("user_id", linkedUserId)
            .eq("Status", "active")
            .order("market_value", { ascending: false })
        : Promise.resolve({ data: [], error: null });

      const [familyHoldingsRes, linkedHoldingsRes] = await Promise.all([
        familyHoldingsQuery,
        linkedHoldingsQuery,
      ]);

      if (familyHoldingsRes.error) { console.error("[child-dash] family holdings query error", familyHoldingsRes.error); return; }
      if (linkedHoldingsRes.error) { console.error("[child-dash] linked holdings query error", linkedHoldingsRes.error); return; }

      const rowsById = new Map();
      [...(familyHoldingsRes.data || []), ...(linkedHoldingsRes.data || [])].forEach((row) => {
        if (row?.id) rowsById.set(row.id, row);
      });
      const baseRows = Array.from(rowsById.values())
        .sort((a, b) => Number(b.market_value || 0) - Number(a.market_value || 0));

      // Enrich with security info (symbol/name/logo_url live on securities_c)
      const securityIds = [...new Set(baseRows.map(h => h.security_id).filter(Boolean))];
      let secMap = {};
      let intradayPriceMap = {};
      if (securityIds.length > 0) {
        const [secsRes, intradayRes] = await Promise.all([
          supabase
            .from("securities_c")
            .select("id, symbol, name, logo_url, last_price")
            .in("id", securityIds),
          supabase
            .from("stock_intraday_c")
            .select("security_id, current_price, 1d_abs, 1d_pct, timestamp")
            .in("security_id", securityIds)
            .order("timestamp", { ascending: false }),
        ]);
        (secsRes.data || []).forEach(s => { secMap[s.id] = s; });
        // Keep latest intraday row per security_id (rows are already ordered DESC)
        (intradayRes.data || []).forEach(r => {
          if (r.security_id != null && intradayPriceMap[r.security_id] === undefined && r.current_price != null) {
            intradayPriceMap[r.security_id] = {
              current_price: Number(r.current_price),
              abs_1d: r['1d_abs'] != null ? Number(r['1d_abs']) : null,
              pct_1d: r['1d_pct'] != null ? Number(r['1d_pct']) : null,
            };
          }
        });
      }
      const rows = baseRows.map(h => {
        const sec = secMap[h.security_id] || {};
        return {
          ...h,
          symbol: sec.symbol || null,
          name: sec.name || null,
          logo_url: sec.logo_url || null,
          last_price: sec.last_price ?? null,
          intraday_price_cents: intradayPriceMap[h.security_id]?.current_price ?? null,
          intraday_1d_abs_cents: intradayPriceMap[h.security_id]?.abs_1d ?? null,
          intraday_1d_pct: intradayPriceMap[h.security_id]?.pct_1d ?? null,
        };
      });
      if (isMounted.current) setHoldings(rows);

      // Fetch strategy names for any strategy holdings
      const stratIds = [...new Set(rows.map(h => h.strategy_id).filter(Boolean))];
      if (stratIds.length > 0) {
        const { data: strats } = await supabase
          .from("strategies_c")
          .select("id, name, short_name, risk_level, is_featured")
          .in("id", stratIds);
        const map = {};
        (strats || []).forEach(s => { map[s.id] = s; });
        if (isMounted.current) setStrategyMap(map);
      }
    } catch (e) { console.error("[child-dash] holdings", e); }
  }

  async function fetchParentWallet() {
    setParentBalanceLoading(true);
    try {
      if (!supabase) return;
      const userId = (await supabase.auth.getUser())?.data?.user?.id;
      if (!userId) return;
      const { data } = await supabase
        .from("wallets")
        .select("balance")
        .eq("user_id", userId)
        .maybeSingle();
      const balanceRands = Number(data?.balance || 0);
      const balanceCents = Math.round(balanceRands * 100);
      if (isMounted.current) setParentBalance(balanceCents);
    } catch (e) {
      console.error("[child-dash] parent wallet", e);
    } finally {
      if (isMounted.current) setParentBalanceLoading(false);
    }
  }

  async function openTransferModal() {
    setOpeningTransfer(true);
    await Promise.all([fetchParentWallet(), fetchChildBalance(), fetchChildProfile()]);
    if (isMounted.current) {
      setShowTransfer(true);
      setOpeningTransfer(false);
    }
  }

  async function openInvestModal() {
    const latestChild = await fetchChildProfile();
    const latestKyc = getChildKycState(latestChild);
    if (!latestKyc.verified) {
      setKycNotice(CHILD_KYC_PENDING_MESSAGE);
      window.setTimeout(() => {
        if (isMounted.current) setKycNotice("");
      }, 5000);
      return;
    }
    setKycNotice("");
    setActiveChildTab("markets");
  }

  async function fetchTransactions() {
    try {
      if (!supabase) return;
      const linkedUserId = child?.linked_user_id || null;
      const familyTxQuery = supabase
        .from("transactions")
        .select("id, user_id, family_member_id, name, direction, amount, description, created_at, transaction_date, base_amount_cents, buffer_cents, buffer_consumed_cents, broker_fee_cents, isin_fee_cents, transaction_fee_cents")
        .eq("family_member_id", child.id)
        .order("created_at", { ascending: false })
        .limit(10);
      const linkedTxQuery = linkedUserId
        ? supabase
            .from("transactions")
            .select("id, user_id, family_member_id, name, direction, amount, description, created_at, transaction_date, base_amount_cents, buffer_cents, buffer_consumed_cents, broker_fee_cents, isin_fee_cents, transaction_fee_cents")
            .eq("user_id", linkedUserId)
            .order("created_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [], error: null });

      const [familyTxRes, linkedTxRes] = await Promise.all([familyTxQuery, linkedTxQuery]);
      if (familyTxRes.error) { console.error("[child-dash] family txns query error", familyTxRes.error); return; }
      if (linkedTxRes.error) { console.error("[child-dash] linked txns query error", linkedTxRes.error); return; }

      const txById = new Map();
      [...(familyTxRes.data || []), ...(linkedTxRes.data || [])].forEach((tx) => {
        if (tx?.id) txById.set(tx.id, tx);
      });
      const mergedTransactions = Array.from(txById.values())
        .sort((a, b) => new Date(b.created_at || b.transaction_date || 0) - new Date(a.created_at || a.transaction_date || 0))
        .slice(0, 10);
      if (isMounted.current) setTransactions(mergedTransactions);
    } catch (e) { console.error("[child-dash] txns", e); }
  }

  // Shared live price poll — runs once every 15s for all child securities,
  // fed to both SwipeableBalanceCard and ChildPortfolioTab to avoid duplicate queries.
  useEffect(() => {
    if (!child?.id || !holdings.length) return;
    const securityIds = [...new Set(holdings.map(h => h.security_id).filter(Boolean))];
    if (!securityIds.length) return;
    const fetchLive = async () => {
      const { data } = await supabase
        .from("stock_intraday_c")
        .select("security_id, current_price, 1d_abs, 1d_pct")
        .in("security_id", securityIds)
        .order("timestamp", { ascending: false });
      if (!data?.length) return;
      const map = {};
      for (const row of data) {
        if (!map[row.security_id]) {
          map[row.security_id] = {
            priceCents: Number(row.current_price),
            abs1dCents: row["1d_abs"] != null ? Number(row["1d_abs"]) : null,
            pct1d: row["1d_pct"] != null ? Number(row["1d_pct"]) : null,
          };
        }
      }
      setChildLivePriceMap(map);
    };
    fetchLive();
    const id = setInterval(fetchLive, 15000);
    return () => clearInterval(id);
  }, [child?.id, holdings]);

  function handleTransferDone(result) {
    if (result.child_balance !== undefined) {
      setChild(prev => ({ ...prev, available_balance: result.child_balance }));
    }
    if (result.parent_balance !== undefined) {
      setParentBalance(result.parent_balance);
    }
    fetchTransactions();
    fetchHoldings();
  }

  function handleInvestDone(result) {
    if (result.child_balance !== undefined) {
      setChild(prev => ({ ...prev, available_balance: result.child_balance }));
    }
    fetchHoldings();
    fetchTransactions();
  }

  // A child purchase can be placed from surfaces that don't own this page's
  // state (Markets child-filter → ChildInvestModal). The modal broadcasts
  // "mint:child-invested" on success; refetch here so the pending card shows
  // IMMEDIATELY — previously it only appeared after leaving and re-entering,
  // which read as "the buy didn't work" and caused double purchases.
  useEffect(() => {
    const onChildInvested = (e) => {
      const d = e?.detail || {};
      if (d.familyMemberId && child?.id && d.familyMemberId !== child.id) return;
      if (d.child_balance !== undefined) setChild(prev => ({ ...prev, available_balance: d.child_balance }));
      fetchHoldings();
      fetchTransactions();
    };
    window.addEventListener("mint:child-invested", onChildInvested);
    return () => window.removeEventListener("mint:child-invested", onChildInvested);
  }, [child?.id]);

  async function fetchGoals() {
    if (!child?.id) return;
    setLoadingGoals(true);
    try {
      let query = supabase
        .from("investment_goals")
        .select("id, name, target_amount, current_amount, is_active, target_date")
        .eq("family_member_id", child.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (profile?.id) query = query.eq("user_id", profile.id);

      const { data, error } = await query;
      if (error) throw error;
      if (isMounted.current) setGoals(data || []);
    } catch (error) {
      console.error("[child-dash] goal fetch error", error);
      if (isMounted.current) setGoals([]);
    } finally {
      if (isMounted.current) setLoadingGoals(false);
    }
  }

  function resetGoalForm() {
    setNewGoal({ name: "", target_amount: "", target_date: "" });
    setEditingGoalId(null);
    setIsCreatingGoal(false);
  }

  function closeGoalsModal() {
    setShowGoalsModal(false);
    resetGoalForm();
  }

  function handleEditClick(goal) {
    setNewGoal({
      name: goal.name,
      target_amount: goal.target_amount,
      target_date: goal.target_date || "",
    });
    setEditingGoalId(goal.id);
    setIsCreatingGoal(true);
    setShowGoalsModal(true);
  }

  async function handleCreateGoal(e) {
    e.preventDefault();
    if (!newGoal.name || !newGoal.target_amount || !child?.id || !profile?.id) return;

    setLoadingGoals(true);
    try {
      const { error } = await supabase.from("investment_goals").insert({
        user_id: profile.id,
        family_member_id: child.id,
        name: newGoal.name,
        target_amount: parseFloat(newGoal.target_amount),
        target_date: newGoal.target_date || null,
        current_amount: 0,
        is_active: true,
      });

      if (error) throw error;

      setNewGoal({ name: "", target_amount: "", target_date: "" });
      setIsCreatingGoal(false);
      fetchGoals();
    } catch (error) {
      console.error("[child-dash] goal create error", error);
    } finally {
      setLoadingGoals(false);
    }
  }

  async function handleUpdateGoal(e) {
    e.preventDefault();
    if (!editingGoalId) return;

    setLoadingGoals(true);
    try {
      const updatePayload = {
        name: newGoal.name,
        target_amount: parseFloat(newGoal.target_amount),
        target_date: newGoal.target_date || null,
      };
      const { error } = await supabase
        .from("investment_goals")
        .update(updatePayload)
        .eq("id", editingGoalId)
        .eq("family_member_id", child.id);

      if (error) throw error;
      resetGoalForm();
      fetchGoals();
    } catch (error) {
      console.error("[child-dash] goal update error", error);
    } finally {
      setLoadingGoals(false);
    }
  }

  async function handleDeleteGoal(goalId) {
    if (!window.confirm("Are you sure you want to delete this goal?")) return;
    setLoadingGoals(true);
    try {
      const { error } = await supabase
        .from("investment_goals")
        .delete()
        .eq("id", goalId)
        .eq("family_member_id", child.id);
      if (error) throw error;
      resetGoalForm();
      fetchGoals();
    } catch (error) {
      console.error("[child-dash] goal delete error", error);
    } finally {
      setLoadingGoals(false);
    }
  }

  const isHoldingFilled = (holding) => Number(holding.avg_fill || 0) > 0 && !!holding.Fill_date;

  // Live price per share in Rands: live poll → intraday DB → last close (all in cents / 100).
  // Returns null only when no price source is available at all.
  const getHoldingLivePriceRands = (holding) => {
    // Prefer 15s live poll (same source as balance card) → intraday DB fallback → last close
    const pollCents = childLivePriceMap[holding.security_id]?.priceCents;
    if (pollCents > 0) return pollCents / 100;
    const intradayCents = Number(holding.intraday_price_cents);
    if (Number.isFinite(intradayCents) && intradayCents > 0) {
      return intradayCents / 100;
    }
    // Final fallback: last close price from securities_c (stored in cents)
    const lastCents = Number(holding.last_price);
    if (Number.isFinite(lastCents) && lastCents > 0) {
      return lastCents / 100;
    }
    return null;
  };

  // Market value in Rands. Null when the holding isn't filled or no live price is available.
  const getHoldingMarketValueRands = (holding) => {
    if (!isHoldingFilled(holding)) return null;
    const livePrice = getHoldingLivePriceRands(holding);
    if (livePrice == null) return null;
    const quantity = Math.abs(Number(holding.quantity || 0));
    return livePrice * quantity;
  };

  // Cost basis in Rands. Prefers Expected_fill (the price the child saw at
  // click time, in rands) over avg_fill (broker fill in cents — captures the
  // company spread). Returns null when neither is set.
  const getHoldingCostRands = (holding) => {
    const expected = Number(holding.Expected_fill);
    const quantity = Math.abs(Number(holding.quantity || 0));
    if (Number.isFinite(expected) && expected > 0) {
      return expected * quantity;
    }
    const avgFill = Number(holding.avg_fill);
    if (!Number.isFinite(avgFill) || avgFill <= 0) return null;
    return (avgFill / 100) * quantity;
  };

  // Legacy cents-based helpers kept for the few callers that still use them (totals, sorting, etc.).
  const getHoldingMarketValueCents = (holding) => {
    const v = getHoldingMarketValueRands(holding);
    return v == null ? 0 : Math.round(v * 100);
  };
  const getHoldingCostCents = (holding) => {
    const v = getHoldingCostRands(holding);
    return v == null ? 0 : Math.round(v * 100);
  };

  const totalPortfolioCents = holdings.reduce((s, h) => s + getHoldingMarketValueCents(h), 0);


  // Group holdings by strategy_id + order batch.
  // Primary key: store_reference (authoritative per-order id stamped on each
  // holdings row by the buy endpoints). Falls back to created_at-minute for
  // legacy rows written before the store_reference column existed.
  // A rebalance is a position swap, not a new purchase. Rebalance-created
  // holdings (rebalance_batch_id set) carry no transaction_id, so merge them into
  // the strategy's earliest ORIGINAL purchase batch (anchor) instead of letting
  // them form a second batch (which would show "2 purchases / 2x").
  const anchorByStrategy = {};
  holdings.forEach((h) => {
    if (!h.strategy_id || h.rebalance_batch_id) return;
    const minute = h.created_at ? new Date(h.created_at).toISOString().slice(0, 16) : "unknown";
    const batchId = h.transaction_id || `legacy:${minute}`;
    const cur = anchorByStrategy[h.strategy_id];
    if (!cur || minute < cur.minute) anchorByStrategy[h.strategy_id] = { batchId, minute, transactionId: h.transaction_id || null };
  });

  const purchaseGroups = holdings.reduce((acc, h) => {
    if (!h.strategy_id) return acc;
    const minute = h.created_at
      ? new Date(h.created_at).toISOString().slice(0, 16) // "2026-05-19T14:32"
      : "unknown";
    const anchor = anchorByStrategy[h.strategy_id];
    let batchId, txnId, batchMinute;
    if (h.rebalance_batch_id && anchor) {
      batchId = anchor.batchId; txnId = anchor.transactionId; batchMinute = anchor.minute;
    } else {
      batchId = h.transaction_id || `legacy:${minute}`; txnId = h.transaction_id || null; batchMinute = minute;
    }
    const key = `${h.strategy_id}__${batchId}`;
    if (!acc[key]) acc[key] = { strategyId: h.strategy_id, transactionId: txnId, minute: batchMinute, holdings: [] };
    acc[key].holdings.push(h);
    return acc;
  }, {});

  // For each strategy, list its purchase batches sorted oldest→newest
  const strategyBatches = Object.values(purchaseGroups).reduce((acc, pg) => {
    const sid = pg.strategyId;
    if (!acc[sid]) acc[sid] = [];
    acc[sid].push(pg);
    return acc;
  }, {});
  Object.values(strategyBatches).forEach(batches =>
    batches.sort((a, b) => (a.minute < b.minute ? -1 : 1))
  );

  // Build one card entry per purchase batch
  const buildBatchCard = (sid, pg, batchIndex, totalBatches) => {
    const strat = strategyMap[sid] || {};
    const hs = pg.holdings;
    const isFilling = hs.some((h) => !isHoldingFilled(h));
    let totalValueRands = 0;
    let totalCostRands = 0;
    let anyPriceMissing = false;
    let anyCostMissing = false;
    if (!isFilling) {
      for (const h of hs) {
        const mv = getHoldingMarketValueRands(h);
        const cv = getHoldingCostRands(h);
        if (mv == null) anyPriceMissing = true; else totalValueRands += mv;
        if (cv == null) anyCostMissing = true; else totalCostRands += cv;
      }
    }
    const pnlAvailable = !isFilling && !anyPriceMissing && !anyCostMissing;
    const pnlRands = pnlAvailable ? (totalValueRands - totalCostRands) : null;
    const pnlPct = pnlAvailable && totalCostRands > 0
      ? ((totalValueRands - totalCostRands) / totalCostRands) * 100 : null;
    const purchaseDate = pg.minute !== "unknown"
      ? new Date(pg.minute).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : null;
    return {
      id: sid,
      batchKey: `${sid}__${pg.minute}`,
      batchIndex,
      totalBatches,
      purchaseDate,
      name: strat.name || "Strategy",
      short_name: strat.short_name,
      risk_level: strat.risk_level,
      is_featured: strat.is_featured,
      totalValue: isFilling ? 0 : Math.round(totalValueRands * 100),
      pnl: pnlRands == null ? null : Math.round(pnlRands * 100),
      pnlPct,
      holdings: hs,
      isFilling,
    };
  };

  // Flat list of batch cards (one per purchase order) for rendering
  const strategyCards = Object.entries(strategyBatches).flatMap(([sid, batches]) =>
    batches.map((pg, i) => buildBatchCard(sid, pg, i, batches.length))
  );

  // Group cards by strategy ID so we can render stacks
  const strategyCardStacks = Object.entries(
    strategyCards.reduce((acc, card) => {
      if (!acc[card.id]) acc[card.id] = [];
      acc[card.id].push(card);
      return acc;
    }, {})
  ); // [[strategyId, [card, card?]], ...]

  // Pending single-security gift holdings — received but not yet broker-filled.
  // Shown as a "Pending Gift" card so the child can see what was gifted to them.
  const pendingShareHoldings = holdings.filter(
    h => !h.strategy_id && !isHoldingFilled(h) && h.security_id
  );

  // Best performing INDIVIDUAL assets — only holdings without a strategy_id.
  // Strategy holdings get surfaced through their own strategy card / detail modal instead.
  const bestAssets = [...holdings]
    .filter(h => !h.strategy_id && h.symbol && isHoldingFilled(h) && getHoldingMarketValueCents(h) > 0)
    .map(h => {
      const costCents = getHoldingCostCents(h);
      const marketCents = getHoldingMarketValueCents(h);
      const pnlCents = marketCents - costCents;
      const pnlR = pnlCents / 100;
      const pnlP = costCents > 0 ? (pnlCents / costCents) * 100 : 0;
      return { ...h, pnlR, pnlP };
    })
    .sort((a, b) => b.pnlP - a.pnlP)
    .slice(0, 5);

  // Holdings inside the currently-selected strategy, ranked by PnL % (for the detail modal).
  const strategyDetailData = strategyDetailId
    ? (() => {
        const strat = strategyMap[strategyDetailId] || {};
        const items = holdings
          .filter(h => h.strategy_id === strategyDetailId && isHoldingFilled(h))
          .map(h => {
            const costCents = getHoldingCostCents(h);
            const marketCents = getHoldingMarketValueCents(h);
            const pnlCents = marketCents - costCents;
            const pnlR = pnlCents / 100;
            const pnlP = costCents > 0 ? (pnlCents / costCents) * 100 : 0;
            return { ...h, marketCents, costCents, pnlCents, pnlR, pnlP };
          })
          .sort((a, b) => b.pnlP - a.pnlP);
        return { strategy: strat, holdings: items };
      })()
    : null;



  // Fetch year-start basket per strategy — mirrors purple SwipeableBalanceCard YTD logic exactly
  useEffect(() => {
    if (!child?.id || !holdings.length) return;
    const stratIds = [...new Set(holdings.filter(h => h.strategy_id).map(h => h.strategy_id))];
    if (!stratIds.length) return;
    const yearStart = `${new Date().getUTCFullYear()}-01-01`;
    Promise.all(stratIds.map(async (sid) => {
      // Fetch YTD basket rows for this strategy (ascending so first = earliest this year)
      let q = supabase
        .from("client_strategy_returns_c")
        .select("as_of_date, basket_value")
        .eq("family_member", child.id)
        .eq("strategy_id", sid)
        .gte("as_of_date", yearStart)
        .order("as_of_date", { ascending: true });
      const { data: ytdRows } = await q;
      if (!ytdRows?.length) return [sid, null];
      const firstBasket = Number(ytdRows[0].basket_value || 0);
      // Check if prior-year data exists (same check purple card does)
      const { count: priorCount } = await supabase
        .from("client_strategy_returns_c")
        .select("as_of_date", { count: "exact", head: true })
        .eq("family_member", child.id)
        .eq("strategy_id", sid)
        .lt("as_of_date", yearStart);
      // yearStartBasketCents = firstBasket only when prior-year data exists; otherwise use cost basis
      return [sid, priorCount > 0 ? firstBasket : null];
    })).then(results => setStrategyYearStartBasket(Object.fromEntries(results)));
  }, [child?.id, holdings]);

  // Compute live YTD per strategy — exact same formula as purple card's childLiveMetrics.
  // Uses getHoldingMarketValueRands / getHoldingCostRands so price and cost sources are
  // consistent: live poll → intraday_price_cents → last_price (cents); avg_fill / Expected_fill.
  const strategyYtdMetrics = useMemo(() => {
    const result = {};
    const stratIds = [...new Set(holdings.filter(h => h.strategy_id).map(h => h.strategy_id))];
    for (const sid of stratIds) {
      const stratHoldings = holdings.filter(h => h.strategy_id === sid && isHoldingFilled(h));
      let liveValue = 0;
      let costBasis = 0;
      let hasPrices = false;
      for (const h of stratHoldings) {
        const mv = getHoldingMarketValueRands(h);
        const cv = getHoldingCostRands(h);
        if (mv != null) { liveValue += mv; hasPrices = true; }
        if (cv != null) costBasis += cv;
      }
      if (!hasPrices || costBasis === 0) continue;
      const yearStartBasketCents = strategyYearStartBasket[sid];
      let pnl, pct;
      if (yearStartBasketCents > 0) {
        const yearStartRands = yearStartBasketCents / 100;
        pnl = liveValue - yearStartRands;
        pct = (pnl / yearStartRands) * 100;
      } else {
        pnl = liveValue - costBasis;
        pct = (pnl / costBasis) * 100;
      }
      result[sid] = { ytdPnlRands: pnl, ytdPct: pct };
    }
    return result;
  }, [holdings, childLivePriceMap, strategyYearStartBasket]);

  // Fetch today's intraday 5-min P&L curve per strategy — same logic as ChildPortfolioTab "D" chart
  useEffect(() => {
    if (!holdings.length) return;
    const stratIds = [...new Set(holdings.filter(h => h.strategy_id).map(h => h.strategy_id))];
    if (!stratIds.length) return;
    const todayUTC = new Date().toISOString().slice(0, 10);

    Promise.all(stratIds.map(async (sid) => {
      const stratHoldings = holdings.filter(h =>
        h.strategy_id === sid && Number(h.avg_fill || 0) > 0 && !!h.Fill_date
      );
      if (!stratHoldings.length) return [sid, []];

      const secIds = [...new Set(stratHoldings.map(h => h.security_id).filter(Boolean))];
      const qtyMap = {};
      stratHoldings.forEach(h => { qtyMap[h.security_id] = Math.abs(Number(h.quantity || 0)); });

      // Paginate intraday rows (same as portfolio tab)
      const PAGE = 1000;
      let intradayRows = [];
      let page = 0;
      while (true) {
        const { data: batch } = await supabase
          .from("stock_intraday_c")
          .select("security_id, current_price, 1d_abs, timestamp")
          .in("security_id", secIds)
          .gte("timestamp", `${todayUTC}T00:00:00Z`)
          .order("timestamp", { ascending: true })
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (!batch?.length) break;
        intradayRows = intradayRows.concat(batch);
        if (batch.length < PAGE) break;
        page++;
      }
      if (!intradayRows.length) return [sid, []];

      // Yesterday's close baseline
      const latestBySecId = {};
      for (const row of intradayRows) latestBySecId[row.security_id] = row;
      const baselineRands = secIds.reduce((sum, id) => {
        const row = latestBySecId[id];
        if (!row) return sum;
        const yClose = Number(row.current_price) - Number(row["1d_abs"] || 0);
        return sum + (yClose / 100) * (qtyMap[id] || 0);
      }, 0);

      // 5-min buckets → P&L points
      const bucketMap = new Map();
      for (const row of intradayRows) {
        const d = new Date(row.timestamp);
        d.setSeconds(0, 0);
        d.setMinutes(Math.floor(d.getMinutes() / 5) * 5);
        const key = d.toISOString();
        if (!bucketMap.has(key)) bucketMap.set(key, {});
        bucketMap.get(key)[row.security_id] = Number(row.current_price);
      }

      const sorted = [...bucketMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const lastKnown = {};
      const points = [{ value: 0 }];
      for (const [, prices] of sorted) {
        for (const id of secIds) {
          if (prices[id] != null) lastKnown[id] = prices[id];
        }
        if (!Object.keys(lastKnown).length) continue;
        const portfolioRands = secIds.reduce((sum, id) => {
          const price = lastKnown[id];
          return price != null ? sum + (price / 100) * (qtyMap[id] || 0) : sum;
        }, 0);
        points.push({ value: Number((portfolioRands - baselineRands).toFixed(2)) });
      }
      return [sid, points.length > 1 ? points : []];
    })).then(results => setStrategySparklines(Object.fromEntries(results)));
  }, [holdings]);

  // Full-width intraday P&L sparkline — same rendering + domain logic as ChildPortfolioTab "D" chart
  const StrategySparkline = ({ points, isUp, gradId }) => {
    if (!points || points.length < 2) return null;
    const color = isUp ? "#16a34a" : "#dc2626";
    const vals = points.map(p => p.value);
    let dataMin = Math.min(...vals);
    let dataMax = Math.max(...vals);
    if (Math.abs(dataMax - dataMin) < 1) { dataMin = Math.min(dataMin, -5); dataMax = Math.max(dataMax, 5); }
    const absMax = Math.max(Math.abs(dataMin), Math.abs(dataMax));
    const domain = dataMin >= 0 ? [0, dataMax * 1.15 || 10]
      : dataMax <= 0 ? [dataMin * 1.15 || -10, 0]
      : [-(absMax * 1.15), absMax * 1.15];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity={0.35} />
              <stop offset="60%"  stopColor={color} stopOpacity={0.12} />
              <stop offset="100%" stopColor="#ffffff" stopOpacity={0}  />
            </linearGradient>
          </defs>
          <YAxis hide domain={domain} />
          <ReferenceLine y={0} stroke={isUp ? "#bbf7d0" : "#fecaca"} strokeDasharray="4 3" strokeWidth={1.5} />
          <Area type="monotone" dataKey="value" stroke="transparent" fill={`url(#${gradId})`} dot={false} activeDot={false} isAnimationActive={true} animationBegin={0} animationDuration={700} animationEasing="ease-out" />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={false} activeDot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div
      className="min-h-screen pb-[env(safe-area-inset-bottom)]"
      style={{
        backgroundColor: "#f8f6fa",
        backgroundImage: "linear-gradient(180deg,#0d0d12 0%,#0e0a14 0.5%,#100b18 1%,#120c1c 1.5%,#150e22 2%,#181028 2.5%,#1c122f 3%,#201436 3.5%,#25173e 4%,#2a1a46 5%,#301d4f 6%,#362158 7%,#3d2561 8%,#44296b 9%,#4c2e75 10%,#54337f 11%,#5d3889 12%,#663e93 13%,#70449d 14%,#7a4aa7 15%,#8451b0 16%,#8e58b9 17%,#9860c1 18%,#a268c8 19%,#ac71ce 20%,#b57ad3 21%,#be84d8 22%,#c68edc 23%,#cd98e0 24%,#d4a2e3 25%,#daace6 26%,#dfb6e9 27%,#e4c0eb 28%,#e8c9ed 29%,#ecd2ef 30%,#efdaf1 31%,#f2e1f3 32%,#f4e7f5 33%,#f6ecf7 34%,#f8f0f9 35%,#f9f3fa 36%,#faf5fb 38%,#fbf7fc 40%,#fcf9fd 42%,#fdfafd 45%,#faf8fc 55%,#f8f6fa 100%)",
        backgroundRepeat: "no-repeat",
        backgroundSize: "100% 100vh",
        backgroundAttachment: "fixed",
      }}
    >
      {/* -- Header -- */}
      <div className="px-4 pt-12 pb-6">
        <div className="mx-auto w-full max-w-sm md:max-w-md">
          <header className="relative flex items-center justify-between text-white mb-4">
            {/* Parent profile pill — shows family dropdown */}
            <FamilyDropdown
              profile={profile}
              userId={profile?.id}
              initials={[profile?.firstName, profile?.lastName].filter(Boolean).map(n => n[0].toUpperCase()).join("") || "P"}
              avatarUrl={profile?.avatarUrl}
              activeChildId={child?.id}
              onGoToParent={onBack}
            />

            {/* Child name — centered */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              <p className="text-[15px] font-bold text-white leading-tight tracking-tight">{childName}</p>
              {age !== null && (
                <p className="text-[11px] text-white/60 font-medium leading-none mt-0.5">Age {age}</p>
              )}
            </div>

            {/* Notification bell */}
            <NotificationBell onClick={onOpenNotifications || (() => {})} />
          </header>

          {activeChildTab !== "portfolio" && (
          <div className="">
            {loading ? (
              <div className="rounded-[28px] bg-white/95 p-5 shadow-xl border border-white/70">
                <div className="flex items-center justify-between mb-8">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-8 rounded-full" />
                </div>
                <Skeleton className="h-10 w-40 mb-8" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-12 rounded-2xl" />
                  <Skeleton className="h-12 rounded-2xl" />
                </div>
              </div>
            ) : (
              <SwipeableBalanceCard
                userId={profile?.id || null}
                familyMemberId={child?.id || null}
                mintNumber={child?.mint_number || null}
                overrideWalletBalance={childBalance / 100}
                livePriceMap={childLivePriceMap}
                onChildYtdMetrics={setPurpleCardYtdMetrics}
              />
            )}
          </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto w-full max-w-sm px-4 pb-[calc(var(--navbar-height,80px)+1rem)] md:max-w-md">
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">

          {/* -- Incomplete profile banner -- */}
          {isProfileIncomplete && (
            <motion.div variants={item}>
              <button
                onClick={() => setShowCompleteModal(true)}
                className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 text-left transition active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg,#fef3c7,#fef9c3)", border: "1px solid #fde68a" }}
              >
                <div className="h-9 w-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="h-4.5 w-4.5 text-amber-600" style={{ height: "1.125rem", width: "1.125rem" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-800">{`Complete ${childName}'s profile`}</p>
                  <p className="text-xs text-amber-700 mt-0.5 truncate">
                    Missing: {missingItems.join(", ")}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-amber-600 flex-shrink-0" />
              </button>
            </motion.div>
          )}

          {kycNotice && (
            <motion.div variants={item}>
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-amber-800 shadow-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p className="text-xs font-semibold leading-relaxed">{kycNotice}</p>
              </div>
            </motion.div>
          )}

          {/* Quick Actions — always visible */}
          {activeChildTab !== "portfolio" && <motion.div variants={item}>
            <div className="grid grid-cols-4 gap-2 text-[11px] font-medium">
              {[
                { label: "Invest", icon: LayoutGrid, onClick: openInvestModal, disabled: isAdminPreview() },
                { label: "Deposit", icon: ArrowDownToLine, onClick: openTransferModal, disabled: openingTransfer || isAdminPreview() },
                { label: "Goals", icon: Target, onClick: () => setShowGoalsModal(true) },
                { label: "Wishlist", icon: Heart, onClick: () => setShowWishlistOptions(true) },
              ].map((btn, i) => {
                const Icon = btn.icon;
                return (
                  <button
                    key={i}
                    disabled={btn.comingSoon || btn.disabled}
                    onClick={btn.onClick}
                    className={`relative flex flex-col items-center gap-2 rounded-2xl px-1 py-3 transition-all ${
                      btn.comingSoon
                        ? "bg-slate-100/70 cursor-not-allowed border border-slate-200/60"
                        : "bg-white shadow-md active:scale-95 active:shadow-sm"
                    } disabled:opacity-60`}
                    type="button"
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full ${
                      btn.comingSoon ? "bg-slate-200 text-slate-400" : "bg-violet-50 text-violet-700"
                    }`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className={`text-center leading-tight font-medium ${
                      btn.comingSoon ? "text-slate-400" : "text-slate-700"
                    }`}>
                      {btn.disabled && !btn.comingSoon ? "Loading..." : btn.label}
                    </span>
                    {btn.comingSoon && (
                      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 inline-flex items-center px-1.5 py-px rounded-full text-[7px] font-bold uppercase tracking-wider text-white" style={{ background: "linear-gradient(90deg,#7c3aed,#a855f7)" }}>Soon</span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>}

          {/* -- Strategy Holdings — home tab only -- */}
          {activeChildTab === "home" && <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="h-2 w-2 rounded-full bg-slate-300" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Strategies</p>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[0, 1].map((i) => (
                  <div key={i} className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm" style={{ background: "linear-gradient(150deg,#fdfbff 0%,#f3eeff 60%,#ede8ff 100%)" }}>
                    <div className="px-4 pt-4 pb-3">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
                          <div className="space-y-2 min-w-0">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-5 w-16 rounded-full" />
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          <Skeleton className="h-5 w-20" />
                          <Skeleton className="h-4 w-14" />
                          <Skeleton className="h-4 w-8 rounded-full" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-3 border-t border-[#dde3f5]">
                        <div className="flex -space-x-2">
                          {[0, 1, 2].map((idx) => (
                            <Skeleton key={idx} className="h-7 w-7 rounded-full border-2 border-white" />
                          ))}
                        </div>
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                    <Skeleton className="w-full" style={{ height: 80, borderRadius: 0 }} />
                  </div>
                ))}
              </div>
            ) : strategyCardStacks.length > 0 ? (
              <div className="space-y-3">
                {strategyCardStacks.map(([sid, cards]) => {
                  const isStack = cards.length > 1;
                  const isExpanded = expandedStrategyStack === sid;

                  // Single card renderer (reused for both single and expanded stack items)
                  const renderCard = (sc, opts = {}) => {
                    // Prefer purple card's computed metrics (identical source) — fall back to per-strategy
                    const ytdMetrics = purpleCardYtdMetrics
                      ? { ytdPnlRands: purpleCardYtdMetrics.pnl, ytdPct: purpleCardYtdMetrics.pct }
                      : strategyYtdMetrics[sc.id];
                    const ytdPct = ytdMetrics?.ytdPct ?? null;
                    const ytdPnlRands = ytdMetrics?.ytdPnlRands ?? null;
                    const ytdAvailable = ytdPct != null && ytdPnlRands != null;
                    const isUp = ytdAvailable ? ytdPct >= 0 : (sc.pnl != null && sc.pnl >= 0);
                    const isFilling = sc.isFilling;
                    const sparkPoints = strategySparklines[sc.id];
                    const hasSparkline = !isFilling && Array.isArray(sparkPoints) && sparkPoints.length >= 2;
                    const gradId = `strat-grad-${sc.id}`;
                    const accentColor = isFilling ? "#f59e0b" : isUp ? "#16a34a" : "#dc2626";
                    const cardCls = isFilling
                      ? "w-full text-left rounded-2xl border border-amber-200 shadow-md overflow-hidden opacity-70"
                      : "w-full text-left rounded-2xl border border-[#e8edf8] shadow-[0_2px_16px_-3px_rgba(109,40,217,0.10)] overflow-hidden hover:border-violet-300 hover:shadow-[0_4px_20px_-4px_rgba(109,40,217,0.18)] transition active:scale-[0.99]";
                    return (
                      <button
                        key={sc.batchKey}
                        type="button"
                        disabled={isFilling}
                        onClick={opts.onClick || (() => !isFilling && setStrategyDetailId(sc.id))}
                        className={cardCls}
                        style={{ background: isFilling ? "#fff" : "linear-gradient(150deg,#fdfbff 0%,#f3eeff 60%,#ede8ff 100%)" }}
                      >
                        <div className="px-4 pt-4 pb-3">
                        {/* Purchase date top-right when in expanded stack */}
                        {sc.purchaseDate && opts.showDate && (
                          <p className="text-[10px] font-semibold text-slate-400 text-right mb-1.5">{sc.purchaseDate}</p>
                        )}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
                              style={{ background: "linear-gradient(135deg,#ede9fe,#ddd6fe)" }}>
                              <BarChart3 className="h-5 w-5 text-purple-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold tracking-[0.18em] uppercase text-slate-900 truncate">{sc.short_name || sc.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {sc.risk_level && (
                                  <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-violet-100 text-violet-700 border border-violet-200">{sc.risk_level}</span>
                                )}
                                {isFilling && (
                                  <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-violet-100 text-violet-700 border border-violet-200">Filling</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end flex-shrink-0">
                            {isFilling ? (
                              <>
                                <p className="text-sm font-bold text-violet-700">Pending</p>
                                <p className="text-xs font-semibold text-violet-600">Awaiting fill</p>
                              </>
                            ) : (
                              <>
                                {ytdAvailable ? (
                                  <>
                                    <p className={`text-base font-bold tabular-nums ${isUp ? "text-emerald-500" : "text-red-500"}`}>
                                      {isUp ? "+" : "-"}{fmtRands(Math.abs(ytdPnlRands))}
                                    </p>
                                    <p className={`text-sm font-bold tabular-nums ${isUp ? "text-emerald-600" : "text-red-500"}`}>
                                      {isUp ? "+" : "-"}{Math.abs(ytdPct).toFixed(1)}%
                                    </p>
                                  </>
                                ) : sc.pnl != null ? (
                                  <>
                                    <p className={`text-base font-bold tabular-nums ${isUp ? "text-emerald-500" : "text-red-500"}`}>
                                      {isUp ? "+" : ""}{fmt(sc.pnl)}
                                    </p>
                                    <p className={`text-sm font-bold tabular-nums mt-0.5 ${isUp ? "text-emerald-600" : "text-red-500"}`}>
                                      {isUp ? "+" : ""}{sc.pnlPct != null ? Math.abs(sc.pnlPct).toFixed(1) + "%" : "—"}
                                    </p>
                                  </>
                                ) : (
                                  <p className="text-xs font-semibold text-slate-400">—</p>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {sc.holdings.length > 0 && (
                          <div className="flex items-center gap-2 pt-3 border-t border-[#dde3f5]">
                            <div className="flex -space-x-2">
                              {sc.holdings.slice(0, 4).map(h => (
                                <div key={h.id} className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm">
                                  {h.logo_url
                                    ? <img src={h.logo_url} alt={h.symbol} className="h-full w-full object-cover" />
                                    : <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">{h.symbol?.substring(0, 2)}</div>}
                                </div>
                              ))}
                              {sc.holdings.length > 4 && (
                                <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[10px] font-semibold text-slate-500">
                                  +{sc.holdings.length - 4}
                                </div>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400">{sc.holdings.length} holding{sc.holdings.length !== 1 ? "s" : ""}</span>
                          </div>
                        )}
                        </div>
                        {/* Full-width area chart — bleeds to card edges */}
                        {hasSparkline && (
                          <div style={{ height: 80 }}>
                            <StrategySparkline points={sparkPoints} isUp={isUp} gradId={gradId} />
                          </div>
                        )}
                      </button>
                    );
                  };

                  if (!isStack) {
                    return <div key={sid}>{renderCard(cards[0])}</div>;
                  }

                  // Stacked card with absolute-positioned layers + spring transition
                  const n = cards.length;
                  const pendingCount = cards.filter(c => c.isFilling).length;
                  const filledCount = n - pendingCount;
                  const hasMixed = pendingCount > 0 && filledCount > 0;
                  const COLLAPSED_H = 112; // header + holdings row
                  const STACK_OFFSET = 13; // each card peeks this many px below the one above
                  const STACK_SCALE  = 0.038; // scale reduction per layer

                  // Container height: collapsed = top card + peeking layers; expanded = cards flow naturally
                  const collapsedContainerH = COLLAPSED_H + (n - 1) * STACK_OFFSET + 4;

                  return (
                    <div key={sid} style={{
                      position: 'relative',
                      height: isExpanded ? 'auto' : collapsedContainerH,
                      transition: 'height 0.45s cubic-bezier(0.25,0.46,0.45,0.94)',
                    }}>
                      {/* 2× badge */}
                      <div style={{
                        position: isExpanded ? 'static' : 'absolute',
                        top: 8, right: 8, zIndex: n + 2,
                        display: isExpanded ? 'none' : 'flex',
                      }}
                        className="absolute h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white shadow pointer-events-none">
                        {n}×
                      </div>

                      {/* Mixed-state "N pending" ribbon — top-left, only when stack contains both filled & pending */}
                      {hasMixed && !isExpanded && (
                        <div style={{ position: 'absolute', top: -4, left: -4, zIndex: n + 3 }}
                          className="flex items-center gap-1 rounded-full bg-violet-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow ring-2 ring-white pointer-events-none">
                          <Clock className="h-2.5 w-2.5" /> {pendingCount} pending
                        </div>
                      )}

                      {isExpanded ? (
                        /* Expanded: normal flow, each card shows full content + date */
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setExpandedStrategyStack(null)}
                            className="flex items-center gap-1.5 px-1 text-[11px] font-semibold text-violet-500 hover:text-violet-700 transition"
                          >
                            <ChevronUp className="h-3 w-3" />
                            {cards[0].name} · {n} purchases · collapse
                          </button>
                          {cards.map(sc => renderCard(sc, { showDate: true }))}
                        </div>
                      ) : (
                        /* Collapsed: absolute-positioned layers */
                        cards.map((sc, i) => {
                          const scale  = 1 - i * STACK_SCALE;
                          const topPos = i * STACK_OFFSET;
                          const zIdx   = n - i;
                          return (
                            <div
                              key={sc.batchKey}
                              onClick={i === 0 ? () => setExpandedStrategyStack(sid) : undefined}
                              style={{
                                position: 'absolute',
                                left: 0, right: 0,
                                top: topPos,
                                transform: `scale(${scale})`,
                                transformOrigin: 'top center',
                                zIndex: zIdx,
                                overflow: 'hidden',
                                height: COLLAPSED_H,
                                borderRadius: 16,
                                cursor: i === 0 ? 'pointer' : 'default',
                                transition: 'all 0.45s cubic-bezier(0.34,1.56,0.64,1)',
                                boxShadow: i === 0
                                  ? '0 4px 16px rgba(0,0,0,0.08)'
                                  : '0 2px 6px rgba(0,0,0,0.04)',
                              }}
                            >
                              <div className="bg-white border border-violet-200 rounded-2xl p-4 h-full pointer-events-none" style={{ boxShadow: i === 0 ? '0 0 0 1px rgba(139,92,246,0.15)' : 'none' }}>
                                {/* Header row always visible */}
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
                                      style={{ background: "linear-gradient(135deg,#ede9fe,#ddd6fe)" }}>
                                      <BarChart3 className="h-5 w-5 text-purple-600" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-sm font-bold tracking-[0.18em] uppercase text-slate-900 truncate">{sc.short_name || sc.name}</p>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        {sc.risk_level && (
                                          <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-violet-50 text-violet-600 border border-violet-100">{sc.risk_level}</span>
                                        )}
                                        {sc.isFilling && (
                                          <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-violet-100 text-violet-700 border border-violet-200">Filling</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    {sc.isFilling ? (
                                      <p className="text-sm font-bold text-violet-700">Pending</p>
                                    ) : (
                                      <>
                                        <p className="text-sm font-bold text-slate-900 tabular-nums">{fmt(sc.totalValue)}</p>
                                        {sc.pnl != null ? (
                                          <p className={`text-xs font-semibold tabular-nums ${sc.pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                            {sc.pnl >= 0 ? "+" : ""}{fmt(sc.pnl)} ({sc.pnlPct?.toFixed(2)}%)
                                          </p>
                                        ) : <p className="text-xs text-slate-400">−</p>}
                                      </>
                                    )}
                                  </div>
                                </div>
                                {/* Holdings avatars */}
                                {sc.holdings.length > 0 && (
                                  <div className="flex items-center gap-2 pt-3 mt-3 border-t border-slate-100">
                                    <div className="flex -space-x-2">
                                      {sc.holdings.slice(0, 4).map(h => (
                                        <div key={h.id} className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm">
                                          {h.logo_url
                                            ? <img src={h.logo_url} alt={h.symbol} className="h-full w-full object-cover" />
                                            : <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[7px] font-bold text-slate-600">{h.symbol?.substring(0,2)}</div>}
                                        </div>
                                      ))}
                                      {sc.holdings.length > 4 && (
                                        <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[9px] font-semibold text-slate-500">+{sc.holdings.length - 4}</div>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-slate-400">{sc.holdings.length} holding{sc.holdings.length !== 1 ? "s" : ""}</span>
                                    {i === 0 && (
                                      <span className="ml-auto text-[10px] font-semibold text-violet-500">
                                        {hasMixed
                                          ? `${filledCount} filled · ${pendingCount} pending · tap to see`
                                          : `Tap to see ${n} purchases`}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 p-8 text-center shadow-lg bg-white">
                <div className="h-16 w-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg,#e9d5ff,#d8b4fe)" }}>
                  <BarChart3 className="h-7 w-7 text-purple-600" />
                </div>
                <p className="text-sm font-bold text-slate-900">No investments yet</p>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  {`Start investing on ${childName}'s behalf to build their future portfolio.`}
                </p>
                <button
                  onClick={openInvestModal}
                  className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-purple-600 hover:text-purple-700 transition"
                >
                  <BarChart3 className="h-4 w-4" /> Browse Strategies
                </button>
              </div>
            )}
          </motion.div>}

          {/* -- Pending Gift Shares — home tab only — shows gifted single securities awaiting broker fill -- */}
          {activeChildTab === "home" && pendingShareHoldings.length > 0 && (
            <motion.div variants={item}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                  Pending Gift{pendingShareHoldings.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="space-y-2">
                {pendingShareHoldings.map(h => (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 rounded-2xl bg-white border border-violet-100 shadow-sm p-4"
                    style={{ background: "linear-gradient(135deg,#fdfbff 0%,#f5f0ff 100%)" }}
                  >
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-violet-50 ring-1 ring-violet-100">
                      {h.logo_url
                        ? <img src={h.logo_url} alt={h.symbol} className="h-9 w-9 object-contain" />
                        : <span className="text-[10px] font-bold text-violet-600">{(h.symbol || "?").substring(0, 3)}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{h.symbol || h.name || "Share"}</p>
                      <p className="text-[10px] text-slate-500 truncate">{h.name || ""}</p>
                      {h.quantity > 0 && (
                        <p className="text-[10px] text-violet-500 font-semibold mt-0.5">{h.quantity} share{h.quantity !== 1 ? "s" : ""} · gifted 🎁</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-violet-700">Pending</p>
                      <p className="text-[10px] text-violet-400">Awaiting fill</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* -- Best Performing Assets — home tab only -- */}
          {activeChildTab === "home" && (loading ? (
            <motion.div variants={item}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="h-2 w-2 rounded-full bg-emerald-200" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Best Performing Assets</p>
              </div>
              <div className="flex gap-3 overflow-hidden pb-1 -mx-4 px-4">
                {[0, 1].map((i) => (
                  <div key={i} className="flex min-w-[220px] flex-shrink-0 items-center gap-3 rounded-2xl bg-white border border-slate-100 shadow-md p-3.5">
                    <Skeleton className="h-11 w-11 rounded-xl flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-14" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : bestAssets.length > 0 && (
            <motion.div variants={item}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Best Performing Assets</p>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {bestAssets.map(a => {
                  const isUp = a.pnlR >= 0;
                  return (
                    <div key={a.id} className="flex min-w-[220px] flex-shrink-0 snap-start items-center gap-3 rounded-2xl bg-white border border-slate-100 shadow-md p-3.5">
                      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
                        {a.logo_url ? (
                          <img src={a.logo_url} alt={a.name} className="h-9 w-9 object-contain" />
                        ) : (
                          <span className="text-[10px] font-bold text-slate-600">{a.symbol?.substring(0, 3)}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{a.symbol}</p>
                        <p className="text-[10px] text-slate-500 truncate">{a.name}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`text-sm font-bold tabular-nums ${isUp ? "text-emerald-500" : "text-red-500"}`}>
                          {isUp ? "+" : ""}{fmt(Math.round(a.pnlR * 100))}
                        </p>
                        <p className={`text-[10px] font-semibold tabular-nums ${isUp ? "text-emerald-500" : "text-red-500"}`}>
                          ({isUp ? "+" : ""}{a.pnlP.toFixed(2)}%)
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ))}

          {/* -- Recent Activity — home tab only -- */}
          {activeChildTab === "home" && <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="h-2 w-2 rounded-full bg-slate-300" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Recent Activity</p>
            </div>

            {loading ? (
              <div className="rounded-2xl overflow-hidden shadow-lg border border-slate-200 bg-white">
                <div className="divide-y divide-slate-100 px-5">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 py-4">
                      <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-4 w-16" />
                    </div>
                  ))}
                </div>
              </div>
            ) : transactions.length > 0 ? (
              <div className="rounded-2xl overflow-hidden shadow-lg border border-slate-200 bg-white">
                <div className="divide-y divide-slate-100 px-5">
                  {transactions.slice(0, 4).map((tx) => (
                    <TransactionRow key={tx.id} tx={tx} />
                  ))}
                </div>
                {transactions.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setShowAllTransactions(true)}
                    className="w-full py-3 text-[12px] font-bold text-purple-600 hover:bg-purple-50 transition border-t border-slate-100"
                  >
                    See all activity
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 p-6 text-center shadow-lg bg-white">
                <p className="text-xs text-slate-600">No activity yet. Transfer or invest to get started.</p>
              </div>
            )}
          </motion.div>}

          {/* -- Child Wishlists — home tab only -- */}
          {activeChildTab === "home" && <motion.div variants={item}>
            <div className="flex items-center justify-between gap-2 mb-3 px-1">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-violet-400" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Wishlists</p>
              </div>
              <button
                type="button"
                onClick={() => setShowChildWishlistCreate(true)}
                className="text-[11px] font-bold text-violet-600 active:opacity-70"
              >
                + New
              </button>
            </div>
            {childWishlistsLoading ? (
              <div className="h-14 rounded-2xl bg-slate-100 animate-pulse" />
            ) : childWishlists.length === 0 ? (
              <button
                type="button"
                onClick={() => setShowChildWishlistCreate(true)}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 py-5 text-sm font-medium text-slate-400 hover:border-violet-300 hover:bg-violet-50 transition-all active:scale-98"
              >
                <Heart size={15} className="text-violet-300" />
                Create a wishlist for {child?.first_name || "this child"}
              </button>
            ) : (
              <div className="space-y-2">
                {childWishlists.map(reg => {
                  const activeItems = (reg.items || []).filter(i => i.status !== "REMOVED");
                  return (
                    <div
                      key={reg.id}
                      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-50 flex-shrink-0">
                        <Heart size={16} className="text-violet-500 fill-violet-100" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{reg.title}</p>
                        <p className="text-[11px] text-slate-400">
                          {activeItems.length === 0 ? "No items yet" : `${activeItems.length} ${activeItems.length === 1 ? "item" : "items"}`}
                        </p>
                      </div>
                      <Gift size={14} className="text-slate-300 flex-shrink-0" />
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowChildWishlistCreate(true)}
                  className="w-full flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-200 py-3 text-[12px] font-semibold text-slate-400 hover:border-violet-300 hover:text-violet-500 transition-all"
                >
                  <Plus size={12} /> Add wishlist
                </button>
              </div>
            )}
          </motion.div>}

          {/* -- Account Info — home tab only -- */}
          {activeChildTab === "home" && <motion.div variants={item}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="h-2 w-2 rounded-full bg-slate-300" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Account Details</p>
            </div>
            <div className="rounded-2xl shadow-lg border border-slate-200 p-5 bg-white">
              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Account Type</span>
                  <span className="font-semibold text-slate-900">Child (Minor)</span>
                </div>
                {child?.mint_number && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Mint Number</span>
                    <span className="font-mono text-xs font-semibold text-slate-900">{child.mint_number}</span>
                  </div>
                )}
                {age !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Age</span>
                    <span className="font-semibold text-slate-900">{age} year{age !== 1 ? "s" : ""}</span>
                  </div>
                )}
                {child?.date_of_birth && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Date of Birth</span>
                    <span className="font-semibold text-slate-900">
                      {new Date(child.date_of_birth).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm border-t border-slate-100 pt-4">
                  <span className="text-slate-600">Managed By</span>
                  <span className="font-semibold text-slate-900">{parentName}</span>
                </div>
                {parentMintNumber && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Parent Mint #</span>
                    <span className="font-mono text-xs font-semibold text-slate-900">{parentMintNumber}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">KYC Status</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide border ${childKyc.className}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${childKyc.pulse ? "animate-pulse" : ""}`} style={{ backgroundColor: "currentColor" }} />
                    {childKyc.label}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>}

        </motion.div>

        {/* -- Portfolio tab: ChildPortfolioTab replaces old pill-tabs layout -- */}
        {activeChildTab === "portfolio" && (
          <ChildPortfolioTab
            child={child}
            rawHoldings={holdings}
            onOpenInvest={openInvestModal}
            onWithdraw={onWithdraw}
            livePriceMap={childLivePriceMap}
          />
        )}
      </div>

      {/* -- Wishlist options sheet (View or Create) -- */}
      <AnimatePresence>
        {showWishlistOptions && (
          <>
            <motion.div
              key="wishlist-options-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setShowWishlistOptions(false)}
            />
            <motion.div
              key="wishlist-options-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-[28px] bg-white px-5 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] shadow-2xl"
            >
              {/* Handle */}
              <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-slate-200" />

              <p className="mb-1 text-[17px] font-bold text-slate-900">
                {child?.first_name ? `${child.first_name}'s Wishlist` : "Wishlist"}
              </p>
              <p className="mb-5 text-sm text-slate-400">What would you like to do?</p>

              <div className="space-y-3">
                {/* View wishlist */}
                <button
                  type="button"
                  onClick={() => {
                    setShowWishlistOptions(false);
                    if (childWishlists.length > 0) {
                      // Navigate to the first (most recent) wishlist detail
                      window.dispatchEvent(new CustomEvent("navigate-within-app", {
                        detail: { page: "giftRegistryDetail", registryId: childWishlists[0].id }
                      }));
                    } else {
                      // No wishlists yet — scroll to the wishlists section on home tab
                      setActiveChildTab("home");
                    }
                  }}
                  className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition-all active:scale-[0.98]"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-100 flex-shrink-0">
                    <Heart size={20} className="text-violet-600 fill-violet-200" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">View Wishlist</p>
                    <p className="text-xs text-slate-400">
                      {childWishlistsLoading
                        ? "Loading…"
                        : childWishlists.length === 0
                          ? "No wishlists yet"
                          : `${childWishlists.length} wishlist${childWishlists.length > 1 ? "s" : ""}`}
                    </p>
                  </div>
                  <span className="text-slate-300 text-base">›</span>
                </button>

                {/* Create new wishlist */}
                <button
                  type="button"
                  onClick={() => {
                    setShowWishlistOptions(false);
                    setShowChildWishlistCreate(true);
                  }}
                  className="flex w-full items-center gap-4 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-4 text-left transition-all active:scale-[0.98]"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-600 flex-shrink-0">
                    <Plus size={20} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-violet-700">Create New Wishlist</p>
                    <p className="text-xs text-violet-400">Add items for friends & family to gift</p>
                  </div>
                  <span className="text-violet-300 text-base">›</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* -- Create Wishlist for child -- */}
      <GiftRegistryCreateSheet
        open={showChildWishlistCreate}
        onClose={() => setShowChildWishlistCreate(false)}
        preselectedChild={child}
        onSaved={() => {
          setShowChildWishlistCreate(false);
          // Re-trigger the wishlists fetch by toggling state
          setChildWishlists([]);
          setChildWishlistsLoading(true);
        }}
      />

      {/* -- Markets/Invest tab — conditionally rendered to reset state on close -- */}
      {activeChildTab === "markets" && (
        <div className="fixed inset-0 z-10 overflow-y-auto" style={{ background: "var(--bg, #0f0a1e)" }}>
          <Suspense fallback={<div style={{ background: "var(--bg, #0f0a1e)", height: "100%" }} />}>
            <MarketsPage
              childFilter={child}
              onBack={() => setActiveChildTab("home")}
              onOpenNotifications={() => {}}
              onOpenStockDetail={() => {}}
              onOpenNewsArticle={(id) => setChildNewsArticleId(id)}
              onOpenFactsheet={onOpenFactsheet}
              onViewModeChange={() => {}}
            />
          </Suspense>
          {!childNewsArticleId && (
            <Navbar
              activeTab="home"
              comingSoonTabs={[]}
              setActiveTab={(tab) => {
                if (tab === "news") setActiveChildTab("news");
                else if (tab === "more") setActiveChildTab("more");
                else if (tab === "investments") setActiveChildTab("portfolio");
                else setActiveChildTab("home");
              }}
            />
          )}
        </div>
      )}

      {/* -- News tab — pre-mounted, shown/hidden via display to avoid flicker -- */}
      <div
        className="fixed inset-0 z-10 overflow-y-auto"
        style={{ background: "var(--bg, #0f0a1e)", display: activeChildTab === "news" ? "block" : "none" }}
      >
        <Suspense fallback={<div style={{ background: "var(--bg, #0f0a1e)", height: "100%" }} />}>
          <MarketsPage
            initialViewMode="news"
            onBack={() => setActiveChildTab("home")}
            onOpenNotifications={() => {}}
            onOpenStockDetail={() => {}}
            onOpenNewsArticle={(id) => setChildNewsArticleId(id)}
            onOpenFactsheet={() => {}}
            onViewModeChange={() => {}}
          />
        </Suspense>
        {!childNewsArticleId && (
          <Navbar
            activeTab="news"
            comingSoonTabs={[]}
            setActiveTab={(tab) => {
              if (tab === "more") setActiveChildTab("more");
              else if (tab === "investments") setActiveChildTab("portfolio");
              else setActiveChildTab("home");
            }}
          />
        )}
      </div>

      {/* -- News article overlay -- */}
      {childNewsArticleId && (
        <div className="fixed inset-0 z-[1100] overflow-y-auto" style={{ background: "var(--bg, #0f0a1e)" }}>
          <Suspense fallback={<div style={{ background: "var(--bg, #0f0a1e)", height: "100%" }} />}>
            <NewsArticlePage
              articleId={childNewsArticleId}
              onBack={() => setChildNewsArticleId(null)}
            />
          </Suspense>
        </div>
      )}

      {/* -- More tab — pre-mounted, shown/hidden via display to avoid flicker -- */}
      <div
        className="fixed inset-0 z-10 overflow-y-auto"
        style={{ background: "var(--bg, #0f0a1e)", display: activeChildTab === "more" ? "block" : "none" }}
      >
        <Suspense fallback={<div style={{ background: "var(--bg, #0f0a1e)", height: "100%" }} />}>
          <MorePage onNavigate={onTabChange} onBeforeLogout={() => {}} />
        </Suspense>
        {!childNewsArticleId && (
          <Navbar
            activeTab="more"
            comingSoonTabs={[]}
            setActiveTab={(tab) => {
              if (tab === "news") setActiveChildTab("news");
              else if (tab === "investments") setActiveChildTab("portfolio");
              else setActiveChildTab("home");
            }}
          />
        )}
      </div>

      {/* -- Bottom Navigation Bar (shared Mint Navbar) -- */}
      {!childNewsArticleId && (
        <Navbar
          activeTab={activeChildTab === "news" ? "news" : activeChildTab === "more" ? "more" : activeChildTab === "portfolio" ? "investments" : "home"}
          comingSoonTabs={[]}
          setActiveTab={(tab) => {
            if (tab === "news") setActiveChildTab("news");
            else if (tab === "more") setActiveChildTab("more");
            else if (tab === "investments") setActiveChildTab("portfolio");
            else setActiveChildTab("home");
          }}
        />
      )}

      {/* -- Modals -- */}
      <AnimatePresence>
        {showTransfer && (
          <TransferModal
            child={child}
            parentBalance={parentBalance}
            balancesLoading={parentBalanceLoading}
            onTransfer={handleTransferDone}
            onClose={() => setShowTransfer(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showInvest && (
          <InvestModal
            child={child}
            onInvest={handleInvestDone}
            onClose={() => setShowInvest(false)}
            onOpenFactsheet={onOpenFactsheet}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {strategyDetailData && (
          <StrategyDetailModal
            data={strategyDetailData}
            onClose={() => setStrategyDetailId(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showAllTransactions && (
          <AllTransactionsModal
            transactions={transactions}
            childName={child?.first_name || "Child"}
            onClose={() => setShowAllTransactions(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCompleteModal && (
          <CompleteProfileModal
            child={child}
            parentProfile={profile}
            onUpdate={(updated) => setChild(updated)}
            onClose={() => setShowCompleteModal(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
      {showGoalsModal && (
        <>
          <motion.div
            key="goals-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[940] bg-black/50 backdrop-blur-sm"
            onClick={closeGoalsModal}
          />
          <motion.div
            key="goals-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-[950] mx-auto flex w-full max-w-md flex-col rounded-t-[28px] bg-white shadow-2xl"
            style={{ maxHeight: "85vh" }}
          >
            {/* Handle */}
            <div className="flex flex-shrink-0 items-center justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-slate-200" />
            </div>
            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between px-5 pt-2 pb-4">
              <h2 className="text-[17px] font-bold text-slate-900">
                {editingGoalId ? "Edit Goal" : (isCreatingGoal || goals.length === 0) ? "New Goal" : "Your Goals"}
              </h2>
              <button
                type="button"
                onClick={closeGoalsModal}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 active:bg-slate-200"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                {loadingGoals ? (
                  <div className="space-y-4">
                    {[0, 1].map((i) => (
                      <div key={i} className="rounded-2xl border border-slate-100 p-4 space-y-3">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                        <Skeleton className="h-2 w-full rounded-full" />
                      </div>
                    ))}
                  </div>
                ) : isCreatingGoal || editingGoalId || goals.length === 0 ? (
                  <form onSubmit={editingGoalId ? handleUpdateGoal : handleCreateGoal} className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Goal Name</label>
                      <input
                        id="child-goal-name"
                        name="child-goal-name"
                        type="text"
                        placeholder="e.g. New Car, Holiday"
                        value={newGoal.name}
                        onChange={(e) => setNewGoal(prev => ({ ...prev, name: e.target.value }))}
                        readOnly={isAdminPreview()}
                        className={`w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20${isAdminPreview() ? " pointer-events-none opacity-60" : ""}`}
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Target Amount (R)</label>
                      <input
                        id="child-goal-target"
                        name="child-goal-target"
                        type="number"
                        placeholder="0.00"
                        value={newGoal.target_amount}
                        onChange={(e) => setNewGoal(prev => ({ ...prev, target_amount: e.target.value }))}
                        readOnly={isAdminPreview()}
                        className={`w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20${isAdminPreview() ? " pointer-events-none opacity-60" : ""}`}
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400">Target Date (Optional)</label>
                      <input
                        id="child-goal-date"
                        name="child-goal-date"
                        type="date"
                        value={newGoal.target_date}
                        onChange={(e) => setNewGoal(prev => ({ ...prev, target_date: e.target.value }))}
                        readOnly={isAdminPreview()}
                        className={`w-full rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20${isAdminPreview() ? " pointer-events-none opacity-60" : ""}`}
                      />
                    </div>
                    <div className="flex flex-col gap-3 pt-2">
                      <button
                        type="submit"
                        disabled={loadingGoals || isAdminPreview()}
                        className={`w-full rounded-2xl bg-[#31005e] py-4 font-bold uppercase tracking-widest text-white shadow-lg transition-active active:scale-95${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
                      >
                        {editingGoalId ? "Update Goal" : "Save Goal"}
                      </button>
                      {editingGoalId && (
                        <button
                          type="button"
                          onClick={() => handleDeleteGoal(editingGoalId)}
                          disabled={isAdminPreview()}
                          className={`w-full rounded-2xl bg-rose-50 py-4 text-xs font-bold uppercase tracking-widest text-rose-600 transition-active active:scale-95${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
                        >
                          Delete Goal
                        </button>
                      )}
                      {goals.length > 0 && !editingGoalId && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreatingGoal(false);
                            setNewGoal({ name: "", target_amount: "", target_date: "" });
                          }}
                          className="w-full rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-600"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    {goals.map((goal) => {
                      const progress = goal.target_amount > 0
                        ? Math.min(100, ((goal.current_amount || 0) / goal.target_amount) * 100)
                        : 0;
                      const left = Math.max(0, (goal.target_amount || 0) - (goal.current_amount || 0));
                      return (
                        <div key={goal.id} className="group relative rounded-3xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:shadow-md">
                          <div className="mb-3 flex items-start justify-between">
                            <div>
                              <h3 className="font-bold text-slate-900">{goal.name}</h3>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Target: R{Number(goal.target_amount).toLocaleString()}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => { if (!isAdminPreview()) handleEditClick(goal); }}
                              disabled={isAdminPreview()}
                              className={`flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50 text-slate-400 hover:bg-violet-50 hover:text-violet-600${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
                            >
                              <FileSignature size={18} />
                            </button>
                          </div>
                          <div className="space-y-2">
                            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                              <span className="text-violet-600">{Math.round(progress)}% Complete</span>
                              <span className="text-slate-300">R{left.toLocaleString()} Left</span>
                            </div>
                            <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-violet-600 to-purple-500 rounded-full transition-all duration-1000"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setIsCreatingGoal(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 py-4 text-sm font-bold text-slate-400 transition-all hover:border-violet-300 hover:bg-violet-50 active:scale-95"
                    >
                      <Plus size={18} />
                      <span>Add New Goal</span>
                    </button>
                  </div>
                )}
            </div>
          </motion.div>
        </>
      )}
      </AnimatePresence>
    </div>
  );
}
