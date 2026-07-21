import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "../lib/supabase";
import {
  ArrowDownToLine,
  BadgeCheck,
  FileSignature,
  HandCoins,
  Landmark,
  Info,
  UserPlus,
  TrendingUp,
  ShieldCheck,
  Wallet,
  Send,
  MapPin,
  Receipt,
  Users,
  X,
  LayoutGrid,
  Gift,
  Target,
  Plus,
  Calendar,
  ChevronRight,
  Clock3,
} from "lucide-react";
import { useProfile } from "../lib/useProfile";
import { isAdminPreview } from "../lib/adminPreview";
import { useNotificationsContext } from "../lib/NotificationsContext.jsx";
import NavigationPill from "../components/NavigationPill";
import { useRequiredActions } from "../lib/useRequiredActions";
import { useUserStrategies } from "../lib/useUserStrategies";
import { useSumsubStatus } from "../lib/useSumsubStatus";
import { parseOnboardingFlags } from "../lib/checkOnboardingComplete";
import { useOnboardingStatus } from "../lib/useOnboardingStatus";
import { useFinancialData, useInvestments } from "../lib/useFinancialData";
import { useRealtimePrices } from "../lib/useRealtimePrices";
import { getHoldingsArray, normalizeSymbol, buildHoldingsBySymbol, getStrategyHoldingsSnapshot } from "../lib/strategyUtils";
import { registerCacheResetCallback } from "../lib/userCacheReset.js";
import Skeleton from "../components/Skeleton";
import SwipeableBalanceCard from "../components/SwipeableBalanceCard";
import OutstandingActionsSection from "../components/OutstandingActionsSection";
import TransactionHistorySection from "../components/TransactionHistorySection";
import SettlementBadge from "../components/PendingBadge";
import NotificationBell from "../components/NotificationBell";
import FamilyDropdown from "../components/FamilyDropdown";
import HomeSkeleton from "../components/HomeSkeleton";
import QuickActionsCarousel from "../components/QuickActionsCarousel";

// Feature flags — set VITE_ENABLE_INSURE=true in Replit Secrets to preview.
// Leave unset in Vercel production to keep the feature hidden from live users.
const INSURE_ENABLED = import.meta.env.VITE_ENABLE_INSURE === "true";

const CARD_VISIBILITY_KEY = "mintBalanceVisible";

// Cost basis per share in Rands. Prefers invested_amount from DB (actual rands
// deducted from wallet) divided by qty. Falls back to Expected_fill then avg_fill/100.
const costBasisRandsPerShare = (holding) => {
  const qty = Number(holding?.quantity || 0);
  const investedCents = Number(holding?.invested_amount || 0);
  if (investedCents > 0 && qty > 0) return investedCents / 100 / qty;
  const expected = Number(holding?.Expected_fill || 0);
  if (expected > 0) return expected;
  const avgFillCents = Number(holding?.avg_fill || 0);
  return avgFillCents > 0 ? avgFillCents / 100 : 0;
};

// Module-level caches to prevent section skeletons on remount
let _cachedBestAssets = [];
let _cachedBestStrategies = [];
let _cachedHasAnyHoldings = false;

registerCacheResetCallback(() => {
  _cachedBestAssets = [];
  _cachedBestStrategies = [];
  _cachedHasAnyHoldings = false;
});

