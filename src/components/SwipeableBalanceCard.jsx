import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Eye,
  EyeOff,
  TrendingUp,
  TrendingDown,
  LayoutGrid,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { supabase } from "../lib/supabase";
import { fetchStrategyCashCents, fetchRealizedCentsByStrategy } from "../lib/strategyValuation";
import { getStrategyPriceHistory, getClientStrategyReturns } from "../lib/strategyData";
import { logDebug, CAT } from "../lib/debugLog.js";
import { getCachedSession } from "../lib/sessionCache.js";
import { useRealtimePrices } from "../lib/useRealtimePrices";
import Skeleton from "./Skeleton";
import SettlementBadge from "./PendingBadge";
import {
  useSettlementConfig,
  getSettlementStatusForHolding,
} from "../lib/useSettlementStatus";

const VISIBILITY_STORAGE_KEY = "mintBalanceVisible";

// Module-level data cache — survives unmount/remount when the user switches
// homeTab values (balance ↔ invest ↔ wallet), preventing the R0 flash that
// occurs because each new instance starts with totalMarketValue: 0.
// Keyed by `userId:familyMemberId` so child-mode data stays separate.
const _cardDataCache = {};

// ── localStorage persistence helpers ──────────────────────────────────────────
// Persisting the last-known card data across page refreshes lets returning users
// see their correct balance instantly (no skeleton) while fresh data loads silently.
const LS_PREFIX = "mintcard:";
const LS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function _lsLoad(cacheKey) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + cacheKey);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > LS_TTL_MS) { localStorage.removeItem(LS_PREFIX + cacheKey); return null; }
    return data?.totalMarketValue != null ? data : null;
  } catch { return null; }
}

