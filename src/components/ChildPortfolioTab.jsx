import React, { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import {
  Area, ComposedChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, ReferenceLine,
} from "recharts";
import { useUserStrategies, useStrategyChartData, useStrategyLivePeriodReturn } from "../lib/useUserStrategies";
import { useProfile } from "../lib/useProfile";
import { supabase } from "../lib/supabase";
import { fetchStrategyCashCents } from "../lib/strategyValuation.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

const fmt = (rands) =>
  `R${Number(rands || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPnlAxis = (value) => {
  const n = Number(value);
  if (Math.abs(n) < 0.5) return "R0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}R${(abs / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${sign}R${(abs / 1e3).toFixed(0)}k`;
  return `${sign}R${abs.toFixed(0)}`;
};

const computePnlAxisConfig = (data) => {
  if (!data || data.length === 0) return { domain: [-10, 10], ticks: [-10, 0, 10] };
  const values = data.map((p) => p.value);
  let dataMin = Math.min(...values);
  let dataMax = Math.max(...values);
  if (Math.abs(dataMax - dataMin) < 1) { dataMin = Math.min(dataMin, -5); dataMax = Math.max(dataMax, 5); }
  let axisMin, axisMax;
  if (dataMin >= 0) { axisMin = 0; axisMax = dataMax * 1.15 || 10; }
  else if (dataMax <= 0) { axisMin = dataMin * 1.15 || -10; axisMax = 0; }
  else { const absMax = Math.max(Math.abs(dataMin), Math.abs(dataMax)); axisMin = -(absMax * 1.15); axisMax = absMax * 1.15; }
  const step = Math.round((axisMax - axisMin) / 3) || 1;
  const ticks = [];
  let t = Math.round(axisMin);
  while (t <= axisMax + 0.5) { ticks.push(t); t += step; }
  if (!ticks.includes(0)) { ticks.push(0); ticks.sort((a, b) => a - b); }
  const unique = [...new Set(ticks)].sort((a, b) => a - b);
  return { domain: [axisMin, axisMax], ticks: unique.length >= 2 ? unique : [0, 5, 10] };
};

// Returns the first data point of each calendar month from chart data.
// Handles both daily labels ("13 Mar '26") and monthly labels ("Mar '26").
const computeChildYtdTicks = (chartData) => {
  const seen = new Set();
  return chartData
    .filter(pt => {
      if (!pt.day) return false;
      const parts = String(pt.day).split(' ');
      // "Mar '26" → parts[0] is a month name (letter); "13 Mar '26" → parts[1]
      const mon = isNaN(Number(parts[0])) ? parts[0] : parts[1];
      if (!mon || seen.has(mon)) return false;
      seen.add(mon);
      return true;
    })
    .map(pt => pt.day);
};

const PIE_COLORS = ["#4C1D95","#5B21B6","#6D28D9","#7C3AED","#8B5CF6","#A78BFA","#C4B5FD","#DDD6FE","#EDE9FE","#F5F3FF"];

// Same spring/stagger entrance used on the child Home tab (ChildDashboardPage) —
// reused here so Portfolio has the same "alive" feel instead of static cards.
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};
const item = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 340, damping: 28 } },
};

// ─── ChildPortfolioTab ─────────────────────────────────────────────────────────