// ── PendingSellsSection ──────────────────────────────────────────────────────
// Red counterpart to the (purple) pending-buy orders: lists holdings the user
// has requested to sell (trade_side='SELL', not yet exit-filled). Self-contained
// — fetches its own data so it doesn't disturb the buy-pending pipeline.
const PendingSellsSection = () => {
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) return;
        const { data: rows } = await supabase
          .from("stock_holdings_c")
          .select("id, strategy_id, security_id, quantity, market_value, avg_exit, expected_exit, trade_side, sell_requested_at, strategy_name_snapshot")
          .eq("user_id", uid).is("family_member_id", null)
          .eq("Status", "active").eq("trade_side", "SELL");
        const pending = (rows || []).filter((r) => !(Number(r.avg_exit) > 0));
        if (!pending.length) { if (!cancelled) setGroups([]); return; }
        const stratIds = [...new Set(pending.filter((r) => r.strategy_id).map((r) => r.strategy_id))];
        const secIds = [...new Set(pending.map((r) => r.security_id).filter(Boolean))];
        const [stratRes, secRes] = await Promise.all([
          stratIds.length ? supabase.from("strategies_c").select("id, name, short_name, icon_url").in("id", stratIds) : Promise.resolve({ data: [] }),
          secIds.length ? supabase.from("securities_c").select("id, symbol, name, logo_url").in("id", secIds) : Promise.resolve({ data: [] }),
        ]);
        const stratMeta = {}; (stratRes.data || []).forEach((s) => { stratMeta[s.id] = s; });
        const secMeta = {}; (secRes.data || []).forEach((s) => { secMeta[s.id] = s; });
        // Value at the expected exit (price the client saw × qty); fall back to
        // market_value only if expected_exit wasn't captured.
        const rowValueCents = (r) => (Number(r.expected_exit) > 0
          ? Number(r.expected_exit) * Number(r.quantity || 0)
          : Number(r.market_value || 0));
        const g = {};
        for (const r of pending) {
          const sm = secMeta[r.security_id] || {};
          if (r.strategy_id) {
            const k = `strat:${r.strategy_id}`;
            const m = stratMeta[r.strategy_id] || {};
            if (!g[k]) g[k] = { key: k, kind: "strategy", title: m.short_name || m.name || r.strategy_name_snapshot || "Strategy", valueCents: 0, assets: [] };
            g[k].valueCents += rowValueCents(r);
            g[k].assets.push({ logo: sm.logo_url || null, symbol: sm.symbol || "" });
          } else {
            g[`sec:${r.id}`] = { key: `sec:${r.id}`, kind: "security", title: sm.name || sm.symbol || "Asset", valueCents: rowValueCents(r), assets: [{ logo: sm.logo_url || null, symbol: sm.symbol || "" }] };
          }
        }
        if (!cancelled) setGroups(Object.values(g));
      } catch (e) { console.warn("[PendingSells] load failed:", e?.message || e); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!groups.length) return null;
  const fmtR = (c) => "R" + (Number(c || 0) / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <section className="pt-2 pb-3">
      <div className="flex items-end justify-between px-5 mb-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">Pending sells</p>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600"><Clock3 className="h-3 w-3" /></span>
            <span>Selling — proceeds land in your wallet once filled</span>
          </div>
        </div>
      </div>
      <div className="mx-4 space-y-3">
        {groups.map((grp) => (
          <div key={grp.key} className="relative overflow-hidden rounded-3xl p-4 text-white shadow-[0_10px_32px_-10px_rgba(159,18,57,0.45)]"
            style={{ background: "linear-gradient(135deg,#9f1239 0%,#dc2626 55%,#fb7185 100%)" }}>
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
            <div className="relative flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {grp.kind === "strategy" && grp.assets.length ? (
                  <div className="flex -space-x-2 flex-shrink-0">
                    {grp.assets.slice(0, 3).map((a, i) => (
                      <div key={i} className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 border-white/80 bg-white text-[8px] font-bold text-slate-600">
                        {a.logo ? <img src={a.logo} alt="" className="h-full w-full object-cover" /> : (a.symbol || "?").slice(0, 2).toUpperCase()}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/15 ring-1 ring-white/25 flex-shrink-0">
                    {grp.assets[0]?.logo ? <img src={grp.assets[0].logo} alt="" className="h-full w-full object-cover" /> : <Clock3 className="h-5 w-5 text-white" />}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{grp.title}</p>
                  <p className="text-[11px] text-white/70 mt-0.5">Selling · pending</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold">{fmtR(grp.valueCents)}</p>
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-white/25"><Clock3 className="h-2.5 w-2.5" />Pending</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

// ── StrategyStackedModal ─────────────────────────────────────────────────────
// Bottom-sheet modal showing each purchase batch as a stacked card.
// Click a card → it expands (height grows), other cards slide below.
// Click again → collapses. Pending batches use the purple gradient; filled
// batches use the white card style with PnL.

const StrategyStackedModal = ({ data, onClose }) => {
  const { strategy, batches, fmtBatchDate, holdingsSnapshot = [], pct = 0, livePriceMap = {} } = data;
  const [openIndex, setOpenIndex] = useState(null);

  // Per-batch cost from each batch's own holdings (this part is always reliable).
  // Per-batch value: apportion the strategy's total currentValue (the same trusted
  // number the collapsed card shows) by this batch's share of the total invested.
  // → batchValue = totalCurrentValue × (batchInvested / totalInvested)
  // PnL = batchValue − batchInvested (matches what the user expects).
  const totalInvestedRands = Number(strategy.investedAmount || 0);
  const totalCurrentValueRands = Number(strategy.currentValue || 0);

  const computeBatchStats = (batch) => {
    let costRands = 0;
    for (const h of batch.holdings) {
      const qty = Number(h.quantity || 0);
      costRands += costBasisRandsPerShare(h) * qty;
    }
    const share = totalInvestedRands > 0 ? costRands / totalInvestedRands : 0;
    const valueRands = totalCurrentValueRands * share;
    const pnlRands = valueRands - costRands;
    const pnlPct = costRands > 0 ? (pnlRands / costRands) * 100 : null;
    return { costRands, valueRands, pnlRands, pnlPct };
  };

  // Display newest-first
  const ordered = [...batches].reverse();

  const COLLAPSED_H = 88;
  const EXPANDED_H = 280;
  const STACK_OFFSET = 14;
  const STACK_SCALE = 0.045;

  const containerH = openIndex == null
    ? COLLAPSED_H + (ordered.length - 1) * STACK_OFFSET + 24
    : EXPANDED_H + (ordered.length - 1) * STACK_OFFSET + COLLAPSED_H + 24;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-t-3xl bg-white shadow-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        <div className="px-5 pt-2 pb-4 border-b border-slate-100">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Your purchases</p>
          <p className="text-[15px] font-bold text-slate-900">{strategy.name}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Tap a card to expand</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="relative" style={{ height: containerH, transition: "height 0.45s cubic-bezier(0.25,0.46,0.45,0.94)" }}>
            {ordered.map((batch, i) => {
              const isOpen = openIndex === i;
              const anyOpen = openIndex != null;
              const behindOpen = anyOpen && !isOpen && i > openIndex;
              const aboveOpen = anyOpen && !isOpen && i < openIndex;

              // Calculate top + scale
              let top, scale, zIndex, height;
              if (isOpen) {
                top = i * STACK_OFFSET;
                scale = 1;
                zIndex = 30;
                height = EXPANDED_H;
              } else if (anyOpen) {
                if (aboveOpen) {
                  // Above the expanded card — push to the top
                  top = i * STACK_OFFSET;
                  scale = 1 - (openIndex - i) * STACK_SCALE * 0.5;
                  zIndex = 20 - (openIndex - i);
                } else {
                  // Below the expanded card — slide down
                  const belowIndex = i - openIndex;
                  top = openIndex * STACK_OFFSET + EXPANDED_H + (belowIndex - 1) * STACK_OFFSET;
                  scale = 1 - (belowIndex - 1) * STACK_SCALE * 0.5;
                  zIndex = 20 - belowIndex;
                }
                height = COLLAPSED_H;
              } else {
                // All collapsed (stacked)
                top = i * STACK_OFFSET;
                scale = 1 - i * STACK_SCALE * 0.7;
                zIndex = ordered.length - i;
                height = COLLAPSED_H;
              }

              const isPending = !batch.filled;
              const dateStr = fmtBatchDate(batch);
              const stats = computeBatchStats(batch);

              return (
                <div
                  key={batch.minute + "_" + i}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top,
                    height,
                    transform: `scale(${scale})`,
                    transformOrigin: "top center",
                    zIndex,
                    cursor: "pointer",
                    overflow: "hidden",
                    borderRadius: 20,
                    transition: "all 0.45s cubic-bezier(0.34,1.56,0.64,1)",
                    boxShadow: isOpen ? "0 8px 32px rgba(0,0,0,0.12)" : "0 2px 8px rgba(0,0,0,0.05)",
                  }}
                >
                  {isPending ? (
                    <div className="w-full h-full p-4 text-white relative overflow-hidden"
                      style={{ background: "linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a855f7 100%)" }}>
                      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
                      <div className="relative flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 flex-shrink-0">
                            <Clock3 className="h-5 w-5 text-white" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold truncate">{strategy.name}</p>
                            <p className="text-[11px] text-white/70 mt-0.5">Purchase {ordered.length - i} · pending</p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {dateStr && <p className="text-[10px] text-white/60 mb-1">{dateStr}</p>}
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-white/25">
                            <Clock3 className="h-2.5 w-2.5" /> Pending
                          </span>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="relative mt-4 pt-4 border-t border-white/15 space-y-2">
                          <p className="text-[12px] text-white/80">Waiting for broker fills. Your portfolio total updates once each holding settles.</p>
                          <p className="text-[11px] text-white/60">{batch.holdings.length} holding{batch.holdings.length !== 1 ? "s" : ""} in this batch</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-full p-4 bg-white border border-slate-200">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 flex items-start justify-between gap-3">
                          <div className="text-left space-y-1 min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{strategy.name}</p>
                            <p className="text-xs text-slate-600 line-clamp-1">Purchase {ordered.length - i} · filled</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            {dateStr && <p className="text-[10px] text-slate-400 mb-0.5">{dateStr}</p>}
                            <p className="text-sm font-semibold text-slate-900">
                              R{stats.valueRands.toFixed(2)}
                            </p>
                            <p className="text-[10px] text-slate-400">Invested R{stats.costRands.toFixed(2)}</p>
                            {stats.pnlPct != null ? (
                              <p className={`text-xs font-semibold ${stats.pnlRands >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {stats.pnlRands >= 0 ? "+" : ""}R{Math.abs(stats.pnlRands).toFixed(2)} ({stats.pnlRands >= 0 ? "+" : ""}{stats.pnlPct.toFixed(2)}%)
                              </p>
                            ) : (
                              <p className="text-xs font-semibold text-slate-400">—</p>
                            )}
                          </div>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="mt-4 pt-3 border-t border-slate-100">
                          {holdingsSnapshot.length > 0 && (
                            <div className="flex items-center gap-2 mb-2">
                              <div className="flex -space-x-2">
                                {holdingsSnapshot.slice(0, 4).map((h) => (
                                  <div key={`${strategy.id}-${h.id || h.symbol}-mod`}
                                    className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow-sm">
                                    {h.logo_url
                                      ? <img src={h.logo_url} alt={h.name} className="h-full w-full object-cover" />
                                      : <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">{h.symbol?.substring(0, 2)}</div>}
                                  </div>
                                ))}
                                {holdingsSnapshot.length > 4 && (
                                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-500">
                                    +{holdingsSnapshot.length - 4}
                                  </div>
                                )}
                              </div>
                              <span className="text-[11px] text-slate-400">{batch.holdings.length} holding{batch.holdings.length !== 1 ? "s" : ""}</span>
                            </div>
                          )}
                          {strategy.risk_level && (
                            <span className="inline-block rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                              {strategy.risk_level}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── StockStackedModal ────────────────────────────────────────────────────────
// Same shape/animation as StrategyStackedModal, but for direct-stock purchases.
// Each raw stock_holdings_c row is a batch — multiple buys of the same security
// appear as separate cards so the user can see each purchase's avg_fill, value,
// and PnL independently.
const StockStackedModal = ({ data, onClose }) => {
  const { asset } = data;
  const [openIndex, setOpenIndex] = useState(null);

  const batches = Array.isArray(asset?.batches) ? asset.batches : [];
  const livePriceRands = Number(asset?.livePriceRands || 0);

  const fmtBatchDate = (b) => {
    if (!b?.created_at) return null;
    return new Date(b.created_at).toLocaleDateString("en-ZA", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  const computeBatchStats = (batch) => {
    const qty = Number(batch.quantity || 0);
    const costRands = costBasisRandsPerShare(batch) * qty;
    const valueRands = livePriceRands * qty;
    const pnlRands = valueRands - costRands;
    const pnlPct = costRands > 0 ? (pnlRands / costRands) * 100 : null;
    return { qty, costRands, valueRands, pnlRands, pnlPct };
  };

  // Newest-first display
  const ordered = [...batches].sort((a, b) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0;
    const db = b.created_at ? new Date(b.created_at).getTime() : 0;
    return db - da;
  });

  const COLLAPSED_H = 88;
  const EXPANDED_H = 220;
  const STACK_OFFSET = 14;
  const STACK_SCALE = 0.045;

  const containerH = openIndex == null
    ? COLLAPSED_H + (ordered.length - 1) * STACK_OFFSET + 24
    : EXPANDED_H + (ordered.length - 1) * STACK_OFFSET + COLLAPSED_H + 24;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-t-3xl bg-white shadow-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>
        <div className="px-5 pt-2 pb-4 border-b border-slate-100">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Your purchases</p>
          <p className="text-[15px] font-bold text-slate-900">{asset?.name || asset?.symbol}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Tap a card to expand</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="relative" style={{ height: containerH, transition: "height 0.45s cubic-bezier(0.25,0.46,0.45,0.94)" }}>
            {ordered.map((batch, i) => {
              const isOpen = openIndex === i;
              const anyOpen = openIndex != null;
              const aboveOpen = anyOpen && !isOpen && i < openIndex;

              let top, scale, zIndex, height;
              if (isOpen) {
                top = i * STACK_OFFSET;
                scale = 1;
                zIndex = 30;
                height = EXPANDED_H;
              } else if (anyOpen) {
                if (aboveOpen) {
                  top = i * STACK_OFFSET;
                  scale = 1 - (openIndex - i) * STACK_SCALE * 0.5;
                  zIndex = 20 - (openIndex - i);
                } else {
                  const belowIndex = i - openIndex;
                  top = openIndex * STACK_OFFSET + EXPANDED_H + (belowIndex - 1) * STACK_OFFSET;
                  scale = 1 - (belowIndex - 1) * STACK_SCALE * 0.5;
                  zIndex = 20 - belowIndex;
                }
                height = COLLAPSED_H;
              } else {
                top = i * STACK_OFFSET;
                scale = 1 - i * STACK_SCALE * 0.7;
                zIndex = ordered.length - i;
                height = COLLAPSED_H;
              }

              const avgFillCents = Number(batch.avg_fill || 0);
              const isPending = !avgFillCents;
              const dateStr = fmtBatchDate(batch);
              const stats = computeBatchStats(batch);

              return (
                <div
                  key={batch.id || `${batch.created_at}_${i}`}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top,
                    height,
                    transform: `scale(${scale})`,
                    transformOrigin: "top center",
                    zIndex,
                    cursor: "pointer",
                    overflow: "hidden",
                    borderRadius: 20,
                    transition: "all 0.45s cubic-bezier(0.34,1.56,0.64,1)",
                    boxShadow: isOpen ? "0 8px 32px rgba(0,0,0,0.12)" : "0 2px 8px rgba(0,0,0,0.05)",
                  }}
                >
                  {isPending ? (
                    <div className="w-full h-full p-4 text-white relative overflow-hidden"
                      style={{ background: "linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a855f7 100%)" }}>
                      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
                      <div className="relative flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 flex-shrink-0">
                            <Clock3 className="h-5 w-5 text-white" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold truncate">{asset?.symbol}</p>
                            <p className="text-[11px] text-white/70 mt-0.5">Purchase {ordered.length - i} · pending</p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {dateStr && <p className="text-[10px] text-white/60 mb-1">{dateStr}</p>}
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-white/25">
                            <Clock3 className="h-2.5 w-2.5" /> Pending
                          </span>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="relative mt-4 pt-4 border-t border-white/15 space-y-1">
                          <p className="text-[12px] text-white/80">Waiting for broker fill — avg fill price will be set on settlement.</p>
                          <p className="text-[11px] text-white/60">Ordered {stats.qty} share{stats.qty !== 1 ? "s" : ""}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-full p-4 bg-white border border-slate-200">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 flex items-start justify-between gap-3">
                          <div className="text-left space-y-1 min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{asset?.symbol}</p>
                            <p className="text-xs text-slate-600 line-clamp-1">Purchase {ordered.length - i} · filled</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            {dateStr && <p className="text-[10px] text-slate-400 mb-0.5">{dateStr}</p>}
                            <p className="text-sm font-semibold text-slate-900">R{stats.valueRands.toFixed(2)}</p>
                            <p className="text-[10px] text-slate-400">Invested R{stats.costRands.toFixed(2)}</p>
                            {stats.pnlPct != null ? (
                              <p className={`text-xs font-semibold ${stats.pnlRands >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {stats.pnlRands >= 0 ? "+" : ""}R{Math.abs(stats.pnlRands).toFixed(2)} ({stats.pnlRands >= 0 ? "+" : ""}{stats.pnlPct.toFixed(2)}%)
                              </p>
                            ) : (
                              <p className="text-xs font-semibold text-slate-400">—</p>
                            )}
                          </div>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="mt-4 pt-3 border-t border-slate-100 space-y-1">
                          <p className="text-[11px] text-slate-500">
                            {stats.qty} share{stats.qty !== 1 ? "s" : ""} @ R{(avgFillCents / 100).toFixed(2)} avg fill
                          </p>
                          <p className="text-[11px] text-slate-400">Live price R{livePriceRands.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const HomePage = ({
  onOpenNotifications,
  onOpenMintBalance,
  onOpenActivity,
  onOpenActions,
  onOpenInstantLiquidity,
  onOpenInvestments,
  onOpenCredit,
  onOpenCreditApply,
  onOpenCreditRepay,
  onOpenInvest,
  onOpenWithdraw,
  onOpenSettings,
  onOpenStrategies,
  onOpenStrategyInPortfolio,
  onOpenMarkets,
  onOpenDeposit,
  onOpenNews,
  onOpenNewsArticle,
  onOpenFamily,
  onOpenInsure,
  onSelectMember,
  onOpenGiftClaim,
  onNavigate,
}) => {
  const { profile, loading } = useProfile();
  const { bankLinked, loading: actionsLoading, refetch: fetchRequiredActions } = useRequiredActions();
  const { strategies: hookStrategies } = useUserStrategies();
  const { kycVerified, kycPending, kycNeedsResubmission } = useSumsubStatus();
  const { balance, investments, transactions, bestAssets, loading: financialLoading, refetch: fetchFinancialData } = useFinancialData();
  const { monthlyChangePercent } = useInvestments();
  const { lastUpdated: pricesLastUpdated } = useRealtimePrices();
  const [bestStrategies, setBestStrategies] = useState(() => _cachedBestStrategies);
  const [holdingsSecurities, setHoldingsSecurities] = useState([]);
  const [rawStrategyHoldings, setRawStrategyHoldings] = useState([]);
  const [hasDirectAssets, setHasDirectAssets] = useState(false);
  const [strategySkeletonHold, setStrategySkeletonHold] = useState(true);

  // Show the strategies skeleton for at least the first 5 seconds on page open,
  // so users always get a smooth loading state even on slow renders.
  useEffect(() => {
    const t = setTimeout(() => setStrategySkeletonHold(false), 5000);
    return () => clearTimeout(t);
  }, []);
  const [failedLogos, setFailedLogos] = useState({});
  const [expandedPendingKey, setExpandedPendingKey] = useState(null);
  const [expandedStratStack, setExpandedStratStack] = useState(null);
  const [expandedStockStack, setExpandedStockStack] = useState(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [news, setNews] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [loadingNews, setLoadingNews] = useState(false);
  const [homeTab, setHomeTab] = useState("balance");
  const [showGiftingIntro, setShowGiftingIntro] = useState(false);
  const [giftingIntroSeen, setGiftingIntroSeen] = useState(() => !!localStorage.getItem('mint_gifting_intro_seen'));
  const [userId, setUserId] = useState(null);
  const [pendingGiftId, setPendingGiftId] = useState(() => localStorage.getItem('mint_pending_gift_id'));
  const [pendingGiftExpiry, setPendingGiftExpiry] = useState(() => localStorage.getItem('mint_pending_gift_expires'));
  const [giftCountdown, setGiftCountdown] = useState(null);
  const { notifications: _homeNotifs, markAsRead: _markGiftNotifRead } = useNotificationsContext();
  const [_pendingGiftNotifId, _setPendingGiftNotifId] = useState(null);

  function _fmtGiftCountdown(expiresAt) {
    const ms = new Date(expiresAt) - Date.now();
    if (ms <= 0) return null;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${String(s).padStart(2, '0')}s`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }

  useEffect(() => {
    const alreadyClaimed = localStorage.getItem('mint_gift_claimed');
    const giftNotif = _homeNotifs.find(n => !n.read_at && n.payload?.action === 'gift_received');
    if (giftNotif) {
      const giftId = giftNotif.payload?.gift_id;
      if (giftId && giftId === alreadyClaimed) {
        // This specific gift was already claimed — hide and mark notification read
        _markGiftNotifRead(giftNotif.id);
        localStorage.removeItem('mint_pending_gift_id');
        localStorage.removeItem('mint_pending_gift_expires');
        setPendingGiftId(null);
      } else if (giftId) {
        // New unclaimed gift — show the banner
        localStorage.setItem('mint_pending_gift_id', giftId);
        setPendingGiftId(giftId);
        _setPendingGiftNotifId(giftNotif.id);
      }
    } else if (!localStorage.getItem('mint_pending_gift_id')) {
      setPendingGiftId(null);
    }
  }, [_homeNotifs]);

  // Fetch expires_at for the pending gift and store in localStorage
  useEffect(() => {
    if (!pendingGiftId) { setPendingGiftExpiry(null); return; }
    const stored = localStorage.getItem('mint_pending_gift_expires');
    if (stored && localStorage.getItem('mint_gift_claimed') === pendingGiftId) { setPendingGiftExpiry(stored); return; }
    if (stored) setPendingGiftExpiry(stored);
    fetch(`/api/gift/by-id/${pendingGiftId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) {
          localStorage.removeItem('mint_pending_gift_id');
          localStorage.removeItem('mint_pending_gift_expires');
          setPendingGiftId(null);
          setPendingGiftExpiry(null);
          return;
        }
        if (['claimed', 'completed', 'expired', 'cancelled'].includes(data.status)) {
          localStorage.removeItem('mint_pending_gift_id');
          localStorage.removeItem('mint_pending_gift_expires');
          if (data.status === 'claimed' || data.status === 'completed') {
            localStorage.setItem('mint_gift_claimed', pendingGiftId);
          }
          setPendingGiftId(null);
          setPendingGiftExpiry(null);
          return;
        }
        if (data.expires_at) {
          localStorage.setItem('mint_pending_gift_expires', data.expires_at);
          setPendingGiftExpiry(data.expires_at);
        }
      })
      .catch(() => {});
  }, [pendingGiftId]);

  // Countdown ticker
  useEffect(() => {
    if (!pendingGiftExpiry) return;
    const tick = () => {
      const label = _fmtGiftCountdown(pendingGiftExpiry);
      if (!label) {
        localStorage.removeItem('mint_pending_gift_id');
        localStorage.removeItem('mint_pending_gift_expires');
        setPendingGiftId(null);
        setPendingGiftExpiry(null);
        setGiftCountdown(null);
      } else {
        setGiftCountdown(label);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pendingGiftExpiry]);

  const [localBestAssets, setLocalBestAssets] = useState(() => _cachedBestAssets);
  const [hasAnyHoldings, setHasAnyHoldings] = useState(() => _cachedHasAnyHoldings);
  const [loadingBestAssets, setLoadingBestAssets] = useState(() => _cachedBestAssets.length === 0);
  const [loadingBestStrategies, setLoadingBestStrategies] = useState(() => _cachedBestStrategies.length === 0);
  const { onboardingComplete, loading: onboardingLoading, refetch: fetchOnboardingStatus } = useOnboardingStatus();
  const onboardingChecked = !onboardingLoading;

  const [isCardVisible] = useState(() => {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(CARD_VISIBILITY_KEY) !== "false";
    }
    return true;
  });

  // Re-render trigger for coach-tour simulated pending order
  const [coachSimTick, setCoachSimTick] = useState(0);
  useEffect(() => {
    const handler = () => setCoachSimTick(t => t + 1);
    window.addEventListener('mint-coach-sim-update', handler);
    return () => window.removeEventListener('mint-coach-sim-update', handler);
  }, []);

  // Auto-scroll to pending section when sim activates via event
  useEffect(() => {
    if (coachSimTick === 0) return;
    const simName = sessionStorage.getItem('mint_coach_pending_sim');
    console.log('[HomePage] coachSimTick changed =', coachSimTick, 'simName=', simName);
    if (!simName) return;
    setTimeout(() => {
      const el = document.querySelector('[data-coach-pending-orders="true"]');
      console.log('[HomePage] scroll target el=', el);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 300);
  }, [coachSimTick]);

  const [showGoalsModal, setShowGoalsModal] = useState(false);
  const [goals, setGoals] = useState([]);
  const [loadingGoals, setLoadingGoals] = useState(false);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [newGoal, setNewGoal] = useState({ name: "", target_amount: "", target_date: "" });
  const [editingGoalId, setEditingGoalId] = useState(null);

  const assetsToDisplay = localBestAssets.length > 0 ? localBestAssets : (bestAssets || []);
  const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const fetchBestAssets = React.useCallback(async () => {
    if (!profile?.id) return;
    setLoadingBestAssets(true);
    try {
      const { data: holdings, error: holdingsError } = await supabase
        .from('stock_holdings_c')
        .select('id, family_member_id, security_id, strategy_id, quantity, avg_fill, Expected_fill, market_value, unrealized_pnl, Status, created_at, transaction_id, rebalance_batch_id')
        .eq('user_id', profile.id)
        .is('family_member_id', null)
        .eq('Status', 'active');

      if (holdingsError) throw holdingsError;

      const directHoldings = (holdings || []).filter(h => !h.strategy_id && h.security_id);
      const strategyHoldings = (holdings || []).filter(h => h.strategy_id);
      setRawStrategyHoldings(strategyHoldings);
      setHasDirectAssets(directHoldings.length > 0);

      if (holdings && holdings.length > 0) { _cachedHasAnyHoldings = true; setHasAnyHoldings(true); }

      if (directHoldings.length > 0) {
        const holdings = directHoldings;
        const securityIds = [...new Set(holdings.map(h => h.security_id).filter(Boolean))];
        let securitiesMap = {};
        if (securityIds.length > 0) {
          const [{ data: secData }, { data: intradayData }] = await Promise.all([
            supabase.from('securities_c').select('id, symbol, name, logo_url, last_price, change_percent').in('id', securityIds),
            supabase.from('stock_intraday_c').select('security_id, current_price, 1d_pct, timestamp').in('security_id', securityIds).order('timestamp', { ascending: false }),
          ]);
          // Build intraday map — latest row per security (current_price in cents)
          const intradayMap = {};
          (intradayData || []).forEach(p => { if (!intradayMap[p.security_id]) intradayMap[p.security_id] = p; });
          (secData || []).forEach(s => {
            const intraday = intradayMap[s.id];
            securitiesMap[s.id] = {
              ...s,
              live_price_cents: intraday?.current_price > 0 ? Number(intraday.current_price) : 0,
              change_percent: intraday?.['1d_pct'] != null ? Number(intraday['1d_pct']) : 0,
            };
          });
        }

        // Group raw rows by security_id — each entry below represents one
        // logical position (= one card in the carousel). Multiple raw rows
        // become the entry's `batches` so the stacked-card UI can render
        // them as separate purchase events, mirroring strategies.
        const rowsBySecurity = new Map();
        for (const h of holdings) {
          if (!securitiesMap[h.security_id]) continue;
          if (!rowsBySecurity.has(h.security_id)) rowsBySecurity.set(h.security_id, []);
          rowsBySecurity.get(h.security_id).push(h);
        }

        const formatted = Array.from(rowsBySecurity.entries()).map(([secId, batches]) => {
          const sec = securitiesMap[secId];
          // last_price in securities_c is stored in CENTS; live_price_cents from intraday is also cents.
          const livePriceCents = sec.live_price_cents > 0 ? sec.live_price_cents : Number(sec.last_price || 0);
          const livePriceRands = livePriceCents / 100;

          // Aggregate across batches: filled-only quantity drives liveValue/PnL,
          // while pending batches contribute to hasPendingBatch (badge).
          // Cost basis prefers Expected_fill (client's quoted price) over
          // avg_fill (broker fill) — keeps the company spread out of client PnL.
          let filledQty = 0;
          let pendingQty = 0;
          let weightedCostRandsSum = 0;
          for (const b of batches) {
            const qty = Number(b.quantity || 0);
            const avgFill = Number(b.avg_fill || 0);
            if (avgFill > 0) {
              filledQty += qty;
              weightedCostRandsSum += costBasisRandsPerShare(b) * qty;
            } else {
              pendingQty += qty;
            }
          }
          const marketVal = (livePriceCents * filledQty) / 100;
          const costBasis = weightedCostRandsSum;
          const pnlRands = marketVal - costBasis;
          const pnlPct = costBasis > 0 ? (pnlRands / costBasis) * 100 : 0;
          const isPending = filledQty === 0;
          const hasPendingBatch = pendingQty > 0;

          return {
            securityId: secId,
            symbol: sec.symbol,
            name: sec.name,
            logo: sec.logo_url,
            livePriceRands,
            value: marketVal,
            change: Number(sec.change_percent) || 0,
            pnlRands: isPending ? 0 : pnlRands,
            pnlPct: isPending ? 0 : pnlPct,
            isPending,
            hasPendingBatch,
            filledQty,
            pendingQty,
            batches,
          };
        });

        const profitable = formatted.filter(a => !a.isPending && a.pnlPct > 0).sort((a, b) => b.pnlPct - a.pnlPct);
        const pending = formatted.filter(a => a.isPending);
        // Rank profitable assets first so they dominate the "best performing assets"
        // carousel (capped at 5 there). Then always retain any asset that has a
        // pending batch — including partial fills that didn't make the top 5 — so
        // the Pending orders section can surface them. Fully-pending ones last.
        const carousel = profitable.slice(0, 5);
        const extraPending = formatted.filter(a => a.hasPendingBatch && !carousel.includes(a) && !pending.includes(a));
        const sorted = [...carousel, ...extraPending, ...pending];
        _cachedBestAssets = sorted;
        setLocalBestAssets(sorted);
        return;
      }

      // No direct holdings — rank the underlying securities inside the user's strategy investments.
      if (strategyHoldings.length > 0) {
        const securityIds = [...new Set(strategyHoldings.map(h => h.security_id).filter(Boolean))];
        if (securityIds.length > 0) {
          const [{ data: secData }, { data: intradayData }] = await Promise.all([
            supabase.from('securities_c').select('id, symbol, name, logo_url, last_price, change_percent').in('id', securityIds),
            supabase.from('stock_intraday_c').select('security_id, current_price, 1d_pct, timestamp').in('security_id', securityIds).order('timestamp', { ascending: false }),
          ]);
          const intradayMap = {};
          (intradayData || []).forEach(p => { if (!intradayMap[p.security_id]) intradayMap[p.security_id] = p; });
          const secMap = Object.fromEntries((secData || []).map(s => {
            const intraday = intradayMap[s.id];
            return [s.id, {
              ...s,
              live_price_cents: intraday?.current_price > 0 ? Number(intraday.current_price) : 0,
              change_percent: intraday?.['1d_pct'] != null ? Number(intraday['1d_pct']) : 0,
            }];
          }));

          const formatted = strategyHoldings
            .filter(h => secMap[h.security_id])
            .map(h => {
              const sec = secMap[h.security_id];
              const qty = Number(h.quantity || 0);
              const avgFill = Number(h.avg_fill || 0);
              const costBasisPerShareRands = costBasisRandsPerShare(h);
              // last_price in securities_c is in CENTS; use live_price_cents (intraday) first.
              const livePriceCents = sec.live_price_cents > 0
                ? sec.live_price_cents
                : (sec.last_price != null ? Number(sec.last_price) : Math.round(costBasisPerShareRands * 100));
              const marketVal = (livePriceCents * qty) / 100;
              const costBasis = costBasisPerShareRands * qty;
              const pnlRands = marketVal - costBasis;
              const pnlPct = costBasis > 0 ? ((pnlRands / costBasis) * 100) : 0;
              return {
                symbol: sec.symbol,
                name: sec.name,
                logo: sec.logo_url,
                value: marketVal,
                change: Number(sec.change_percent) || 0,
                pnlRands,
                pnlPct,
                isPending: !avgFill,
              };
            });

          const profitable = formatted.filter(a => !a.isPending && a.pnlPct > 0).sort((a, b) => b.pnlPct - a.pnlPct);
          const ranked = profitable.slice(0, 5);
          if (ranked.length > 0) {
            _cachedBestAssets = ranked;
            setLocalBestAssets(ranked);
            return;
          }
        }
      }

      // allocations table removed — skip this fallback gracefully
    } catch (e) {
      console.error("Asset fetch error:", e.message);
    } finally {
      setLoadingBestAssets(false);
    }
  }, [profile?.id]);

  const fetchGoals = React.useCallback(async () => {
    if (!profile?.id) return;
    setLoadingGoals(true);
    try {
      let { data, error } = await supabase
        .from('investment_goals')
        .select('id, name, target_amount, current_amount, is_active, target_date')
        .eq('user_id', profile.id)
        .is('family_member_id', null)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error && (error.code === "42703" || String(error.message || "").includes("family_member_id"))) {
        const fallback = await supabase
          .from('investment_goals')
          .select('id, name, target_amount, current_amount, is_active, target_date')
          .eq('user_id', profile.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false });
        data = fallback.data;
        error = fallback.error;
      }

      if (error) throw error;
      setGoals(data || []);
    } catch (e) {
      console.error("Goal fetch error:", e.message);
    } finally {
      setLoadingGoals(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) setUserId(session.user.id);
    };
    getUser();
  }, []);

  useEffect(() => {
    if (!profile?.id || profile?.mintNumber) return;

    const ensureMintNumber = async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess?.session?.access_token;
        if (!token) return;

        const resp = await fetch('/api/user/ensure-mint-number', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const result = await resp.json();
        }
      } catch (err) { }
    };
    ensureMintNumber();
  }, [profile?.id, profile?.mintNumber]);

  useEffect(() => {
    if (!profile?.id) return;

    const homeSubscription = supabase
      .channel('home_realtime_updates')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'investment_goals',
        filter: `user_id=eq.${profile.id}`
      }, () => fetchGoals())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'transactions',
        filter: `user_id=eq.${profile.id}`
      }, () => {
        fetchBestAssets();
        if (typeof fetchFinancialData === 'function') fetchFinancialData();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'required_actions',
        filter: `user_id=eq.${profile.id}`
      }, () => {
        if (typeof fetchRequiredActions === 'function') fetchRequiredActions();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_onboarding',
        filter: `user_id=eq.${profile.id}`
      }, () => {
        fetchOnboardingStatus();
      })
      .subscribe();

    fetchBestAssets();
    fetchGoals();

    return () => {
      supabase.removeChannel(homeSubscription);
    };
  }, [profile?.id, fetchBestAssets, fetchGoals, fetchFinancialData, fetchRequiredActions, fetchOnboardingStatus]);

  const priceDebounceRef = useRef(null);
  useEffect(() => {
    if (pricesLastUpdated && profile?.id) {
      clearTimeout(priceDebounceRef.current);
      priceDebounceRef.current = setTimeout(() => {
        fetchBestAssets();
        if (typeof fetchFinancialData === 'function') fetchFinancialData();
      }, 800);
    }
    return () => clearTimeout(priceDebounceRef.current);
  }, [pricesLastUpdated]);

  useEffect(() => {
    if (showGoalsModal && profile?.id) {
      fetchGoals();
    }
  }, [showGoalsModal, profile?.id, fetchGoals]);

  useEffect(() => {
    // isRefresh=true → silent update (no loading spinner, keeps existing data visible)
    const fetchStrategies = async (isRefresh = false) => {
      try {
        if (!profile?.id) return;
        if (!isRefresh) setLoadingBestStrategies(true);

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          if (!isRefresh) setBestStrategies([]);
          return;
        }

        const res = await fetch("/api/user/strategies", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          console.error("[HomePage] Failed to fetch user strategies:", res.status);
          if (!isRefresh) setBestStrategies([]);
          return;
        }

        const json = await res.json();
        const serverStrategies = json.strategies || [];

        if (serverStrategies.length === 0) {
          setBestStrategies([]);
          return;
        }

        const formatted = serverStrategies
          .map((s) => {
          const holdingsInvested = (s.holdings || [])
            .filter(h => Number(h.avg_fill || 0) > 0)
            .reduce((sum, h) => sum + Number(h.invested_amount || 0) / 100, 0);
          const invested = holdingsInvested > 0 ? holdingsInvested : (Number(s.investedAmount) || 0);
          const rawCurrent = s.currentMarketValue;
          const currentValue = rawCurrent != null && Number.isFinite(Number(rawCurrent))
            ? Number(Number(rawCurrent).toFixed(2))
            : invested;
          const isPending = s.isPending === true || (invested === 0 && currentValue === 0);
          // Live holdings-based P&L (matches the portfolio card + CRM). NOT the
          // EOD client_strategy_returns_c ytd_pnl, which lags live intraday prices
          // and made this card disagree with everything else.
          const stratPnlRands = currentValue - invested;
          const stratPnlPct = invested > 0 ? ((currentValue - invested) / invested) * 100 : 0;
          const changePctVal = stratPnlPct;
          return {
            id: s.id,
            purchaseKey: s.purchaseKey || s.id,
            purchaseRef: s.purchaseRef || null,
            firstInvestedDate: s.firstInvestedDate || null,
            name: s.name,
            short_name: s.shortName,
            description: s.description,
            risk_level: s.riskLevel,
            sector: s.sector,
            icon_url: s.iconUrl,
            image_url: s.imageUrl,
            holdings: s.holdings || [],
            investedAmount: invested,
            currentValue,
            isPending,
            change_pct: changePctVal,
            pnlRands: stratPnlRands,
            pnlPct: changePctVal,
            strategy_metrics: s.metrics ? [s.metrics] : [],
          };
        });

        // Deduplicate by id — server can return multiple rows for the same
        // strategy (e.g. a re-buy on top of filled holdings).  When one entry
        // is pending and another is filled, merge them into a single
        // hasPendingBatch entry so the pending section shows the new batch
        // while the strategies carousel hides it until it's settled.
        const stratMap = new Map();
        for (const s of formatted) {
          if (stratMap.has(s.id)) {
            const existing = stratMap.get(s.id);
            if (s.isPending && !existing.isPending) {
              // existing is filled, s is the new pending batch → flag mixed
              existing.hasPendingBatch = true;
            } else if (!s.isPending && existing.isPending) {
              // existing was marked pending but s has filled data → keep filled values
              existing.isPending = false;
              existing.hasPendingBatch = true;
              existing.investedAmount = s.investedAmount || existing.investedAmount;
              existing.currentValue = s.currentValue || existing.currentValue;
              existing.change_pct = s.change_pct;
              existing.pnlRands = s.pnlRands;
              existing.pnlPct = s.pnlPct;
            }
            // Otherwise both are the same state — ignore the duplicate
          } else {
            stratMap.set(s.id, { ...s });
          }
        }
        const deduped = [...stratMap.values()];

        const sorted = deduped
          .sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0))
          .slice(0, 5);
        _cachedBestStrategies = sorted;
        setBestStrategies(sorted);
      } catch (error) {
        console.error("Failed to load strategies", error);
        if (!isRefresh) setBestStrategies((prev) => prev.length > 0 ? prev : []);
      } finally {
        if (!isRefresh) setLoadingBestStrategies(false);
      }
    };

    fetchStrategies();
    // Poll every 15 seconds (in sync with intraday price updates) — silent refresh, no spinner
    const pollInterval = setInterval(() => fetchStrategies(true), 15000);
    return () => clearInterval(pollInterval);
  }, [profile?.id]);

  const holdingsBySymbol = useMemo(() => buildHoldingsBySymbol(holdingsSecurities), [holdingsSecurities]);

  // Live price map (security_id → last_price in Rands) for per-batch value calculations.
  const livePriceMap = useMemo(() => {
    const map = {};
    for (const sec of (holdingsSecurities || [])) {
      if (sec?.id && sec?.last_price != null) {
        map[sec.id] = Number(sec.last_price);
      }
    }
    return map;
  }, [holdingsSecurities]);

  // Group strategy holdings into purchase batches (one batch per order).
  // Primary key: store_reference (authoritative per-order id stamped on each
  // holdings row by the buy endpoints). Falls back to created_at-minute for
  // legacy rows written before the store_reference column existed.
  // Each batch is fully filled (all have avg_fill) or fully pending (none do).
  const purchaseBatchesByStrategy = useMemo(() => {
    const rows = (rawStrategyHoldings || []).filter((h) => h.strategy_id);

    // A rebalance is a position swap, NOT a new purchase. Rebalance-created
    // holdings (rebalance_batch_id set) carry no transaction_id, so they'd land
    // in their own batch and show the strategy as "2 purchases / 2x". Instead,
    // merge them into the strategy's earliest ORIGINAL purchase batch (the anchor)
    // so a rebalanced strategy still reads as one purchase.
    const anchorByStrategy = {};
    for (const h of rows) {
      if (h.rebalance_batch_id) continue; // rebalance rows can't be the anchor
      const minute = h.created_at ? new Date(h.created_at).toISOString().slice(0, 16) : "unknown";
      const batchId = h.transaction_id || `legacy:${minute}`;
      const cur = anchorByStrategy[h.strategy_id];
      if (!cur || minute < cur.minute) {
        anchorByStrategy[h.strategy_id] = { batchId, minute, transactionId: h.transaction_id || null };
      }
    }

    const out = {};
    for (const h of rows) {
      const minute = h.created_at ? new Date(h.created_at).toISOString().slice(0, 16) : "unknown";
      const anchor = anchorByStrategy[h.strategy_id];
      let batchId, txnId, batchMinute;
      if (h.rebalance_batch_id && anchor) {
        // Fold the rebalance holding into the original purchase batch.
        batchId = anchor.batchId; txnId = anchor.transactionId; batchMinute = anchor.minute;
      } else {
        batchId = h.transaction_id || `legacy:${minute}`; txnId = h.transaction_id || null; batchMinute = minute;
      }
      const key = `${h.strategy_id}__${batchId}`;
      if (!out[h.strategy_id]) out[h.strategy_id] = {};
      if (!out[h.strategy_id][key]) {
        out[h.strategy_id][key] = {
          strategyId: h.strategy_id,
          transactionId: txnId,
          minute: batchMinute,
          holdings: [],
          filled: true,
        };
      }
      out[h.strategy_id][key].holdings.push(h);
      // If any holding in batch is unfilled, mark batch as not filled
      if (!h.avg_fill || Number(h.avg_fill) === 0) out[h.strategy_id][key].filled = false;
    }
    // Convert to array of batches per strategy, sorted oldest→newest
    const result = {};
    for (const [stratId, batchMap] of Object.entries(out)) {
      result[stratId] = Object.values(batchMap).sort((a, b) => (a.minute < b.minute ? -1 : 1));
    }
    return result;
  }, [rawStrategyHoldings]);

  useEffect(() => {
    const fetchHoldingsSecurities = async () => {
      if (!supabase || bestStrategies.length === 0) return;

      try {
        const allTickers = [...new Set(
          bestStrategies.flatMap((strategy) =>
            getHoldingsArray(strategy).flatMap((h) => {
              const rawSymbol = h.ticker || h.symbol || h;
              const normalizedSym = normalizeSymbol(rawSymbol);
              return normalizedSym && normalizedSym !== rawSymbol
                ? [rawSymbol, normalizedSym]
                : [rawSymbol];
            })
          )
        )];

        if (allTickers.length === 0) return;

        const chunkSize = 50;
        const chunks = [];
        for (let i = 0; i < allTickers.length; i += chunkSize) {
          chunks.push(allTickers.slice(i, i + chunkSize));
        }

        const results = await Promise.all(
          chunks.map((symbols) =>
            supabase
              .from("securities_c")
              .select("id, symbol, logo_url, name")
              .in("symbol", symbols)
          )
        );

        const merged = [];
        results.forEach(({ data, error }) => {
          if (error) {
            console.error("Error fetching holdings securities chunk:", error);
            return;
          }
          if (data?.length) merged.push(...data);
        });

        if (merged.length) {
          setHoldingsSecurities(merged);
        }
      } catch (error) {
        console.error("Error fetching holdings securities:", error);
      }
    };

    fetchHoldingsSecurities();
  }, [bestStrategies]);

  useEffect(() => {
    const fetchNews = async () => {
      setLoadingNews(true);
      try {
        const { data, error } = await supabase
          .from('News_articles')
          .select('id, title, source, published_at, body_text')
          .order('published_at', { ascending: false })
          .limit(3);
        if (error) throw error;
        setNews(data || []);
      } catch (err) {
        console.error("News error:", err.message);
      } finally {
        setLoadingNews(false);
      }
    };
    fetchNews();
  }, []);

  const handleEditClick = (goal) => {
    setNewGoal({
      name: goal.name,
      target_amount: goal.target_amount,
      target_date: goal.target_date || ""
    });
    setEditingGoalId(goal.id);
    setIsCreatingGoal(true);
    setShowGoalsModal(true);
  };

  const handleUpdateGoal = async (e) => {
    e.preventDefault();
    if (!editingGoalId) return;
    setLoadingGoals(true);
    try {
      const updatePayload = {
        name: newGoal.name,
        target_amount: parseFloat(newGoal.target_amount),
      };
      if (newGoal.target_date) {
        updatePayload.target_date = newGoal.target_date;
      }
      const { error } = await supabase
        .from('investment_goals')
        .update(updatePayload)
        .eq('id', editingGoalId);
      if (error) throw error;
      setEditingGoalId(null);
      setIsCreatingGoal(false);
      setNewGoal({ name: "", target_amount: "", target_date: "" });
      fetchGoals();
    } catch (error) { console.error("Update error:", error.message); }
    finally { setLoadingGoals(false); }
  };

  const handleCreateGoal = async (e) => {
    e.preventDefault();
    if (!newGoal.name || !newGoal.target_amount) return;

    setLoadingGoals(true);
    try {
      const { error } = await supabase.from('investment_goals').insert({
        user_id: profile.id,
        name: newGoal.name,
        target_amount: parseFloat(newGoal.target_amount),
        target_date: newGoal.target_date || null,
        current_amount: 0
      });

      if (error) throw error;

      setNewGoal({ name: "", target_amount: "", target_date: "" });
      setIsCreatingGoal(false);
      fetchGoals();
    } catch (error) {
      console.error("Error creating goal:", error);
    } finally {
      setLoadingGoals(false);
    }
  };

  const handleDeleteGoal = async (goalId) => {
    if (!window.confirm("Are you sure you want to delete this goal?")) return;
    setLoadingGoals(true);
    try {
      const { error } = await supabase.from('investment_goals').delete().eq('id', goalId);
      if (error) throw error;
      setEditingGoalId(null);
      setIsCreatingGoal(false);
      setNewGoal({ name: "", target_amount: "", target_date: "" });
      fetchGoals();
    } catch (error) { console.error("Delete error:", error.message); }
    finally { setLoadingGoals(false); }
  };


  if (loading) {
    return <HomeSkeleton />;
  }

  const handleMintBalancePress = () => {
    if (onOpenMintBalance) {
      onOpenMintBalance();
    }
  };

  const identityFullyComplete = onboardingComplete || (kycVerified && onboardingComplete);

  const getIdentityStatusForHome = () => {
    if (identityFullyComplete) return { text: "Verified", style: "bg-green-100 text-green-600" };
    if (kycNeedsResubmission) return { text: "Documents Required", style: "bg-amber-100 text-amber-700" };
    if (kycPending) return { text: "Under Review", style: "bg-blue-100 text-blue-600" };
    if (kycVerified && !onboardingComplete) return { text: "Continue Onboarding", style: "bg-blue-100 text-blue-600" };
    return { text: "Action Required", style: "bg-red-50 text-red-600" };
  };

  const identityStatusHome = getIdentityStatusForHome();

  const getIdentityDescription = () => {
    if (identityFullyComplete) return "Identity and onboarding complete";
    if (kycNeedsResubmission) return "Some documents need to be submitted or resubmitted";
    if (kycPending) return "Your documents are being reviewed";
    if (kycVerified && !onboardingComplete) return "Identity verified — complete remaining onboarding steps";
    return "Verify your identity to get started";
  };

  const actionsData = [
    {
      id: "onboarding",
      title: "Complete onboarding",
      description: getIdentityDescription(),
      priority: 1,
      status: identityStatusHome.text,
      statusStyle: identityStatusHome.style,
      icon: ShieldCheck,
      routeName: "actions",
      isComplete: identityFullyComplete,
    },
  ];

  const outstandingActions = actionsData.filter((action) => !action.isComplete);

  const transactionHistory = transactions.slice(0, 3).map((t) => ({
    title: t.name || t.description || "Transaction",
    date: formatDate(t.transaction_date || t.created_at),
    amount: formatAmount((t.amount || 0) / 100, t.direction),
    direction: t.direction,
    status: t.status,
    settlement_status: t.settlement_status || null,
    description: t.description,
    logo_url: t.logo_url,
    holding_logos: t.holding_logos || [],
  }));

  const handleActionNavigation = (action) => {
    const routes = {
      investments: onOpenInvestments,
      credit: onOpenCredit,
      settings: onOpenSettings,
      actions: onOpenActions,
    };

    const handler = routes[action.routeName];
    if (handler) {
      handler();
    }
  };

  const hasAssets = assetsToDisplay.length > 0;
  const hasInvestments = hasAnyHoldings || assetsToDisplay.length > 0;
  const hasStrategies = bestStrategies && bestStrategies.length > 0;

  return (
    <>
    <div
      className="min-h-screen pb-[env(safe-area-inset-bottom)] text-slate-900 relative overflow-x-hidden"
      style={{
        backgroundColor: '#f8f6fa',
        backgroundImage: 'linear-gradient(180deg, #0d0d12 0%, #0e0a14 0.5%, #100b18 1%, #120c1c 1.5%, #150e22 2%, #181028 2.5%, #1c122f 3%, #201436 3.5%, #25173e 4%, #2a1a46 5%, #301d4f 6%, #362158 7%, #3d2561 8%, #44296b 9%, #4c2e75 10%, #54337f 11%, #5d3889 12%, #663e93 13%, #70449d 14%, #7a4aa7 15%, #8451b0 16%, #8e58b9 17%, #9860c1 18%, #a268c8 19%, #ac71ce 20%, #b57ad3 21%, #be84d8 22%, #c68edc 23%, #cd98e0 24%, #d4a2e3 25%, #daace6 26%, #dfb6e9 27%, #e4c0eb 28%, #e8c9ed 29%, #ecd2ef 30%, #efdaf1 31%, #f2e1f3 32%, #f4e7f5 33%, #f6ecf7 34%, #f8f0f9 35%, #f9f3fa 36%, #faf5fb 38%, #fbf7fc 40%, #fcf9fd 42%, #fdfafd 45%, #faf8fc 55%, #f8f6fa 100%)',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100vh',
      }}
    >

      <div className="rounded-b-[36px] bg-transparent px-4 pb-12 pt-12 text-white md:px-8">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6 md:max-w-md">
          <header className="relative flex items-center justify-between text-white">
            <FamilyDropdown
              profile={profile}
              userId={userId}
              initials={initials}
              avatarUrl={profile?.avatarUrl}
              onOpenFamily={onOpenFamily}
              onSelectMember={onSelectMember}
            />

            <NavigationPill
              activeTab="home"
              onTabChange={(id) => {
                if (id === "credit") {
                  onOpenCredit();
                } else if (id === "home") {
                  setHomeTab("invest");
                }
              }}
            />

            <NotificationBell onClick={onOpenNotifications} />
          </header>


          {homeTab === "balance" || homeTab === "invest" ? (
            <div className="relative select-none -mx-2 md:mx-0">
              <div className="relative w-full touch-pan-y h-auto">
                {/* Withdrawals temporarily disabled (CEO): the purple card no longer
                    navigates to the withdraw page. Restore by re-adding the
                    cursor-pointer / role="button" / onClick that dispatched
                    navigate-within-app → "withdraw". */}
                <div
                  className="relative h-auto rounded-[28px] border border-white/10"
                >
                  <SwipeableBalanceCard
                    userId={userId}
                    isBackFacing
                    forceVisible={isCardVisible}
                    mintNumber={profile?.mintNumber}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="-mx-2 md:mx-0">
              <SwipeableBalanceCard userId={userId} mintNumber={profile?.mintNumber} />
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto -mt-10 flex w-full max-w-sm flex-col gap-6 px-4 pb-10 md:max-w-md md:px-8">

        {pendingGiftId && (
          <>
            <style>{`
              @keyframes hgift-slide-up {
                from { opacity: 0; transform: translateY(12px); }
                to   { opacity: 1; transform: translateY(0); }
              }
              @keyframes hgift-shimmer {
                0%   { transform: translateX(-100%) skewX(-12deg); }
                100% { transform: translateX(300%) skewX(-12deg); }
              }
              @keyframes hgift-glow-pulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(167,139,250,0), 0 0 18px 2px rgba(139,92,246,0.15); }
                50%      { box-shadow: 0 0 0 3px rgba(167,139,250,0.15), 0 0 28px 6px rgba(139,92,246,0.28); }
              }
              @keyframes hgift-float {
                0%, 100% { transform: translateY(0); }
                50%      { transform: translateY(-3px); }
              }
              @keyframes hgift-ping {
                0%        { transform: scale(1); opacity: 1; }
                75%, 100% { transform: scale(2.2); opacity: 0; }
              }
              .hgift-banner {
                animation: hgift-slide-up 0.5s cubic-bezier(0.16,1,0.3,1) both,
                           hgift-glow-pulse 2.8s ease-in-out 0.5s infinite;
              }
              .hgift-shimmer::after {
                content: '';
                position: absolute;
                inset: 0;
                background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.09) 50%, transparent 70%);
                animation: hgift-shimmer 2.6s ease-in-out 0.7s infinite;
              }
              .hgift-icon { animation: hgift-float 2.4s ease-in-out 0.4s infinite; }
              .hgift-ping { animation: hgift-ping 1.4s cubic-bezier(0,0,0.2,1) 0.5s infinite; }
            `}</style>

            <button
              type="button"
              className="hgift-banner relative overflow-hidden w-full rounded-2xl px-4 py-4 flex items-center gap-3.5 text-left active:scale-[0.98] transition-transform"
              style={{
                background: 'linear-gradient(135deg, #1e0d3a 0%, #3b1a6b 45%, #2a1050 100%)',
                border: '1px solid rgba(167,139,250,0.3)',
              }}
              onClick={() => {
                if (onOpenGiftClaim) onOpenGiftClaim();
                else if (onNavigate) onNavigate("giftClaim");
              }}
            >
              <div className="hgift-shimmer absolute inset-0 rounded-2xl pointer-events-none" />

              <span className="absolute top-3 right-3 flex h-2 w-2">
                <span className="hgift-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-300" />
              </span>

              <span
                className="hgift-icon shrink-0 flex h-10 w-10 items-center justify-center rounded-xl text-2xl"
                style={{ background: 'rgba(255,255,255,0.07)', boxShadow: '0 0 14px 2px rgba(250,204,21,0.18)' }}
              >
                🎁
              </span>

              <div className="flex-1 min-w-0 pr-6">
                <p className="text-sm font-semibold text-white leading-snug">You have an investment gift to claim</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(196,181,253,0.85)' }}>Tap to claim your gift</p>
              </div>

              {giftCountdown && (
                <p className="absolute bottom-2.5 right-10 text-[10px] font-medium tabular-nums" style={{ color: 'rgba(250,204,21,0.9)' }}>
                  ⏱ {giftCountdown}
                </p>
              )}

              <button
                type="button"
                className="absolute top-3 right-7 p-1 shrink-0"
                style={{ color: 'rgba(196,181,253,0.6)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  localStorage.removeItem('mint_pending_gift_id');
                  localStorage.removeItem('mint_pending_gift_expires');
                  setPendingGiftId(null);
                  setPendingGiftExpiry(null);
                  if (_pendingGiftNotifId) _markGiftNotifRead(_pendingGiftNotifId);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </button>
          </>
        )}


        <section className="flex flex-col gap-3">
          {/* Row 1 — primary actions */}
          <div className="grid grid-cols-4 gap-2 text-[11px] font-medium">
            {[
              { label: "Invest", icon: LayoutGrid, onClick: onOpenStrategies || onOpenInvest },
              { label: "Deposit", icon: ArrowDownToLine, onClick: onOpenDeposit },
              { label: "Gifting", icon: Gift, isNew: true, onClick: () => { if (!giftingIntroSeen) { setShowGiftingIntro(true); } else { onNavigate("giftStrategies"); } } },
              { label: "Goals", icon: Target, onClick: () => setShowGoalsModal(true) },
            ].map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={index}
                  className={`relative flex flex-col items-center gap-2 rounded-2xl bg-white px-1 py-3 text-slate-700 shadow-md transition-all ${item.comingSoon ? "cursor-not-allowed" : "active:scale-95 active:shadow-sm"}`}
                  type="button"
                  onClick={item.comingSoon ? undefined : item.onClick}
                  disabled={item.comingSoon}
                >
                  {item.comingSoon && (
                    <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-violet-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white shadow-sm">
                      Soon
                    </span>
                  )}
                  {item.isNew && (
                    <span className="absolute -top-1.5 -right-1 whitespace-nowrap rounded-full bg-gradient-to-r from-violet-600 to-purple-500 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white shadow-sm">
                      New
                    </span>
                  )}
                  <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-violet-50 text-violet-700">
                    <Icon className="h-4 w-4" />
                    {item.isNew && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
                      </span>
                    )}
                  </span>
                  <span className="text-center leading-tight">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Actions Carousel */}
          <QuickActionsCarousel
            items={[
              { id: 1, label: "Invest", description: "Start investing", image: "https://mfxnghmuccevsxwcetej.supabase.co/storage/v1/object/public/Mint%20Assets/MINT%20Basket.avif", onClick: onOpenStrategies || onOpenInvest },
              { id: 2, label: "Child Account", description: "Manage kids", image: "https://mfxnghmuccevsxwcetej.supabase.co/storage/v1/object/public/Mint%20Assets/PSD%20MINT%20EMAIL%20TEMPLATE%20HEADER%20STANDARD%20Child%20Account%20Verified%201.png", onClick: onOpenFamily },
              { id: 3, label: "News", description: "Market insights", image: "https://mfxnghmuccevsxwcetej.supabase.co/storage/v1/object/public/Mint%20Assets/News.avif", onClick: () => onOpenNews && onOpenNews("news") },
              { id: 4, label: "Gifting", description: "Send gifts", image: "https://mfxnghmuccevsxwcetej.supabase.co/storage/v1/object/public/Mint%20Assets/Gifting.avif", onClick: () => {} },
            ]}
          />
        </section>

        {onboardingChecked && outstandingActions.length > 0 ? (
          <OutstandingActionsSection
            actions={outstandingActions}
            onViewAll={onOpenActions}
            onSelectAction={handleActionNavigation}
          />
        ) : null}

        {/* Market Insights */}
        <section className="rounded-3xl bg-white shadow-[0_2px_16px_-2px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="flex items-end justify-between px-5 py-4 border-b border-slate-100">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                Market Insights
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-slate-500 bg-slate-50">
                  <Gift className="h-2.5 w-2.5" />
                </span>
                <span>Latest updates for your portfolio</span>
              </div>
            </div>
            <button
              onClick={() => onOpenNews && onOpenNews()}
              className="mb-1 text-xs font-semibold text-violet-600 active:opacity-70 transition-colors"
            >
              View all
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {news.length > 0 ? (
              news.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  onClick={() => onOpenNewsArticle && onOpenNewsArticle(item.id)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors active:bg-slate-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600 bg-violet-50 px-2 py-0.5 rounded-md">
                        {item.source || 'Market'}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {formatDate(item.published_at)}
                      </span>
                    </div>
                    <p className="text-[13px] font-semibold text-slate-900 line-clamp-2 leading-snug">
                      {item.title}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                </button>
              ))
            ) : !loadingNews && (
              <div className="p-6 text-center">
                <p className="text-xs text-slate-400">No recent insights available.</p>
              </div>
            )}

            {loadingNews && (
              <div className="divide-y divide-slate-100">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="px-5 py-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-14 rounded-full" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Investment Goals */}
        <section className="rounded-3xl bg-white shadow-[0_2px_16px_-2px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="flex items-end justify-between px-5 py-4 border-b border-slate-100">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                Investment Goals
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-slate-500 bg-slate-50">
                  <Target className="h-2.5 w-2.5" />
                </span>
                <span>Track your long-term wealth</span>
              </div>
            </div>
            <button
              onClick={() => { if (!isAdminPreview()) setShowGoalsModal(true); }}
              disabled={isAdminPreview()}
              className={`mb-1 text-xs font-semibold text-violet-600 active:opacity-70 transition-colors${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
            >
              Manage
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {loadingGoals ? (
              <div className="divide-y divide-slate-100">
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-4">
                    <Skeleton className="h-10 w-10 rounded-2xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-1.5 w-full rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : goals.length > 0 ? (
              goals.map((goal) => {
                const invested = goal.current_amount || 0;
                const target = goal.target_amount || 0;
                const progress = target > 0 ? Math.min(100, (invested / target) * 100) : 0;
                return (
                  <button
                    key={goal.id}
                    type="button"
                    onClick={() => { if (!isAdminPreview()) handleEditClick(goal); }}
                    disabled={isAdminPreview()}
                    className={`flex w-full items-center gap-3 px-5 py-4 text-left transition-colors active:bg-slate-50${isAdminPreview() ? " opacity-60 cursor-not-allowed pointer-events-none" : ""}`}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 flex-shrink-0">
                      <Target className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">{goal.name}</p>
                        <p className="text-xs font-semibold text-slate-600 ml-2 flex-shrink-0">
                          {Math.round(progress)}%
                        </p>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden mb-1">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[10px] text-slate-400">
                            R{Number(invested).toLocaleString()} of R{Number(target).toLocaleString()}
                          </p>
                          {goal.target_date && !isNaN(new Date(goal.target_date).getTime()) && (
                            <p className="text-[10px] text-slate-400">
                              • {new Date(goal.target_date).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                            </p>
                          )}
                        </div>
                        {goal.linked_asset_name && (
                          <p className="text-[10px] text-violet-500 truncate ml-2">
                            {goal.linked_asset_name}
                          </p>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                  </button>
                );
              })
            ) : (
              <div className="p-10 text-center">
                <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-violet-50 text-violet-600 mb-4">
                  <Target className="h-8 w-8" />
                </div>
                <p className="text-sm font-semibold text-slate-900 mb-1">No goals yet</p>
                <p className="text-xs text-slate-500 mb-6">Set investment goals to track your progress</p>
                <button
                  type="button"
                  onClick={() => { if (!isAdminPreview()) setShowGoalsModal(true); }}
                  disabled={isAdminPreview()}
                  className={`inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
                >
                  Create Goal
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Pending sells (red) — requested sells awaiting broker fill */}
        <PendingSellsSection />

        {/* Pending Orders */}
        {(() => {
          const safeAssets = Array.isArray(assetsToDisplay) ? assetsToDisplay : [];
          const safeStrategies = Array.isArray(bestStrategies) ? bestStrategies : [];
          // Include fully-pending assets AND mixed assets (some batches filled, some
          // pending) so a re-buy of a security you already hold surfaces its pending
          // batch here while the filled portion stays in the portfolio carousel.
          const pendingAssets = safeAssets.filter(a => a && (a.isPending || a.hasPendingBatch));
          // A strategy goes in the pending section if:
          //   (a) isPending flag = all holdings are unfilled (first-ever buy), OR
          //   (b) purchaseBatchesByStrategy has at least one unfilled batch (re-buy on filled strategy)
          // Using purchaseBatchesByStrategy is authoritative because it's computed
          // client-side from real holdings data, independent of server response flags.
          const pendingStrategies = safeStrategies.filter(s => {
            if (!s) return false;
            if (s.isPending) return true;
            const batches = purchaseBatchesByStrategy[s.id] || [];
            return batches.some(b => !b.filled);
          });

          // Build a set of transaction IDs that correspond to UNFILLED batches.
          // A filled transaction's ID will be in filledTxIds — we skip those so
          // a re-buy doesn't drag the old filled purchase into the pending section.
          const pendingTxIds = new Set();
          const filledTxIds = new Set();
          Object.values(purchaseBatchesByStrategy).forEach(batches => {
            batches.forEach(b => {
              if (!b.transactionId) return;
              if (b.filled) filledTxIds.add(b.transactionId);
              else pendingTxIds.add(b.transactionId);
            });
          });

          // Build one entry per PENDING TRANSACTION for strategies.
          // Each transaction "Strategy Investment: X" = one purchase event.
          // Skip transactions that belong to a filled batch so a re-buy doesn't
          // pull the already-settled purchase into the pending section.
          const stratTxMap = {};
          (Array.isArray(transactions) ? transactions : []).forEach(tx => {
            // If we have batch data and this tx belongs only to a filled batch, skip it.
            if (filledTxIds.has(tx.id) && !pendingTxIds.has(tx.id)) return;
            const name = (tx.name || "").trim();
            let stratName = null;
            if (name.startsWith("Strategy Investment: ")) stratName = name.replace("Strategy Investment: ", "").trim();
            else if (name.startsWith("Purchased ")) stratName = name.replace("Purchased ", "").trim();
            else if (name.startsWith("Gift Received — ")) stratName = name.replace("Gift Received — ", "").trim();
            if (!stratName) return;
            const strat = pendingStrategies.find(s =>
              (s.name || "").toLowerCase() === stratName.toLowerCase() ||
              (s.shortName || "").toLowerCase() === stratName.toLowerCase()
            );
            if (!strat) return;
            const key = strat.id || strat.name;
            if (!stratTxMap[key]) stratTxMap[key] = { strat, txs: [] };
            stratTxMap[key].txs.push(tx);
          });

          // If no tx match found, fall back to one entry per pending strategy
          pendingStrategies.forEach(s => {
            const key = s.id || s.name;
            if (!stratTxMap[key]) stratTxMap[key] = { strat: s, txs: [null] };
          });

          // Sort all txs per group newest-first so "Purchase 1 of N" = most recent
          Object.entries(stratTxMap).forEach(([, entry]) => {
            if (entry.txs.length > 1) {
              entry.txs.sort((a, b) =>
                new Date(b?.transaction_date || b?.created_at || 0) -
                new Date(a?.transaction_date || a?.created_at || 0)
              );
            }
          });

          // Groups: [{key, strat, txs}]
          let stratGroups = Object.entries(stratTxMap).map(([key, { strat, txs }]) => ({
            key,
            strat,
            txs: txs.sort((a, b) =>
              new Date(b?.transaction_date || b?.created_at || 0) -
              new Date(a?.transaction_date || a?.created_at || 0)
            ),
          }));

          // Hard guard: collapse any duplicate cards for the SAME strategy id into
          // one. Two independent data sources feed this section (the strategies
          // poll and the transactions cache) on different clocks, so a brief sync
          // gap could otherwise surface the same strategy twice — once matched to
          // its transaction (real date) and once via the txs:[null] fallback
          // (no date). When both exist, keep the one carrying real transactions.
          const byStratId = new Map();
          for (const g of stratGroups) {
            const id = g.strat?.id || g.strat?.name || g.key;
            const existing = byStratId.get(id);
            if (!existing) { byStratId.set(id, g); continue; }
            const gHasReal = g.txs.some(Boolean);
            const exHasReal = existing.txs.some(Boolean);
            if (gHasReal && !exHasReal) byStratId.set(id, g);
            // else keep existing (it already has real txs, or neither does)
          }
          stratGroups = [...byStratId.values()];

          const pendingAssetItems = pendingAssets.map(a => {
            const allBatches = Array.isArray(a.batches) ? a.batches : [];
            // Only the UNFILLED batches belong in Pending orders — filled batches
            // live in the portfolio carousel. For a mixed security this drops the
            // already-settled buys and keeps just the pending one(s).
            const batches = allBatches.filter(b => !(Number(b?.avg_fill) > 0));
            // Sort newest-first so the top of the stack is the most recent buy.
            const sortedBatches = [...batches].sort((b1, b2) => {
              const t1 = b1?.created_at ? new Date(b1.created_at).getTime() : 0;
              const t2 = b2?.created_at ? new Date(b2.created_at).getTime() : 0;
              return t2 - t1;
            });
            return {
              kind: "asset",
              key: `pending-asset-${a.symbol || a.name}`,
              title: a.symbol || a.name || "Asset",
              subtitle: a.name || "Awaiting fill",
              image: a.logo || null,
              symbolFallback: a.symbol || "•",
              asset: a,
              batches: sortedBatches.length > 0 ? sortedBatches : [null],
            };
          });

          // Inject a simulated pending order during the coach tour or right after a payment
          const coachSimName = sessionStorage.getItem('mint_coach_pending_sim');
          if (coachSimName) {
            // During the coach tour suppress real pending orders — only the mock should show
            stratGroups.splice(0);
          }
          if (coachSimName && !stratGroups.find(g => g.key === 'coach-sim')) {
            const realStrat = safeStrategies.find(s =>
              (s.name || '').toLowerCase() === coachSimName.toLowerCase() ||
              (s.short_name || '').toLowerCase() === coachSimName.toLowerCase()
            ) || safeStrategies.find(s =>
              (s.name || '').toLowerCase().includes(coachSimName.toLowerCase()) ||
              coachSimName.toLowerCase().includes((s.name || '').toLowerCase())
            ) || safeStrategies.find(s =>
              (s.name || '').toLowerCase().includes('famous') ||
              (s.short_name || '').toLowerCase().includes('famous')
            ) || safeStrategies[0];
            const minRands = realStrat?.min_investment
              ? Math.round(Number(realStrat.min_investment) / 100)
              : 0;
            stratGroups.unshift({
              key: 'coach-sim',
              strat: {
                id: 'coach-sim',
                name: coachSimName,
                shortName: coachSimName,
                risk_level: realStrat?.risk_level || 'Growth',
                image_url: realStrat?.image_url || null,
                icon_url: realStrat?.icon_url || null,
                investedAmount: minRands,
                isPending: true,
              },
              txs: [null],
            });
          }

          const visiblePendingAssetItems = coachSimName ? [] : pendingAssetItems;
          const totalGroups = stratGroups.length + visiblePendingAssetItems.length;
          if (totalGroups === 0) return null;

          const fmtDate = (tx) => {
            const raw = tx?.transaction_date || tx?.created_at;
            if (!raw) return null;
            const d = new Date(raw);
            if (isNaN(d)) return null;
            return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
          };

          const PendingRow = ({ image, title, subtitle, symbolFallback, amountLabel, dateLabel, kind }) => (
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-white/15 ring-1 ring-white/25 flex-shrink-0">
                {image && !failedLogos[title] ? (
                  <img src={image} alt={title} className="h-full w-full object-cover"
                    referrerPolicy="no-referrer" crossOrigin="anonymous"
                    onError={() => kind === "asset" && setFailedLogos(p => ({ ...p, [title]: true }))} />
                ) : symbolFallback ? (
                  <span className="text-[11px] font-bold text-white">{symbolFallback}</span>
                ) : (
                  <LayoutGrid className="h-5 w-5 text-white" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-bold text-white">{title}</p>
                <p className="text-[11px] font-medium text-white/70 line-clamp-1">{subtitle}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {dateLabel && (
                  <p className="text-[10px] font-semibold text-white/50 whitespace-nowrap">{dateLabel}</p>
                )}
                <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white ring-1 ring-white/25">
                  <Clock3 className="h-2.5 w-2.5" />
                  Pending
                </span>
                <p className="text-[11px] font-semibold text-white/80 whitespace-nowrap">{amountLabel}</p>
              </div>
            </div>
          );

          return (
            <section data-coach-pending-orders="true" className="sticky top-0 z-20 pt-6 -mt-6 pb-3 -mb-3" style={{ background: '#f8f6fa' }}>
              <div className="flex items-end justify-between px-5 mb-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900">Pending orders</p>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-violet-200 bg-violet-50 text-violet-600">
                      <Clock3 className="h-3 w-3" />
                    </span>
                    <span>Filling — will reflect in portfolio once settled</span>
                  </div>
                </div>
              </div>

              <div className="mx-4 space-y-3" data-coach-pending-content="true">
                {/* Strategy groups */}
                {stratGroups.map(({ key, strat, txs }) => {
                  const isStack = txs.length > 1;
                  const isExpanded = expandedPendingKey === key;
                  const image = strat.image_url || strat.icon_url || null;
                  const amountFor = (tx) => {
                    const amt = tx ? Number(tx.amount || 0) / 100 : Number(strat.investedAmount || 0);
                    return amt > 0 ? `R${amt.toFixed(2)} placed` : "Awaiting fill";
                  };

                  if (!isStack) {
                    return (
                      <div key={key}
                        className="rounded-3xl shadow-[0_10px_32px_-10px_rgba(76,29,149,0.45)] relative overflow-hidden"
                        style={{ background: "linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a855f7 100%)" }}>
                        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
                        <PendingRow image={image} title={strat.name || "Strategy"}
                          subtitle={`Strategy • ${strat.risk_level || "Balanced"}`}
                          symbolFallback={null} amountLabel={amountFor(txs[0])}
                          dateLabel={fmtDate(txs[0])} kind="strategy" />
                      </div>
                    );
                  }

                  // Stack
                  return (
                    <div key={key}>
                      {!isExpanded ? (
                        <button type="button" onClick={() => setExpandedPendingKey(key)}
                          className="relative w-full text-left">
                          {/* Shadow cards */}
                          <div className="absolute inset-x-3 bottom-0 h-full rounded-3xl opacity-60"
                            style={{ background: "linear-gradient(135deg,#5b21b6,#7c3aed)", transform: "translateY(-5px) scaleX(0.96)" }} />
                          {txs.length > 2 && (
                            <div className="absolute inset-x-5 bottom-0 h-full rounded-3xl opacity-40"
                              style={{ background: "linear-gradient(135deg,#5b21b6,#7c3aed)", transform: "translateY(-9px) scaleX(0.92)" }} />
                          )}
                          {/* Top card */}
                          <div className="relative rounded-3xl shadow-[0_10px_32px_-10px_rgba(76,29,149,0.45)] overflow-hidden"
                            style={{ background: "linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a855f7 100%)" }}>
                            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
                            <PendingRow image={image} title={strat.name || "Strategy"}
                              subtitle={`${txs.length} purchases • tap to see each`}
                              symbolFallback={null} amountLabel={amountFor(txs[0])}
                              dateLabel={fmtDate(txs[0])} kind="strategy" />
                          </div>
                          {/* Count badge */}
                          <div className="absolute top-3 left-3 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-violet-700 shadow">
                            {txs.length}
                          </div>
                        </button>
                      ) : (
                        <div className="space-y-2">
                          {/* Collapse header */}
                          <button type="button" onClick={() => setExpandedPendingKey(null)}
                            className="flex items-center gap-2 px-1 text-[11px] font-bold text-slate-500 hover:text-slate-700 transition">
                            <Clock3 className="h-3 w-3" /> {strat.name} · {txs.length} purchases · tap to collapse
                          </button>
                          {txs.map((tx, i) => (
                            <div key={i}
                              className="rounded-3xl overflow-hidden shadow-[0_6px_20px_-6px_rgba(76,29,149,0.4)]"
                              style={{ background: "linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a855f7 100%)" }}>
                              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
                              <PendingRow image={image} title={strat.name || "Strategy"}
                                subtitle={`Purchase ${i + 1} of ${txs.length}`}
                                symbolFallback={null} amountLabel={amountFor(tx)}
                                dateLabel={fmtDate(tx)} kind="strategy" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Single-security pending items */}
                {visiblePendingAssetItems.map(item => {
                  const isStack = item.batches.length > 1;
                  const isExpanded = expandedPendingKey === item.key;

                  if (!isStack) {
                    const onlyBatch = item.batches[0];
                    return (
                      <div key={item.key}
                        className="rounded-3xl shadow-[0_10px_32px_-10px_rgba(76,29,149,0.45)] relative overflow-hidden"
                        style={{ background: "linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a855f7 100%)" }}>
                        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
                        <PendingRow image={item.image} title={item.title} subtitle={item.subtitle}
                          symbolFallback={item.symbolFallback} amountLabel="Awaiting fill"
                          dateLabel={onlyBatch ? fmtDate(onlyBatch) : null} kind="asset" />
                      </div>
                    );
                  }

                  // Multi-batch pending stock — same expand-collapse pattern as multi-purchase pending strategies
                  return (
                    <div key={item.key}>
                      {!isExpanded ? (
                        <button type="button" onClick={() => setExpandedPendingKey(item.key)}
                          className="relative w-full text-left">
                          <div className="absolute inset-x-3 bottom-0 h-full rounded-3xl opacity-60"
                            style={{ background: "linear-gradient(135deg,#5b21b6,#7c3aed)", transform: "translateY(-5px) scaleX(0.96)" }} />
                          {item.batches.length > 2 && (
                            <div className="absolute inset-x-5 bottom-0 h-full rounded-3xl opacity-40"
                              style={{ background: "linear-gradient(135deg,#5b21b6,#7c3aed)", transform: "translateY(-9px) scaleX(0.92)" }} />
                          )}
                          <div className="relative rounded-3xl shadow-[0_10px_32px_-10px_rgba(76,29,149,0.45)] overflow-hidden"
                            style={{ background: "linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a855f7 100%)" }}>
                            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
                            <PendingRow image={item.image} title={item.title}
                              subtitle={`${item.batches.length} purchases • tap to see each`}
                              symbolFallback={item.symbolFallback} amountLabel="Awaiting fill"
                              dateLabel={fmtDate(item.batches[0])} kind="asset" />
                          </div>
                          <div className="absolute top-3 left-3 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-violet-700 shadow">
                            {item.batches.length}
                          </div>
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <button type="button" onClick={() => setExpandedPendingKey(null)}
                            className="flex items-center gap-2 px-1 text-[11px] font-bold text-slate-500 hover:text-slate-700 transition">
                            <Clock3 className="h-3 w-3" /> {item.title} · {item.batches.length} purchases · tap to collapse
                          </button>
                          {item.batches.map((batch, i) => (
                            <div key={batch?.id || i}
                              className="rounded-3xl overflow-hidden shadow-[0_6px_20px_-6px_rgba(76,29,149,0.4)] relative"
                              style={{ background: "linear-gradient(135deg,#5b21b6 0%,#7c3aed 55%,#a855f7 100%)" }}>
                              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl pointer-events-none" />
                              <PendingRow image={item.image} title={item.title}
                                subtitle={`Purchase ${item.batches.length - i} of ${item.batches.length}`}
                                symbolFallback={item.symbolFallback} amountLabel="Awaiting fill"
                                dateLabel={fmtDate(batch)} kind="asset" />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* Best Performing Assets — only shown when user has individual stock holdings
            (i.e. not part of a strategy). Strategies have their own section. */}
        {(loadingBestAssets || hasDirectAssets) && (
        <section>
          <div className="flex items-end justify-between px-5 mb-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                Your best performing assets
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-slate-500">
                  <Info className="h-3 w-3" />
                </span>
                <span>Based on your investment portfolio</span>
              </div>
            </div>
            {hasInvestments && !loadingBestAssets && (
              <button
                onClick={onOpenInvestments}
                className="mb-1 text-xs font-semibold text-violet-600 active:opacity-70 transition-colors"
              >
                View all
              </button>
            )}
          </div>

          {loadingBestAssets ? (
            <div className="flex gap-3 overflow-hidden pb-1">
              {[0, 1].map((i) => (
                <div key={i} className="flex min-w-[260px] flex-shrink-0 items-center gap-4 rounded-3xl bg-white p-4 shadow-md">
                  <Skeleton className="h-12 w-12 rounded-2xl flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <div className="space-y-1 text-right">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                </div>
              ))}
            </div>
          ) : hasAssets ? (
            <div className="-mx-4 flex gap-3 overflow-x-auto overflow-y-visible px-4 pb-1 pt-2 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {assetsToDisplay.filter(a => !a.isPending).slice(0, 5).map((asset) => {
                // FILLED purchases only — pending buys live in the Pending orders
                // section. Count, stack and modal all use filled batches only.
                const allBatches = Array.isArray(asset.batches) ? asset.batches : [];
                const batches = allBatches.filter(b => Number(b.avg_fill) > 0);
                const isStack = batches.length > 1;
                // Purchase date hint for single-purchase cards. Stack cards already
                // show the "Nx" badge; the per-batch dates appear in the stacked modal.
                const latestBatchDate = batches
                  .map(b => b?.created_at)
                  .filter(Boolean)
                  .map(d => new Date(d))
                  .filter(d => !isNaN(d))
                  .sort((a, b) => b - a)[0] || null;
                const fmtShortDate = (d) => d ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : null;
                const dateLabel = !isStack ? fmtShortDate(latestBatchDate) : null;

                const cardInner = (
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 flex-shrink-0">
                      {failedLogos[asset.symbol] || !asset.logo ? (
                        <span className="text-sm font-semibold text-slate-600">
                          {asset.symbol}
                        </span>
                      ) : (
                        <img
                          src={asset.logo}
                          alt={asset.name}
                          className="h-10 w-10 object-contain"
                          referrerPolicy="no-referrer"
                          crossOrigin="anonymous"
                          onError={() =>
                            setFailedLogos((prev) => ({ ...prev, [asset.symbol]: true }))
                          }
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-slate-900">{asset.symbol}</p>
                        {asset.isPending && <SettlementBadge status="pending" size="xs" />}
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-1">
                        {isStack
                          ? `${batches.length} purchases · tap to see each`
                          : asset.name}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {dateLabel && (
                        <p className="text-[10px] text-slate-400 mb-0.5">{dateLabel}</p>
                      )}
                      {asset.isPending ? (
                        <p className="text-xs text-slate-400">Awaiting fill</p>
                      ) : asset.pnlRands != null ? (
                        <>
                          <p className={`text-sm font-semibold ${asset.pnlRands >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {asset.pnlRands >= 0 ? '+' : ''}R{Math.abs(asset.pnlRands).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className={`text-xs font-semibold ${asset.pnlPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            ({asset.pnlPct >= 0 ? '+' : ''}{asset.pnlPct.toFixed(2)}%)
                          </p>
                        </>
                      ) : (
                        <p className={`text-sm font-semibold ${asset.change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {asset.change >= 0 ? '+' : ''}{typeof asset.change === 'number' ? asset.change.toFixed(2) : (asset.change || '0.00')}%
                        </p>
                      )}
                    </div>
                  </div>
                );

                if (isStack) {
                  return (
                    <div key={asset.symbol} className="flex-shrink-0 min-w-[260px] snap-start relative">
                      {/* Stack shadow layers — always white (filled-only section) */}
                      <div className="absolute inset-x-3 top-2 bottom-0 rounded-3xl border border-slate-100/80 bg-white/70 shadow-sm" />
                      {batches.length > 2 && (
                        <div className="absolute inset-x-5 top-4 bottom-0 rounded-3xl border border-slate-100/60 bg-white/50 shadow-sm" />
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedStockStack({ asset: { ...asset, batches } })}
                        className="relative w-full rounded-3xl bg-white p-4 text-left shadow-md transition-all active:scale-[0.97]"
                      >
                        {cardInner}
                      </button>
                      {/* Filled purchase count badge */}
                      <div className="absolute top-2 right-2 h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white shadow">
                        {batches.length}×
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={asset.symbol}
                    className="flex min-w-[260px] flex-1 snap-start items-center gap-4 rounded-3xl bg-white p-4 shadow-md"
                  >
                    {cardInner}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-3xl bg-white p-6 shadow-md text-center">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-violet-50 text-violet-600 mb-4">
                <TrendingUp className="h-8 w-8" />
              </div>
              {hasInvestments ? (
                <>
                  <p className="text-sm font-semibold text-slate-900 mb-1">No profitable assets yet</p>
                  <p className="text-xs text-slate-500">Your best performers will appear here once any of your assets are in profit.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-slate-900 mb-1">No investments yet</p>
                  <p className="text-xs text-slate-500 mb-4">Start investing to see your best performing assets here</p>
                  <button
                    type="button"
                    onClick={() => onOpenInvest && onOpenInvest("invest")}
                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
                  >
                    Make your first investment
                  </button>
                </>
              )}
            </div>
          )}
        </section>
        )}

        {/* Best Performing Strategies */}
        <section>
          <div className="flex items-end justify-between px-5 mb-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                Your best performing strategies
              </p>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-slate-500">
                  <LayoutGrid className="h-3 w-3" />
                </span>
                <span>Top performing curated portfolios</span>
              </div>
            </div>
            {hasStrategies && !loadingBestStrategies && !strategySkeletonHold && (
              <button
                onClick={() => onOpenInvestments && onOpenInvestments("strategy")}
                className="mb-1 text-xs font-semibold text-violet-600 active:opacity-70 transition-colors"
              >
                View all
              </button>
            )}
          </div>

          {(loadingBestStrategies || strategySkeletonHold) ? (
            <div className="flex gap-3 overflow-hidden pb-1">
              {[0, 1].map((i) => (
                <div key={i} className="flex min-w-[280px] flex-shrink-0 flex-col gap-3 rounded-3xl bg-white p-4 shadow-md">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-3 w-36" />
                    </div>
                    <div className="space-y-1 text-right">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-3 w-14" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-6 w-20 rounded-full" />
                    <Skeleton className="h-7 w-20 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : hasStrategies ? (
            <div className="-mx-4 flex gap-3 overflow-x-auto overflow-y-visible px-4 pb-1 pt-2 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {bestStrategies.filter(s => {
                if (!s || s.isPending) return false;
                const batches = purchaseBatchesByStrategy[s.id] || [];
                // Show the strategy here if it has at least one FILLED batch. A re-buy
                // adds a pending batch (which shows in Pending orders) but the original
                // filled holding still belongs in the portfolio carousel.
                return batches.length === 0 || batches.some(b => b.filled);
              }).slice(0, 5).map((strategy) => {
                const holdingsSnapshot = getStrategyHoldingsSnapshot(strategy, holdingsBySymbol);
                const pct = strategy.change_pct || 0;

                // Override P&L with live data from useUserStrategies so realized
                // gains (rebalance sells) and buffer/residual cash are included —
                // the API's invested_amount omits those.
                const hookStrat = hookStrategies.find(h => h.strategyId === strategy.id || h.id === strategy.id);
                const displayPnlRands = hookStrat != null ? hookStrat.totalPnl : strategy.pnlRands;
                const displayPnlPct = hookStrat != null
                  ? (hookStrat.investedAmount > 0 ? (hookStrat.totalPnl / hookStrat.investedAmount) * 100 : 0)
                  : strategy.pnlPct;

                // "Your best performing strategies" shows FILLED purchases only.
                // Pending re-buys live exclusively in the Pending orders section, so
                // the count, stack and modal here all use filled batches only — a
                // strategy with 1 filled + 1 pending shows as a single filled card
                // (not "2×"), and 2 filled + 1 pending shows "2×".
                const allBatches = purchaseBatchesByStrategy[strategy.id] || [];
                const batches = allBatches.filter(b => b.filled);
                const isStack = batches.length > 1;

                const fmtBatchDate = (b) => {
                  if (b.minute === "unknown") return null;
                  return new Date(b.minute).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
                };

                // Inner card content (shared between single and stack)
                const cardInner = (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 flex items-start justify-between gap-4">
                        <div className="text-left space-y-1 min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{strategy.name}</p>
                          <p className="text-xs text-slate-600 line-clamp-1">
                            {isStack
                              ? `${batches.length} purchases · tap to see each`
                              : `${strategy.risk_level || 'Balanced'}${strategy.objective ? ` • ${strategy.objective}` : ''}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {displayPnlRands != null && strategy.investedAmount > 0 ? (
                            <div className={`text-right ${displayPnlRands >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              <p className="text-sm font-semibold">{displayPnlRands >= 0 ? '+' : ''}R{Math.abs(displayPnlRands).toFixed(2)}</p>
                              <p className="text-xs font-semibold">({displayPnlPct >= 0 ? '+' : ''}{displayPnlPct.toFixed(2)}%)</p>
                            </div>
                          ) : (
                            <p className={`text-sm font-semibold ${pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {strategy.firstInvestedDate ? (
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-400">
                            {formatDate(strategy.firstInvestedDate)}
                          </span>
                        ) : strategy.purchaseRef ? (
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-400">
                            {strategy.purchaseRef}
                          </span>
                        ) : null}
                      </div>
                      {holdingsSnapshot.length > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2">
                            {holdingsSnapshot.slice(0, 3).map((h) => (
                              <div key={`${strategy.id}-${h.id || h.symbol}-snap`}
                                className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow-sm">
                                {h.logo_url
                                  ? <img src={h.logo_url} alt={h.name} className="h-full w-full object-cover" />
                                  : <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">{h.symbol?.substring(0, 2)}</div>}
                              </div>
                            ))}
                            {holdingsSnapshot.length > 3 && (
                              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-500">
                                +{holdingsSnapshot.length - 3}
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400">Holdings</span>
                        </div>
                      )}
                    </div>
                  </>
                );

                if (isStack) {
                  return (
                    <div key={strategy.id} className="flex-shrink-0 w-[280px] snap-start relative">
                      {/* Stack shadow layers — always white (filled-only section) */}
                      <div className="absolute inset-x-3 top-2 bottom-0 rounded-3xl border border-slate-100/80 bg-white/70 shadow-sm" />
                      {batches.length > 2 && (
                        <div className="absolute inset-x-5 top-4 bottom-0 rounded-3xl border border-slate-100/60 bg-white/50 shadow-sm" />
                      )}
                      {/* Top card */}
                      <button
                        type="button"
                        onClick={() => setExpandedStratStack({
                          // Feed the modal the hook's POSITIONS-only values so each filled
                          // batch's apportioned P&L matches the card header. batches is
                          // already filtered to filled-only, so no pending card appears.
                          strategy: hookStrat
                            ? { ...strategy, currentValue: hookStrat.positionsValue, investedAmount: Number((hookStrat.positionsValue - hookStrat.unrealizedPnl).toFixed(2)) }
                            : strategy,
                          batches, fmtBatchDate, holdingsSnapshot, pct, livePriceMap
                        })}
                        className="relative w-full rounded-3xl border border-slate-100/80 bg-white/90 backdrop-blur-sm p-4 text-left shadow-[0_2px_16px_-2px_rgba(0,0,0,0.08)] transition-all active:scale-[0.97]"
                      >
                        {cardInner}
                      </button>
                      {/* Filled purchase count badge */}
                      <div className="absolute top-2 right-2 h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white shadow">
                        {batches.length}×
                      </div>
                    </div>
                  );
                }

                return (
                  <button
                    key={strategy.purchaseKey || strategy.id}
                    type="button"
                    onClick={() => onOpenStrategyInPortfolio ? onOpenStrategyInPortfolio(strategy.id) : onOpenStrategies && onOpenStrategies(strategy)}
                    className="flex-shrink-0 w-[280px] snap-start rounded-3xl border border-slate-100/80 bg-white/90 backdrop-blur-sm p-4 text-left shadow-[0_2px_16px_-2px_rgba(0,0,0,0.08)] transition-all active:scale-[0.97]"
                  >
                    {cardInner}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-3xl bg-white p-6 shadow-md text-center">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-slate-50 text-slate-400 mb-4">
                <LayoutGrid className="h-8 w-8" />
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">Invest in your first strategy</p>
              <p className="text-xs text-slate-500 mb-4">Explore our curated investment portfolios</p>
              <button
                type="button"
                onClick={onOpenStrategies}
                className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5"
              >
                Browse Strategies
              </button>
            </div>
          )}
        </section>

        {transactionHistory.length > 0 ? (
          <TransactionHistorySection items={transactionHistory} onViewAll={onOpenActivity} />
        ) : (
          <section className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm font-semibold text-slate-900 mb-3">Recent Activity</p>
            <div className="text-center py-4">
              <p className="text-xs text-slate-500">No transactions yet</p>
              <p className="text-xs text-slate-400 mt-1">Your activity will appear here</p>
            </div>
          </section>
        )}
      </div>

      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close modal"
            onClick={() => setShowPayModal(false)}
          />
          <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-[32px] bg-white shadow-2xl">
            <div className="flex items-center justify-center pt-3">
              <div className="h-1.5 w-12 rounded-full bg-slate-200" />
            </div>
            <div className="p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Pay</h2>
                <button
                  type="button"
                  onClick={() => setShowPayModal(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left opacity-60"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-purple-600 text-white">
                    <Send className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">Coming soon</p>
                    <p className="text-xs text-slate-500">Transfers are not available yet</p>
                  </div>
                </button>
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left opacity-60"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 text-white">
                    <MapPin className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">Coming soon</p>
                    <p className="text-xs text-slate-500">GeoPay is not available yet</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReceiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close modal"
            onClick={() => setShowReceiveModal(false)}
          />
          <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-[32px] bg-white shadow-2xl">
            <div className="flex items-center justify-center pt-3">
              <div className="h-1.5 w-12 rounded-full bg-slate-200" />
            </div>
            <div className="p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Receive</h2>
                <button
                  type="button"
                  onClick={() => setShowReceiveModal(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3">
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left opacity-60"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white">
                    <Receipt className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">Coming soon</p>
                    <p className="text-xs text-slate-500">Requests are not available yet</p>
                  </div>
                </button>
                <button
                  type="button"
                  disabled
                  className="flex w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left opacity-60"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-600 to-orange-600 text-white">
                    <Users className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">Coming soon</p>
                    <p className="text-xs text-slate-500">Bill split is not available yet</p>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
      {showGoalsModal && (
        <>
          <motion.div
            key="goals-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[940] bg-black/50 backdrop-blur-sm"
            onClick={() => { setShowGoalsModal(false); setIsCreatingGoal(false); setEditingGoalId(null); }}
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
                onClick={() => { setShowGoalsModal(false); setIsCreatingGoal(false); setEditingGoalId(null); }}
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
                        id="home-goal-name"
                        name="home-goal-name"
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
                        id="home-goal-target"
                        name="home-goal-target"
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
                        id="home-goal-date"
                        name="home-goal-date"
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
                          className="w-full rounded-2xl bg-rose-50 py-4 text-xs font-bold uppercase tracking-widest text-rose-600 transition-active active:scale-95"
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
                    {goals.map((goal) => (
                      <div key={goal.id} className="group relative rounded-3xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:shadow-md">
                        <div className="mb-3 flex items-start justify-between">
                          <div>
                            <h3 className="font-bold text-slate-900">{goal.name}</h3>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Target: R{Number(goal.target_amount).toLocaleString()}
                            </p>
                          </div>
                          <button
                            onClick={() => handleEditClick(goal)}
                            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50 text-slate-400 hover:bg-violet-50 hover:text-violet-600"
                          >
                            <FileSignature size={18} />
                          </button>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                            <span className="text-violet-600">{Math.round(goal.target_amount > 0 ? Math.min(100, ((goal.current_amount || 0) / goal.target_amount) * 100) : 0)}% Complete</span>
                            <span className="text-slate-300">R{Math.max(0, (goal.target_amount || 0) - (goal.current_amount || 0)).toLocaleString()} Left</span>
                          </div>
                          <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-violet-600 to-purple-500 rounded-full transition-all duration-1000"
                              style={{ width: `${goal.target_amount > 0 ? Math.min(100, ((goal.current_amount || 0) / goal.target_amount) * 100) : 0}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
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

    {/* Strategy stack purchases modal — animated stacked cards */}
    {expandedStratStack && (
      <StrategyStackedModal
        data={expandedStratStack}
        onClose={() => setExpandedStratStack(null)}
      />
    )}
    {/* Stock stack purchases modal — same animation, per-batch fills */}
    {expandedStockStack && (
      <StockStackedModal
        data={expandedStockStack}
        onClose={() => setExpandedStockStack(null)}
      />
    )}

    {/* Gifting intro modal — shown only on first tap of Gifting */}
    {showGiftingIntro && (
      <div
        className="fixed inset-0 z-[999] flex items-end justify-center"
        style={{ background: 'rgba(10,6,20,0.55)', backdropFilter: 'blur(4px)' }}
        onClick={(e) => { if (e.target === e.currentTarget) { setShowGiftingIntro(false); localStorage.setItem('mint_gifting_intro_seen','1'); setGiftingIntroSeen(true); } }}
      >
        <style>{`
          @keyframes gift-intro-slide {
            from { opacity: 0; transform: translateY(100%); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes gift-intro-float {
            0%, 100% { transform: translateY(0) rotate(-3deg); }
            50%       { transform: translateY(-8px) rotate(3deg); }
          }
          @keyframes gift-intro-step-in {
            from { opacity: 0; transform: translateX(-12px); }
            to   { opacity: 1; transform: translateX(0); }
          }
          .gift-intro-sheet {
            animation: gift-intro-slide 0.45s cubic-bezier(0.16,1,0.3,1) both;
          }
          .gift-intro-emoji {
            animation: gift-intro-float 3s ease-in-out infinite;
            display: inline-block;
          }
          .gift-intro-step-1 { animation: gift-intro-step-in 0.4s cubic-bezier(0.16,1,0.3,1) 0.25s both; }
          .gift-intro-step-2 { animation: gift-intro-step-in 0.4s cubic-bezier(0.16,1,0.3,1) 0.38s both; }
          .gift-intro-step-3 { animation: gift-intro-step-in 0.4s cubic-bezier(0.16,1,0.3,1) 0.51s both; }
          .gift-intro-step-4 { animation: gift-intro-step-in 0.4s cubic-bezier(0.16,1,0.3,1) 0.64s both; }
          .gift-intro-btn    { animation: gift-intro-step-in 0.4s cubic-bezier(0.16,1,0.3,1) 0.78s both; }
        `}</style>

        <div className="gift-intro-sheet w-full max-w-sm mx-4 mb-6 rounded-3xl overflow-hidden shadow-2xl"
          style={{ background: 'linear-gradient(170deg, #1a0d2e 0%, #2d1554 40%, #1e0d3a 100%)', border: '1px solid rgba(167,139,250,0.25)' }}
        >
          {/* Header */}
          <div className="relative px-6 pt-7 pb-5 text-center"
            style={{ background: 'linear-gradient(135deg, rgba(109,40,217,0.35) 0%, rgba(124,58,237,0.15) 100%)' }}
          >
            <div className="text-5xl mb-3">
              <span className="gift-intro-emoji">🎁</span>
            </div>
            <h2 className="text-xl font-extrabold text-white tracking-tight">How Gifting Works</h2>
            <p className="text-sm mt-1.5" style={{ color: 'rgba(196,181,253,0.8)' }}>Send real investments to anyone — it takes 30 seconds</p>

            {/* Close pill */}
            <button
              onClick={() => { setShowGiftingIntro(false); localStorage.setItem('mint_gifting_intro_seen','1'); setGiftingIntroSeen(true); }}
              className="absolute top-4 right-4 flex h-7 w-7 items-center justify-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              <X className="h-3.5 w-3.5 text-white/70" />
            </button>
          </div>

          {/* Steps */}
          <div className="px-6 py-5 space-y-4">
            {[
              { step: '1', emoji: '📈', title: 'Pick an investment', desc: 'Choose any stock, ETF or basket from the MINT catalogue', cls: 'gift-intro-step-1' },
              { step: '2', emoji: '💸', title: 'Set the amount', desc: 'You decide how much to gift — starts from R100', cls: 'gift-intro-step-2' },
              { step: '3', emoji: '📧', title: 'Send via email', desc: 'Enter the recipient\'s email address — we handle the rest', cls: 'gift-intro-step-3' },
              { step: '4', emoji: '🎉', title: 'They claim & invest', desc: 'Your gift lands in their MINT portfolio once claimed', cls: 'gift-intro-step-4' },
            ].map(({ step, emoji, title, desc, cls }) => (
              <div key={step} className={`${cls} flex items-start gap-3.5`}>
                <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-violet-200"
                  style={{ background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.35)' }}
                >
                  {step}
                </div>
                <div className="flex-1 pt-0.5">
                  <p className="text-sm font-semibold text-white leading-snug">{emoji} {title}</p>
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'rgba(196,181,253,0.7)' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="gift-intro-btn px-6 pb-7">
            <button
              onClick={() => {
                setShowGiftingIntro(false);
                localStorage.setItem('mint_gifting_intro_seen', '1');
                setGiftingIntroSeen(true);
                onNavigate('giftStrategies');
              }}
              className="w-full py-4 rounded-2xl font-bold text-sm text-white active:scale-[0.98] transition-transform"
              style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', boxShadow: '0 4px 20px rgba(124,58,237,0.45)' }}
            >
              🎁 Send a Gift
            </button>
            <button
              onClick={() => { setShowGiftingIntro(false); localStorage.setItem('mint_gifting_intro_seen','1'); setGiftingIntroSeen(true); }}
              className="w-full mt-2.5 py-2.5 text-xs font-medium text-center"
              style={{ color: 'rgba(196,181,253,0.65)' }}
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function formatAmount(amount, direction) {
  if (amount === undefined || amount === null) return "R0.00";
  return `R${Math.abs(amount).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default HomePage;