function _lsSave(cacheKey, data) {
  try { localStorage.setItem(LS_PREFIX + cacheKey, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

// Wraps a Supabase query promise with a timeout so hung queries fail fast
function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Query timed out after ${ms}ms`)), ms)
    ),
  ]);
}

const truncateDecimal = (num, decimals) => {
  const factor = Math.pow(10, decimals);
  return Math.floor(num * factor) / factor;
};

const formatFull = (value) => {
  const num = Number(value);
  const truncated = truncateDecimal(num, 2);
  return `R${truncated.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatKMB = (value) => {
  const num = Number(value);
  const sign = num < 0 ? "-" : "";
  const absNum = Math.abs(num);
  let formatted = absNum;
  if (absNum >= 1e9) formatted = (truncateDecimal(absNum / 1e9, 1)).toString() + "b";
  else if (absNum >= 1e6) formatted = (truncateDecimal(absNum / 1e6, 1)).toString() + "m";
  else if (absNum >= 1e3) formatted = (truncateDecimal(absNum / 1e3, 1)).toString() + "k";
  else formatted = truncateDecimal(absNum, 2).toFixed(2);
  return `${sign}R${formatted}`;
};

const formatPrecise = (value) => {
  const num = Number(value);
  const truncated = truncateDecimal(num, 2);
  return `R${truncated.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const TIMEFRAME_DAYS = { d: 7, "5d": 5, m: 30, ytd: 365, all: 1825 };

// Higher-of cost basis per holding in rands: max(Expected_fill, avg_fill/100) × qty.
// Drives the "Portfolio Value" headline — the conservative view of what the
// client paid, taking the larger of the two prices the system recorded.
// Pending holdings (no avg_fill yet) contribute 0; legacy rows with no
// Expected_fill fall back to avg_fill/100 only.
//
// Defensive: rows written before commit a732c49 stored Expected_fill in cents
// (~100x inflated). If Expected_fill is more than 5x avg_fill/100, treat it as
// legacy cents and divide by 100.
function maxOfCostBasisRands(h) {
  const qty = Number(h?.quantity || 0);
  if (qty <= 0) return 0;
  const avgFillCents = Number(h?.avg_fill || 0);
  if (avgFillCents <= 0) return 0;
  const expectedRaw = Number(h?.Expected_fill || 0);
  const avgFillRands = avgFillCents / 100;
  const expectedRands = expectedRaw > 0
    ? (expectedRaw > avgFillRands * 5 ? expectedRaw / 100 : expectedRaw)
    : 0;
  const perShareRands = expectedRands > 0 ? expectedRands : avgFillRands;
  return perShareRands * qty;
}

async function getSessionWithRetry() {
  const session = await getCachedSession();
  if (session?.access_token) return session;
  // Fallback: attempt a direct refresh (only if cache returned null)
  try {
    const { data } = await supabase.auth.refreshSession();
    if (data?.session?.access_token) return data.session;
  } catch {}
  return null;
}

async function fetchJsonWithAuth(url, token) {
  let activeToken = token;
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${activeToken}` },
  });

  if (res.status === 401) {
    const session = await getSessionWithRetry();
    activeToken = session?.access_token;
    if (activeToken) {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
    }
  }

  return res.ok ? res.json() : null;
}

const SwipeableBalanceCard = ({
  userId,
  familyMemberId,        // For child dashboard — fetch child-specific holdings instead of parent
  isBackFacing = true,
  forceVisible,
  mintNumber: mintNumberProp,
  overrideBalance,       // Rands — replaces the big portfolio number
  overrideWalletBalance, // Rands — replaces the CASH footer value
  managedByLabel,        // For child cards: "Managed by parent · Age X · Independent at Y"
  livePriceMap: livePriceMapProp = null, // Shared from ChildDashboardPage — skips internal poll
  onChildYtdMetrics = null, // Callback(pnl, pct) fired when childLiveMetrics updates
}) => {
  const childMode = !!familyMemberId;
  const _cacheKey = `${userId || ''}:${familyMemberId || ''}`;
  const [activeTab, setActiveTab] = useState("ytd");
  const [periodReturn, setPeriodReturn] = useState(null);
  const [periodPct, setPeriodPct] = useState(null);
  const [parentYtdPnl, setParentYtdPnl] = useState(null);
  const [parentYearStartBasketCents, setParentYearStartBasketCents] = useState(null);
  const [parentSnapshotPeriodReturn, setParentSnapshotPeriodReturn] = useState(null);
  const [parentSnapshotPeriodPct, setParentSnapshotPeriodPct] = useState(null);
  // Start-basket for M/5D — fallback when no stored column available
  const [parentSnapshotStartBasketCents, setParentSnapshotStartBasketCents] = useState(null);
  // Stored pre-computed P&L from client_strategy_returns_c (5d_pnl / 1m_pnl) in rands
  const [parentStoredMDPnl, setParentStoredMDPnl] = useState(null);
  const [parentStoredMDPct, setParentStoredMDPct] = useState(null);
  // True when the user has fewer snapshot rows than the window requires (new investor).
  // In this case 5D/M fall through to displayReturn (all-time P&L) rather than showing a misleading value.
  const [parentMDInsufficientData, setParentMDInsufficientData] = useState(false);
  const [childSnapshotCount, setChildSnapshotCount] = useState(null);
  const [childLivePriceMap, setChildLivePriceMap] = useState({});
  const [yearStartBasketCents, setYearStartBasketCents] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { lastUpdated, isConnected } = useRealtimePrices();
  const settlementCfg = useSettlementConfig();
  const holdingSettlementStatus = getSettlementStatusForHolding(settlementCfg);
  const [showUpdatedText, setShowUpdatedText] = useState(false);
  const updatedTimerRef = useRef(null);

  // ── FIX 1: Wallet balance state ──────────────────────────────────────────
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(true);

  const effectiveWalletBalance = overrideWalletBalance !== undefined ? overrideWalletBalance : walletBalance;
  const effectiveWalletLoading = overrideWalletBalance !== undefined ? false : walletLoading;

  useEffect(() => {
    if (overrideWalletBalance !== undefined) return;
    if (!userId) return;
    const fetchWallet = async () => {
      setWalletLoading(true);
      try {
        const { data, error } = await supabase
          .from("wallets")
          .select("balance")
          .eq("user_id", userId)
          .maybeSingle();
        if (!error && data?.balance !== undefined) {
          // Balance is stored in Rands (not cents)
          const bal = Number(data.balance);
          setWalletBalance(bal);
        } else if (error) {
          console.error("❌ [SwipeableBalanceCard] Wallet fetch error:", error);
        }
      } catch (err) {
        console.error("❌ [SwipeableBalanceCard] Wallet fetch crash:", err);
      } finally {
        setWalletLoading(false);
      }
    };
    fetchWallet();

    window.addEventListener("profile-updated", fetchWallet);
    window.addEventListener("wallet-updated", fetchWallet);
    return () => {
      window.removeEventListener("profile-updated", fetchWallet);
      window.removeEventListener("wallet-updated", fetchWallet);
    };
  }, [userId]);

  // ── FIX 2: Mint number — fetch from DB if prop not provided ──────────────
  const [mintNumber, setMintNumber] = useState(mintNumberProp || null);

  useEffect(() => {
    if (mintNumberProp) {
      setMintNumber(mintNumberProp);
      return;
    }
    if (!userId) return;
    const fetchMintNumber = async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("mint_number")
          .eq("id", userId)
          .maybeSingle();
        if (!error && data?.mint_number) {
          setMintNumber(data.mint_number);
        }
      } catch (e) {}
    };
    fetchMintNumber();
  }, [userId, mintNumberProp]);

  useEffect(() => {
    if (lastUpdated) {
      setShowUpdatedText(true);
      if (updatedTimerRef.current) clearTimeout(updatedTimerRef.current);
      updatedTimerRef.current = setTimeout(
        () => setShowUpdatedText(false),
        3000,
      );
    }
    return () => {
      if (updatedTimerRef.current) clearTimeout(updatedTimerRef.current);
    };
  }, [lastUpdated]);


  useEffect(() => {
    if (!isBackFacing) setIsOpen(false);
  }, [isBackFacing]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen]);

  const [selectedAsset, setSelectedAsset] = useState(null);

  // ── Warm cache from localStorage on first mount ──────────────────────────
  // This runs synchronously inside useState initialisers so the very first
  // render already has the last-known data — no skeleton for returning users.
  const _warmCache = (() => {
    if (_cardDataCache[_cacheKey]) return _cardDataCache[_cacheKey];
    const stored = _lsLoad(_cacheKey);
    if (stored) { _cardDataCache[_cacheKey] = stored; return stored; }
    return null;
  })();

  const [loading, setLoading] = useState(() => !_warmCache);
  const [dataSettled, setDataSettled] = useState(() => !!_warmCache?.totalMarketValue);
  const [chartData, setChartData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const holdingsScrollRef = useRef(null);

  const scrollToHoldingIndex = (index) => {
    const container = holdingsScrollRef.current;
    if (!container) return;
    const item = container.querySelector(`[data-holding-index="${index}"]`);
    if (item) {
      const containerRect = container.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const scrollLeft =
        container.scrollLeft +
        (itemRect.left - containerRect.left) -
        containerRect.width / 2 +
        itemRect.width / 2;
      container.scrollTo({ left: scrollLeft, behavior: "smooth" });
    }
  };

  const [dbData, setDbData] = useState(() => _warmCache || {
    holdings: [],
    totalMarketValue: 0,
    totalMaxOfCostBasis: 0,
    totalInvested: 0,
    totalInvestedAmount: 0,
    holdingsCount: 0,
  });

  // When a specific strategy is selected from the dropdown, every basket-scoped
  // calculation (5D/M snapshot anchor, YTD/ALL cost basis) must be scoped to ONLY
  // that strategy's id — never fall back to the whole portfolio's ids/cost basis.
  const selectedStrategyId = (selectedAsset?.isStrategy && (selectedAsset.strategyId || selectedAsset.strategy_id)) || null;

  // Stable key: only changes when the SET of strategy IDs changes, not on every live-price tick.
  // Prevents the parent snapshot effect from re-running on every price poll (which would flash R0).
  const parentStrategyKey = useMemo(() => {
    if (selectedStrategyId) return selectedStrategyId;
    return [...new Set(dbData.holdings.map(h => h.strategyId || h.strategy_id).filter(Boolean))].sort().join(",");
  }, [dbData.holdings, selectedStrategyId]);

  const [isVisible, setIsVisible] = useState(() => {
    try { return localStorage.getItem(VISIBILITY_STORAGE_KEY) !== "false"; } catch { return true; }
  });

  const toggleVisibility = () => {
    setIsVisible(v => {
      try { localStorage.setItem(VISIBILITY_STORAGE_KEY, String(!v)); } catch {}
      return !v;
    });
  };

  const loadDataRef = React.useRef(null);
  const lastCardLoadRef = React.useRef(0);
  const CARD_REFRESH_COOLDOWN = 30000;

  useEffect(() => {
    let cancelled = false;

    // Phase-1 safety (5 s): release the `loading` flag so any loading spinners
    // stop — but do NOT touch `dataSettled` here.  Skeleton must stay until
    // real data actually arrives to prevent the R0 flash.
    const safetyTimer = setTimeout(() => {
      if (!cancelled) {
        logDebug(CAT.LOADING, "⏱ Safety timer fired — SwipeableBalanceCard loading flag cleared after 5 s");
        setLoading(false);
      }
    }, 5000);

    // Phase-2 absolute abort (15 s): if the network truly stalled and no data
    // arrived at all, exit the skeleton with whatever we have (R0 / empty).
    // This prevents an infinite skeleton on complete network failure.
    const abortTimer = setTimeout(() => {
      if (!cancelled) {
        logDebug(CAT.LOADING, "⏱ Abort timer fired — forcing skeleton exit after 15 s");
        setDataSettled(true);
        setLoading(false);
      }
    }, 15000);

    const loadData = async ({ silent = false } = {}) => {
      if (!userId && !familyMemberId) return;
      if (!silent) {
        logDebug(CAT.LOADING, "🃏 SwipeableBalanceCard loadData — loading → TRUE");
        setLoading(true);
      }

      try {
        let enrichedHoldings = [];

        if (familyMemberId) {
          // ── CHILD MODE: mirrors ChildDashboardPage.fetchHoldings exactly ──────
          // Step 1: resolve linked_user_id (child may have their own Supabase account)
          const { data: familyMemberRow } = await supabase
            .from("family_members")
            .select("id, linked_user_id")
            .eq("id", familyMemberId)
            .maybeSingle();
          if (cancelled) return;
          const linkedUserId = familyMemberRow?.linked_user_id || null;

          // Step 2: fetch holdings — by family_member_id, plus by linked_user_id if present
          const holdingsSelect = "id, user_id, family_member_id, security_id, quantity, avg_fill, Expected_fill, market_value, strategy_id, Fill_date, Status, created_at";
          const [familyRes, linkedRes] = await Promise.all([
            supabase
              .from("stock_holdings_c")
              .select(holdingsSelect)
              .eq("family_member_id", familyMemberId)
              .eq("Status", "active"),
            linkedUserId
              ? supabase
                  .from("stock_holdings_c")
                  .select(holdingsSelect)
                  .eq("user_id", linkedUserId)
                  .eq("Status", "active")
              : Promise.resolve({ data: [], error: null }),
          ]);
          if (cancelled) return;

          // Deduplicate by id
          const rowsById = new Map();
          [...(familyRes.data || []), ...(linkedRes.data || [])].forEach(r => {
            if (r?.id) rowsById.set(r.id, r);
          });
          const childHoldings = Array.from(rowsById.values());
          const childSecIds = [...new Set(childHoldings.map(h => h.security_id).filter(Boolean))];

          // Step 3: parallel lookup of securities info + intraday prices
          const secMap = {};
          const intradayMap = {};
          if (childSecIds.length > 0) {
            const [secsRes, intradayRes] = await Promise.all([
              supabase
                .from("securities_c")
                .select("id, symbol, name, logo_url, last_price")
                .in("id", childSecIds),
              supabase
                .from("stock_intraday_c")
                .select("security_id, current_price, timestamp")
                .in("security_id", childSecIds)
                .order("timestamp", { ascending: false }),
            ]);
            if (cancelled) return;
            (secsRes.data || []).forEach(s => { secMap[s.id] = s; });
            // Keep latest intraday row per security (rows ordered DESC)
            (intradayRes.data || []).forEach(r => {
              if (r.security_id != null && intradayMap[r.security_id] === undefined && r.current_price != null) {
                intradayMap[r.security_id] = Number(r.current_price);
              }
            });
          }
          if (cancelled) return;

          // Step 4: enrich — only filled holdings (avg_fill > 0 + Fill_date), same logic as page
          enrichedHoldings = childHoldings
            .filter(h => Number(h.avg_fill || 0) > 0 && !!h.Fill_date)
            .map(h => {
              const sec = secMap[h.security_id] || {};
              const quantity = Number(h.quantity || 0);
              const avgFillCents = Number(h.avg_fill || 0);
              const avgFillRands = avgFillCents / 100;
              const expectedFillRaw = Number(h.Expected_fill || 0);
              const expectedFillRands = expectedFillRaw > 0
                ? (expectedFillRaw > avgFillRands * 5 ? expectedFillRaw / 100 : expectedFillRaw)
                : 0;
              const costBasisPerShareRands = expectedFillRands > 0
                ? expectedFillRands
                : avgFillRands;
              // Prefer live intraday price, fall back to last_price from securities_c
              const intradayCents = intradayMap[h.security_id];
              const lastPriceRands = Number(sec.last_price || 0);
              const currentPriceCents = intradayCents != null
                ? intradayCents
                : (lastPriceRands > 0 ? Math.round(lastPriceRands * 100) : 0);
              const marketValueCents = currentPriceCents > 0
                ? Math.round(currentPriceCents * quantity) : 0;
              const investedCents = Math.round(costBasisPerShareRands * 100 * quantity);
              return {
                id: h.id,
                symbol: sec.symbol || `SEC-${String(h.security_id || "").slice(0, 6)}`,
                name: sec.name || "Security",
                market_value: marketValueCents,
                invested_amount: investedCents,
                avg_fill: avgFillCents,
                Expected_fill: expectedFillRands,
                quantity,
                logo_url: sec.logo_url || null,
                security_id: h.security_id,
                strategy_id: h.strategy_id,
                isStrategy: false,
              };
            });

        } else {
          // ── PARENT MODE: /api/user/holdings (supabaseAdmin + Status=active + intraday) ──
          // API already fetches stock_intraday_c as primary price source.
          // Also fetch strategy IDs from client_strategy_returns_c for the chart placeholders.
          const session = await getSessionWithRetry();
          if (cancelled) return;
          const token = session?.access_token;

          const [holdingsJson, returnsResult] = await Promise.all([
            token
              ? fetchJsonWithAuth("/api/user/holdings", token).then(j => j || { holdings: [] })
              : Promise.resolve({ holdings: [] }),
            supabase
              .from("client_strategy_returns_c")
              .select("strategy_id")
              .eq("user_id", userId)
              .is("family_member", null)
              .order("as_of_date", { ascending: false }),
          ]);
          if (cancelled) return;

          const apiHoldings = holdingsJson.holdings || [];

          // Apply higher-of cost basis: max(Expected_fill, avg_fill÷100).
          // API already normalises Expected_fill to rands and market_value to intraday cents.
          enrichedHoldings = apiHoldings
            .filter(h => Number(h.avg_fill || 0) > 0)
            .map(h => {
              const quantity = Number(h.quantity || 0);
              const avgFillCents = Number(h.avg_fill || 0);
              const avgFillRands = avgFillCents / 100;
              const expectedFillRands = Number(h.Expected_fill || 0); // already rands from API
              const costBasisPerShareRands = expectedFillRands > 0
                ? expectedFillRands
                : avgFillRands;
              const investedCents = Math.round(costBasisPerShareRands * 100 * quantity);
              return {
                id: h.id,
                symbol: h.symbol || `SEC-${String(h.security_id || "").slice(0, 6)}`,
                name: h.name || "Security",
                market_value: Number(h.market_value || 0), // intraday-based, in cents
                invested_amount: investedCents,
                avg_fill: avgFillCents,
                Expected_fill: expectedFillRands,
                quantity,
                logo_url: h.logo_url || null,
                security_id: h.security_id,
                strategy_id: h.strategy_id,
                last_price: Number(h.last_price || 0),
                created_at: h.created_at || null,
                isStrategy: false,
              };
            });

          // Strategy grouping + per-strategy cash is built in the shared block
          // below — driven by holdings so fresh buys appear without a returns row.
        }

        /* ── Strategy grouping + per-strategy CASH (residual + 8% buffer) ──────────
           Driven by HOLDINGS (not client_strategy_returns_c): every strategy the
           user holds gets a grouped item valued as positions + cash, so a fresh buy
           shows correctly the instant it's made. Cash = rebalance residual + the held
           8% buffer (transactions.buffer_cents − consumed, via holdings.transaction_id). */
        const stratAgg = {};
        enrichedHoldings.filter(h => !h.isStrategy && h.strategy_id).forEach(h => {
          if (!stratAgg[h.strategy_id]) stratAgg[h.strategy_id] = { market_value: 0, invested_amount: 0 };
          stratAgg[h.strategy_id].market_value += Number(h.market_value || 0);
          stratAgg[h.strategy_id].invested_amount += Number(h.invested_amount || 0);
        });
        const stratIds = Object.keys(stratAgg);

        let bufferCentsByStrategy = {};
        let residualCentsByStrategy = {};
        let realizedCentsByStrategy = {};
        if (stratIds.length > 0) {
          // Shared single-source-of-truth cash (buffer + residual) + realised P&L.
          ({ bufferCentsByStrategy, residualCentsByStrategy } = await fetchStrategyCashCents({ userId, familyMemberId, strategyIds: stratIds }));
          realizedCentsByStrategy = await fetchRealizedCentsByStrategy({ userId, familyMemberId, strategyIds: stratIds });

          const { data: stratMeta } = await supabase.from("strategies_c").select("id, name, short_name, icon_url").in("id", stratIds);
          const stratMap = {}; (stratMeta || []).forEach(s => { stratMap[s.id] = s; });
          for (const sid of stratIds) {
            const meta = stratMap[sid] || {};
            const agg = stratAgg[sid];
            const bufC = bufferCentsByStrategy[sid] || 0;
            const resC = residualCentsByStrategy[sid] || 0;
            enrichedHoldings.push({
              symbol: meta.short_name || meta.name || "Strategy",
              name: meta.name || "Strategy",
              market_value: agg.market_value + bufC + resC,   // positions + cash (buffer + residual)
              // invested derived so this strategy's P&L = unrealised (positions −
              // open cost) + realised (locked-in rebalance gains), stable across rebalances.
              invested_amount: agg.invested_amount + bufC + resC - (realizedCentsByStrategy[sid] || 0),
              avg_fill: 0, Expected_fill: 0, quantity: 1,
              logo_url: meta.icon_url || null,
              security_id: null, strategy_id: sid,
              isStrategy: true, strategyId: sid,
              topLogos: [], changePct: 0, holdings: [], firstInvestedDate: null,
            });
          }

          // Pending/gift holdings (avg_fill=0) are intentionally excluded here.
          // Holdings only appear once officially filled by the broker (avg_fill > 0).
        }

        const totalBufferCents = Object.values(bufferCentsByStrategy).reduce((s, v) => s + v, 0);
        const totalResidualCents = Object.values(residualCentsByStrategy).reduce((s, v) => s + v, 0);

        // Portfolio total (rands): underlying stock positions + total cash (buffer + residual).
        let mValue = enrichedHoldings
          .filter(h => !h.isStrategy)
          .reduce((acc, h) => acc + Number(h.market_value || 0) / 100, 0);
        mValue += (totalBufferCents + totalResidualCents) / 100;

        // Total P&L = unrealised (live positions − cost of OPEN positions) +
        // realised (locked-in from rebalance sells). Stays stable across rebalances
        // — a rebalance just converts unrealised → realised. invested is then
        // DERIVED from that total so the % return never drifts after a rebalance.
        const totalRealizedCents = Object.values(realizedCentsByStrategy).reduce((s, v) => s + v, 0);
        const unrealizedRands = enrichedHoldings
          .filter(h => !h.isStrategy)
          .reduce((acc, h) => acc + (Number(h.market_value || 0) - Number(h.invested_amount || 0)) / 100, 0);
        const totalPnlRands = unrealizedRands + totalRealizedCents / 100;
        const totalCostBasis = Number((mValue - totalPnlRands).toFixed(2));

        // maxOfCostBasis per item (used when an item is selected). Totals only sum
        // individual stocks (+ buffer) to avoid double-counting strategy items.
        enrichedHoldings.forEach(h => {
          h.maxOfCostBasis = Number(h.invested_amount || 0) / 100;
        });
        // The headline all-time P&L is (totalMarketValue − totalMaxOfCostBasis),
        // so this must be the SAME derived invested — otherwise realised gains from
        // rebalances would be dropped from the headline. (Per-item maxOfCostBasis
        // above still drives the per-asset selected view.)
        const totalMaxOfCostBasis = totalCostBasis;

        console.log("[SwipeableBalanceCard] Loaded holdings:", {
          count: enrichedHoldings.length,
          totalMarketValue: mValue,
          holdings: enrichedHoldings.map(h => ({
            symbol: h.symbol,
            market_value: h.market_value,
            security_id: h.security_id,
            strategy_id: h.strategy_id,
            quantity: h.quantity,
            avg_fill: h.avg_fill
          }))
        });

        const nextDbData = {
          holdings: enrichedHoldings,
          totalMarketValue: mValue,
          totalMaxOfCostBasis,
          totalInvested: totalCostBasis,
          totalInvestedAmount: totalCostBasis,
          holdingsCount: enrichedHoldings.filter(h => !h.isStrategy).length,
        };
        // Persist in module-level cache (tab switches) + localStorage (page refreshes)
        if (mValue > 0 || enrichedHoldings.length > 0) {
          _cardDataCache[_cacheKey] = nextDbData;
          _lsSave(_cacheKey, nextDbData);
        } else {
          // Fresh data returned empty — clear stale cache so old values don't reappear
          delete _cardDataCache[_cacheKey];
          try { localStorage.removeItem("mintcard:" + _cacheKey); } catch {}
        }
        setDbData(nextDbData);
        setDataSettled(true);
      } catch (err) {
        console.error("❌ [SwipeableBalanceCard] Load data error:", err);
        setDataSettled(true);
      } finally {
        if (!cancelled) {
          lastCardLoadRef.current = Date.now();
          if (!silent) setLoading(false);
          else setLoading(false);
        }
      }
    };

    // If we already have cached data (module cache or localStorage), refresh
    // silently in the background — no skeleton shown, value updates in-place.
    const hasCached = !!(_warmCache?.totalMarketValue > 0);
    loadDataRef.current = () => loadData({ silent: hasCached });
    loadData({ silent: hasCached });

    // Debounce visibility handler — silent background refresh with 30 s cooldown
    // so tab switches never reset the skeleton when data is already loaded
    let visibilityDebounce = null;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(visibilityDebounce);
        visibilityDebounce = setTimeout(() => {
          const elapsed = Date.now() - lastCardLoadRef.current;
          if (elapsed < CARD_REFRESH_COOLDOWN) {
            logDebug(CAT.VISIBILITY, `👁  SwipeableBalanceCard skip tab-focus refresh — cooldown (${Math.round(elapsed / 1000)}s < 30s)`);
            return;
          }
          logDebug(CAT.LOADING, "👁  SwipeableBalanceCard silent refresh on tab focus (no skeleton)");
          loadData({ silent: true });
        }, 300);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Poll every 15 seconds for live price updates
    const pollInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadDataRef.current?.();
      }
    }, 15000);

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
      clearTimeout(abortTimer);
      clearTimeout(visibilityDebounce);
      clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [userId, familyMemberId, lastUpdated]);

  // Fetch total snapshot row count for child accounts so we can lock tabs with insufficient data
  useEffect(() => {
    if (!childMode || !familyMemberId) return;
    const fetchCount = async () => {
      const strategyIds = [...new Set(
        dbData.holdings.map(h => h.strategy_id).filter(Boolean)
      )];
      if (!strategyIds.length) { setChildSnapshotCount(0); return; }
      const { count } = await supabase
        .from("client_strategy_returns_c")
        .select("as_of_date", { count: "exact", head: true })
        .eq("family_member", familyMemberId)
        .in("strategy_id", strategyIds);
      setChildSnapshotCount(count ?? 0);
    };
    fetchCount();
  }, [childMode, familyMemberId, dbData.holdings]);

  // Clear P&L immediately when tab changes — prevents stale value flashing
  useEffect(() => {
    if (childMode) { setPeriodReturn(null); setPeriodPct(null); setYearStartBasketCents(null); }
  }, [activeTab, childMode]);

  // Child snapshot fetch — runs only when holdings or active tab change, NOT on every live-price tick
  useEffect(() => {
    if (!childMode || !familyMemberId) return;
    let cancelled = false;
    const fetchChildSnapshots = async () => {
      const strategyIds = [...new Set(
        dbData.holdings.map(h => h.strategy_id).filter(Boolean)
      )];
      if (!strategyIds.length) return; // keep previous periodReturn — don't flash fallback
      setChartLoading(true);
      try {
        const rowLimit = activeTab === "5d" ? 5 : activeTab === "m" ? 22 : undefined;
        const now = new Date();
        const yearStart = `${now.getUTCFullYear()}-01-01`;

        const basketByDate = {};
        await Promise.all(strategyIds.map(async (sid) => {
          let q = supabase
            .from("client_strategy_returns_c")
            .select("as_of_date, basket_value")
            .eq("family_member", familyMemberId)
            .eq("strategy_id", sid)
            .order("as_of_date", { ascending: false });
          if (activeTab === "ytd") q = q.gte("as_of_date", yearStart);
          if (rowLimit) q = q.limit(rowLimit);
          const { data } = await q;
          (data || []).forEach(r => {
            basketByDate[r.as_of_date] = (basketByDate[r.as_of_date] || 0) + Number(r.basket_value || 0);
          });
        }));

        if (cancelled) return;
        const dates = Object.keys(basketByDate).sort();
        if (!dates.length) { setChartData([]); setPeriodReturn(null); return; }

        const minRows = activeTab === "5d" ? 5 : activeTab === "m" ? 22 : 1;
        if (dates.length < minRows) { setChartData([]); setPeriodReturn(null); return; }

        const firstBasket = basketByDate[dates[0]];
        // Capture year-start basket for true YTD PnL — but only if the child had investments
        // before this year. If all data is from this year, YTD should equal ALL (use cost basis).
        let priorYearCountLocal = 0;
        if (activeTab === "ytd") {
          const yearStart = `${new Date().getUTCFullYear()}-01-01`;
          const { count: priorYearCount } = await supabase
            .from("client_strategy_returns_c")
            .select("as_of_date", { count: "exact", head: true })
            .eq("family_member", familyMemberId)
            .lt("as_of_date", yearStart);
          priorYearCountLocal = priorYearCount ?? 0;
          setYearStartBasketCents(priorYearCountLocal > 0 ? firstBasket : null);
        }
        const points = [{ d: null, v: 0 }];
        dates.forEach(d => {
          points.push({ d, v: Number(((basketByDate[d] - firstBasket) / 100).toFixed(2)) });
        });
        setChartData(points);

        // Mirror the portfolio tab's priority exactly (ChildPortfolioTab.jsx lines 572/577):
        // 1. Use the pre-stored P&L/pct columns if non-zero
        // 2. Fall back to basket-computed values (same formula as derivedPeriodReturn)
        const storedPnlCol = { "5d": "5d_pnl", "m": "1m_pnl", "ytd": "ytd_pnl" }[activeTab];
        const storedPctCol = { "5d": "5d_pct", "m": "1m_pct", "ytd": "ytd_pct" }[activeTab];
        const basketVal = points[points.length - 1].v;
        // Basket-based pct: (latest - first) / first * 100 — matches derivedPeriodReturn.pct
        const latestBasketCents = basketByDate[dates[dates.length - 1]];
        const basketPct = firstBasket > 0 ? ((latestBasketCents - firstBasket) / firstBasket) * 100 : 0;

        if (storedPnlCol) {
          let totalPnlCents = 0;
          let totalPctCents = 0;
          await Promise.all(strategyIds.map(async (sid) => {
            let q = supabase
              .from("client_strategy_returns_c")
              .select(`${storedPnlCol}, ${storedPctCol}`)
              .eq("family_member", familyMemberId)
              .eq("strategy_id", sid);
            if (userId) q = q.eq("user_id", userId); // match useStrategyPeriodReturns hook exactly
            const { data: pnlRow } = await q
              .order("as_of_date", { ascending: false })
              .limit(1)
              .maybeSingle();
            totalPnlCents += Number(pnlRow?.[storedPnlCol] || 0);
            totalPctCents += Number(pnlRow?.[storedPctCol] || 0);
          }));
          if (cancelled) return;
          const storedVal = totalPnlCents / 100;
          const storedPct = totalPctCents / strategyIds.length;
          const pctFallback = activeTab === "ytd" ? null : (basketPct || null);
          // For new child accounts (all investments in the current year) the cron stores
          // ytd_pnl = basket_value (cost_basis_cents = 0), not the actual gain. Skip the
          // stored ytd_pnl in that case so the basket-diff fallback is used instead.
          const skipStoredYtd = activeTab === "ytd" && priorYearCountLocal === 0;
          const finalReturn = (!skipStoredYtd && storedVal !== 0) ? storedVal : basketVal;
          const finalPct = (!skipStoredYtd && storedPct !== 0) ? storedPct : pctFallback;
          setPeriodReturn(finalReturn);
          setPeriodPct(finalPct);
        } else {
          setPeriodReturn(basketVal);
          setPeriodPct(activeTab === "ytd" ? null : (basketPct || null));
        }
      } catch (e) {
        console.warn("[SwipeableBalanceCard] childMode snapshot error:", e.message);
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    };
    fetchChildSnapshots();
    return () => { cancelled = true; };
  }, [childMode, familyMemberId, dbData.holdings, activeTab, userId]);

  // Parent snapshot effect — runs on tab/strategy change only (NOT on every live-price tick).
  // Computes cash-adjusted, non-trading-day-aware anchors for 5D/M and cost-basis anchors for YTD/ALL.
  useEffect(() => {
    if (childMode || !userId) return;
    setParentSnapshotPeriodReturn(null);
    setParentSnapshotPeriodPct(null);
    setParentSnapshotStartBasketCents(null);
    setParentStoredMDPnl(null);
    setParentStoredMDPct(null);
    setParentMDInsufficientData(false);
    setParentYearStartBasketCents(null);
    if (activeTab === "d") return;
    let cancelled = false;

    const runParentSnapshots = async () => {
      const strategyIds = parentStrategyKey ? parentStrategyKey.split(",") : [];
      if (!strategyIds.length) return;
      try {
        // ── YTD / ALL — cost basis ──────────────────────────────────────────────────
        // Default ("All Baskets", no selection): use already-computed totalInvested from
        // loadData. loadData computes: totalInvested = live_value − (unrealized + realized P&L).
        // This is consistent with the live portfolio (same position set) and correctly
        // handles rebalances: realized gains from closed positions stay in P&L, and
        // replacement positions (transaction_id=null) are never double-counted as capital.
        // Avoids the previous bug where closed/sold positions (is_active=false) were
        // included in cost basis, making rebalanced portfolios show false losses.
        //
        // When ONE specific strategy is selected from the dropdown: must use THAT
        // strategy's own cost basis (selectedAsset.maxOfCostBasis), never the whole
        // portfolio's totalInvested — otherwise a freshly-bought basket gets compared
        // against every other basket's combined cost basis, producing impossible
        // numbers like -96.7% on a position bought yesterday.
        if (activeTab === "ytd" || activeTab === "all") {
          const costBasisRands = selectedStrategyId
            ? Number(selectedAsset?.maxOfCostBasis || 0)
            : (dbData.totalInvested || 0);
          const costBasisCents = Math.round(costBasisRands * 100);
          setParentYearStartBasketCents(costBasisCents > 0 ? costBasisCents : null);
          return;
        }

        // ── Step 1: fetch cash components (buffer + residual with date) ──────────────
        // Buffer from active holding transaction_ids; residual balance + date from rebalance table.
        let totalBufferCents = 0;
        let totalResidualCents = 0;
        let earliestResidualDateStr = null; // "YYYY-MM-DD"

        const [{ data: activeHlds }, { data: residuals }] = await Promise.all([
          supabase
            .from("stock_holdings_c")
            .select("transaction_id")
            .eq("is_active", true)
            .eq("user_id", userId)
            .is("family_member_id", null)
            .in("strategy_id", strategyIds),
          supabase
            .from("strategy_rebalance_residuals")
            .select("balance_cents, updated_at")
            .eq("user_id", userId)
            .is("family_member_id", null)
            .in("strategy_id", strategyIds),
        ]);

        const allTxIds = [...new Set((activeHlds || []).map(h => h.transaction_id).filter(Boolean))];
        if (allTxIds.length > 0) {
          const { data: txns } = await supabase
            .from("transactions")
            .select("buffer_cents, buffer_consumed_cents")
            .in("id", allTxIds);
          (txns || []).forEach(t => {
            totalBufferCents += (Number(t.buffer_cents || 0) - Number(t.buffer_consumed_cents || 0));
          });
        }

        (residuals || []).forEach(r => {
          totalResidualCents += Number(r.balance_cents || 0);
          const d = r.updated_at ? r.updated_at.split("T")[0] : null;
          if (d && (!earliestResidualDateStr || d < earliestResidualDateStr)) {
            earliestResidualDateStr = d;
          }
        });

        if (cancelled) return;

        // Cash that was present at a given snapshot date.
        // Buffer is always present. Residual only exists from the rebalance date onward.
        const cashCentsAt = (dateStr) =>
          (earliestResidualDateStr && dateStr >= earliestResidualDateStr)
            ? totalBufferCents + totalResidualCents
            : totalBufferCents;



        // ── 5D / M — cash-adjusted, non-trading-day-aware anchor ─────────────────────
        // Fetch 4× more rows than needed so we have enough real trading days after
        // stripping weekends and SA public holidays (identified by basket_value == prev row).
        const rowLimit = activeTab === "5d" ? 5 : 22;
        const FETCH_LIMIT = rowLimit * 4 + 15;

        const basketByDate = {};
        await Promise.all(strategyIds.map(async (sid) => {
          const { data } = await supabase
            .from("client_strategy_returns_c")
            .select("as_of_date, basket_value")
            .eq("user_id", userId)
            .is("family_member", null)
            .eq("strategy_id", sid)
            .order("as_of_date", { ascending: false })
            .limit(FETCH_LIMIT);
          (data || []).forEach(r => {
            basketByDate[r.as_of_date] = (basketByDate[r.as_of_date] || 0) + Number(r.basket_value || 0);
          });
        }));

        if (cancelled) return;

        // Sort ascending; keep only rows where basket changed (trading days).
        const allDates = Object.keys(basketByDate).sort();
        const tradingDates = allDates.filter((d, i) =>
          i === 0 || basketByDate[d] !== basketByDate[allDates[i - 1]]
        );

        // Need at least rowLimit + 1 trading days (anchor + rowLimit days up to and including today).
        if (tradingDates.length < rowLimit + 1) {
          setParentMDInsufficientData(true);
          return;
        }

        // Anchor = rowLimit real trading days before the most recent snapshot row.
        const anchorDate = tradingDates[tradingDates.length - 1 - rowLimit];
        const anchorBasketCents = basketByDate[anchorDate];
        const anchorCashCents = cashCentsAt(anchorDate);
        const anchorTotalCents = anchorBasketCents + anchorCashCents;

        // parentMDBasketPnl = displayMarketValue − anchorTotalCents/100
        //   displayMarketValue already includes buffer + residual.
        //   anchorTotalCents = positions + buffer + (residual if rebalance ≤ anchor date).
        //   This makes both sides cash-comparable so the delta reflects only price moves.
        setParentSnapshotStartBasketCents(anchorTotalCents);

      } catch (e) {
        console.warn("[SwipeableBalanceCard] parentMode snapshot error:", e.message);
      }
    };

    runParentSnapshots();
    return () => { cancelled = true; };
  }, [childMode, userId, parentStrategyKey, activeTab, dbData.totalInvested, selectedStrategyId, selectedAsset]);

  // Live price poll for child mode — 15s, only runs when no shared prop from ChildDashboardPage
  useEffect(() => {
    if (!childMode || !familyMemberId || !dbData.holdings.length || livePriceMapProp) return;
    const securityIds = [...new Set(dbData.holdings.map(h => h.security_id).filter(Boolean))];
    if (!securityIds.length) return;
    const fetchLive = async () => {
      const { data } = await supabase
        .from("stock_intraday_c")
        .select("security_id, current_price")
        .in("security_id", securityIds)
        .order("timestamp", { ascending: false });
      if (!data?.length) return;
      const map = {};
      for (const row of data) {
        if (!map[row.security_id]) map[row.security_id] = Number(row.current_price);
      }
      setChildLivePriceMap(map);
    };
    fetchLive();
    const id = setInterval(fetchLive, 15000);
    return () => clearInterval(id);
  }, [childMode, familyMemberId, dbData.holdings, livePriceMapProp]);

  // NOTE: a client-side trigger to /api/parent-live-returns used to live here, but
  // that endpoint was never implemented — it 404'd on every render (fire-and-forget)
  // and did nothing. Parent YTD/period returns are computed client-side from
  // yearStartBasketCents, so removing the trigger has no functional effect. If
  // server-persisted parent return snapshots are wanted later, build the endpoint
  // and reinstate a trigger here.

  useEffect(() => {
    let chartCancelled = false;
    const fetchChartPrices = async () => {
      if (!userId && !familyMemberId) return;
      // Child cards are handled by the separate snapshot effect above
      if (childMode) return;

      // Ensure we don't leave chart stuck in loading if no holdings
      if (dbData.holdings.length === 0) {
        setChartData([]);
        setPeriodReturn(null);
        setChartLoading(false);
        return;
      }

      logDebug(CAT.CHART, `📈 Chart fetch START — tab: ${activeTab}`);
      setChartLoading(true);

      // Safety timeout — always exit chart skeleton after 5s even if Supabase query stalls
      const chartSafetyTimer = setTimeout(() => {
        if (!chartCancelled) {
          logDebug(CAT.CHART, "⏱ Safety timer fired — chart loading forced off after 5 s");
          console.warn("[SwipeableBalanceCard] Chart fetch safety timeout reached, clearing loader");
          setChartLoading(false);
        }
      }, 5000);

      try {
        const holdingsToChart = selectedAsset ? [selectedAsset] : dbData.holdings;
        const days = TIMEFRAME_DAYS[activeTab] || 30;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const startDateStr = cutoff.toISOString().split("T")[0];
        console.log(`[SwipeableBalanceCard] Fetching history for tab: ${activeTab}, days: ${days}, startDate: ${startDateStr}`);

        // Process strategies: cumulative sum of 1d_pnl from client_strategy_returns_c
        // Only for parent mode (userId); child mode has limited strategy returns tracking
        const strategyBasketByDate = {};
        const endDateStr = new Date().toISOString().split("T")[0];
        const limitValue = activeTab === "5d" ? 5 : undefined;

        if (userId) {
          // Collect unique strategy IDs from ALL holdings — not just isStrategy entries.
          // Parent holdings tagged with strategy_id (but isStrategy=false) must also use
          // client_strategy_returns_c so YTD and ALL share the same data source.
          const uniqueStrategyIds = [...new Set(
            holdingsToChart
              .map(h => h.strategyId || h.strategy_id)
              .filter(Boolean)
          )];
          // Collect daily 1d_pnl per date (summed across all strategies)
          const strategyDailyPnl = {};
          const parentBasketByDate = {}; // for computing year-start anchor (live parent YTD)
          let latestYtdPnlCents = null;
          let latestYtdDate = null;
          await Promise.all(uniqueStrategyIds.map(async (sid) => {
            try {
              let query = supabase
                .from("client_strategy_returns_c")
                .select("as_of_date, 1d_pnl, ytd_pnl, basket_value")
                .eq("user_id", userId)
                .eq("strategy_id", sid)
                .is("family_member", null) // parent chart only
                .order("as_of_date", { ascending: true });

              if (activeTab !== "all") {
                query = query.gte("as_of_date", startDateStr);
              }

              if (limitValue) {
                query = query.limit(limitValue);
              }

              const { data, error } = await withTimeout(query, 4000);

              if (!error && data && data.length > 0) {
                data.forEach((row) => {
                  const dateKey = row.as_of_date;
                  const dailyPnlRands = (Number(row["1d_pnl"] || 0)) / 100;
                  strategyDailyPnl[dateKey] = (strategyDailyPnl[dateKey] || 0) + dailyPnlRands;
                  // Sum basket_value across strategies per date (for live YTD anchor)
                  parentBasketByDate[dateKey] = (parentBasketByDate[dateKey] || 0) + Number(row["basket_value"] || 0);
                  // Track the latest row's ytd_pnl (fallback when no prior-year basket available)
                  if (latestYtdDate === null || dateKey > latestYtdDate) {
                    latestYtdDate = dateKey;
                    latestYtdPnlCents = Number(row["ytd_pnl"] || 0);
                  }
                });
              }
            } catch (e) {
              console.warn(`[Chart] Failed to fetch strategy 1d_pnl for ${sid}:`, e);
            }
          }));
          // Store the stored ytd_pnl as fallback
          if (!childMode && latestYtdPnlCents !== null) {
            setParentYtdPnl(latestYtdPnlCents / 100);
          }
          // NOTE: parentYearStartBasketCents for YTD/ALL is now set exclusively by the
          // parent snapshot effect (cost-basis approach). Do not set it here to avoid conflicts.

          // Build cumulative sum of 1d_pnl across all dates
          const sortedStrategyDates = Object.keys(strategyDailyPnl).sort();
          let runningTotal = 0;
          for (const dateKey of sortedStrategyDates) {
            runningTotal += strategyDailyPnl[dateKey];
            strategyBasketByDate[dateKey] = runningTotal;
          }
        }

        // Process stocks — exclude any stock whose strategy already has a chart entry
        // in client_strategy_returns_c (strategyBasketByDate). Double-counting
        // would add both the per-stock stock_returns_c P&L AND the strategy 1d_pnl.
        const chartedStrategyIds = new Set(
          holdingsToChart
            .map(h => h.strategyId || h.strategy_id)
            .filter(Boolean)
        );
        const stockHoldings = holdingsToChart.filter(h =>
          h.security_id && !h.isStrategy && !chartedStrategyIds.has(h.strategy_id)
        );
        const pricePromises = stockHoldings.map(async (h) => {
          try {
            // Compute purchase date before querying so we can use it as the query floor.
            // This prevents the Supabase 1000-row cap from hiding recent data when the
            // tab window (e.g. ALL = 5 years) would return thousands of stale rows first.
            const pDateStr = (h.created_at || h.as_of_date || "").split("T")[0];
            const queryStart = pDateStr && pDateStr > startDateStr ? pDateStr : startDateStr;

            let { data, error } = await supabase
              .from("stock_returns_c")
              .select("as_of_date, current_price")
              .eq("security_id", h.security_id)
              .gte("as_of_date", queryStart)
              .order("as_of_date", { ascending: true });

            if (error || !data || data.length < 2) {
              const fallback = await supabase
                .from("stock_returns_c")
                .select("as_of_date, current_price")
                .eq("security_id", h.security_id)
                .order("as_of_date", { ascending: false })
                .limit(30);
              if (!fallback.error && fallback.data && fallback.data.length >= 2) {
                data = fallback.data.reverse();
              } else if (!data || data.length === 0) return null;
            }

            // Chart's "purchase price" anchor prefers Expected_fill (rands) over avg_fill (cents).
            // Defensive: Expected_fill > 5x avg_fill/100 is legacy cents — divide by 100.
            const expectedFillRaw = Number(h.Expected_fill || 0);
            const avgFillRandsAnchor = Number(h.avg_fill || 0) / 100;
            const expectedFillRands = expectedFillRaw > 0
              ? (expectedFillRaw > avgFillRandsAnchor * 5 ? expectedFillRaw / 100 : expectedFillRaw)
              : 0;
            const avgFillPrice = expectedFillRands > 0 ? expectedFillRands : avgFillRandsAnchor;
            const livePrice = Number(h.last_price || 0) / 100;
            
            const allMapped = data.map((p) => ({
              ts: p.as_of_date.split("T")[0],
              close: Number(p.current_price) / 100,
            }));
            
            let filteredPrices = allMapped.filter((p) => p.ts >= pDateStr);
            if (filteredPrices.length === 0) {
              filteredPrices = [{ ts: pDateStr, close: avgFillPrice }];
            }
            
            const today = new Date().toISOString().split("T")[0];
            const lastDate = filteredPrices[filteredPrices.length - 1]?.ts;
            if (livePrice > 0 && lastDate && lastDate < today) {
              filteredPrices.push({ ts: today, close: livePrice });
            }
            
            return {
              securityId: h.security_id,
              quantity: Number(h.quantity || 1),
              avgFill: avgFillPrice,
              prices: filteredPrices,
            };
          } catch (e) {
            console.warn(`[Chart] Failed to fetch stock ${h.security_id}:`, e);
            return null;
          }
        });

        const allPriceData = (await Promise.all(pricePromises)).filter(Boolean);
        const hasStrategyData = Object.keys(strategyBasketByDate).length > 0;

        if (allPriceData.length === 0 && !hasStrategyData) {
          setChartData([]);
          setPeriodReturn(null);
          return;
        }

        // Merge dates and calculate PnL per point
        const dateSet = new Set();
        allPriceData.forEach(({ prices }) => prices.forEach((p) => dateSet.add(p.ts)));
        Object.keys(strategyBasketByDate).forEach((d) => dateSet.add(d));
        const sortedDates = Array.from(dateSet).sort();

        const rawPriceByDate = {};
        allPriceData.forEach(({ securityId, prices }) => {
          rawPriceByDate[securityId] = {};
          prices.forEach((p) => { rawPriceByDate[securityId][p.ts] = p.close; });
        });

        const filledPriceByDate = {};
        allPriceData.forEach(({ securityId }) => {
          filledPriceByDate[securityId] = {};
          let lastK = 0;
          for (const dateKey of sortedDates) {
            if (rawPriceByDate[securityId]?.[dateKey] !== undefined) {
              lastK = rawPriceByDate[securityId][dateKey];
            }
            if (lastK > 0) filledPriceByDate[securityId][dateKey] = lastK;
          }
        });

        const points = [];
        // Don't add anchor point - start with first actual value at bottom left
        for (const dateKey of sortedDates) {
          let totalPnl = 0;
          let hasVal = false;
          for (const { securityId, quantity, avgFill } of allPriceData) {
            const pr = filledPriceByDate[securityId]?.[dateKey];
            if (pr && avgFill > 0) {
              totalPnl += quantity * (pr - avgFill);
              hasVal = true;
            }
          }
          // Add strategy basket value from last 5 rows (in rands)
          if (strategyBasketByDate[dateKey] !== undefined) {
            totalPnl += strategyBasketByDate[dateKey];
            hasVal = true;
          }
          if (hasVal) points.push({ d: dateKey, v: Number(totalPnl.toFixed(2)) });
        }

        // Normalize chart to start value: subtract first value from all points
        if (points.length > 0) {
          const firstValue = points[0].v;
          points.forEach(point => {
            point.v = Number((point.v - firstValue).toFixed(2));
          });
          // Add the first value back as the baseline
          points[0].v = firstValue;
        }

        console.log(`[SwipeableBalanceCard] Final chart points: ${points.length}`);
        setChartData(points);

        // Badge logic — each branch owns exactly one setPeriodReturn call:
        //   isStockOnlyPeriodTab    → stock-only block below (pre-computed stock_returns_c columns)
        //   isStrategyOnlyPeriodTab → strategy block below  (pre-computed client_strategy_returns_c columns)
        //   otherwise               → post-norm chart last point (mixed portfolio / ALL tab)
        const isStockOnlyPeriodTab    = stockHoldings.length > 0 && !hasStrategyData && activeTab !== "all";
        const isStrategyOnlyPeriodTab = hasStrategyData && stockHoldings.length === 0 && activeTab !== "all";

        if (!isStockOnlyPeriodTab && !isStrategyOnlyPeriodTab) {
          if (points.length >= 2) {
            setPeriodReturn(points[points.length - 1].v);
          } else {
            setPeriodReturn(null);
          }
        }

        // Strategy-only badge — read pre-computed columns from client_strategy_returns_c.
        // This matches exactly what the portfolio tab shows via useStrategyPeriodReturns.
        //   D   → 1d_pnl  (today's P&L)
        //   5D  → 5d_pnl  (true 5-trading-day return)
        //   M   → 1m_pnl  (true 1-month return)
        //   YTD → ytd_pnl (year-to-date return)
        if (isStrategyOnlyPeriodTab && userId) {
          const stratColMap = { "d": "1d_pnl", "5d": "5d_pnl", "m": "1m_pnl", "ytd": "ytd_pnl" };
          const stratCol = stratColMap[activeTab];
          if (stratCol) {
            const strategyIds = [...new Set(
              holdingsToChart.filter(h => h.isStrategy && h.strategyId).map(h => h.strategyId)
            )];
            let totalCents = 0;
            let hasStratPreData = false;
            await Promise.all(strategyIds.map(async (sid) => {
              try {
                const { data: sret } = await supabase
                  .from("client_strategy_returns_c")
                  .select(stratCol)
                  .eq("user_id", userId)
                  .eq("strategy_id", sid)
                  .is("family_member", null)
                  .order("as_of_date", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (sret?.[stratCol] != null) {
                  totalCents += Number(sret[stratCol]);
                  hasStratPreData = true;
                }
              } catch (e) {
                console.warn(`[Chart] strategy pre-computed fetch failed for ${sid}:`, e);
              }
            }));
            if (!chartCancelled && hasStratPreData) {
              setPeriodReturn(parseFloat((totalCents / 100).toFixed(2)));
            }
          }
        }

        // Badge override for stock-only holdings (no strategy):
        // 5D / M  → pre-computed columns from stock_returns_c (5d_abs, 1m_abs)
        // YTD     → if bought this calendar year: (last_price − avg_fill) × qty  (= ALL, exact match)
        //           if bought a prior year: ytd_abs × qty / 100
        // ALL     → chart-derived value is correct, no override needed
        if (stockHoldings.length > 0 && !hasStrategyData && activeTab !== "all") {
          if (activeTab === "ytd") {
            const currentYear = new Date().getUTCFullYear();
            const allBoughtThisYear = stockHoldings.every(h => {
              const d = h.created_at || h.as_of_date || "";
              return new Date(d).getUTCFullYear() >= currentYear;
            });
            if (allBoughtThisYear) {
              let totalPnl = 0;
              stockHoldings.forEach(h => {
                const qty = Number(h.quantity || 0);
                const avgFillCents = Number(h.avg_fill || 0);
                const lastPriceCents = Number(h.last_price || 0);
                if (lastPriceCents > 0 && avgFillCents > 0) {
                  totalPnl += ((lastPriceCents - avgFillCents) / 100) * qty;
                }
              });
              if (!chartCancelled) setPeriodReturn(parseFloat(totalPnl.toFixed(2)));
            } else {
              let totalAbsRands = 0;
              let hasPreData = false;
              await Promise.all(stockHoldings.map(async (h) => {
                try {
                  const { data: ret } = await supabase
                    .from("stock_returns_c")
                    .select("ytd_abs")
                    .eq("security_id", h.security_id)
                    .order("as_of_date", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  if (ret?.ytd_abs != null) {
                    totalAbsRands += (Number(ret.ytd_abs) / 100) * Number(h.quantity || 0);
                    hasPreData = true;
                  }
                } catch (e) {
                  console.warn(`[Chart] ytd_abs fetch failed for ${h.security_id}:`, e);
                }
              }));
              if (!chartCancelled && hasPreData) setPeriodReturn(parseFloat(totalAbsRands.toFixed(2)));
            }
          } else {
            const preComputedAbsCol = { "5d": "5d_abs", "m": "1m_abs" }[activeTab];
            if (preComputedAbsCol) {
              let totalAbsRands = 0;
              let hasPreData = false;
              await Promise.all(stockHoldings.map(async (h) => {
                try {
                  const { data: ret } = await supabase
                    .from("stock_returns_c")
                    .select(`${preComputedAbsCol}`)
                    .eq("security_id", h.security_id)
                    .order("as_of_date", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  if (ret && ret[preComputedAbsCol] != null) {
                    const qty = Number(h.quantity || 0);
                    totalAbsRands += (Number(ret[preComputedAbsCol]) / 100) * qty;
                    hasPreData = true;
                  }
                } catch (e) {
                  console.warn(`[Chart] Pre-computed fetch failed for ${h.security_id}:`, e);
                }
              }));
              if (!chartCancelled && hasPreData) setPeriodReturn(parseFloat(totalAbsRands.toFixed(2)));
            }
          }
        }
      } catch (err) {
        console.error("❌ [SwipeableBalanceCard] Chart fetch error:", err);
      } finally {
        clearTimeout(chartSafetyTimer);
        setChartLoading(false);
      }
    };

    fetchChartPrices();
    return () => {
      chartCancelled = true;
    };
  }, [userId, familyMemberId, dbData.holdings, activeTab, selectedAsset, lastUpdated]);

  const displayMarketValue = selectedAsset
    ? Number(selectedAsset.market_value || 0) / 100
    : dbData.totalMarketValue;
  // Selected-asset cost basis prefers Expected_fill (rands, client's quoted price)
  // over avg_fill (broker fill, in cents). For strategies — which set
  // avg_fill: investedCents at construction time — both paths yield the same value.
  const selectedAssetInvestedRands = (() => {
    if (!selectedAsset) return 0;
    const expectedRaw = Number(selectedAsset.Expected_fill || 0);
    const avgFillCents = Number(selectedAsset.avg_fill || 0);
    const qty = Number(selectedAsset.quantity || 0);
    const avgFillRands = avgFillCents / 100;
    // Defensive: Expected_fill > 5x avg_fill/100 is legacy cents.
    const expectedRands = expectedRaw > 0
      ? (expectedRaw > avgFillRands * 5 ? expectedRaw / 100 : expectedRaw)
      : 0;
    if (expectedRands > 0) return expectedRands * qty;
    return avgFillRands * qty;
  })();
  const displayInvested = selectedAsset
    ? selectedAssetInvestedRands
    : dbData.totalInvested;
  const displayInvestedAmount = selectedAsset
    ? (selectedAsset.invested_amount !== undefined
        ? Number(selectedAsset.invested_amount) / 100
        : selectedAssetInvestedRands)
    : dbData.totalInvestedAmount;
  // Headline (the big number) is the live market value — cost basis + unrealised profit.
  const displayBigValue = selectedAsset
    ? Number(selectedAsset.maxOfCostBasis || 0)
    : Number(dbData.totalMaxOfCostBasis || 0);
  const isPeriodTab = ["5d", "m", "ytd", "all"].includes(activeTab);
  // Total PnL (all-time): live market value minus higher-of cost basis.
  const displayReturn = displayMarketValue - displayBigValue;

  // Live P&L for child YTD — uses 15s price poll, mirrors ChildPortfolioTab.liveStrategyMetrics
  const childLiveMetrics = useMemo(() => {
    if (!childMode || !dbData.holdings.length) return null;
    let liveValue = 0;
    let costBasis = 0;
    let hasPrices = false;
    for (const h of dbData.holdings) {
      // Skip aggregate strategy items — they duplicate the underlying individual stock holdings.
      // Iterating both would double-count liveValue and costBasis (causing YTD ≠ ALL).
      if (h.isStrategy) continue;
      const qty = Number(h.quantity || 0);
      if (qty <= 0) continue;
      // Prefer shared prop (rich format) → internal poll (number) → fallback
      const liveCents = livePriceMapProp
        ? livePriceMapProp[h.security_id]?.priceCents
        : childLivePriceMap[h.security_id];
      const fallbackCents = qty > 0 ? Math.round(Number(h.market_value || 0) / qty) : 0;
      const priceCents = liveCents > 0 ? liveCents : fallbackCents;
      if (priceCents > 0) { liveValue += (priceCents / 100) * qty; hasPrices = true; }
      // Cost basis in Rands — invested_amount stored as cents
      costBasis += Number(h.invested_amount || 0) / 100;
    }
    if (!hasPrices || costBasis === 0) return null;
    // True YTD: compare live value to start-of-year portfolio value, not all-time cost basis
    if (activeTab === "ytd" && yearStartBasketCents > 0) {
      const yearStartRands = yearStartBasketCents / 100;
      const pnl = liveValue - yearStartRands;
      const pct = (pnl / yearStartRands) * 100;
      return { pnl, pct };
    }
    const pnl = liveValue - costBasis;
    const pct = (pnl / costBasis) * 100;
    return { pnl, pct };
  }, [childMode, dbData.holdings, childLivePriceMap, livePriceMapProp, activeTab, yearStartBasketCents]);

  useEffect(() => {
    if (childMode && childLiveMetrics && onChildYtdMetrics) {
      onChildYtdMetrics(childLiveMetrics);
    }
  }, [childMode, childLiveMetrics, onChildYtdMetrics]);

  const displayBalance = overrideBalance !== undefined
    ? overrideBalance
    : displayMarketValue;

  // For child accounts: derive a locked label when the active tab needs more data
  const _childLockedLabels = { "5d": "Available after 5 trading days", m: "Available after 1 month", ytd: "Available after first full year" };
  const childLockedLabel = (() => {
    if (!childMode || childSnapshotCount === null) return null;
    const minRows = activeTab === "5d" ? 5 : activeTab === "m" ? 22 : 1;
    return (childSnapshotCount < minRows && _childLockedLabels[activeTab]) ? _childLockedLabels[activeTab] : null;
  })();

  // PnL pill: for child YTD use live metrics (15s poll); for other period tabs use stored/basket.
  // "all" always uses displayReturn (live market value − cost basis).
  // Parent YTD: liveMarketValue − yearStartBasket. Prior-year count check (in fetchParentSnapshots)
  //   sets parentYearStartBasketCents=null when all invested this year → falls back to displayReturn.
  // Parent M/5D: parentSnapshotPeriodReturn from dedicated snapshot query (stored cols or basket diff).
  const useChildLiveYtd = childMode && activeTab === "ytd" && childLiveMetrics != null;
  // "all" uses the same cost-basis anchor as "ytd" — parentYearStartBasketCents holds avg_fill×qty+buffer.
  const useParentLiveYtd = !childMode && (activeTab === "ytd" || activeTab === "all") && parentYearStartBasketCents != null && displayMarketValue > 0;
  // Cap YTD at all-time (displayReturn) to prevent mid-year deposit inflation.
  // Prior-year count check already ensures parentYearStartBasketCents is only set when
  // prior-year rows exist — the cap adds a second safety layer for net-new deposits.
  const parentYtdReturn = useParentLiveYtd
    ? Math.min(displayMarketValue - parentYearStartBasketCents / 100, displayReturn)
    : 0;

  // Parent M/5D: prefer stored pre-computed columns (5d_pnl / 1m_pnl) — industry standard.
  // Fall back to basket-diff (live price − period-start basket) when stored columns absent.
  const parentMDBasketPnl = (!childMode && parentSnapshotStartBasketCents != null && displayMarketValue > 0)
    ? parseFloat((displayMarketValue - parentSnapshotStartBasketCents / 100).toFixed(2))
    : null;
  const parentMDBasketPct = (parentMDBasketPnl !== null && parentSnapshotStartBasketCents > 0)
    ? parseFloat(((parentMDBasketPnl / (parentSnapshotStartBasketCents / 100)) * 100).toFixed(4))
    : null;
  const parentMDLivePnl = parentStoredMDPnl !== null ? parentStoredMDPnl : parentMDBasketPnl;
  const parentMDLivePct = parentStoredMDPct !== null ? parentStoredMDPct : parentMDBasketPct;

  const useParentMD = !childMode && (activeTab === "m" || activeTab === "5d") && parentMDLivePnl !== null;
  // Parent M/5D when data not yet fetched: show R0 explicitly — no stale chart periodReturn fallback.
  // Only applies to strategy accounts — stock-only accounts never populate parentMDLivePnl
  // (the snapshot effect exits early when strategyIds is empty), so they must fall through to periodReturn.
  const parentHasStrategyHoldings = !childMode && dbData.holdings.some(h => h.strategyId || h.strategy_id);
  // parentMDInsufficientData = we fetched and confirmed not enough rows — fall through to displayReturn, not R0
  const isParentMDTabWaiting = !childMode && parentHasStrategyHoldings && (activeTab === "m" || activeTab === "5d") && parentMDLivePnl === null && !parentMDInsufficientData;
  // For parent YTD: when no prior-year anchor (parentYearStartBasketCents=null → !useParentLiveYtd),
  // user invested entirely this year → YTD = All-time = displayReturn. Never use chart periodReturn for YTD.
  const useParentYtdTab = !childMode && activeTab === "ytd";

  const activeReturn = useChildLiveYtd
    ? childLiveMetrics.pnl
    : useParentLiveYtd
      ? parentYtdReturn
      : useParentMD
        ? parentMDLivePnl
        : useParentYtdTab
          ? displayReturn            // No prior-year anchor → All-time (never fall through to periodReturn)
          : isParentMDTabWaiting
            ? 0                      // Basket data not yet fetched — R0, no stale chart fallback
            : ((!parentMDInsufficientData && isPeriodTab && activeTab !== "all" && periodReturn !== null) ? periodReturn : displayReturn);


  const activeReturnPct = displayBigValue > 0
    ? (useChildLiveYtd
        ? Math.abs(childLiveMetrics.pct).toFixed(1)
        : (useParentMD && parentMDLivePct !== null
            ? Math.abs(parentMDLivePct).toFixed(1)
            : ((childMode && isPeriodTab && activeTab !== "all" && periodPct !== null)
                ? Math.abs(periodPct).toFixed(1)
                : ((Math.abs(activeReturn) / displayBigValue) * 100).toFixed(1))))
    : "0.0";

  const isLoss = activeReturn < 0;
  const returnPct = activeReturnPct;
  const chartColor = isLoss ? "hsl(0,84%,60%)" : "hsl(160,70%,45%)";

  const masked = "••••";

  const TrendIcon = isLoss ? TrendingDown : TrendingUp;

  return (
    <div className="rounded-3xl gradient-hero-card shadow-hero p-4 relative overflow-hidden border border-white/5">
      {/* Ambient glows */}
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-accent/30 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -left-8 w-32 h-32 rounded-full bg-primary/15 blur-3xl pointer-events-none" />

      {/* Top row: label + visibility + LIVE */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.18em] text-white/60">
            {selectedAsset ? selectedAsset.symbol.toUpperCase() : "PORTFOLIO VALUE"}
          </span>
          <button
            onClick={toggleVisibility}
            className="text-white/50 hover:text-white/90 transition-colors"
            aria-label="Toggle visibility"
          >
            {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {isConnected && (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-success" style={{ animation: "pulse-dot 2s ease-in-out infinite" }} />
              <span className="text-[9px] tracking-wider text-white/50 font-semibold">LIVE</span>
            </>
          )}
        </div>
      </div>

      {/* Value + inline sparkline */}
      <div className="flex items-end justify-between mt-1">
        <div className="flex-1 min-w-0 pr-2">
          {!dataSettled ? (
            <Skeleton className="h-8 w-36 bg-white/15 rounded mb-2 animate-pulse" />
          ) : (
            <h2 className="text-3xl font-bold tracking-tight text-white leading-none">
              {isVisible ? formatFull(displayBalance) : masked}
            </h2>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            {!dataSettled ? (
              <Skeleton className="h-5 w-24 bg-white/15 rounded-full animate-pulse" />
            ) : childLockedLabel ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-white/70 text-[11px] font-semibold">{childLockedLabel}</span>
                <span className="text-white/40 text-[10px]">Check back once more data has been recorded</span>
              </div>
            ) : (childMode && periodReturn === null) ? (
              <span className="inline-flex items-center gap-1 px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white/60 loading-dot-1" />
                <span className="w-1.5 h-1.5 rounded-full bg-white/60 loading-dot-2" />
                <span className="w-1.5 h-1.5 rounded-full bg-white/60 loading-dot-3" />
              </span>
            ) : (
              <>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${isLoss ? "bg-destructive/20 text-destructive" : "bg-success/20 text-success"}`}>
                  <TrendIcon size={11} strokeWidth={2.5} />
                  {isVisible ? (
                    <>
                      {isPeriodTab && (
                        <span className="text-[10px] opacity-75">
                          {activeTab === "5d" && "5D:"}{activeTab === "m" && "1M:"}{activeTab === "ytd" && "YTD:"}{activeTab === "all" && "Inc:"}
                        </span>
                      )}
                      {activeReturn == null ? "N/A" : `${isLoss ? "-" : "+"}${formatKMB(Math.abs(activeReturn))}`}
                    </>
                  ) : (
                    masked
                  )}
                </span>
                <span className={`text-[11px] font-medium ${isLoss ? "text-destructive" : "text-success"}`}>
                  {isVisible
                    ? (returnPct == null ? "N/A" : `${isLoss ? "-" : "+"}${returnPct}%`)
                    : masked}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Inline sparkline — flex item, never overlaps content below */}
        <div className="opacity-90 shrink-0 self-end pointer-events-none w-[44%] translate-y-4" style={{ height: 90 }}>
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={90}>
              <ComposedChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-2 py-1 shadow-md">
                        <p className="text-[9px] text-slate-500">{payload[0]?.payload?.d}</p>
                        <p className="text-[10px] font-semibold text-slate-800">{formatPrecise(payload[0]?.value)}</p>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={0} stroke="rgba(148,163,184,0.3)" strokeDasharray="3 3" strokeWidth={1} />
                <Area type="monotone" dataKey="v" stroke="none" fill={chartColor} fillOpacity={0.15} />
                <Line type="monotone" dataKey="v" stroke={chartColor} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (!dataSettled || chartLoading) ? (
            <div className="flex items-end gap-0.5 w-full" style={{ height: 90 }}>
              {[40, 55, 35, 65, 50, 70, 45, 60].map((h, i) => (
                <Skeleton key={i} className="flex-1 rounded-sm bg-white/10 animate-pulse" style={{ height: `${h}%` }} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Asset selector — hidden in child mode */}

      <div ref={dropdownRef} className={`relative mt-2${childMode ? " hidden" : ""}`}>
        {!dataSettled ? (
          <Skeleton className="h-7 w-28 bg-white/10 rounded-full animate-pulse" />
        ) : (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/15"
        >
          <LayoutGrid size={12} className="text-violet-400" />
          <span className="text-[11px] font-medium text-slate-200 whitespace-nowrap">
            {selectedAsset ? selectedAsset.symbol : (dbData.holdings.length > 0 ? "All Baskets" : "Investments")}
          </span>
          {isOpen ? <ChevronUp size={12} className="text-slate-300" /> : <ChevronDown size={12} className="text-slate-300" />}
        </button>
        )}
        {isOpen && (
          <div className="absolute top-full mt-1 left-0 w-48 bg-white rounded-xl z-[120] overflow-hidden border border-slate-200 shadow-lg">
            <div className="py-1 overflow-y-auto max-h-[140px]">
              {(() => {
                const strategyItemIds = new Set(dbData.holdings.filter(h => h.isStrategy).map(h => h.strategy_id).filter(Boolean));
                const dropdownItems = [
                  ...dbData.holdings.filter(h => h.isStrategy),
                  ...dbData.holdings.filter(h => !h.isStrategy && !strategyItemIds.has(h.strategy_id)),
                ];
                // "All Baskets" aggregates every basket/holding the user owns — only worth
                // showing once there's more than one thing to aggregate.
                const showAllBasketsOption = dropdownItems.length > 1;
                return (
                  <>
                    {showAllBasketsOption && (
                      <button
                        onClick={() => { setSelectedAsset(null); setIsOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${!selectedAsset ? "bg-slate-100" : "hover:bg-slate-50"}`}
                      >
                        <div className="w-4 h-4 rounded-full overflow-hidden bg-violet-100 shrink-0 flex items-center justify-center">
                          <LayoutGrid size={10} className="text-violet-500" />
                        </div>
                        <span className="text-[9px] font-medium text-slate-700 truncate">All Baskets</span>
                      </button>
                    )}
                    {dropdownItems.map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => { setSelectedAsset(item); setIsOpen(false); scrollToHoldingIndex(idx); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${selectedAsset?.symbol === item.symbol ? "bg-slate-100" : "hover:bg-slate-50"}`}
                    >
                      <div className="w-4 h-4 rounded-full overflow-hidden bg-slate-100 shrink-0">
                        {item.isStrategy && item.topLogos?.length > 0 ? (
                          <div className="flex -space-x-1 h-full items-center justify-center">
                            {item.topLogos.slice(0, 2).map((logo, li) => (
                              <img key={li} src={logo} className="w-3 h-3 rounded-full object-cover border border-white/25" />
                            ))}
                          </div>
                        ) : item.logo_url ? (
                          <img src={item.logo_url} className="w-full h-full object-cover" />
                        ) : (
                          <span className="flex items-center justify-center w-full h-full text-[6px] text-slate-500">
                            {item.symbol?.substring(0, 2)}
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] font-medium text-slate-700 truncate">{item.symbol}</span>
                      {(() => {
                        if (!item.isStrategy && Number(item.avg_fill || 0) === 0) return <SettlementBadge status="pending" size="xs" />;
                        if (item.settlement_status && item.settlement_status !== "confirmed") return <SettlementBadge status={item.settlement_status} size="xs" />;
                        const isSettlementActive = settlementCfg.brokerEnabled || settlementCfg.fullyIntegrated;
                        if (!isSettlementActive) return null;
                        const s = holdingSettlementStatus;
                        return s && s !== "confirmed" ? <SettlementBadge status={s} size="xs" /> : null;
                      })()}
                    </button>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Period selector */}
      <div className="mt-2 flex bg-black/20 backdrop-blur-sm rounded-full p-0.5 relative">
        {[["5d","5D"],["m","M"],["ytd","YTD"],["all","All"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
              activeTab === key ? "bg-white text-slate-900 shadow-sm" : "text-white/60 hover:text-white/90"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-white/10 flex relative">
        <div className="flex-1">
          <div className="text-[9px] tracking-[0.15em] text-white/50 font-semibold">CASH</div>
          <div className="text-sm font-bold text-white mt-0.5">
            {isVisible ? (effectiveWalletLoading ? "..." : formatFull(effectiveWalletBalance)) : masked}
          </div>
        </div>
        <div className="w-px bg-white/10" />
        <div className="flex-1 pl-4">
          <div className="text-[9px] tracking-[0.15em] text-white/50 font-semibold">MINT NUMBER</div>
          <div className="text-sm font-bold text-white mt-0.5 font-mono">
            {mintNumber ?? "GENERATING..."}
          </div>
        </div>
      </div>

      {managedByLabel && (
        <div className="mt-3 pt-3 border-t border-white/10 text-center">
          <div className="text-[10px] text-white/60 font-medium">
            {managedByLabel}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(52,211,153,0.4); }
          50% { opacity: 0.7; box-shadow: 0 0 0 3px rgba(52,211,153,0); }
        }
      `}</style>
    </div>
  );
};

export default SwipeableBalanceCard;