const ChildPortfolioTab = ({ child, rawHoldings = [], onOpenInvest, onWithdraw, livePriceMap: livePriceMapProp = null }) => {
  const { profile } = useProfile();
  const familyMemberId = child?.id || null;

  // strategy hooks — filtered to child
  const { strategies, selectedStrategy, loading: strategiesLoading, selectStrategy } = useUserStrategies(familyMemberId);

  // Child's cash reserve = held 8% execution buffer + any rebalance residual,
  // scoped to this child. Same source the parent portfolio / withdraw use, so it
  // reconciles. Shown as the purple "Cash" coin below.
  const [childCashRands, setChildCashRands] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const stratIds = [...new Set((rawHoldings || []).map((h) => h.strategy_id).filter(Boolean))];
    if (!profile?.id || !familyMemberId || stratIds.length === 0) { setChildCashRands(0); return; }
    (async () => {
      try {
        const { bufferCentsByStrategy = {}, residualCentsByStrategy = {} } =
          await fetchStrategyCashCents({ userId: profile.id, familyMemberId, strategyIds: stratIds });
        if (cancelled) return;
        const totalCents = stratIds.reduce((s, sid) => s + (bufferCentsByStrategy[sid] || 0) + (residualCentsByStrategy[sid] || 0), 0);
        setChildCashRands(Math.max(0, totalCents) / 100);
      } catch { if (!cancelled) setChildCashRands(0); }
    })();
    return () => { cancelled = true; };
  }, [profile?.id, familyMemberId, rawHoldings]);

  const [timeFilter, setTimeFilter] = useState("ytd");
  const [tabJustChanged, setTabJustChanged] = useState(false);
  const tabJustChangedTimer = useRef(null);
  const { chartData: realChartData, loading: chartLoading } = useStrategyChartData(
    selectedStrategy?.strategyId, timeFilter,
    selectedStrategy?.firstInvestedDate || null,
    profile?.id, familyMemberId
  );
  const { returnData: periodReturnData, loading: periodReturnLoading } = useStrategyLivePeriodReturn(
    profile?.id, selectedStrategy?.strategyId, timeFilter, 0, familyMemberId
  );

  // which time period tabs have enough data to show
  const [availablePeriods, setAvailablePeriods] = useState({ D: true, "5d": false, m: false, ytd: false, all: true });
  // raw snapshot rows used for period P&L derivation (basket_value in cents, ascending by date)
  const [snapshotRows, setSnapshotRows] = useState([]);

  useEffect(() => {
    if (!familyMemberId || !selectedStrategy?.strategyId) return;
    supabase
      .from("client_strategy_returns_c")
      .select("as_of_date, basket_value, ytd_pct")
      .eq("family_member", familyMemberId)
      .eq("strategy_id", selectedStrategy.strategyId)
      .order("as_of_date", { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setSnapshotRows(data);
          const count = data.length;
          const latestYtdPct = data[data.length - 1]?.ytd_pct;
          setAvailablePeriods({
            D: true,
            "5d": count >= 5,
            m: count >= 22,
            ytd: latestYtdPct != null,
            all: true,
          });
        }
      });
  }, [familyMemberId, selectedStrategy?.strategyId]);

  // derive period P&L from basket snapshots when pre-calculated columns are null
  const derivedPeriodReturn = useMemo(() => {
    if (!snapshotRows.length) return { pnl: 0, pct: 0 };
    const last = snapshotRows[snapshotRows.length - 1];
    const latestCents = Number(last?.basket_value || 0);
    if (!latestCents) return { pnl: 0, pct: 0 };

    let startCents = 0;
    if (timeFilter === "5d" && snapshotRows.length >= 5) {
      startCents = Number(snapshotRows[snapshotRows.length - 5]?.basket_value || 0);
    } else if (timeFilter === "m" && snapshotRows.length >= 22) {
      startCents = Number(snapshotRows[snapshotRows.length - 22]?.basket_value || 0);
    } else {
      return { pnl: 0, pct: 0 };
    }

    if (!startCents) return { pnl: 0, pct: 0 };
    const pnl = (latestCents - startCents) / 100;
    const pct = ((latestCents - startCents) / startCents) * 100;
    return { pnl, pct: parseFloat(pct.toFixed(4)) };
  }, [snapshotRows, timeFilter]);


  // Derive locked message directly from availablePeriods + current filter — always in sync
  const _lockedLabels = { "5d": "Available after 5 trading days", m: "Available after 1 month", ytd: "Available after first full year", all: null };
  const lockedMessage = (!availablePeriods[timeFilter] && _lockedLabels[timeFilter]) ? _lockedLabels[timeFilter] : null;

  // sub-tab within the portfolio tab
  const [activeTab, setActiveTab] = useState("strategy");
  const [tabDirection, setTabDirection] = useState(0);
  const [tabRipple, setTabRipple] = useState(null);
  const tabOrder = ["strategy", "holdings"];

  // strategy dropdown
  const [showStrategyDropdown, setShowStrategyDropdown] = useState(false);
  const dropdownRef = useRef(null);
  useEffect(() => {
    if (!showStrategyDropdown) return;
    const handleClick = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowStrategyDropdown(false); };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showStrategyDropdown]);

  // holdings pagination
  const [holdingsPage, setHoldingsPage] = useState(0);
  const [expandedStrategyId, setExpandedStrategyId] = useState(null);
  const [failedLogos, setFailedLogos] = useState({});
  const [activePieIndex, setActivePieIndex] = useState(-1);

  // intraday D chart
  const [intradayChartData, setIntradayChartData] = useState(null);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const [intradayTick, setIntradayTick] = useState(0);

  // Poll every 60 seconds while on D view
  useEffect(() => {
    if (timeFilter !== "D") return;
    const id = setInterval(() => setIntradayTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, [timeFilter]);

  // ── live price map — polls every 15s directly from stock_intraday_c ──────
  // Skipped when livePriceMapProp is provided from ChildDashboardPage (shared poll)
  const [ownLivePriceMap, setOwnLivePriceMap] = useState({});
  const livePriceMap = livePriceMapProp ?? ownLivePriceMap;

  useEffect(() => {
    if (livePriceMapProp) return; // shared poll from parent handles it
    const stratId = selectedStrategy?.strategyId;
    if (!stratId) return;

    const securityIds = [...new Set(
      (rawHoldings || [])
        .filter(h => h.strategy_id === stratId && h.security_id)
        .map(h => h.security_id)
    )];
    if (securityIds.length === 0) return;

    const fetchPrices = async () => {
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
      setOwnLivePriceMap(map);
    };

    fetchPrices();
    const id = setInterval(fetchPrices, 15000);
    return () => clearInterval(id);
  }, [livePriceMapProp, selectedStrategy?.strategyId, rawHoldings]);

  // ── chart data ─────────────────────────────────────────────────────────────
  const currentStrategy = selectedStrategy || { name: strategiesLoading ? "Loading..." : "No Strategy", currentValue: 0, investedAmount: 0 };

  // ── live strategy metrics — computed from holdings instead of saved snapshot ──
  const liveStrategyMetrics = useMemo(() => {
    const stratId = selectedStrategy?.strategyId;
    const empty = { liveValue: 0, costBasis: 0, todayPnl: 0, todayPct: 0, isPending: true, hasPrices: false };
    if (!stratId) return empty;

    const stratHoldings = (rawHoldings || []).filter(h =>
      h.strategy_id === stratId &&
      Number(h.avg_fill || 0) > 0 &&
      !!h.Fill_date
    );
    if (stratHoldings.length === 0) return empty;

    let liveValue = 0;
    let costBasis = 0;
    let todayPnl = 0;
    let hasPrices = false;

    for (const h of stratHoldings) {
      const qty = Math.abs(Number(h.quantity || 0));

      // Prefer live price from 15s poll, fall back to rawHoldings intraday, then last_price
      const liveEntry = livePriceMap[h.security_id];
      const liveCents = liveEntry?.priceCents;
      const intraCents = Number(h.intraday_price_cents);
      const lastCents = Number(h.last_price);
      const priceCents = (liveCents > 0) ? liveCents : (Number.isFinite(intraCents) && intraCents > 0) ? intraCents : lastCents;
      if (Number.isFinite(priceCents) && priceCents > 0) {
        liveValue += (priceCents / 100) * qty;
        hasPrices = true;
      }

      // Match SwipeableBalanceCard: Expected_fill (client cost) with legacy-cents guard;
      // NOT higher-of — avg_fill carries MINT's spread, absorbed by the 8% buffer.
      const avgFillCents = Number(h.avg_fill || 0);
      const avgFillRands = avgFillCents / 100;
      const expectedRaw = Number(h.Expected_fill || 0);
      const expectedRands = expectedRaw > 0
        ? (expectedRaw > avgFillRands * 5 ? expectedRaw / 100 : expectedRaw)
        : 0;
      costBasis += (expectedRands > 0 ? expectedRands : avgFillRands) * qty;

      // Prefer live 1d_abs from poll, fall back to rawHoldings field
      const abs1d = liveEntry?.abs1dCents ?? Number(h.intraday_1d_abs_cents);
      if (Number.isFinite(abs1d)) {
        todayPnl += (abs1d / 100) * qty;
      }
    }

    const todayPct = costBasis > 0 ? (todayPnl / costBasis) * 100 : 0;
    return { liveValue, costBasis, todayPnl, todayPct, isPending: false, hasPrices };
  }, [rawHoldings, selectedStrategy?.strategyId, livePriceMap]);

  // ── intraday D chart — fetches 5-min bucketed prices from stock_intraday_c ──
  useEffect(() => {
    if (timeFilter !== "D") { setIntradayChartData(null); return; }
    const stratId = selectedStrategy?.strategyId;
    if (!stratId || liveStrategyMetrics.isPending) return;

    const stratHoldings = (rawHoldings || []).filter(h =>
      h.strategy_id === stratId && Number(h.avg_fill || 0) > 0 && !!h.Fill_date
    );
    if (stratHoldings.length === 0) return;

    const securityIds = [...new Set(stratHoldings.map(h => h.security_id).filter(Boolean))];
    const qtyMap = {};
    stratHoldings.forEach(h => { qtyMap[h.security_id] = Math.abs(Number(h.quantity || 0)); });

    let cancelled = false;
    setIntradayLoading(true);

    (async () => {
      try {
        // Find the most recent trading day that has intraday data (handles weekends/holidays)
        const { data: latestRow } = await supabase
          .from("stock_intraday_c")
          .select("timestamp")
          .in("security_id", securityIds)
          .order("timestamp", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (!latestRow) { setIntradayChartData([]); setIntradayLoading(false); return; }
        const tradingDay = latestRow.timestamp.slice(0, 10);

        // That trading day's intraday rows — paginate in batches of 1000 to bypass Supabase's server-side row cap
        const PAGE = 1000;
        let intradayRows = [];
        let page = 0;
        while (true) {
          const { data: batch } = await supabase
            .from("stock_intraday_c")
            .select("security_id, current_price, 1d_abs, timestamp")
            .in("security_id", securityIds)
            .gte("timestamp", `${tradingDay}T00:00:00Z`)
            .lt("timestamp", `${tradingDay}T23:59:59Z`)
            .order("timestamp", { ascending: true })
            .range(page * PAGE, (page + 1) * PAGE - 1);
          if (!batch?.length) break;
          intradayRows = intradayRows.concat(batch);
          if (batch.length < PAGE) break; // last page
          page++;
          if (cancelled) return;
        }

        if (cancelled) return;
        if (!intradayRows.length) { setIntradayChartData([]); setIntradayLoading(false); return; }

        // Derive yesterday's closing price per security from the latest 1d_abs value:
        // yesterday_close = current_price - 1d_abs  (1d_abs = today's change vs yesterday's close)
        const latestBySecId = {};
        for (const row of intradayRows) {
          latestBySecId[row.security_id] = row; // later rows overwrite earlier → we get the latest
        }
        const baselineRands = securityIds.reduce((sum, sid) => {
          const row = latestBySecId[sid];
          if (!row) return sum;
          const yesterdayCloseCents = Number(row.current_price) - Number(row["1d_abs"] || 0);
          return sum + (yesterdayCloseCents / 100) * (qtyMap[sid] || 0);
        }, 0) || liveStrategyMetrics.costBasis;

        // Group into 5-minute buckets
        const bucketMap = new Map();
        for (const row of intradayRows) {
          const d = new Date(row.timestamp);
          d.setSeconds(0, 0);
          d.setMinutes(Math.floor(d.getMinutes() / 5) * 5);
          const key = d.toISOString();
          if (!bucketMap.has(key)) bucketMap.set(key, {});
          bucketMap.get(key)[row.security_id] = Number(row.current_price);
        }

        const sorted = [...bucketMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
        const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const lastKnown = {};
        const points = [{ day: null, value: 0, fullDate: null }];

        for (const [isoKey, prices] of sorted) {
          for (const sid of securityIds) {
            if (prices[sid] != null) lastKnown[sid] = prices[sid];
          }
          if (Object.keys(lastKnown).length === 0) continue;

          const portfolioRands = securityIds.reduce((sum, sid) => {
            const price = lastKnown[sid];
            return price != null ? sum + (price / 100) * (qtyMap[sid] || 0) : sum;
          }, 0);

          const pnl = Number((portfolioRands - baselineRands).toFixed(2));

          // Convert UTC → SAST (+2h) for labels
          const d = new Date(isoKey);
          const sast = new Date(d.getTime() + 2 * 60 * 60 * 1000);
          const hh = String(sast.getUTCHours()).padStart(2, "0");
          const mm = String(sast.getUTCMinutes()).padStart(2, "0");
          const dd = sast.getUTCDate();
          const mo = MONTH_NAMES[sast.getUTCMonth()];
          const yr = sast.getUTCFullYear();

          points.push({ day: `${hh}:${mm}`, value: pnl, fullDate: `${dd} ${mo} ${yr} ${hh}:${mm}` });
        }

        if (!cancelled) setIntradayChartData(points.length > 1 ? points : []);
      } catch (e) {
        console.error("[intraday-chart]", e);
        if (!cancelled) setIntradayChartData([]);
      } finally {
        if (!cancelled) setIntradayLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [timeFilter, selectedStrategy?.strategyId, rawHoldings, familyMemberId, liveStrategyMetrics.costBasis, liveStrategyMetrics.isPending, intradayTick]);

  const currentChartData = useMemo(() => {
    if (realChartData && realChartData.length > 0) {
      if (realChartData[0]?.day === null && realChartData[0]?.value === 0) return realChartData;
      const cv = liveStrategyMetrics.hasPrices ? liveStrategyMetrics.liveValue : (currentStrategy.currentValue || 0);
      const ia = liveStrategyMetrics.costBasis || currentStrategy.investedAmount || 0;
      if (cv > 0 && realChartData.length > 0) {
        const latestNav = realChartData[realChartData.length - 1].value;
        if (!latestNav || latestNav <= 0) return [];
        const scale = cv / latestNav;
        const pts = [{ ...realChartData[0], day: null, value: 0 }];
        realChartData.forEach(d => pts.push({ ...d, value: Number(((d.value * scale) - ia).toFixed(2)) }));
        return pts;
      }
    }
    return [];
  }, [realChartData, currentStrategy, liveStrategyMetrics]);

  const isLoadingData = strategiesLoading || chartLoading || (timeFilter === "D" && intradayLoading);

  // Use intraday buckets for D; return [] while loading so the skeleton shows instead of a flat line
  const displayChartData = (() => {
    if (isLoadingData) return [];
    if (timeFilter === "D") return (intradayChartData && intradayChartData.length > 1 ? intradayChartData : []);
    return currentChartData;
  })();

  const stratAxisConfig = computePnlAxisConfig(displayChartData);

  // ── holdings data (for Holdings tab) ──────────────────────────────────────
  const allStrategyHoldings = useMemo(() => {
    // Build symbol→logo_url lookup from rawHoldings (always enriched from securities_c)
    const logoBySymbol = {};
    (rawHoldings || []).forEach(h => { if (h.symbol && h.logo_url) logoBySymbol[h.symbol] = h.logo_url; });

    const holdingsMap = new Map();
    const standalone = (rawHoldings || []).filter(h => !h.strategy_id);
    const totalStandaloneVal = standalone.reduce((s, h) => {
      const mv = h.last_price != null && h.quantity != null ? (h.last_price * h.quantity) / 100 : (h.market_value || 0) / 100;
      return s + mv;
    }, 0);
    standalone.forEach(h => {
      const sym = h.symbol || "N/A";
      const currentValue = h.last_price != null && h.quantity != null ? (h.last_price * h.quantity) / 100 : (h.market_value || 0) / 100;
      const costBasis = ((h.avg_fill || 0) * (h.quantity || 0)) / 100;
      const changePct = costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0;
      const weight = totalStandaloneVal > 0 ? (currentValue / totalStandaloneVal) * 100 : 0;
      holdingsMap.set(sym, { symbol: sym, name: h.name || "Unknown", weight, logo: h.logo_url || null, securityId: h.security_id || null, currentValue, costBasis, change: changePct, isPending: !h.avg_fill || Number(h.avg_fill) === 0 });
    });

    strategies.forEach(s => {
      const sym = s.shortName || s.name || "Strategy";
      if (!holdingsMap.has(sym)) {
        const holdingsArr = s.holdings || [];
        // Enrich each holding with logo from rawHoldings if strategies_c JSONB doesn't have it
        const enrichedHoldings = holdingsArr.map(h => ({
          ...h,
          logo_url: h.logo_url || logoBySymbol[h.symbol] || logoBySymbol[h.ticker] || null,
        }));
        const topLogos = enrichedHoldings
          .slice()
          .sort((a, b) => (b.weight || 0) - (a.weight || 0))
          .slice(0, 5)
          .map(h => h.logo_url)
          .filter(Boolean);
        const sCv = s.currentValue || s.investedAmount || 0;
        const sIa = s.investedAmount || 0;
        const sPnlPct = sIa > 0 ? ((sCv - sIa) / sIa) * 100 : 0;
        const stratRaw = (rawHoldings || []).filter(h => h.strategy_id === (s.strategyId || s.id));
        const isPending = stratRaw.length > 0 && stratRaw.every(h => !h.avg_fill);
        holdingsMap.set(sym, { symbol: sym, name: s.name || "Strategy", strategyId: s.strategyId || s.id, weight: 0, logo: null, isStrategy: true, isPending, topLogos, strategyHoldings: enrichedHoldings, currentValue: sCv, investedAmount: sIa, change: sPnlPct, ytd_return: s.ytd_pct != null ? s.ytd_pct : s.metrics?.r_ytd });
      }
    });

    const totalVal = Array.from(holdingsMap.values()).reduce((s, h) => s + h.currentValue, 0);
    if (totalVal > 0) holdingsMap.forEach(h => { h.weight = (h.currentValue / totalVal) * 100; });
    return Array.from(holdingsMap.values()).sort((a, b) => b.weight - a.weight);
  }, [rawHoldings, strategies]);

  // ── pie data ───────────────────────────────────────────────────────────────
  const flatPieData = useMemo(() => {
    const map = new Map();
    allStrategyHoldings.forEach(h => {
      if (h.isStrategy && h.strategyHoldings?.length > 0) {
        const totalW = h.strategyHoldings.reduce((s, c) => s + (c.weight || 0), 0) || 100;
        h.strategyHoldings.forEach(c => {
          const key = c.symbol || c.name;
          const val = h.currentValue * ((c.weight || 0) / totalW);
          if (map.has(key)) map.get(key).value += val;
          else map.set(key, { name: key, displayName: c.name || key, value: val });
        });
      } else if (!h.isStrategy) {
        const key = h.symbol;
        if (map.has(key)) map.get(key).value += h.currentValue;
        else map.set(key, { name: key, displayName: h.name, value: h.currentValue });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [allStrategyHoldings]);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-full">
      {/* STRATEGIES / HOLDINGS pill tabs */}
      <div className="flex gap-2 px-4 mb-4 justify-center">
        {[{ id: "strategy", label: "Strategies" }, { id: "holdings", label: "Holdings" }].map((tab) => (
          <button
            key={tab.id}
            onClick={(e) => {
              if (tab.id === activeTab) return;
              const rect = e.currentTarget.getBoundingClientRect();
              setTabRipple({ id: tab.id, x: e.clientX - rect.left, y: e.clientY - rect.top, key: Date.now() });
              setTabDirection(tabOrder.indexOf(tab.id) > tabOrder.indexOf(activeTab) ? 1 : -1);
              setActiveTab(tab.id);
            }}
            className={`relative overflow-hidden px-5 py-2.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.18em] transition-all duration-300 ${
              activeTab === tab.id
                ? "bg-violet-500 text-white shadow-lg shadow-violet-500/30"
                : "border border-slate-300 text-slate-500 bg-white hover:bg-slate-50"
            }`}
          >
            {tabRipple && tabRipple.id === tab.id && (
              <motion.span
                key={tabRipple.key}
                className="absolute rounded-full pointer-events-none"
                style={{ left: tabRipple.x, top: tabRipple.y, background: "radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(139,92,246,0.3) 50%, transparent 70%)", transform: "translate(-50%, -50%)" }}
                initial={{ width: 0, height: 0, opacity: 0.8 }}
                animate={{ width: 300, height: 300, opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                onAnimationComplete={() => setTabRipple(null)}
              />
            )}
            <span className="relative z-10">{tab.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {/* ── STRATEGIES TAB ── */}
        {activeTab === "strategy" && (
          <motion.div
            key="strategy"
            initial={{ opacity: 0, x: tabDirection * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: tabDirection * -40 }}
            transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <motion.div variants={container} initial="hidden" animate="show" className="px-4 pb-6 space-y-4">
              {strategies.length === 0 && !strategiesLoading ? (
                <motion.div variants={item} className="rounded-3xl bg-white p-8 shadow-sm border border-slate-100 text-center">
                  <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-violet-50 flex items-center justify-center">
                    <TrendingUp className="h-7 w-7 text-violet-500" />
                  </div>
                  <p className="text-base font-semibold text-slate-900 mb-1">No strategies yet</p>
                  <p className="text-sm text-slate-500 mb-5">Start investing on {child?.first_name || "their"}'s behalf to build their portfolio.</p>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={onOpenInvest}
                    className="w-full py-3 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg"
                  >
                    Browse Strategies
                  </motion.button>
                </motion.div>
              ) : (
                <>
                  {/* Hero card: strategy selector, value + P&L, equity curve —
                      glass card + soft purple glow so it reads as a real "hero",
                      matching the Home tab's balance card instead of floating flat. */}
                  <motion.div variants={item} className="relative rounded-[28px] bg-white/90 backdrop-blur-xl p-5 shadow-xl border border-white/70 overflow-hidden">
                    <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-violet-300/20 blur-3xl" />
                    <div className="pointer-events-none absolute -bottom-14 -left-10 h-40 w-40 rounded-full bg-purple-300/15 blur-3xl" />
                  <div className="relative flex items-center justify-between">
                    <div className="relative" ref={dropdownRef}>
                      <button
                        onClick={() => setShowStrategyDropdown(!showStrategyDropdown)}
                        className="flex items-center gap-0.5 text-slate-900 hover:text-slate-700 transition"
                      >
                        <span className="text-lg font-semibold tracking-tight truncate max-w-[180px]">
                          {currentStrategy.name || "Strategy"}
                        </span>
                        <ChevronDown className={`h-5 w-5 transition-transform duration-200 ${showStrategyDropdown ? "rotate-180" : ""}`} />
                      </button>
                      {showStrategyDropdown && strategies.length > 0 && (
                        <div className="absolute top-full left-0 mt-2 min-w-[200px] max-h-[280px] overflow-y-auto bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/50 z-50">
                          {strategies.map((s) => (
                            <button
                              key={s.strategyId}
                              onClick={() => { selectStrategy(s); setShowStrategyDropdown(false); }}
                              className={`w-full px-4 py-3.5 text-left hover:bg-purple-50/50 transition border-b border-slate-100/50 last:border-b-0 ${selectedStrategy?.strategyId === s.strategyId ? "bg-purple-50" : ""}`}
                            >
                              <p className="font-medium text-slate-800 text-sm">{s.name}</p>
                              <p className="text-xs text-slate-400 mt-0.5 tabular-nums">{fmt(s.currentValue || 0)}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-1">
                      {[{ id: "D", label: "D" }, { id: "5d", label: "5D" }, { id: "m", label: "M" }, { id: "ytd", label: "YTD" }].map((f) => {
                        return (
                          <button
                            key={f.id}
                            onClick={() => {
                              setTabJustChanged(true);
                              setTimeFilter(f.id);
                              clearTimeout(tabJustChangedTimer.current);
                              tabJustChangedTimer.current = setTimeout(() => setTabJustChanged(false), 800);
                            }}
                            className={`px-3 h-8 rounded-full text-xs font-bold transition-all ${
                              timeFilter === f.id
                                ? "bg-slate-700 text-white shadow"
                                : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Value + P&L */}
                  <div>
                    {(() => {
                      const cv = liveStrategyMetrics.hasPrices ? liveStrategyMetrics.liveValue : (currentStrategy.currentValue || 0);
                      const ia = liveStrategyMetrics.costBasis || currentStrategy.investedAmount || 0;
                      const isPending = liveStrategyMetrics.isPending;
                      const livePnl = liveStrategyMetrics.liveValue - liveStrategyMetrics.costBasis;
                      const livePct = ia > 0 ? (livePnl / ia) * 100 : 0;
                      // True YTD: live value vs earliest snapshot of current year, not inception cost.
                      // Only applies if the child had investments BEFORE this year — otherwise YTD = ALL.
                      const currentYear = new Date().getFullYear();
                      const hasPriorYearData = snapshotRows.some(r => r.as_of_date < `${currentYear}-01-01`);
                      const yearStartRow = hasPriorYearData ? snapshotRows.find(r => r.as_of_date >= `${currentYear}-01-01`) : null;
                      const yearStartRands = yearStartRow ? Number(yearStartRow.basket_value || 0) / 100 : null;
                      const ytdPnl = yearStartRands ? liveStrategyMetrics.liveValue - yearStartRands : livePnl;
                      const ytdPct = yearStartRands ? (ytdPnl / yearStartRands) * 100 : livePct;
                      const pnl = timeFilter === "D"
                        ? liveStrategyMetrics.todayPnl
                        : timeFilter === "ytd"
                          ? ytdPnl
                          : timeFilter === "all"
                            ? livePnl
                            : (periodReturnData?.pnl !== undefined && periodReturnData.pnl !== 0 ? periodReturnData.pnl : (derivedPeriodReturn.pnl !== 0 ? derivedPeriodReturn.pnl : livePnl));
                      const pnlPct = timeFilter === "D"
                        ? liveStrategyMetrics.todayPct
                        : timeFilter === "ytd"
                          ? ytdPct
                          : timeFilter === "all"
                            ? livePct
                            : (periodReturnData?.pct !== undefined && periodReturnData.pct !== 0 ? periodReturnData.pct : (derivedPeriodReturn.pct !== 0 ? derivedPeriodReturn.pct : (ia > 0 ? (pnl / ia) * 100 : 0)));
                      const isPos = pnl >= 0;
                      if (isPending) return <p className="text-3xl font-bold text-slate-900">R0,00</p>;
                      return (
                        <>
                          <p className="text-3xl font-bold text-slate-900">{fmt(cv)}</p>
                          {!lockedMessage && tabJustChanged && (
                            <div className="flex items-center gap-2 mt-1">
                              <div className="h-4 w-16 bg-slate-200 rounded-full animate-pulse" />
                              <div className="h-4 w-10 bg-slate-200 rounded-full animate-pulse" />
                            </div>
                          )}
                      {!lockedMessage && !tabJustChanged && (
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-sm font-semibold ${isPos ? "text-emerald-500" : "text-rose-500"}`}>
                                {isPos ? "+" : "-"}{fmt(Math.abs(pnl))}
                              </span>
                              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${isPos ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>
                                {isPos ? "+" : ""}{pnlPct.toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  {/* Equity curve chart */}
                  <div style={{ width: "100%", height: 200 }}>
                    {lockedMessage ? (
                      <div className="h-full flex flex-col items-center justify-center gap-2">
                        <span className="text-2xl">📈</span>
                        <p className="text-slate-500 text-sm font-medium">{lockedMessage}</p>
                        <p className="text-slate-400 text-xs">Check back once more data has been recorded</p>
                      </div>
                    ) : isLoadingData ? (
                      <div className="h-full w-full px-1 pb-6 pt-2">
                        <svg width="100%" height="100%" viewBox="0 0 300 160" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="skeletonFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.6" />
                              <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.05" />
                            </linearGradient>
                          </defs>
                          {/* filled area under the line */}
                          <path
                            d="M0 110 C30 100 50 80 80 70 S120 50 150 60 S200 90 230 75 S270 45 300 55 L300 160 L0 160 Z"
                            fill="url(#skeletonFill)"
                            className="animate-pulse"
                          />
                          {/* the line itself */}
                          <path
                            d="M0 110 C30 100 50 80 80 70 S120 50 150 60 S200 90 230 75 S270 45 300 55"
                            fill="none"
                            stroke="#cbd5e1"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            className="animate-pulse"
                          />
                        </svg>
                      </div>
                    ) : displayChartData.length === 0 ? (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-slate-400 text-sm">No data available</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={displayChartData} margin={{ top: 8, right: 12, left: 4, bottom: 24 }}>
                          <defs>
                            <linearGradient id="childGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
                              <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.02" />
                            </linearGradient>
                          </defs>
                          <XAxis
                            dataKey="day"
                            axisLine={false}
                            tickLine={false}
                            tickMargin={8}
                            ticks={timeFilter === 'ytd' ? computeChildYtdTicks(displayChartData) : undefined}
                            interval={timeFilter === 'ytd' ? 0 : (displayChartData.length <= 8 ? 0 : Math.max(0, Math.ceil(displayChartData.length / 4) - 1))}
                            tick={({ x, y, payload }) => {
                              if (!payload.value) return null;
                              const val = String(payload.value);
                              let label;
                              if (timeFilter === 'ytd') {
                                const parts = val.split(' ');
                                label = isNaN(Number(parts[0])) ? parts[0] : parts[1];
                              } else if (timeFilter === 'm' || timeFilter === '5d') {
                                const parts = val.split(' ');
                                label = parts.length >= 3 ? parts.slice(0, 2).join(' ') : val;
                              } else {
                                label = val;
                              }
                              return <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={10} fontWeight={500}>{label}</text>;
                            }}
                          />
                          <YAxis domain={stratAxisConfig.domain} ticks={stratAxisConfig.ticks} tickFormatter={formatPnlAxis} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} width={50} />
                          <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth={1} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (active && payload?.length) {
                                const val = payload[0].value;
                                const isPos = val >= 0;
                                return (
                                  <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-1.5 shadow-md">
                                    <div className="text-xs text-slate-500 mb-0.5">{payload[0]?.payload?.fullDate || ""}</div>
                                    <div className={`text-sm font-bold ${isPos ? "text-violet-700" : "text-rose-600"}`}>
                                      {isPos ? "+" : "-"}{fmt(Math.abs(val))}
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            }}
                            cursor={false}
                            wrapperStyle={{ outline: "none" }}
                          />
                          <Area type="monotone" dataKey="value" stroke="none" fill="url(#childGradient)" fillOpacity={1} />
                          <Line type="monotone" dataKey="value" stroke="#7c3aed" strokeWidth={2.5} strokeLinecap="round" dot={false} activeDot={{ r: 6, fill: "#7c3aed", stroke: "#c4b5fd", strokeWidth: 2 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  </motion.div>

                  {/* Portfolio Holdings */}
                  {allStrategyHoldings.length > 0 && (
                    <motion.div variants={item} className="rounded-3xl bg-white/80 backdrop-blur-xl p-5 shadow-sm border border-slate-100">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900 mb-1">Portfolio Holdings</p>
                      <p className="text-xs text-slate-400 mb-4">All holdings by weight</p>
                      <div className="space-y-3">
                        {allStrategyHoldings.map((h) => (
                          <div key={h.symbol} className="flex items-center justify-between">
                            {h.isStrategy && h.topLogos?.length > 0 ? (
                              <div className="flex-1 min-w-0">
                                <div className="flex -space-x-2 mb-2">
                                  {h.topLogos.slice(0, 5).map((logo, li) => (
                                    <img key={li} src={logo} className="w-7 h-7 rounded-full object-cover border-2 border-white shadow-sm" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                                  ))}
                                </div>
                                <p className="text-sm font-bold tracking-[0.18em] uppercase text-slate-900">{h.name}</p>
                                <p className="text-xs text-slate-500">{(h.strategyHoldings || []).length > 0 ? `${h.strategyHoldings.length} assets` : h.symbol}</p>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 overflow-hidden flex-shrink-0">
                                  {failedLogos[h.symbol] || !h.logo ? (
                                    <span className="text-xs font-bold text-slate-600">{h.symbol.slice(0, 3)}</span>
                                  ) : (
                                    <img src={h.logo} alt={h.name} className="h-8 w-8 object-contain" referrerPolicy="no-referrer" crossOrigin="anonymous" onError={() => setFailedLogos(prev => ({ ...prev, [h.symbol]: true }))} />
                                  )}
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{h.symbol}</p>
                                  <p className="text-xs text-slate-500">{h.name}</p>
                                </div>
                              </div>
                            )}
                            <div className="text-right flex-shrink-0">
                              <p className={`text-sm font-semibold ${h.change >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                {h.change >= 0 ? "+" : ""}{h.change.toFixed(1)}%
                              </p>
                              <p className="text-[10px] text-slate-400">{h.weight.toFixed(1)}% of portfolio</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Invest / Withdraw CTAs */}
                  <motion.div variants={item}>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={onOpenInvest}
                      className="w-full py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg"
                    >
                      Invest More
                    </motion.button>

                    {/* Withdraw — sell the child's holdings (parent-operated). */}
                    {onWithdraw && (
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={onWithdraw}
                        className="mt-3 w-full py-3.5 rounded-full border border-slate-200 bg-white text-sm font-semibold uppercase tracking-[0.1em] text-slate-700 shadow-sm"
                      >
                        Withdraw
                      </motion.button>
                    )}
                  </motion.div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}

        {/* ── HOLDINGS TAB ── */}
        {activeTab === "holdings" && (
          <motion.div
            key="holdings"
            initial={{ opacity: 0, x: tabDirection * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: tabDirection * -40 }}
            transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {(() => {
              const holdingsData = allStrategyHoldings.sort((a, b) => b.currentValue - a.currentValue);

              if (holdingsData.length === 0) {
                return (
                  <div className="px-4 pb-6">
                    <div className="rounded-3xl bg-white p-8 shadow-sm border border-slate-100 text-center">
                      <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-violet-50 flex items-center justify-center">
                        <TrendingUp className="h-7 w-7 text-violet-500" />
                      </div>
                      <p className="text-base font-semibold text-slate-900 mb-1">No holdings yet</p>
                      <p className="text-sm text-slate-500">Investment holdings will appear here once you start investing.</p>
                    </div>
                  </div>
                );
              }

              const totalValue = holdingsData.reduce((s, h) => s + h.currentValue, 0);
              const totalDistinct = flatPieData.length;
              const top10 = flatPieData.slice(0, 10).map((h, idx) => ({ ...h, color: PIE_COLORS[idx % PIE_COLORS.length] }));
              const othersValue = flatPieData.slice(10).reduce((s, h) => s + h.value, 0);
              const pieData = othersValue > 0 ? [...top10, { name: "Others", displayName: "Others", value: othersValue, color: "#E9D5FF" }] : top10;

              const HOLDINGS_PER_PAGE = 6;
              const totalPages = Math.ceil(holdingsData.length / HOLDINGS_PER_PAGE);
              const pagedHoldings = holdingsData.slice(holdingsPage * HOLDINGS_PER_PAGE, (holdingsPage + 1) * HOLDINGS_PER_PAGE);

              return (
                <motion.div variants={container} initial="hidden" animate="show" className="px-4 pb-6 space-y-4">
                  {/* Summary card with pie chart */}
                  <motion.div variants={item} className="rounded-3xl bg-white/80 backdrop-blur-xl p-5 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-3">
                        <div>
                          <p className="text-xs text-slate-500 mb-0.5">Total Portfolio Value</p>
                          <p className="text-2xl font-bold text-slate-900">{fmt(totalValue)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-3xl font-bold text-slate-900">{totalDistinct}</p>
                          <div className="flex flex-col justify-center">
                            <p className="text-xs text-slate-500 leading-tight">Total Holdings</p>
                            <p className="text-xs text-slate-500 leading-tight">assets</p>
                          </div>
                        </div>
                      </div>
                      <div className="relative h-44 w-44 -mr-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <defs>
                              <filter id="childGlow">
                                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                                <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                              </filter>
                            </defs>
                            <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} paddingAngle={2} dataKey="value" stroke="rgba(255,255,255,0.9)" strokeWidth={1.5} animationBegin={0} animationDuration={800}>
                              {pieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color}
                                  opacity={activePieIndex >= 0 && activePieIndex !== index ? 0.4 : 1}
                                  style={{ transform: activePieIndex === index ? "scale(1.1)" : activePieIndex >= 0 ? "scale(0.94)" : "scale(1)", transformOrigin: "center", transition: "transform 0.6s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.5s ease-out", cursor: "pointer", filter: activePieIndex === index ? "url(#childGlow)" : "none" }}
                                  onMouseEnter={() => setActivePieIndex(index)}
                                  onMouseLeave={() => setActivePieIndex(-1)}
                                  onClick={() => setActivePieIndex(activePieIndex === index ? -1 : index)}
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              wrapperStyle={{ outline: "none", zIndex: 100 }}
                              position={{ x: -80, y: -10 }}
                              content={({ active, payload }) => {
                                if (active && payload?.length) {
                                  const d = payload[0].payload;
                                  const pct = ((d.value / totalValue) * 100).toFixed(1);
                                  return (
                                    <div className="px-3 py-2 rounded-xl shadow-xl border border-white/20 bg-white/95 backdrop-blur-xl text-center min-w-[70px]">
                                      <p className="text-xs font-bold text-slate-800">{d.displayName || d.name}</p>
                                      <p className="text-base font-bold text-violet-600">{pct}%</p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </motion.div>

                  {/* YOUR ASSETS list */}
                  <motion.div variants={item} className="rounded-3xl bg-white/80 backdrop-blur-xl p-5 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">Your Assets</p>
                      {totalPages > 1 && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => setHoldingsPage(p => Math.max(0, p - 1))} disabled={holdingsPage === 0} className={`h-7 w-7 rounded-full flex items-center justify-center transition ${holdingsPage === 0 ? "text-slate-300" : "text-slate-600 hover:bg-slate-100"}`}>
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <span className="text-xs font-medium text-slate-400 tabular-nums">{holdingsPage + 1}/{totalPages}</span>
                          <button onClick={() => setHoldingsPage(p => Math.min(totalPages - 1, p + 1))} disabled={holdingsPage >= totalPages - 1} className={`h-7 w-7 rounded-full flex items-center justify-center transition ${holdingsPage >= totalPages - 1 ? "text-slate-300" : "text-slate-600 hover:bg-slate-100"}`}>
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-3">
                      {pagedHoldings.map((stock) => {
                        const pctValue = totalValue > 0 ? ((stock.currentValue / totalValue) * 100) : 0;
                        const isExpanded = stock.isStrategy && expandedStrategyId === stock.strategyId;
                        const changePnl = stock.change || 0;
                        return (
                          <div key={stock.symbol}>
                            <div
                              className={`rounded-2xl bg-white/70 backdrop-blur-xl p-4 shadow-sm border transition-all duration-200 cursor-pointer active:scale-[0.98] ${stock.isStrategy ? "border-violet-100/60" : "border-slate-100/50"}`}
                              onClick={() => stock.isStrategy && setExpandedStrategyId(isExpanded ? null : stock.strategyId)}
                            >
                              {stock.isStrategy && stock.topLogos?.length > 0 ? (
                                <div className="w-full">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex -space-x-2">
                                      {stock.topLogos.slice(0, 5).map((logo, li) => (
                                        <img key={li} src={logo} className="w-7 h-7 rounded-full object-cover border-2 border-white shadow-sm" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <div className="text-right flex-shrink-0">
                                        <p className="text-sm font-bold text-slate-900">{stock.isPending ? "—" : fmt(stock.currentValue)}</p>
                                        {stock.isPending ? (
                                          <p className="text-xs text-violet-600 font-semibold">Pending</p>
                                        ) : (
                                          <p className={`text-xs font-semibold ${changePnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                                            {changePnl >= 0 ? "+" : ""}{changePnl.toFixed(1)}% Total Return
                                          </p>
                                        )}
                                        <p className="text-[10px] text-slate-400">{pctValue.toFixed(1)}% of portfolio</p>
                                      </div>
                                      <ChevronDown className={`h-4 w-4 text-slate-400 flex-shrink-0 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`} />
                                    </div>
                                  </div>
                                  <p className="text-sm font-bold tracking-[0.18em] uppercase text-slate-900">{stock.name}</p>
                                  <p className="text-xs text-slate-500 font-medium mt-0.5">{(stock.strategyHoldings || []).length} assets</p>
                                </div>
                              ) : (
                                <div className="flex items-center gap-3 w-full">
                                  <div className="h-11 w-11 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                    {!stock.logo || failedLogos[stock.symbol] ? (
                                      <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-violet-100 to-purple-100 text-xs font-bold text-violet-700">{(stock.symbol || "").slice(0, 2)}</div>
                                    ) : (
                                      <img src={stock.logo} alt={stock.name} className="h-full w-full object-cover" onError={() => setFailedLogos(prev => ({ ...prev, [stock.symbol]: true }))} />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-900 truncate">{stock.name}</p>
                                    <p className="text-xs text-slate-500 font-medium">{stock.symbol}</p>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="text-sm font-bold text-slate-900">{stock.isPending ? "—" : fmt(stock.currentValue)}</p>
                                    {stock.isPending ? (
                                      <p className="text-xs text-violet-600 font-semibold">Pending</p>
                                    ) : (
                                      <p className={`text-xs font-semibold ${changePnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                                        {changePnl >= 0 ? "+" : ""}{changePnl.toFixed(1)}%
                                      </p>
                                    )}
                                    <p className="text-[10px] text-slate-400">{pctValue.toFixed(1)}% of portfolio</p>
                                  </div>
                                </div>
                              )}
                            </div>
                            {/* Expanded constituent stocks */}
                            {isExpanded && stock.strategyHoldings?.length > 0 && (
                              <div className="mt-1.5 ml-3 space-y-1.5 border-l-2 border-violet-100 pl-3">
                                {stock.strategyHoldings.map((c, ci) => {
                                  const totalW = stock.strategyHoldings.reduce((s, x) => s + (x.weight || 0), 0) || 100;
                                  const fraction = (c.weight || 0) / totalW;
                                  const cVal = stock.currentValue * fraction;
                                  const cBasis = (stock.investedAmount || stock.currentValue) * fraction;
                                  const cPnl = cVal - cBasis;
                                  const isGain = cPnl >= 0;
                                  return (
                                    <div key={ci} className="rounded-xl bg-white/80 p-3 border border-slate-100 flex items-center gap-3">
                                      <div className="h-8 w-8 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                        {c.logo_url ? <img src={c.logo_url} className="h-full w-full object-cover" referrerPolicy="no-referrer" crossOrigin="anonymous" /> : <div className="h-full w-full flex items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">{(c.symbol || "").slice(0, 2)}</div>}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-semibold text-slate-800 truncate">{c.symbol}</p>
                                        <p className="text-[10px] text-slate-500 truncate">{c.name}</p>
                                      </div>
                                      <div className="text-right flex-shrink-0">
                                        <p className={`text-xs font-semibold ${isGain ? "text-emerald-500" : "text-rose-500"}`}>{isGain ? "+" : "-"}{fmt(Math.abs(cPnl))}</p>
                                        <p className="text-[10px] text-slate-400">{((c.weight || 0) / totalW * 100).toFixed(1)}%</p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Cash reserve — the held 8% execution buffer + any
                          rebalance residual. Same purple coin as the parent. */}
                      {childCashRands > 0 && (
                        <div className="rounded-2xl bg-white/70 backdrop-blur-xl p-4 shadow-sm border border-violet-100/50">
                          <div className="flex items-center gap-3 w-full">
                            <div className="h-11 w-11 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "#7C3AED" }}>
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 6v2m0 8v2M9.5 9.5C9.5 8.4 10.6 7.5 12 7.5s2.5.9 2.5 2c0 2-5 2-5 4 0 1.1 1.1 2 2.5 2s2.5-.9 2.5-2" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900">Cash</p>
                              <p className="text-xs text-slate-500 font-medium">Execution reserve &amp; residual</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-sm font-bold text-slate-900">{fmt(childCashRands)}</p>
                              <p className="text-[10px] text-slate-400">{totalValue + childCashRands > 0 ? ((childCashRands / (totalValue + childCashRands)) * 100).toFixed(1) : "0.0"}% of portfolio</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ChildPortfolioTab;
