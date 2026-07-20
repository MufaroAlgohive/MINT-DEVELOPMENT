import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Eye, EyeOff, ChevronDown, ChevronRight, ChevronLeft, ArrowLeft, TrendingUp, TrendingDown, Plus, ArrowUpRight, HelpCircle } from "lucide-react";
import SpotlightTour from "../components/SpotlightTour";
import { hasSeenAnimation, markAnimationSeen } from "../lib/animationSeen.js";

// First-timer walkthrough for the Portfolio page. Steps whose section isn't on
// the page (e.g. no goals yet) are skipped automatically by SpotlightTour.
const PF_TOUR_SEEN_KEY = "mint_pf_tour_seen_v1";
const PF_TOUR_STEPS = [
  { selector: '[data-coach-pf-summary]', title: "Total Portfolio Value", body: "Everything your money is worth right now, plus how many assets you hold across baskets, stocks and cash. It updates live with the market." },
  { selector: '[data-coach-pf-pie]', title: "Your money at a glance", body: "Each slice of this chart is one of your assets — the bigger the slice, the more of your portfolio it makes up. Tap a slice to highlight it." },
  { selector: '[data-coach-pf-assets]', title: "Your Assets", body: "Every basket and stock you own, with its live value, total return, and share of your portfolio. Cash is here too — your execution reserve and rebalance leftovers, shown as Buffer & residual." },
  { selector: '[data-coach-pf-other]', title: "Other Stocks", body: "Stocks on MINT that you don't own yet. Tap any of them to see its live price and chart — a quick way to scout your next investment." },
  { selector: '[data-coach-pf-goals]', title: "Your Goals", body: "Your savings goals live here — each shows its target date, how much you've put in, and how far you still have to go. Investing toward a goal fills the bar." },
  { selector: '[data-coach-pf-withdraw]', title: "Cash out anytime", body: "When you want your money back, tap Withdraw to sell a holding or a whole basket. The proceeds are credited straight to your wallet." },
];
import { Area, ComposedChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, ReferenceLine } from 'recharts';
import { useInvestments } from "../lib/useFinancialData";
import { useRealtimePrices } from "../lib/useRealtimePrices";
import { useProfile } from "../lib/useProfile";
import { useUserStrategies, useStrategyChartData, useStrategyLivePeriodReturn } from "../lib/useUserStrategies";
import { getMonthlyReturns, getStockMonthlyReturns, getOverallPortfolioMonthlyReturns, getStrategyMonthlyReturnsFromDB } from "../lib/strategyData";
import { useStockQuotes, useStockChart, useStockReturns } from "../lib/useStockData";
import { clearMarketDataCache } from "../lib/marketData";
import { supabase } from "../lib/supabase";
import SwipeBackWrapper from "../components/SwipeBackWrapper.jsx";
import PortfolioSkeleton from "../components/PortfolioSkeleton";
import SettlementBadge from "../components/PendingBadge";
import FamilyDropdown from "../components/FamilyDropdown";



const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const computeYtdMonthTicks = (chartData) => {
  const seen = new Set();
  return chartData
    .filter(pt => {
      if (!pt.day) return false;
      const mon = pt.day.split(' ')[1];
      if (!mon || seen.has(mon)) return false;
      seen.add(mon);
      return true;
    })
    .map(pt => pt.day);
};

const formatPnlAxis = (value) => {
  const num = Number(value);
  if (Math.abs(num) < 0.5) return "R0";
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  if (abs >= 1e6) return `${sign}R${(abs / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${sign}R${(abs / 1e3).toFixed(0)}k`;
  return `${sign}R${abs.toFixed(0)}`;
};

const computePnlAxisConfig = (data, dataKey = "value") => {
  if (!data || data.length === 0) return { domain: [-10, 10], ticks: [-10, 0, 10] };
  const values = data.map((p) => p[dataKey]);
  let dataMin = Math.min(...values);
  let dataMax = Math.max(...values);
  if (Math.abs(dataMax - dataMin) < 1) {
    dataMin = Math.min(dataMin, -5);
    dataMax = Math.max(dataMax, 5);
  }
  let axisMin, axisMax;
  if (dataMin >= 0) {
    axisMin = 0;
    axisMax = dataMax * 1.15 || 10;
  } else if (dataMax <= 0) {
    axisMin = dataMin * 1.15 || -10;
    axisMax = 0;
  } else {
    const absMax = Math.max(Math.abs(dataMin), Math.abs(dataMax));
    axisMin = -(absMax * 1.15);
    axisMax = absMax * 1.15;
  }
  const totalRange = axisMax - axisMin;
  const step = Math.round(totalRange / 3) || 1;
  const ticks = [];
  let t = Math.round(axisMin);
  while (t <= axisMax + 0.5) { ticks.push(t); t += step; }
  if (!ticks.includes(0)) { ticks.push(0); ticks.sort((a, b) => a - b); }
  const unique = [...new Set(ticks)].sort((a, b) => a - b);
  return { domain: [axisMin, axisMax], ticks: unique.length >= 2 ? unique : [0, 5, 10] };
};

const getReturnColor = (value) => {
  if (value == null) return "bg-slate-50 text-slate-600";
  if (value > 0) return "bg-emerald-50 text-emerald-600";
  if (value < 0) return "bg-rose-50 text-rose-600";
  return "bg-slate-50 text-slate-600";
};


const NewPortfolioPage = ({ onOpenNotifications, onOpenInvest, onOpenStrategies, onBack, deepLink, onDeepLinkConsumed, onOpenStockDetail, onWithdraw, isActive = false }) => {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [showTour, setShowTour] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );
  const [activeTab, setActiveTab] = useState("holdings");
  const [timeFilter, setTimeFilter] = useState("ytd");
  const [failedLogos, setFailedLogos] = useState({});
  const [currentView, setCurrentView] = useState("portfolio");
  const [showStrategyDropdown, setShowStrategyDropdown] = useState(false);
  const [activePieIndex, setActivePieIndex] = useState(-1);
  const [selectedStock, setSelectedStock] = useState(null);
  const [showStockDropdown, setShowStockDropdown] = useState(false);
  const [stockTimeFilter, setStockTimeFilter] = useState("W");
  const [myStocksPage, setMyStocksPage] = useState(0);
  const [otherStocksPage, setOtherStocksPage] = useState(0);
  const [holdingsPage, setHoldingsPage] = useState(0);
  const [expandedStrategyId, setExpandedStrategyId] = useState(null);
  const [pendingStrategyId, setPendingStrategyId] = useState(null);
  const [modalHolding, setModalHolding] = useState(null);
  const [modalTimeFilter, setModalTimeFilter] = useState("W");
  const expandedRowRef = useRef(null);
  const tabJustChangedTimer = useRef(null);
  const tourStartTimerRef = useRef(null);
  const [tabRipple, setTabRipple] = useState(null);
  const [tabDirection, setTabDirection] = useState(0);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarData, setCalendarData] = useState({});
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [calendarFilter, setCalendarFilter] = useState("overall");
  const [showCalendarFilterDropdown, setShowCalendarFilterDropdown] = useState(false);
  const [snapshotRows, setSnapshotRows] = useState([]);
  const [availablePeriods, setAvailablePeriods] = useState({ D: true, "5d": false, m: false, ytd: false, all: true });
  const [intradayChartData, setIntradayChartData] = useState(null);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const [intradayTick, setIntradayTick] = useState(0);
  const [ownLivePriceMap, setOwnLivePriceMap] = useState({});
  const [directStratHoldings, setDirectStratHoldings] = useState([]);
  const tabOrder = ["strategy", "holdings"];

  useEffect(() => {
    if (currentView === "allocations") {
      window.history.pushState({ view: 'allocations' }, '');

      const handlePopState = (e) => {
        setCurrentView("portfolio");
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    }
  }, [currentView]);

  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.tab) {
      const oldIdx = tabOrder.indexOf(activeTab);
      const newIdx = tabOrder.indexOf(deepLink.tab);
      setTabDirection(newIdx > oldIdx ? 1 : -1);
      setActiveTab(deepLink.tab);
    }
    if (deepLink.strategyId) {
      setExpandedStrategyId(deepLink.strategyId);
      setPendingStrategyId(deepLink.strategyId);
    }
    if (onDeepLinkConsumed) onDeepLinkConsumed();
  }, [deepLink]);

  useEffect(() => {
    if (!expandedStrategyId) return;
    let attempts = 0;
    const tryScroll = () => {
      if (expandedRowRef.current) {
        expandedRowRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (attempts < 10) {
        attempts++;
        setTimeout(tryScroll, 150);
      }
    };
    const timer = setTimeout(tryScroll, 400);
    return () => clearTimeout(timer);
  }, [expandedStrategyId]);

  const { lastUpdated: pricesLastUpdated } = useRealtimePrices();
  const { securities: allSecurities, quotes: liveQuotes, loading: quotesLoading, refetch: refetchStocks } = useStockQuotes(true);
  const stocksList = useMemo(() => {
    if (!allSecurities || allSecurities.length === 0) return [];
    return allSecurities
      .filter(s => s.currentPrice != null)
      .map(s => ({
        id: s.id,
        name: s.name,
        ticker: s.symbol,
        shares: 0,
        price: s.currentPrice || 0,
        dailyChange: s.changePct || 0,
        logo: s.logo_url || null,
      }));
  }, [allSecurities]);
  const selectedSecurityId = useMemo(() => {
    if (!selectedStock?.ticker) return null;
    const match = liveQuotes[selectedStock.ticker];
    return match?.id || null;
  }, [selectedStock?.ticker, liveQuotes]);
  const dropdownRef = useRef(null);
  const stockDropdownRef = useRef(null);
  const { profile } = useProfile();
  const { strategies, selectedStrategy: userSelectedStrategy, loading: strategiesLoading, selectStrategy, refetch: refetchStrategies } = useUserStrategies();

  useEffect(() => {
    if (!pendingStrategyId || !strategies.length) return;
    const match = strategies.find(s => s.strategyId === pendingStrategyId || s.id === pendingStrategyId);
    if (match) {
      selectStrategy(match);
      setPendingStrategyId(null);
    }
  }, [pendingStrategyId, strategies]);

  const { chartData: realChartData, loading: chartLoading } = useStrategyChartData(userSelectedStrategy?.strategyId, timeFilter, userSelectedStrategy?.firstInvestedDate || null, profile?.id);
  const { returnData: periodReturnData, loading: periodReturnLoading } = useStrategyLivePeriodReturn(
    profile?.id,
    userSelectedStrategy?.strategyId,
    timeFilter,
    userSelectedStrategy?.investedAmount ?? 0
  );

  const fullName = [profile?.firstName || profile?.first_name, profile?.lastName || profile?.last_name]
    .filter(Boolean).join(" ") || "User";
  const initials = fullName.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "U";

  const isStrategyReady = !strategiesLoading && userSelectedStrategy;
  const currentStrategy = userSelectedStrategy || {
    name: strategiesLoading ? "Loading..." : "No Strategy",
    currentValue: 0,
    previousMonthChange: 0,
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowStrategyDropdown(false);
      }
    };
    if (showStrategyDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showStrategyDropdown]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (stockDropdownRef.current && !stockDropdownRef.current.contains(event.target)) {
        setShowStockDropdown(false);
      }
    };
    if (showStockDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showStockDropdown]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (yearDropdownRef.current && !yearDropdownRef.current.contains(event.target)) {
        setShowYearDropdown(false);
      }
    };
    if (showYearDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showYearDropdown]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (calendarFilterRef.current && !calendarFilterRef.current.contains(event.target)) {
        setShowCalendarFilterDropdown(false);
      }
    };
    if (showCalendarFilterDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showCalendarFilterDropdown]);

  const handleStrategySelect = (strategy) => {
    selectStrategy(strategy);
    setShowStrategyDropdown(false);
  };

  const availableCalendarYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const dataYears = Object.keys(calendarData).map(Number);
    const earliestDataYear = dataYears.length > 0 ? Math.min(...dataYears) : currentYear;
    const entryYear = currentStrategy?.entryDate
      ? new Date(currentStrategy.entryDate).getFullYear()
      : earliestDataYear;
    const startYear = Math.min(entryYear, earliestDataYear);
    const years = [];
    for (let y = currentYear; y >= startYear; y--) {
      years.push(String(y));
    }
    return years;
  }, [calendarData, currentStrategy]);
  const yearDropdownRef = useRef(null);
  const calendarFilterRef = useRef(null);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  };

  const { holdings: rawHoldings, closedHoldings, loading: holdingsLoading, goals: investmentGoals, refetch: refetchInvestments } = useInvestments();

  const selectedStockPurchaseDate = useMemo(() => {
    if (!selectedSecurityId || !rawHoldings) return null;
    const holding = rawHoldings.find(h => String(h.security_id) === String(selectedSecurityId));
    return holding?.created_at || holding?.as_of_date || null;
  }, [selectedSecurityId, rawHoldings]);
  const { chartData: liveStockChartData, loading: stockChartLoading } = useStockChart(selectedSecurityId, stockTimeFilter, selectedStockPurchaseDate);
  const modalSecurityId = useMemo(() => {
    if (!modalHolding) return null;
    return liveQuotes[modalHolding.ticker]?.id || modalHolding.securityId || null;
  }, [modalHolding, liveQuotes]);
  const modalPurchaseDate = useMemo(() => {
    if (!modalHolding || !rawHoldings) return null;
    const h = (rawHoldings || []).find(h =>
      String(h.security_id) === String(modalSecurityId) ||
      String(h.security_id) === String(modalHolding.securityId)
    );
    return h?.created_at || h?.as_of_date || null;
  }, [modalHolding, modalSecurityId, rawHoldings]);
  const { chartData: modalRawChartData, loading: modalChartLoading } = useStockChart(modalSecurityId, modalTimeFilter, null);
  const modalStockReturns = useStockReturns(modalSecurityId);
  const selectedStockReturns = useStockReturns(selectedSecurityId);

  const stockLiveReturns = useMemo(() => {
    const q = selectedStock?.ticker ? liveQuotes[selectedStock.ticker] : null;
    return {
      d_abs: q?.change != null ? Math.round(q.change * 100) : null,
      d_pct: q?.changePercent ?? null,
      w_abs: selectedStockReturns?.['5d_abs'] ?? null,
      w_pct: q?.returns?.w1 ?? null,
      m_abs: selectedStockReturns?.['1m_abs'] ?? null,
      m_pct: q?.returns?.m1 ?? null,
    };
  }, [selectedStock?.ticker, liveQuotes, selectedStockReturns]);

  const modalLiveReturns = useMemo(() => {
    const q = modalHolding?.ticker ? liveQuotes[modalHolding.ticker] : null;
    return {
      d_abs: q?.change != null ? Math.round(q.change * 100) : null,
      d_pct: q?.changePercent ?? null,
      w_abs: modalStockReturns?.['5d_abs'] ?? null,
      w_pct: q?.returns?.w1 ?? null,
      m_abs: modalStockReturns?.['1m_abs'] ?? null,
      m_pct: q?.returns?.m1 ?? null,
    };
  }, [modalHolding?.ticker, liveQuotes, modalStockReturns]);

  useEffect(() => {
    if (pricesLastUpdated) {
      clearMarketDataCache();
      refetchStocks();
      refetchInvestments();
      refetchStrategies();
    }
  }, [pricesLastUpdated, refetchInvestments, refetchStrategies]);

  const calendarFilterOptions = useMemo(() => {
    const options = [{ id: "overall", label: "Overall Portfolio" }];
    strategies.forEach(s => {
      options.push({ id: s.strategyId, label: s.shortName || s.name, type: "strategy" });
    });
    if (rawHoldings && rawHoldings.length > 0) {
      rawHoldings.filter(h => h.security_id && !h.strategy_id).forEach(h => {
        options.push({ id: h.security_id, label: h.symbol || h.name, type: "stock" });
      });
    }
    return options;
  }, [strategies, rawHoldings]);

  useEffect(() => {
    const validIds = calendarFilterOptions.map(o => o.id);
    if (!validIds.includes(calendarFilter)) {
      setCalendarFilter("overall");
    }
  }, [calendarFilterOptions]);

  const individualHoldingSecurityIds = useMemo(() => {
    return (rawHoldings || []).filter(h => h.security_id && !h.strategy_id).map(h => h.security_id);
  }, [rawHoldings]);

  useEffect(() => {
    let cancelled = false;
    const fetchCalendarData = async () => {
      let data = {};
      if (calendarFilter === "overall") {
        data = await getOverallPortfolioMonthlyReturns(
          strategies.map(s => s.strategyId).filter(Boolean),
          individualHoldingSecurityIds,
          strategies,
          (rawHoldings || []).filter(h => !h.strategy_id),
          profile?.id
        );
      } else {
        const matchedStrategy = strategies.find(s => s.strategyId === calendarFilter);
        if (matchedStrategy) {
          if (profile?.id && matchedStrategy.hasReturnsData) {
            data = await getStrategyMonthlyReturnsFromDB(profile.id, calendarFilter, matchedStrategy.firstInvestedDate || null);
          }
          if (!data || Object.keys(data).length === 0) {
            const invested = matchedStrategy.investedAmount || 0;
            const current = matchedStrategy.currentValue || 0;
            const actualPnlPct = invested > 0 ? (current - invested) / invested : null;
            data = await getMonthlyReturns(calendarFilter, matchedStrategy.firstInvestedDate || null, actualPnlPct);
          }
        } else {
          const matchedHolding = (rawHoldings || []).find(h => h.security_id === calendarFilter && !h.strategy_id);
          const investedVal = matchedHolding ? (matchedHolding.avg_fill * matchedHolding.quantity) / 100 : 0;
          const currentVal = matchedHolding ? (matchedHolding.market_value || 0) / 100 : 0;
          const actualPnlPct = investedVal > 0 ? (currentVal - investedVal) / investedVal : null;
          const livePriceCents = matchedHolding?.last_price ? Number(matchedHolding.last_price) : null;
          const livePriceRands = livePriceCents ? livePriceCents / 100 : null;
          data = await getStockMonthlyReturns(calendarFilter, matchedHolding?.created_at || null, actualPnlPct, livePriceRands);
        }
      }
      if (!cancelled) {
        setCalendarData(data);
        const years = Object.keys(data).sort().reverse();
        if (years.length > 0 && !years.includes(String(calendarYear))) {
          setCalendarYear(Number(years[0]));
        }
      }
    };
    fetchCalendarData();
    return () => { cancelled = true; };
  }, [calendarFilter, strategies, rawHoldings, individualHoldingSecurityIds]);

  const liveHoldingValue = (h) => {
    if (h.last_price != null && h.quantity != null) return (h.last_price * h.quantity) / 100;
    return (h.market_value || 0) / 100;
  };

  const displayAccountValue = useMemo(() => {
    const holdingsValue = (rawHoldings || []).filter(h => !h.strategy_id).reduce((sum, h) => sum + liveHoldingValue(h), 0);
    const strategiesValue = strategies.reduce((sum, s) => sum + (s.currentValue || s.investedAmount || 0), 0);
    return holdingsValue + strategiesValue;
  }, [rawHoldings, strategies]);

  const displayTotalCostBasis = useMemo(() => {
    const holdingsBasis = (rawHoldings || []).filter(h => !h.strategy_id).reduce((sum, h) => sum + ((h.avg_fill || 0) * (h.quantity || 0)) / 100, 0);
    const strategiesBasis = strategies.reduce((sum, s) => sum + (s.investedAmount || 0), 0);
    return holdingsBasis + strategiesBasis;
  }, [rawHoldings, strategies]);

  const displayInvestedAmount = useMemo(() => {
    const holdingsInvested = (rawHoldings || []).filter(h => !h.strategy_id).reduce((sum, h) => {
      if (h.invested_amount !== undefined) return sum + Number(h.invested_amount) / 100;
      return sum + ((h.avg_fill || 0) * (h.quantity || 0)) / 100;
    }, 0);
    const strategiesInvested = strategies.reduce((sum, s) => sum + (s.investedAmount || 0), 0);
    return holdingsInvested + strategiesInvested;
  }, [rawHoldings, strategies]);


  const allStrategyHoldings = useMemo(() => {
    const holdingsMap = new Map();
    const standaloneHoldings = (rawHoldings || []).filter(h => !h.strategy_id);
    if (standaloneHoldings.length > 0) {
      const totalValue = standaloneHoldings.reduce((sum, h) => sum + liveHoldingValue(h), 0);
      standaloneHoldings.forEach(h => {
        const sym = h.symbol || "N/A";
        const currentValue = liveHoldingValue(h);
        const costBasis = ((h.avg_fill || 0) * (h.quantity || 0)) / 100;
        const changePct = costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0;
        const weight = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
        const isPending = !h.avg_fill || Number(h.avg_fill) === 0;
        holdingsMap.set(sym, {
          symbol: sym,
          name: h.name || "Unknown",
          weight,
          logo: h.logo_url || null,
          securityId: h.security_id || null,
          currentValue,
          costBasis,
          change: changePct,
          isPending,
          settlement_status: h.settlement_status || null,
        });
      });
    }
    // Build symbol → logo lookup from securities list and raw holdings
    const logoBySymbol = {};
    (stocksList || []).forEach(s => { if (s.logo) logoBySymbol[s.ticker] = s.logo; });
    (rawHoldings || []).forEach(h => { if (h.logo_url) logoBySymbol[h.symbol] = h.logo_url; });

    strategies.forEach(s => {
      const sym = s.shortName || s.name || "Strategy";
      if (!holdingsMap.has(sym)) {
        const stratRawHoldings = (rawHoldings || []).filter(h => h.strategy_id === (s.strategyId || s.id));
        const isStrategyPending = s.isPending || (stratRawHoldings.length > 0 && stratRawHoldings.every(h => !h.avg_fill));
        // Pending strategies are not shown on the portfolio tab at all —
        // they appear on the home tab with the purple pending indicator instead,
        // matching the behaviour of a normal pending strategy purchase.
        if (isStrategyPending) return;
        const holdingsArr = s.holdings || [];
        const topLogos = holdingsArr
          .sort((a, b) => (b.weight || 0) - (a.weight || 0))
          .slice(0, 5)
          .map(h => h.logo_url || h.logo || logoBySymbol[h.symbol] || logoBySymbol[h.ticker] || null)
          .filter(Boolean);
        const sCv = s.currentValue || s.investedAmount || 0;
        const sIa = s.investedAmount || 0;
        const sPnlPct = sIa > 0 ? ((sCv - sIa) / sIa) * 100 : 0;
        holdingsMap.set(sym, {
          symbol: sym,
          name: s.name || "Strategy",
          strategyId: s.strategyId || s.id,
          weight: 0,
          logo: null,
          isStrategy: true,
          isPending: false,
          topLogos,
          strategyHoldings: holdingsArr,
          currentValue: sCv,
          investedAmount: sIa,
          change: sPnlPct,
          ytd_return: s.ytd_pct != null ? s.ytd_pct : s.metrics?.r_ytd,
          cashElement: s.cashElement || 0,
          positionsValue: s.positionsValue || 0,
        });
      }
    });
    const totalValue = Array.from(holdingsMap.values()).reduce((sum, h) => sum + h.currentValue, 0);
    if (totalValue > 0) {
      holdingsMap.forEach(h => { h.weight = (h.currentValue / totalValue) * 100; });
    }
    return Array.from(holdingsMap.values()).sort((a, b) => b.weight - a.weight);
  }, [rawHoldings, strategies, stocksList, liveQuotes]);

  const holdings = allStrategyHoldings;

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const clearTourStartTimer = useCallback(() => {
    if (tourStartTimerRef.current) {
      clearTimeout(tourStartTimerRef.current);
      tourStartTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isActive && isDocumentVisible) return;
    clearTourStartTimer();
    setShowTour(false);
  }, [clearTourStartTimer, isActive, isDocumentVisible]);

  // DB-backed "seen once" check for the portfolio walkthrough. The `animation`
  // table is the source of truth (localStorage is only a fast cache inside
  // hasSeenAnimation), so the tour never replays across devices / storage clears.
  const tourSeenRef = useRef(false);
  const [tourSeenResolved, setTourSeenResolved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    hasSeenAnimation("portfolio_tour", PF_TOUR_SEEN_KEY).then((seen) => {
      if (cancelled) return;
      tourSeenRef.current = seen;
      setTourSeenResolved(true);
    });
    return () => { cancelled = true; };
  }, []);

  // First-visit walkthrough: auto-plays EXACTLY ONCE ever. It's marked "seen"
  // (in the DB) the instant it opens (not on finish) — so if the user switches
  // tabs mid-tour it still never auto-plays again; after that the ? button is the
  // only way to replay it. Only scheduled while the portfolio tab is visible.
  useEffect(() => {
    clearTourStartTimer();
    if (!isActive || !isDocumentVisible || showTour) return;
    if (holdingsLoading || !onWithdraw || allStrategyHoldings.length === 0) return;
    if (!tourSeenResolved) return;   // wait for the DB "seen" check to resolve
    if (tourSeenRef.current) return; // already seen (DB or local cache)
    tourStartTimerRef.current = setTimeout(() => {
      if (isActive && document.visibilityState === "visible") {
        tourSeenRef.current = true;
        markAnimationSeen("portfolio_tour", PF_TOUR_SEEN_KEY); // consume the one auto-play now
        setShowTour(true);
      }
      tourStartTimerRef.current = null;
    }, 180);
    return clearTourStartTimer;
  }, [
    allStrategyHoldings.length,
    clearTourStartTimer,
    holdingsLoading,
    isActive,
    isDocumentVisible,
    onWithdraw,
    showTour,
    tourSeenResolved,
  ]);

  const closeTour = useCallback(() => {
    setShowTour(false);
    tourSeenRef.current = true;
    markAnimationSeen("portfolio_tour", PF_TOUR_SEEN_KEY);
  }, []);

  // ── direct strategy holdings ──────────────────────────────────────────────
  useEffect(() => {
    const stratId = userSelectedStrategy?.strategyId;
    if (!stratId || !profile?.id) return;
    supabase
      .from("stock_holdings_c")
      .select("security_id, quantity, avg_fill, Expected_fill, strategy_id, last_price")
      .eq("user_id", profile.id)
      .is("family_member_id", null)
      .eq("strategy_id", stratId)
      .gt("avg_fill", 0)
      .eq("Status", "active")
      .then(({ data }) => { setDirectStratHoldings(data || []); });
  }, [userSelectedStrategy?.strategyId, profile?.id]);

  // ── snapshot rows (period chart + available period locks) ─────────────────
  useEffect(() => {
    if (!userSelectedStrategy?.strategyId || !profile?.id) return;
    // Use today's date — stored P&L rows are computed daily with correct calendar
    // lookback. Capping to the last weekday on a Sunday shifts the 22-row anchor
    // 2 days too early (May 12 instead of May 14), skewing the chart baseline.
    const todayStr = new Date().toISOString().split("T")[0];
    supabase
      .from("client_strategy_returns_c")
      .select("as_of_date, basket_value, ytd_pct, ytd_pnl, 1d_pnl")
      .eq("user_id", profile.id)
      .is("family_member", null)
      .eq("strategy_id", userSelectedStrategy.strategyId)
      .lte("as_of_date", todayStr)
      .order("as_of_date", { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setSnapshotRows(data);
          // Count only real trading days (rows where basket changed) — same
          // stripping used by derivedPeriodReturn and the home card anchor logic.
          const tradingCount = data.filter((r, i) =>
            i === 0 || Number(r.basket_value) !== Number(data[i - 1].basket_value)
          ).length;
          const latestYtdPct = data[data.length - 1]?.ytd_pct;
          setAvailablePeriods({ D: true, "5d": tradingCount >= 6, m: tradingCount >= 23, ytd: latestYtdPct != null, all: true });
        }
      });
  }, [userSelectedStrategy?.strategyId, profile?.id]);

  // ── intraday tick (60s refresh while on D tab) ────────────────────────────
  useEffect(() => {
    if (timeFilter !== "D") return;
    const id = setInterval(() => setIntradayTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, [timeFilter]);

  // ── live price map (15s poll from stock_intraday_c) ───────────────────────
  useEffect(() => {
    const stratId = userSelectedStrategy?.strategyId;
    if (!stratId) return;
    const baseHoldings = directStratHoldings.length
      ? directStratHoldings
      : (rawHoldings || []).filter(h => h.strategy_id === stratId);
    const securityIds = [...new Set(baseHoldings.filter(h => h.security_id).map(h => h.security_id))];
    if (!securityIds.length) return;
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
  }, [userSelectedStrategy?.strategyId, directStratHoldings, rawHoldings]);

  // ── live strategy metrics (live value, today P&L, cost basis) ────────────
  const liveStrategyMetrics = useMemo(() => {
    const stratId = userSelectedStrategy?.strategyId;
    const empty = { liveValue: 0, costBasis: 0, todayPnl: 0, todayPct: 0, isPending: true, hasPrices: false };
    if (!stratId) return empty;
    const stratHoldings = directStratHoldings.length
      ? directStratHoldings.filter(h => Number(h.avg_fill || 0) > 0)
      : (rawHoldings || []).filter(h => h.strategy_id === stratId && Number(h.avg_fill || 0) > 0);
    if (!stratHoldings.length) return empty;
    let liveValue = 0, costBasis = 0, todayPnl = 0, hasPrices = false;
    for (const h of stratHoldings) {
      const qty = Math.abs(Number(h.quantity || 0));
      const liveEntry = ownLivePriceMap[h.security_id];
      const liveCents = liveEntry?.priceCents;
      const lastCents = Number(h.last_price);
      const priceCents = (liveCents > 0) ? liveCents : lastCents;
      if (Number.isFinite(priceCents) && priceCents > 0) { liveValue += (priceCents / 100) * qty; hasPrices = true; }
      const avgFillCents = Number(h.avg_fill || 0);
      const avgFillRands = avgFillCents / 100;
      const expectedRaw = Number(h.Expected_fill || 0);
      const expectedRands = expectedRaw > 0 ? (expectedRaw > avgFillRands * 5 ? expectedRaw / 100 : expectedRaw) : 0;
      costBasis += (expectedRands > 0 ? expectedRands : avgFillRands) * qty; // Expected-preferred (not higher-of): slippage absorbed by the 8% buffer
      const abs1d = liveEntry?.abs1dCents != null ? liveEntry.abs1dCents : null;
      const pct1d = liveEntry?.pct1d ?? 0;
      // Correct sign using pct1d — Yahoo Finance can store 1d_abs as unsigned for JSE stocks.
      const signed1d = abs1d != null ? Math.abs(abs1d) * (pct1d < 0 ? -1 : 1) : null;
      if (signed1d != null) todayPnl += (signed1d / 100) * qty;
    }
    return { liveValue, costBasis, todayPnl, todayPct: costBasis > 0 ? (todayPnl / costBasis) * 100 : 0, isPending: false, hasPrices };
  }, [rawHoldings, userSelectedStrategy?.strategyId, ownLivePriceMap, directStratHoldings]);

  // ── derived period return (5D / M / YTD from basket snapshots) ───────────
  const derivedPeriodReturn = useMemo(() => {
    if (!snapshotRows.length) return { pnl: 0, pct: 0 };
    const liveVal = liveStrategyMetrics.liveValue > 0
      ? liveStrategyMetrics.liveValue
      : directStratHoldings.reduce((sum, h) => {
          const qty = Math.abs(Number(h.quantity || 0));
          const lastCents = Number(h.last_price || 0);
          return sum + (lastCents > 0 ? (lastCents / 100) * qty : 0);
        }, 0);
    // Strip non-trading days (weekends / SA holidays) the same way the home
    // card does: any row where basket_value didn't change from the previous
    // row is a non-trading day and must not count toward the N-day lookback.
    const tradingRows = snapshotRows.filter((r, i) =>
      i === 0 || Number(r.basket_value) !== Number(snapshotRows[i - 1].basket_value)
    );
    if (timeFilter === "5d") {
      if (tradingRows.length < 6 || !liveVal) return { pnl: 0, pct: 0 };
      const startCents = Number(tradingRows[tradingRows.length - 6]?.basket_value || 0);
      if (!startCents) return { pnl: 0, pct: 0 };
      const startRands = startCents / 100;
      const pnl = parseFloat((liveVal - startRands).toFixed(2));
      return { pnl, pct: parseFloat(((pnl / startRands) * 100).toFixed(4)) };
    }
    if (timeFilter === "m") {
      if (tradingRows.length < 23 || !liveVal) return { pnl: 0, pct: 0 };
      const startCents = Number(tradingRows[tradingRows.length - 23]?.basket_value || 0);
      if (!startCents) return { pnl: 0, pct: 0 };
      const startRands = startCents / 100;
      const pnl = parseFloat((liveVal - startRands).toFixed(2));
      return { pnl, pct: parseFloat(((pnl / startRands) * 100).toFixed(4)) };
    }
    if (timeFilter === "ytd") {
      if (!liveVal) return { pnl: 0, pct: 0 };
      const yearStr = `${new Date().getFullYear()}-01-01`;
      const priorRows = snapshotRows.filter(r => r.as_of_date < yearStr);
      const currentYearRows = snapshotRows.filter(r => r.as_of_date >= yearStr);
      // Use useUserStrategies totalPnl (unrealized + realized gains) as the
      // all-time P&L base so realized gains from rebalance sells are included.
      const hookTotalPnl = currentStrategy?.totalPnl;
      const hookInvested = currentStrategy?.investedAmount;
      const allTimePnl = hookTotalPnl != null
        ? parseFloat(hookTotalPnl.toFixed(2))
        : parseFloat((liveVal - liveStrategyMetrics.costBasis).toFixed(2));
      const allTimePctBase = hookInvested ?? liveStrategyMetrics.costBasis;
      const allTimePct = parseFloat((allTimePctBase > 0
        ? (allTimePnl / allTimePctBase) * 100 : 0).toFixed(4));
      if (priorRows.length === 0) return { pnl: allTimePnl, pct: allTimePct };
      const yearStartCents = currentYearRows.length > 0 ? Number(currentYearRows[0]?.basket_value || 0) : 0;
      if (!yearStartCents) return { pnl: 0, pct: 0 };
      const yearStartRands = yearStartCents / 100;
      const rawPnl = liveVal - yearStartRands;
      const pnl = parseFloat(Math.min(rawPnl, allTimePnl).toFixed(2));
      const anchor = liveVal - pnl;
      return { pnl, pct: parseFloat((anchor > 0 ? (pnl / anchor) * 100 : 0).toFixed(4)) };
    }
    return { pnl: 0, pct: 0 };
  }, [snapshotRows, timeFilter, liveStrategyMetrics, directStratHoldings, currentStrategy]);

  // ── period chart from basket_value (5D / M / YTD) ────────────────────────
  const snapshotChartData = useMemo(() => {
    if (!snapshotRows.length || !["5d", "m", "ytd"].includes(timeFilter)) return null;
    const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const fmtDay = (iso) => { const [, mo, d] = iso.split("-").map(Number); return `${d} ${MN[mo - 1]}`; };
    const fmtFull = (iso) => { const [y, mo, d] = iso.split("-").map(Number); return `${d} ${MN[mo - 1]} ${y}`; };

    // Use the same reference-date lookback the server uses:
    // 5d → latestRow - 9 calendar days, 1m → latestRow - 31 calendar days, ytd → Jan 1
    // Use the latest row's date (not the browser's today) so the reference matches the stored pnl.
    const latestRowDate = snapshotRows[snapshotRows.length - 1]?.as_of_date || new Date().toISOString().split("T")[0];
    const offsetDate = (days) => {
      // Use noon UTC to avoid local-timezone midnight-shift bugs (e.g. UTC+2 would roll back a day)
      const d = new Date(latestRowDate + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - days);
      return d.toISOString().split("T")[0];
    };
    const closestRowOnOrBefore = (targetDateStr) => {
      let best = null;
      for (const r of snapshotRows) {
        if (r.as_of_date <= targetDateStr) best = r; else break;
      }
      return best || snapshotRows[0];
    };

    // YTD: use stored ytd_pnl directly — matches the badge value exactly
    if (timeFilter === "ytd") {
      const yearStr = `${new Date().getFullYear()}-01-01`;
      const dataRows = snapshotRows.filter(r => r.as_of_date >= yearStr);
      if (!dataRows.length) return null;
      const points = [{ day: null, value: 0, fullDate: null }];
      for (const row of dataRows) {
        const val = parseFloat((Number(row.ytd_pnl || 0) / 100).toFixed(2));
        points.push({ day: fmtDay(row.as_of_date), value: val, fullDate: fmtFull(row.as_of_date) });
      }
      return points;
    }

    // 5D / M: find the reference row using the same lookback the server uses
    const refRow = timeFilter === "5d"
      ? closestRowOnOrBefore(offsetDate(9))
      : closestRowOnOrBefore(offsetDate(31));

    const dataRows = snapshotRows.filter(r => r.as_of_date >= refRow.as_of_date);
    if (!dataRows.length) return null;
    const startCents = Number(refRow.basket_value || 0);
    if (!startCents) return null;

    const points = [{ day: null, value: 0, fullDate: null }];
    for (const row of dataRows) {
      const val = parseFloat(((Number(row.basket_value || 0) - startCents) / 100).toFixed(2));
      points.push({ day: fmtDay(row.as_of_date), value: val, fullDate: fmtFull(row.as_of_date) });
    }
    return points;
  }, [snapshotRows, timeFilter]);

  // ── intraday D chart (5-min buckets from stock_intraday_c) ────────────────
  useEffect(() => {
    if (timeFilter !== "D") { setIntradayChartData(null); return; }
    const stratId = userSelectedStrategy?.strategyId;
    if (!stratId) return;
    const stratHoldings = directStratHoldings.length
      ? directStratHoldings.filter(h => Number(h.avg_fill || 0) > 0)
      : (rawHoldings || []).filter(h => h.strategy_id === stratId && Number(h.avg_fill || 0) > 0);
    if (!stratHoldings.length) return;
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
        // Don't show a previous day's intraday session labelled as "Today" — if
        // the most recent data is from a prior calendar day (market not yet open)
        // return nothing so the D tab shows the snapshot-based fallback instead.
        const _todayUTC = new Date().toISOString().slice(0, 10);
        if (tradingDay !== _todayUTC) { setIntradayChartData([]); setIntradayLoading(false); return; }
        const PAGE = 1000;
        let intradayRows = [];
        let page = 0;
        while (true) {
          const { data: batch } = await supabase
            .from("stock_intraday_c")
            .select("security_id, current_price, 1d_abs, 1d_pct, timestamp")
            .in("security_id", securityIds)
            .gte("timestamp", `${tradingDay}T00:00:00Z`)
            .lt("timestamp", `${tradingDay}T23:59:59Z`)
            .order("timestamp", { ascending: true })
            .range(page * PAGE, (page + 1) * PAGE - 1);
          if (!batch?.length) break;
          intradayRows = intradayRows.concat(batch);
          if (batch.length < PAGE) break;
          page++;
          if (cancelled) return;
        }
        if (cancelled) return;
        if (!intradayRows.length) { setIntradayChartData([]); setIntradayLoading(false); return; }
        const latestBySecId = {};
        for (const row of intradayRows) latestBySecId[row.security_id] = row;
        // Prefer yesterday's basket_value from snapshots as baseline (avoids wrong-sign
        // 1d_abs from Yahoo Finance for JSE stocks). Falls back to the 1d_abs formula
        // if today's snapshot isn't yet saved (i.e. EOD job hasn't run yet).
        const todayDateStr = new Date().toISOString().split("T")[0];
        const lastSR = snapshotRows[snapshotRows.length - 1];
        const prevSR = snapshotRows[snapshotRows.length - 2];
        const snapshotHasToday = lastSR?.as_of_date === todayDateStr;
        // Baseline = yesterday's close basket value, sourced entirely from snapshots.
        // snapshotHasToday → yesterday is prevSR; market still open → yesterday is lastSR.
        // This avoids Yahoo Finance's unreliable 1d_abs sign for JSE stocks entirely.
        const baselineRands = (snapshotHasToday && prevSR)
          ? Number(prevSR.basket_value || 0) / 100
          : lastSR
            ? Number(lastSR.basket_value || 0) / 100
            : (securityIds.reduce((sum, sid) => {
                const row = latestBySecId[sid];
                if (!row) return sum;
                const abs1d = Number(row["1d_abs"] || 0);
                const pct1d = Number(row["1d_pct"] || 0);
                const signed1d = Math.abs(abs1d) * (pct1d < 0 ? -1 : 1);
                return sum + ((Number(row.current_price) - signed1d) / 100) * (qtyMap[sid] || 0);
              }, 0) || liveStrategyMetrics.costBasis);
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
        const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const lastKnown = {};
        const points = [{ day: null, value: 0, fullDate: null }];
        for (const [isoKey, prices] of sorted) {
          for (const sid of securityIds) { if (prices[sid] != null) lastKnown[sid] = prices[sid]; }
          if (!Object.keys(lastKnown).length) continue;
          const portfolioRands = securityIds.reduce((sum, sid) => {
            const price = lastKnown[sid];
            return price != null ? sum + (price / 100) * (qtyMap[sid] || 0) : sum;
          }, 0);
          const pnl = Number((portfolioRands - baselineRands).toFixed(2));
          const d = new Date(isoKey);
          const sast = new Date(d.getTime() + 2 * 60 * 60 * 1000);
          const hh = String(sast.getUTCHours()).padStart(2, "0");
          const mm = String(sast.getUTCMinutes()).padStart(2, "0");
          points.push({ day: `${hh}:${mm}`, value: pnl, fullDate: `${sast.getUTCDate()} ${MN[sast.getUTCMonth()]} ${sast.getUTCFullYear()} ${hh}:${mm}` });
        }
        if (!cancelled) setIntradayChartData(points.length > 1 ? points : []);
      } catch (e) {
        console.error("[parent-intraday-chart]", e);
        if (!cancelled) setIntradayChartData([]);
      } finally {
        if (!cancelled) setIntradayLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [timeFilter, userSelectedStrategy?.strategyId, directStratHoldings, rawHoldings, liveStrategyMetrics.costBasis, intradayTick, snapshotRows]);

  const getChartData = () => {
    if (realChartData && realChartData.length > 0) {
      if (realChartData[0]?.day === null && realChartData[0]?.value === 0) {
        return realChartData;
      }
      const currentValue = liveStrategyMetrics.hasPrices ? liveStrategyMetrics.liveValue : (currentStrategy.currentValue || 0);
      const costBasis = liveStrategyMetrics.costBasis || currentStrategy.investedAmount || 0;
      if (currentValue > 0 && realChartData.length > 0) {
        const latestNav = realChartData[realChartData.length - 1].value;
        if (!latestNav || latestNav <= 0) return [];
        const scale = currentValue / latestNav;
        const pts = [{ ...realChartData[0], day: null, value: 0 }];
        realChartData.forEach(d => pts.push({ ...d, value: Number(((d.value * scale) - costBasis).toFixed(2)) }));
        return pts;
      }
    }
    return [];
  };

  const currentChartData = getChartData();
  const isLoadingData = strategiesLoading || chartLoading || (timeFilter === "D" && intradayLoading);
  const displayChartData = (() => {
    if (isLoadingData) return [];
    if (timeFilter === "D") return (intradayChartData && intradayChartData.length > 1 ? intradayChartData : []);
    if (["5d", "m", "ytd"].includes(timeFilter) && snapshotChartData && snapshotChartData.length > 1) {
      return snapshotChartData;
    }
    return currentChartData;
  })();
  const strategyAxisConfig = computePnlAxisConfig(displayChartData);
  const _lockedLabels = { "5d": "Available after 5 trading days", m: "Available after 1 month", ytd: "Available after first full year" };
  const lockedMessage = (!availablePeriods[timeFilter] && _lockedLabels[timeFilter]) ? _lockedLabels[timeFilter] : null;

  const formatCurrency = (value) => {
    return `R${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const myStocks = useMemo(() => {
    if (!stocksList || stocksList.length === 0) return [];
    const holdingSymbols = new Set();
    (rawHoldings || []).filter(h => !h.strategy_id).forEach(h => { if (h.symbol) holdingSymbols.add(h.symbol); });
    allStrategyHoldings.forEach(h => { if (h.symbol && !h.isStrategy) holdingSymbols.add(h.symbol); });
    if (holdingSymbols.size === 0) return [];
    return stocksList.filter(stock => holdingSymbols.has(stock.ticker));
  }, [rawHoldings, allStrategyHoldings, stocksList]);

  const myStockIds = useMemo(() => new Set(myStocks.map(s => s.id)), [myStocks]);

  const prevMyStocksRef = useRef(0);
  useEffect(() => {
    if (myStocks.length > 0) {
      const currentIsMyStock = selectedStock && myStocks.some(s => s.id === selectedStock.id);
      if (!selectedStock || !currentIsMyStock || prevMyStocksRef.current === 0) {
        setSelectedStock(myStocks[0]);
      }
      prevMyStocksRef.current = myStocks.length;
    } else if (!selectedStock && stocksList.length > 0) {
      setSelectedStock(stocksList[0]);
    }
  }, [myStocks, stocksList]);

  if (strategiesLoading || holdingsLoading) {
    return <PortfolioSkeleton />;
  }

  // All Allocations View
  if (currentView === "allocations") {
    const topHoldings = Array.isArray(currentStrategy.holdings)
      ? currentStrategy.holdings.slice(0, 3)
      : [];

    return (
      <SwipeBackWrapper onBack={() => setCurrentView("portfolio")} enabled={true}>
        <div className="min-h-screen pb-[env(safe-area-inset-bottom)] text-white relative overflow-x-hidden">
          {/* Gradient background - same as portfolio page */}
          <div className="absolute inset-x-0 top-0 -z-10 h-full">
            <div
              className="absolute inset-x-0 top-0"
              style={{
                height: '100vh',
                background: 'linear-gradient(180deg, #0d0d12 0%, #0e0a14 0.5%, #100b18 1%, #120c1c 1.5%, #150e22 2%, #181028 2.5%, #1c122f 3%, #201436 3.5%, #25173e 4%, #2a1a46 5%, #301d4f 6%, #362158 7%, #3d2561 8%, #44296b 9%, #4c2e75 10%, #54337f 11%, #5d3889 12%, #663e93 13%, #70449d 14%, #7a4aa7 15%, #8451b0 16%, #8e58b9 17%, #9860c1 18%, #a268c8 19%, #ac71ce 20%, #b57ad3 21%, #be84d8 22%, #c68edc 23%, #cd98e0 24%, #d4a2e3 25%, #daace6 26%, #dfb6e9 27%, #e4c0eb 28%, #e8c9ed 29%, #ecd2ef 30%, #efdaf1 31%, #f2e1f3 32%, #f4e7f5 33%, #f6ecf7 34%, #f8f0f9 35%, #f9f3fa 36%, #faf5fb 38%, #fbf7fc 40%, #fcf9fd 42%, #fdfafd 45%, #faf8fc 55%, #f8f6fa 100%)'
              }}
            />
            <div
              className="absolute inset-x-0 top-[100vh] bottom-0"
              style={{ background: '#f8f6fa' }}
            />
          </div>

          {/* Header */}
          <div className="mx-auto flex w-full max-w-sm flex-col px-4 pt-12 md:max-w-md md:px-6">
            <header className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setCurrentView("portfolio")}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm border border-white/20 shadow-lg transition hover:bg-white/20"
              >
                <ArrowLeft className="h-5 w-5 text-white" />
              </button>
              <h1 className="text-xl font-bold text-white">{currentStrategy.name || "Strategy"}</h1>
            </header>
          </div>

          {/* Portfolio Overview Card */}
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-6">
            <div className="rounded-3xl p-6 backdrop-blur-xl shadow-sm border border-slate-100/50" style={{ background: 'rgba(255,255,255,0.7)' }}>
              {/* Amount and Return */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Portfolio Value</p>
                  <p className="text-3xl font-bold text-slate-900">
                    {formatCurrency(currentStrategy.currentValue || 0)}
                  </p>
                  {isStrategyReady && (currentStrategy.cashElement || 0) > 0 && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      Positions {formatCurrency(currentStrategy.positionsValue || 0)} · Cash {formatCurrency(currentStrategy.cashElement || 0)}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500 mb-1">Period Return</p>
                  <p className={`text-2xl font-bold ${periodReturnLoading ? 'text-slate-400' : (periodReturnData.pct || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {periodReturnLoading ? '...' : `${(periodReturnData.pct || 0) >= 0 ? '+' : ''}${(periodReturnData.pct || 0).toFixed(2)}%`}
                  </p>
                </div>
              </div>

              {/* Cost basis + Realised / Unrealised P&L split (EasyEquities-style).
                  Realised + Unrealised always sums to total P&L; invested stays
                  stable across rebalances. */}
              {isStrategyReady && (
                <div className="grid grid-cols-2 gap-2.5 mb-6">
                  <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500 mb-0.5">Invested</p>
                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(currentStrategy.investedAmount || 0)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500 mb-0.5">Total P&amp;L</p>
                    <p className={`text-sm font-semibold ${(currentStrategy.totalPnl || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {(currentStrategy.totalPnl || 0) >= 0 ? '+' : ''}{formatCurrency(currentStrategy.totalPnl || 0)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500 mb-0.5">Realised</p>
                    <p className={`text-sm font-semibold ${(currentStrategy.realizedPnl || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {(currentStrategy.realizedPnl || 0) >= 0 ? '+' : ''}{formatCurrency(currentStrategy.realizedPnl || 0)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] text-slate-500 mb-0.5">Unrealised</p>
                    <p className={`text-sm font-semibold ${(currentStrategy.unrealizedPnl || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {(currentStrategy.unrealizedPnl || 0) >= 0 ? '+' : ''}{formatCurrency(currentStrategy.unrealizedPnl || 0)}
                    </p>
                  </div>
                </div>
              )}

              {/* Period Filter Tabs */}
              <div className="flex items-center justify-between gap-2 pt-4 border-t border-slate-100">
                <div className="flex gap-2">
                  {["5D", "M", "YTD"].map((period) => (
                    <button
                      key={period}
                      onClick={() => setTimeFilter(period.toLowerCase())}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                        timeFilter === period.toLowerCase()
                          ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {period}
                    </button>
                  ))}
                </div>

                {/* Holdings Preview */}
                {topHoldings.length > 0 && (
                  <div className="flex items-center -space-x-2">
                    {topHoldings.map((asset, index) => {
                      const matchedStock = stocksList.find(st => st.ticker === asset.symbol);
                      const logo = asset.logo_url || asset.logo || matchedStock?.logo || null;
                      return (
                        <div
                          key={asset.symbol}
                          className="h-8 w-8 rounded-full bg-white border-2 border-white shadow-md overflow-hidden"
                          style={{ zIndex: 3 - index }}
                        >
                          {failedLogos[asset.symbol] || !logo ? (
                            <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-violet-100 to-purple-100 text-[8px] font-bold text-violet-700">
                              {asset.symbol.slice(0, 2)}
                            </div>
                          ) : (
                            <img
                              src={logo}
                              alt={asset.symbol}
                              className="h-full w-full object-cover"
                              onError={() => setFailedLogos(prev => ({ ...prev, [asset.symbol]: true }))}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </SwipeBackWrapper>
    );
  }

  return (
    <div className="min-h-screen pb-[env(safe-area-inset-bottom)] text-white relative overflow-x-hidden">
      {/* Gradient background - scrolls with content */}
      <div className="absolute inset-x-0 top-0 -z-10 h-full">
        {/* Base gradient: seamless purple to lavender to white transition using vh units for consistent position */}
        <div
          className="absolute inset-x-0 top-0"
          style={{
            height: '100vh',
            background: 'linear-gradient(180deg, #0d0d12 0%, #0e0a14 0.5%, #100b18 1%, #120c1c 1.5%, #150e22 2%, #181028 2.5%, #1c122f 3%, #201436 3.5%, #25173e 4%, #2a1a46 5%, #301d4f 6%, #362158 7%, #3d2561 8%, #44296b 9%, #4c2e75 10%, #54337f 11%, #5d3889 12%, #663e93 13%, #70449d 14%, #7a4aa7 15%, #8451b0 16%, #8e58b9 17%, #9860c1 18%, #a268c8 19%, #ac71ce 20%, #b57ad3 21%, #be84d8 22%, #c68edc 23%, #cd98e0 24%, #d4a2e3 25%, #daace6 26%, #dfb6e9 27%, #e4c0eb 28%, #e8c9ed 29%, #ecd2ef 30%, #efdaf1 31%, #f2e1f3 32%, #f4e7f5 33%, #f6ecf7 34%, #f8f0f9 35%, #f9f3fa 36%, #faf5fb 38%, #fbf7fc 40%, #fcf9fd 42%, #fdfafd 45%, #faf8fc 55%, #f8f6fa 100%)'
          }}
        />
        {/* Continuation for rest of page - matches end of gradient */}
        <div
          className="absolute inset-x-0 top-[100vh] bottom-0"
          style={{ background: '#f8f6fa' }}
        />

        {/* Subtle ambient glow behind account balance */}
        <div
          className="absolute top-[6%] left-1/2 -translate-x-1/2 w-[300px] h-[160px] rounded-full"
          style={{ background: 'radial-gradient(ellipse at center, rgba(91,33,182,0.15) 0%, rgba(76,29,149,0.08) 40%, transparent 70%)', filter: 'blur(50px)' }}
        />
      </div>

      {/* Header section */}
      <div className="relative px-5 pb-6 pt-10 md:px-8">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-4 md:max-w-md">
          {/* Top row: Avatar stacked with greeting, notification on right */}
          <header className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <FamilyDropdown
                profile={profile}
                userId={profile?.id}
                initials={initials}
                avatarUrl={profile?.avatarUrl}
                onOpenFamily={() =>
                  window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "family" } }))
                }
                onSelectMember={(member) =>
                  window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "memberPortfolio", member } }))
                }
              />
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white mt-1">{fullName}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                aria-label="How this page works"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 backdrop-blur-sm transition hover:bg-white/10"
                onClick={() => setShowTour(true)}
              >
                <HelpCircle className="h-5 w-5 text-white/90" />
              </button>
              <button
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 backdrop-blur-sm transition hover:bg-white/10"
                onClick={onOpenNotifications}
              >
                <Bell className="h-5 w-5 text-white/90" />
              </button>
            </div>
          </header>

          {/* Account balance */}
          <section className="relative">
            <div className="absolute -inset-8 bg-gradient-radial from-[#7c3aed]/20 via-transparent to-transparent rounded-full blur-2xl -z-10" />
            {(() => {
              const totalPnl = displayAccountValue - displayTotalCostBasis;
              const totalPnlPct = displayTotalCostBasis > 0 ? (totalPnl / displayTotalCostBasis) * 100 : 0;
              const isPnlPos = totalPnl >= 0;
              const balanceDisplay = displayAccountValue;

              return (
                <>
                  <div className="flex items-center gap-3">
                    <p className="text-4xl font-bold tracking-tight" style={{ minWidth: '180px' }}>
                      R{balanceVisible ? balanceDisplay.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "••••••••"}
                    </p>
                    <button
                      onClick={() => setBalanceVisible(!balanceVisible)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm transition hover:bg-white/25"
                    >
                      {balanceVisible ? (
                        <Eye className="h-5 w-5 text-white/70" />
                      ) : (
                        <EyeOff className="h-5 w-5 text-white/70" />
                      )}
                    </button>
                  </div>
                  {!balanceVisible ? (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">Total Value</p>
                  ) : (
                    <>
                      <div className="mt-1 flex items-center gap-2.5">
                        <span className="text-lg font-bold" style={{ color: isPnlPos ? '#6ee7b7' : '#fca5a5' }}>
                          {isPnlPos ? '+' : '-'}R{Math.abs(totalPnl).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                          style={{ backdropFilter: 'blur(4px)', background: 'rgba(255,255,255,0.12)', border: `1px solid ${isPnlPos ? 'rgba(52,211,153,0.6)' : 'rgba(251,113,133,0.6)'}`, color: isPnlPos ? '#6ee7b7' : '#fca5a5' }}>
                          {isPnlPos ? '▲' : '▼'} {isPnlPos ? '+' : ''}{totalPnlPct.toFixed(1)}%
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Total Value</p>
                    </>
                  )}
                </>
              );
            })()}
          </section>

          {/* Tabs: Strategy, Holdings */}
          <section className="flex gap-2 mt-1 justify-center">
            {[
              { id: "strategy", label: "Baskets" },
              { id: "holdings", label: "Holdings" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={(e) => {
                  if (tab.id === activeTab) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const y = e.clientY - rect.top;
                  setTabRipple({ id: tab.id, x, y, key: Date.now() });
                  const oldIdx = tabOrder.indexOf(activeTab);
                  const newIdx = tabOrder.indexOf(tab.id);
                  setTabDirection(newIdx > oldIdx ? 1 : -1);
                  setActiveTab(tab.id);
                }}
                className={`relative overflow-hidden px-4 py-2.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.18em] transition-all duration-300 ${activeTab === tab.id
                    ? "bg-violet-500 text-white shadow-lg shadow-violet-500/30"
                    : "border border-white/60 text-white backdrop-blur-xl hover:bg-white/20"
                  }`}
                style={activeTab !== tab.id ? { background: 'rgba(255,255,255,0.15)', textShadow: '0 0 8px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.3)' } : {}}
              >
                {tabRipple && tabRipple.id === tab.id && (
                  <motion.span
                    key={tabRipple.key}
                    className="absolute rounded-full pointer-events-none"
                    style={{
                      left: tabRipple.x,
                      top: tabRipple.y,
                      background: 'radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(139,92,246,0.3) 50%, transparent 70%)',
                      transform: 'translate(-50%, -50%)',
                    }}
                    initial={{ width: 0, height: 0, opacity: 0.8 }}
                    animate={{ width: 300, height: 300, opacity: 0 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    onAnimationComplete={() => setTabRipple(null)}
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            ))}
          </section>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {/* Strategy Tab Content */}
        {activeTab === "strategy" && (
          <motion.div
            key="strategy"
            initial={{ opacity: 0, x: tabDirection * 40, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: tabDirection * -40, filter: 'blur(6px)' }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <>
              {/* Chart section */}
              <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 md:max-w-md md:px-8">
                <section className="py-2">
                  {strategies.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                      <div className="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center mb-4">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2L2 7l10 5 10-5-10-5z" />
                          <path d="M2 17l10 5 10-5" />
                          <path d="M2 12l10 5 10-5" />
                        </svg>
                      </div>
                      <p className="text-lg font-semibold text-slate-900 mb-1">Invest in Your First Strategy</p>
                      <p className="text-sm text-slate-500 text-center max-w-[260px]">Choose a strategy and start building your portfolio. Your performance will show up here.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-3 -ml-4">
                        <div className="relative" ref={dropdownRef}>
                          <button
                            onClick={() => setShowStrategyDropdown(!showStrategyDropdown)}
                            className="flex items-center gap-0.5 text-slate-900 hover:text-slate-700 transition"
                          >
                            <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
                              {currentStrategy.name || "Strategy"}
                            </span>
                            <ChevronDown className={`h-5 w-5 transition-transform duration-200 ${showStrategyDropdown ? 'rotate-180' : ''}`} />
                          </button>
                          {showStrategyDropdown && strategies.length > 0 && (
                            <div
                              className="absolute top-full left-0 mt-2 min-w-[200px] max-h-[280px] overflow-y-auto bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/50 z-50 overscroll-contain"
                              style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif", WebkitOverflowScrolling: 'touch' }}
                            >
                              {strategies.map((strategy) => (
                                <button
                                  key={strategy.strategyId}
                                  onClick={() => handleStrategySelect(strategy)}
                                  className={`w-full px-4 py-3.5 text-left hover:bg-purple-50/50 transition-colors duration-150 border-b border-slate-100/50 last:border-b-0 ${userSelectedStrategy?.strategyId === strategy.strategyId ? 'bg-purple-50' : ''
                                    }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-slate-800 text-sm tracking-tight">{strategy.name}</p>
                                  </div>
                                  <p className="text-xs text-slate-400 mt-0.5 font-medium tabular-nums">
                                    R{(strategy.currentValue || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {[
                            { id: "D", label: "D" },
                            { id: "5d", label: "5D", hidden: true },
                            { id: "m", label: "M", hidden: true },
                            { id: "ytd", label: "YTD" },
                            { id: "all", label: "All" },
                          ].map((filter) => (
                            <button
                              key={filter.id}
                              onClick={() => setTimeFilter(filter.id)}
                              className={`px-3 h-9 rounded-full text-sm font-bold transition-all ${filter.hidden ? "hidden" : ""} ${timeFilter === filter.id
                                  ? "bg-slate-700/80 text-white shadow-lg backdrop-blur-md border border-white/20"
                                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/30"
                                }`}
                              style={timeFilter === filter.id ? {
                                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.1), 0 4px 12px rgba(0,0,0,0.15)'
                              } : {}}
                            >
                              {filter.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mb-3 px-1">
                        {(() => {
                          const cv = liveStrategyMetrics.hasPrices ? liveStrategyMetrics.liveValue : (currentStrategy.currentValue || 0);
                          const ia = liveStrategyMetrics.costBasis || currentStrategy.investedAmount || 0;
                          const isStratPending = liveStrategyMetrics.isPending && (currentStrategy.currentValue || 0) === 0 && ia === 0;
                          let pnl, pnlPct;
                          if (timeFilter === "D") {
                            // Always read 1d_pnl from the most recent snapshot — same source
                            // as the home page. This avoids wrong-sign values from Yahoo
                            // Finance's 1d_abs/1d_pct for JSE stocks, and also prevents
                            // showing stale intraday data from a previous calendar day before
                            // the current trading session has opened.
                            const _lastSR = snapshotRows[snapshotRows.length - 1];
                            const _prevSR = snapshotRows[snapshotRows.length - 2];
                            if (_lastSR?.["1d_pnl"] != null) {
                              pnl = Number(_lastSR["1d_pnl"]) / 100;
                              const _prevBasket = Number(_prevSR?.basket_value || 0) / 100;
                              pnlPct = _prevBasket > 0 ? (pnl / _prevBasket) * 100 : 0;
                            } else {
                              pnl = liveStrategyMetrics.todayPnl;
                              pnlPct = liveStrategyMetrics.todayPct;
                            }
                          } else if (timeFilter === "5d" || timeFilter === "m") {
                            // useStrategyLivePeriodReturn: same cash-adjusted, trading-day
                            // aware computation as the purple home card — one source of truth.
                            pnl = periodReturnData?.pnl ?? 0;
                            pnlPct = periodReturnData?.pct ?? 0;
                          } else if (timeFilter === "ytd") {
                            // useStrategyLivePeriodReturn: live total − investedAmount,
                            // identical to the home card's YTD calculation.
                            pnl = periodReturnData?.pnl ?? 0;
                            pnlPct = periodReturnData?.pct ?? 0;
                          } else {
                            pnl = cv - ia;
                            pnlPct = ia > 0 ? ((cv - ia) / ia) * 100 : 0;
                          }
                          const isPos = (pnl ?? 0) >= 0;
                          if (isStratPending) {
                            return (
                              <div className="flex items-center gap-2 mt-1">
                                <SettlementBadge status="pending" size="md" />
                                <span className="text-xs text-slate-400">Awaiting trade execution</span>
                              </div>
                            );
                          }
                          // Before market open on D filter there is no intraday data yet —
                          // hide the PnL row entirely so nothing misleading is shown.
                          const hideDayPnl = timeFilter === "D" && !(intradayChartData?.length);
                          return (
                            <>
                              {!hideDayPnl && (
                                <div className="flex items-center gap-2 mt-1">
                                  <span className={`text-sm font-semibold ${isPos ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {isPos ? '+' : '-'}R{Math.abs(pnl ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${isPos ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
                                    {isPos ? '+' : ''}{(pnlPct ?? 0).toFixed(1)}%
                                  </span>
                                  {timeFilter === "D" && <span className="text-[10px] text-slate-400 font-medium">Today</span>}
                                  {timeFilter === "5d" && <span className="text-[10px] text-slate-400 font-medium">5 days</span>}
                                  {timeFilter === "m" && <span className="text-[10px] text-slate-400 font-medium">1 month</span>}
                                  {timeFilter === "ytd" && <span className="text-[10px] text-slate-400 font-medium">YTD</span>}
                                  {timeFilter === "all" && <span className="text-[10px] text-slate-400 font-medium">All time</span>}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>

                      <div style={{ width: '100%', height: 220, marginBottom: 8, minWidth: 0 }}>
                        {lockedMessage ? (
                          <div style={{ width: '100%', height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            <p className="text-slate-400 text-sm text-center px-6">{lockedMessage}</p>
                          </div>
                        ) : displayChartData.length === 0 ? (
                          isLoadingData ? (
                            <div style={{ width: '100%', height: 220 }}>
                              <svg width="100%" height="220" viewBox="0 0 400 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                                <defs>
                                  <linearGradient id="skeletonFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.6" />
                                    <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.05" />
                                  </linearGradient>
                                  <linearGradient id="shimmer" x1="0" y1="0" x2="1" y2="0">
                                    <stop offset="0%" stopColor="transparent"><animate attributeName="offset" values="-1;0;1" dur="1.6s" repeatCount="indefinite" /></stop>
                                    <stop offset="50%" stopColor="rgba(255,255,255,0.55)"><animate attributeName="offset" values="-0.5;0.5;1.5" dur="1.6s" repeatCount="indefinite" /></stop>
                                    <stop offset="100%" stopColor="transparent"><animate attributeName="offset" values="0;1;2" dur="1.6s" repeatCount="indefinite" /></stop>
                                  </linearGradient>
                                  <mask id="shimmerMask"><rect width="400" height="220" fill="url(#shimmer)" /></mask>
                                </defs>
                                {[40,80,120,160].map((y, i) => <rect key={i} x="0" y={y} width="22" height="8" rx="4" fill="#e2e8f0" />)}
                                <path d="M32,160 C55,155 70,130 90,118 C110,106 125,125 145,108 C165,91 180,70 205,65 C230,60 245,80 265,72 C285,64 300,82 320,75 C340,68 360,85 380,78 L380,190 L32,190 Z" fill="url(#skeletonFill)" />
                                <path d="M32,160 C55,155 70,130 90,118 C110,106 125,125 145,108 C165,91 180,70 205,65 C230,60 245,80 265,72 C285,64 300,82 320,75 C340,68 360,85 380,78" fill="none" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M32,160 C55,155 70,130 90,118 C110,106 125,125 145,108 C165,91 180,70 205,65 C230,60 245,80 265,72 C285,64 300,82 320,75 C340,68 360,85 380,78 L380,190 L32,190 Z" fill="url(#shimmer)" mask="url(#shimmerMask)" />
                                <line x1="32" y1="190" x2="400" y2="190" stroke="#e2e8f0" strokeWidth="1" />
                                {[55,128,200,272,345].map((x, i) => <rect key={i} x={x - 16} y="200" width="32" height="8" rx="4" fill="#e2e8f0" />)}
                              </svg>
                            </div>
                          ) : (
                            <div style={{ width: '100%', height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <div className="text-slate-400 text-sm">No data available</div>
                            </div>
                          )
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart
                              data={displayChartData}
                              margin={{ top: 10, right: 15, left: 5, bottom: 30 }}
                            >
                              <defs>
                                <linearGradient id="glowGradientVertical" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
                                  <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.2" />
                                  <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.02" />
                                </linearGradient>
                              </defs>

                              <XAxis
                                dataKey="day"
                                axisLine={false}
                                tickLine={false}
                                tickMargin={8}
                                ticks={timeFilter === 'ytd' ? computeYtdMonthTicks(displayChartData) : undefined}
                                interval={timeFilter === 'ytd' ? 0 : (displayChartData.length <= 8 ? 0 : Math.max(0, Math.ceil(displayChartData.length / 6) - 1))}
                                tick={({ x, y, payload }) => {
                                  if (!payload.value) return null;
                                  const label = timeFilter === 'ytd'
                                    ? String(payload.value).split(' ')[1]
                                    : payload.value;
                                  return <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={11} fontWeight={500}>{label}</text>;
                                }}
                              />

                              <YAxis
                                domain={strategyAxisConfig.domain}
                                ticks={strategyAxisConfig.ticks}
                                tickFormatter={formatPnlAxis}
                                tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                                axisLine={false}
                                tickLine={false}
                                width={55}
                              />

                              <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth={1} />

                              <Tooltip
                                content={({ active, payload, label }) => {
                                  if (active && payload && payload.length) {
                                    const fullDate = payload[0]?.payload?.fullDate || label;
                                    const val = payload[0].value;
                                    const isPos = val >= 0;
                                    return (
                                      <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-1.5 shadow-md">
                                        <div className="text-xs text-slate-500 mb-0.5">{fullDate}</div>
                                        <div className="text-sm font-bold text-violet-700">
                                          {isPos ? '+' : '-'}R{Math.abs(val).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </div>
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                                cursor={false}
                                wrapperStyle={{ outline: 'none' }}
                              />

                              <Area
                                type="monotone"
                                dataKey="value"
                                stroke="none"
                                fill="url(#glowGradientVertical)"
                                fillOpacity={1}
                              />

                              <Line
                                type="monotone"
                                dataKey="value"
                                stroke="#7c3aed"
                                strokeWidth={2.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                dot={false}
                                activeDot={{
                                  r: 6,
                                  fill: '#7c3aed',
                                  stroke: '#c4b5fd',
                                  strokeWidth: 2,
                                }}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </>
                  )}
                </section>
              </div>

              {/* Scrollable content section - starts after chart */}
              <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-8">
                {strategies.length === 0 ? (
                  <button
                    onClick={() => onOpenStrategies && onOpenStrategies()}
                    className="w-full py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl"
                  >
                    Make Your First Investment
                  </button>
                ) : (
                  <button
                    onClick={() => { setCurrentView("allocations"); window.scrollTo(0, 0); }}
                    className="w-full py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl"
                  >
                    View All Allocations
                  </button>
                )}

                <section className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">Portfolio Holdings</p>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">All holdings by weight</p>

                  <div className="space-y-3">
                    {holdings.map((holding) => (
                      <div
                        key={holding.symbol}
                        className="flex items-center justify-between"
                      >
                        {holding.isStrategy && holding.topLogos?.length > 0 ? (
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex -space-x-2">
                                {holding.topLogos.slice(0, 5).map((logo, li) => (
                                  <img key={li} src={logo} className="w-7 h-7 rounded-full object-cover border-2 border-white shadow-sm" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                                ))}
                              </div>
                            </div>
                            <p className="text-sm font-bold tracking-[0.18em] uppercase text-slate-900">{holding.name}</p>
                            <p className="text-xs text-slate-500">{(holding.strategyHoldings || []).length > 0 ? `${holding.strategyHoldings.length} assets` : holding.symbol}</p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 overflow-hidden flex-shrink-0">
                              {failedLogos[holding.symbol] || !holding.logo ? (
                                <span className="text-xs font-bold text-slate-600">
                                  {holding.symbol.slice(0, 3)}
                                </span>
                              ) : (
                                <img
                                  src={holding.logo}
                                  alt={holding.name}
                                  className="h-8 w-8 object-contain"
                                  referrerPolicy="no-referrer"
                                  crossOrigin="anonymous"
                                  onError={() => setFailedLogos(prev => ({ ...prev, [holding.symbol]: true }))}
                                />
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{holding.symbol}</p>
                              <p className="text-xs text-slate-500">{holding.name}</p>
                            </div>
                          </div>
                        )}
                        <div className="text-right">
                          <p className={`text-sm font-semibold ${holding.change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {holding.change >= 0 ? '+' : ''}{holding.change.toFixed(1)}%
                          </p>
                          <p className="text-[10px] text-slate-400">{holding.weight.toFixed(1)}% of portfolio</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Calendar Returns */}
                <section className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50">
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">Calendar Returns</p>
                    <div className="flex items-center gap-2">
                      <div className="relative" ref={calendarFilterRef}>
                        <button
                          onClick={() => setShowCalendarFilterDropdown(!showCalendarFilterDropdown)}
                          className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 max-w-[140px]"
                        >
                          <span className="truncate">{calendarFilterOptions.find(o => o.id === calendarFilter)?.label || "Overall Portfolio"}</span>
                          <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 ${showCalendarFilterDropdown ? 'rotate-180' : ''}`} />
                        </button>
                        {showCalendarFilterDropdown && (
                          <div className="absolute right-0 top-full mt-1 min-w-[160px] max-h-[200px] overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200/50 z-50 overflow-hidden">
                            {calendarFilterOptions.map((option) => (
                              <button
                                key={option.id}
                                onClick={() => { setCalendarFilter(option.id); setShowCalendarFilterDropdown(false); }}
                                className={`w-full px-4 py-2.5 text-left text-xs font-semibold transition-colors ${option.id === calendarFilter
                                    ? "bg-violet-50 text-violet-700"
                                    : "text-slate-600 hover:bg-slate-50"
                                  }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {availableCalendarYears.length > 0 && (
                        <div className="relative" ref={yearDropdownRef}>
                          <button
                            onClick={() => setShowYearDropdown(!showYearDropdown)}
                            className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                          >
                            {calendarYear}
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showYearDropdown ? 'rotate-180' : ''}`} />
                          </button>
                          {showYearDropdown && (
                            <div className="absolute right-0 top-full mt-1 min-w-[80px] bg-white rounded-xl shadow-xl border border-slate-200/50 z-50 overflow-hidden">
                              {availableCalendarYears.map((year) => (
                                <button
                                  key={year}
                                  onClick={() => { setCalendarYear(Number(year)); setShowYearDropdown(false); }}
                                  className={`w-full px-4 py-2.5 text-left text-xs font-semibold transition-colors ${Number(year) === calendarYear
                                      ? "bg-violet-50 text-violet-700"
                                      : "text-slate-600 hover:bg-slate-50"
                                    }`}
                                >
                                  {year}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {monthNames.map((label, index) => {
                      const monthKey = String(index + 1).padStart(2, "0");
                      const value = calendarData[String(calendarYear)]?.[monthKey];
                      const hasData = value != null;
                      return (
                        <div
                          key={`${calendarYear}-${label}`}
                          className={`rounded-xl px-3 py-2.5 text-center ${hasData ? getReturnColor(value) : "bg-slate-50"}`}
                        >
                          <p className={`text-[10px] font-semibold ${hasData ? "text-slate-500" : "text-slate-300"}`}>{label}</p>
                          <p className={`mt-0.5 text-sm font-bold ${hasData ? "" : "text-slate-300"}`}>
                            {hasData ? `${(Number(value) * 100).toFixed(2)}%` : "—"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {strategies.length > 0 && (
                  <button
                    onClick={() => (onOpenStrategies || onOpenInvest) && (onOpenStrategies || onOpenInvest)()}
                    className="w-full py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl flex items-center justify-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Buy More Strategies
                  </button>
                )}
              </div>
            </>
          </motion.div>
        )}

        {/* Individual Stocks Tab Content */}
        {activeTab === "stocks" && (
          <motion.div
            key="stocks"
            initial={{ opacity: 0, x: tabDirection * 40, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: tabDirection * -40, filter: 'blur(6px)' }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {(() => {
              const isMyStock = myStockIds.has(selectedStock?.id);
              const userHolding = isMyStock && selectedSecurityId ? (rawHoldings || []).find(h => h.security_id === selectedSecurityId) : null;
              const userQuantity = userHolding ? (userHolding.quantity || 0) : 0;
              const avgFillRands = userHolding ? (userHolding.avg_fill || 0) / 100 : 0;
              const costBasisStock = avgFillRands * userQuantity;
              const showStockPnl = isMyStock && userQuantity > 0 && avgFillRands > 0;
              const stockChartData = (() => {
                if (stockTimeFilter === "D") {
                  const raw = stockTabIntradayData || [];
                  if (!showStockPnl || !raw.length) return raw;
                  const liveD_abs = stockLiveReturns?.d_abs ?? null;
                  if (liveD_abs == null) return raw;
                  const lastReal = [...raw].reverse().find(p => p.rawCents != null);
                  if (!lastReal) return raw;
                  const newBaseline = ((lastReal.rawCents - liveD_abs) / 100) * userQuantity;
                  return raw.map(p => p.rawCents != null
                    ? { ...p, value: Number(((p.rawCents / 100) * userQuantity - newBaseline).toFixed(2)) }
                    : p
                  );
                }
                if (liveStockChartData.length > 0) {
                  if (showStockPnl) {
                    if (stockTimeFilter === 'W' || stockTimeFilter === 'M') {
                      const daysBack = stockTimeFilter === 'W' ? 9 : 31;
                      const refMs = Date.now() - daysBack * 24 * 60 * 60 * 1000;
                      let refPoint = liveStockChartData[0];
                      for (const d of liveStockChartData) {
                        if ((d.timestamp || 0) <= refMs) refPoint = d;
                        else break;
                      }
                      const refPrice = refPoint.value;
                      const pts = [{ ...liveStockChartData[0], day: null, value: 0 }];
                      liveStockChartData.forEach(d => {
                        pts.push({ ...d, value: Number(((d.value - refPrice) * userQuantity).toFixed(2)) });
                      });
                      return pts;
                    }
                    const pts = [{ ...liveStockChartData[0], day: null, value: 0 }];
                    liveStockChartData.forEach(d => {
                      pts.push({ ...d, value: Number(((d.value * userQuantity) - costBasisStock).toFixed(2)) });
                    });
                    return pts;
                  }
                  return liveStockChartData;
                }
                return showStockPnl ? [{ day: null, value: 0 }, { day: "Today", value: 0 }] : [];
              })();
              const stockAxisConfig = computePnlAxisConfig(stockChartData);
              if (!selectedStock) {
                if (quotesLoading || holdingsLoading) {
                  return <div className="text-center py-10 text-slate-500">Loading stocks...</div>;
                }
                if (stocksList.length === 0) {
                  return <div className="text-center py-10 text-slate-500">No stocks available.</div>;
                }
                return null;
              }
              const otherStocks = stocksList.filter(s => s.id !== selectedStock?.id && !myStockIds.has(s.id));
              const hasNoHoldings = myStocks.length === 0;
              return (
                <>
                  {hasNoHoldings ? (
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                      <div className="w-16 h-16 rounded-full bg-purple-50 flex items-center justify-center mb-4">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                          <polyline points="16 7 22 7 22 13" />
                        </svg>
                      </div>
                      <p className="text-lg font-semibold text-slate-900 mb-1">Invest in Your First Stock</p>
                      <p className="text-sm text-slate-500 text-center max-w-[260px] mb-5">Browse individual stocks and start building your portfolio. Your holdings will show up here.</p>
                      <button
                        onClick={() => onOpenInvest && onOpenInvest()}
                        className="w-full max-w-[280px] py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl"
                      >
                        Make Your First Investment
                      </button>
                    </div>
                  ) : (
                    <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 md:max-w-md md:px-8">
                      <section className="py-2">
                        {/* Chart and stock selector only shown when user has holdings */}
                        <div className="flex items-center justify-between mb-3 px-1">
                          <div className="relative" ref={stockDropdownRef}>
                            <button
                              onClick={() => setShowStockDropdown(!showStockDropdown)}
                              className="flex items-center gap-2 text-slate-900 hover:text-slate-700 transition"
                            >
                              <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
                                {selectedStock.name}
                              </span>
                              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showStockDropdown ? 'rotate-180' : ''}`} />
                            </button>
                            {showStockDropdown && (myStocks.length > 0 || stocksList.length > 0) && (
                              <div
                                className="absolute top-full left-0 mt-2 min-w-[200px] max-h-[280px] overflow-y-auto bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/50 z-50 overscroll-contain"
                                style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif", WebkitOverflowScrolling: 'touch' }}
                              >
                                {(myStocks.length > 0 ? myStocks : stocksList.slice(0, 20)).map((stock) => (
                                  <button
                                    key={stock.id}
                                    onClick={() => { setSelectedStock(stock); setShowStockDropdown(false); }}
                                    className={`w-full px-4 py-3.5 text-left hover:bg-purple-50/50 transition-colors duration-150 border-b border-slate-100/50 last:border-b-0 ${selectedStock.id === stock.id ? 'bg-purple-50' : ''
                                      }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium text-slate-800 text-sm tracking-tight">{stock.name}</p>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-0.5 font-medium tabular-nums">
                                      {formatCurrency(liveQuotes[stock.ticker]?.price || stock.price)}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            {[
                              { id: "D", label: "D" },
                              { id: "W", label: "W" },
                              { id: "M", label: "M" },
                              { id: "ALL", label: "All" },
                            ].map((filter) => (
                              <button
                                key={filter.id}
                                onClick={() => setStockTimeFilter(filter.id)}
                                className={`px-3 h-9 rounded-full text-sm font-bold transition-all ${stockTimeFilter === filter.id
                                    ? "bg-slate-700/80 text-white shadow-lg backdrop-blur-md border border-white/20"
                                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/30"
                                  }`}
                                style={stockTimeFilter === filter.id ? {
                                  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.1), 0 4px 12px rgba(0,0,0,0.15)'
                                } : {}}
                              >
                                {filter.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mb-3 px-1">
                          {(() => {
                            if (isMyStock && userHolding && userQuantity > 0) {
                              const holdingMarketValue = liveHoldingValue(userHolding);
                              const costBasis = ((userHolding.avg_fill || 0) * userQuantity) / 100;
                              // Filter-aware P&L: D/W/M from live intraday data; ALL = all-time
                              let pnl, pnlPct;
                              if (stockTimeFilter === "D" && stockLiveReturns?.d_abs != null) {
                                pnl = (stockLiveReturns.d_abs / 100) * userQuantity;
                                pnlPct = stockLiveReturns.d_pct ?? 0;
                              } else if (stockTimeFilter === "W" && stockLiveReturns?.w_abs != null) {
                                pnl = (stockLiveReturns.w_abs / 100) * userQuantity;
                                pnlPct = stockLiveReturns.w_pct ?? 0;
                              } else if (stockTimeFilter === "M" && stockLiveReturns?.m_abs != null) {
                                pnl = (stockLiveReturns.m_abs / 100) * userQuantity;
                                pnlPct = stockLiveReturns.m_pct ?? 0;
                              } else {
                                pnl = holdingMarketValue - costBasis;
                                pnlPct = costBasis > 0 ? ((pnl / costBasis) * 100) : 0;
                              }
                              const isPos = pnl >= 0;
                              return (
                                <>
                                  <p className="text-3xl font-bold text-slate-900">{formatCurrency(holdingMarketValue)}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-sm font-semibold ${isPos ? 'text-emerald-500' : 'text-rose-500'}`}>
                                      {isPos ? '+' : '-'}R{Math.abs(pnl).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${isPos ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
                                      {isPos ? '+' : ''}{pnlPct.toFixed(1)}%
                                    </span>
                                    {stockTimeFilter === "D" && <span className="text-[10px] text-slate-400 font-medium">Today</span>}
                                    {stockTimeFilter === "W" && <span className="text-[10px] text-slate-400 font-medium">1 week</span>}
                                    {stockTimeFilter === "M" && <span className="text-[10px] text-slate-400 font-medium">1 month</span>}
                                    {stockTimeFilter === "ALL" && <span className="text-[10px] text-slate-400 font-medium">All time</span>}
                                  </div>
                                </>
                              );
                            }
                            const perSharePrice = liveQuotes[selectedStock.ticker]?.price || selectedStock.price;
                            const changePct = liveQuotes[selectedStock.ticker]?.changePercent ?? selectedStock.dailyChange;
                            const isPos = changePct >= 0;
                            return (
                              <>
                                <p className="text-3xl font-bold text-slate-900">{formatCurrency(perSharePrice)}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className={`text-sm font-semibold ${isPos ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {isPos ? '+' : ''}{changePct.toFixed(2)}%
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${isPos ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>Today</span>
                                </div>
                              </>
                            );
                          })()}
                        </div>

                        <div style={{ width: '100%', height: 220, marginBottom: 8, minWidth: 0 }}>
                          {stockChartData.length === 0 ? (
                            stockChartLoading ? (
                              <div style={{ width: '100%', height: 220 }}>
                                <svg width="100%" height="220" viewBox="0 0 400 220" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                                  <defs>
                                    <linearGradient id="stockSkeletonFill" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.6" />
                                      <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.05" />
                                    </linearGradient>
                                    <linearGradient id="stockShimmer" x1="0" y1="0" x2="1" y2="0">
                                      <stop offset="0%" stopColor="transparent"><animate attributeName="offset" values="-1;0;1" dur="1.6s" repeatCount="indefinite" /></stop>
                                      <stop offset="50%" stopColor="rgba(255,255,255,0.55)"><animate attributeName="offset" values="-0.5;0.5;1.5" dur="1.6s" repeatCount="indefinite" /></stop>
                                      <stop offset="100%" stopColor="transparent"><animate attributeName="offset" values="0;1;2" dur="1.6s" repeatCount="indefinite" /></stop>
                                    </linearGradient>
                                    <mask id="stockShimmerMask"><rect width="400" height="220" fill="url(#stockShimmer)" /></mask>
                                  </defs>
                                  {[40,80,120,160].map((y, i) => <rect key={i} x="0" y={y} width="22" height="8" rx="4" fill="#e2e8f0" />)}
                                  <path d="M32,160 C55,155 70,130 90,118 C110,106 125,125 145,108 C165,91 180,70 205,65 C230,60 245,80 265,72 C285,64 300,82 320,75 C340,68 360,85 380,78 L380,190 L32,190 Z" fill="url(#stockSkeletonFill)" />
                                  <path d="M32,160 C55,155 70,130 90,118 C110,106 125,125 145,108 C165,91 180,70 205,65 C230,60 245,80 265,72 C285,64 300,82 320,75 C340,68 360,85 380,78" fill="none" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M32,160 C55,155 70,130 90,118 C110,106 125,125 145,108 C165,91 180,70 205,65 C230,60 245,80 265,72 C285,64 300,82 320,75 C340,68 360,85 380,78 L380,190 L32,190 Z" fill="url(#stockShimmer)" mask="url(#stockShimmerMask)" />
                                  <line x1="32" y1="190" x2="400" y2="190" stroke="#e2e8f0" strokeWidth="1" />
                                  {[55,128,200,272,345].map((x, i) => <rect key={i} x={x - 16} y="200" width="32" height="8" rx="4" fill="#e2e8f0" />)}
                                </svg>
                              </div>
                            ) : (
                              <div style={{ width: '100%', height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div className="text-slate-400 text-sm">No data available</div>
                              </div>
                            )
                          ) : (
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart
                                data={stockChartData}
                                margin={{ top: 10, right: 15, left: 5, bottom: 30 }}
                              >
                                <defs>
                                  <linearGradient id="stockGlowGradientVertical" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
                                    <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.2" />
                                    <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.02" />
                                  </linearGradient>
                                </defs>

                                <XAxis
                                  dataKey="day"
                                  axisLine={false}
                                  tickLine={false}
                                  tickMargin={8}
                                  ticks={stockTimeFilter === 'ytd' ? computeYtdMonthTicks(stockChartData) : undefined}
                                  interval={stockTimeFilter === 'D'
                                    ? Math.max(0, Math.ceil(stockChartData.length / 4) - 1)
                                    : stockTimeFilter === 'ytd' ? 0
                                    : stockChartData.length <= 8 ? 0 : Math.max(0, Math.ceil(stockChartData.length / 4) - 1)}
                                  tick={({ x, y, payload }) => {
                                    if (!payload.value) return null;
                                    const val = String(payload.value);
                                    if (stockTimeFilter === 'D') {
                                      return <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={10} fontWeight={500}>{val}</text>;
                                    }
                                    if (val.includes('|')) {
                                      const [dayPart, timePart] = val.split('|');
                                      return (
                                        <text x={x} y={y} textAnchor="middle" fill="#64748b" fontSize={10} fontWeight={500}>
                                          <tspan x={x} dy={10}>{dayPart}</tspan>
                                          <tspan x={x} dy={13}>{timePart}</tspan>
                                        </text>
                                      );
                                    }
                                    const label = stockTimeFilter === 'ytd' ? val.split(' ')[1] : val;
                                    return <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={11} fontWeight={500}>{label}</text>;
                                  }}
                                />

                                <YAxis
                                  domain={stockAxisConfig.domain}
                                  ticks={stockAxisConfig.ticks}
                                  tickFormatter={formatPnlAxis}
                                  tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                                  axisLine={false}
                                  tickLine={false}
                                  width={55}
                                />

                                <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth={1} />

                                <Tooltip
                                  content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                      let fullDate = payload[0]?.payload?.fullDate || label;
                                      if (typeof fullDate === 'string' && fullDate.includes('|')) {
                                        fullDate = fullDate.replace('|', ' ');
                                      }
                                      const val = payload[0].value;
                                      const isPos = val >= 0;
                                      return (
                                        <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-1.5 shadow-md">
                                          <div className="text-xs text-slate-500 mb-0.5">{fullDate}</div>
                                          <div className="text-sm font-bold text-violet-700">
                                            {showStockPnl ? (isPos ? '+' : '-') + 'R' + Math.abs(val).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'R' + val.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </div>
                                        </div>
                                      );
                                    }
                                    return null;
                                  }}
                                  cursor={false}
                                  wrapperStyle={{ outline: 'none' }}
                                />

                                <Area
                                  type="monotone"
                                  dataKey="value"
                                  stroke="none"
                                  fill="url(#stockGlowGradientVertical)"
                                  fillOpacity={1}
                                />

                                <Line
                                  type="monotone"
                                  dataKey="value"
                                  stroke="#7c3aed"
                                  strokeWidth={2.5}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  dot={false}
                                  activeDot={{
                                    r: 6,
                                    fill: '#7c3aed',
                                    stroke: '#c4b5fd',
                                    strokeWidth: 2,
                                  }}
                                />
                              </ComposedChart>
                            </ResponsiveContainer>
                          )}
                        </div>
                      </section>
                    </div>
                  )}

                  <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-8">
                    {myStocks.length > 0 && (() => {
                      const STOCKS_PER_PAGE = 6;
                      const myTotalPages = Math.ceil(myStocks.length / STOCKS_PER_PAGE);
                      const myPagedStocks = myStocks.slice(myStocksPage * STOCKS_PER_PAGE, (myStocksPage + 1) * STOCKS_PER_PAGE);
                      return (
                        <section
                          className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50"
                          style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                        >
                          <div className="flex items-center justify-between mb-4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">My Stocks</p>
                            {myTotalPages > 1 && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setMyStocksPage(p => Math.max(0, p - 1))}
                                  disabled={myStocksPage === 0}
                                  className={`h-7 w-7 rounded-full flex items-center justify-center transition ${myStocksPage === 0 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                >
                                  <ChevronLeft className="h-4 w-4" />
                                </button>
                                <span className="text-xs font-medium text-slate-400 tabular-nums">{myStocksPage + 1}/{myTotalPages}</span>
                                <button
                                  onClick={() => setMyStocksPage(p => Math.min(myTotalPages - 1, p + 1))}
                                  disabled={myStocksPage >= myTotalPages - 1}
                                  className={`h-7 w-7 rounded-full flex items-center justify-center transition ${myStocksPage >= myTotalPages - 1 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            {myPagedStocks.map((stock) => {
                              const livePrice = liveQuotes[stock.ticker]?.price || stock.price;
                              const liveChange = liveQuotes[stock.ticker]?.changePercent ?? stock.dailyChange;
                              const isPositive = liveChange >= 0;
                              const stockSecId = liveQuotes[stock.ticker]?.id || null;
                              const stockHolding = stockSecId ? (rawHoldings || []).find(h => h.security_id === stockSecId) : null;
                              const stockQty = stockHolding ? (stockHolding.quantity || 0) : 0;
                              const displayPrice = stockQty > 0 ? livePrice * stockQty : livePrice;
                              return (
                                <button
                                  key={stock.id}
                                  onClick={() => setSelectedStock(stock)}
                                  className="w-full flex items-center gap-3 rounded-2xl bg-white/70 backdrop-blur-xl p-3 shadow-sm border border-slate-100/50 transition hover:bg-white/90 text-left"
                                >
                                  <div className="h-11 w-11 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                    {failedLogos[stock.ticker] ? (
                                      <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-violet-100 to-purple-100 text-xs font-bold text-violet-700">
                                        {stock.ticker.slice(0, 2)}
                                      </div>
                                    ) : (
                                      <img
                                        src={stock.logo}
                                        alt={stock.name}
                                        className="h-full w-full object-cover"
                                        onError={() => setFailedLogos(prev => ({ ...prev, [stock.ticker]: true }))}
                                      />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <p className="text-sm font-semibold text-slate-900 leading-snug break-words">{stock.name}</p>
                                    </div>
                                    <p className="text-xs text-slate-500 font-medium">{stockQty > 0 ? `${Math.round(stockQty)} shares` : stock.ticker}</p>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="text-sm font-bold text-slate-900">{formatCurrency(displayPrice)}</p>
                                    <p className={`text-xs font-medium ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                                      {isPositive ? '+' : ''}{liveChange.toFixed(2)}%
                                    </p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })()}

                    {!hasNoHoldings && (
                      <button
                        onClick={() => onOpenInvest && onOpenInvest()}
                        className="w-full py-3.5 rounded-full bg-gradient-to-r from-slate-800 to-slate-900 text-sm font-semibold uppercase tracking-[0.1em] text-white shadow-lg shadow-slate-900/30 transition hover:-translate-y-0.5 hover:shadow-xl flex items-center justify-center gap-2"
                      >
                        <Plus className="h-4 w-4" />
                        Buy More Stocks
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </motion.div>
        )}

        {/* Holdings Tab Content */}
        {activeTab === "holdings" && (
          <motion.div
            key="holdings"
            initial={{ opacity: 0, x: tabDirection * 40, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: tabDirection * -40, filter: 'blur(6px)' }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {(() => {
              if (holdingsLoading || strategiesLoading) {
                return (
                  <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-8">
                    <div className="text-center py-10 text-slate-500">Loading holdings...</div>
                  </div>
                );
              }
              const pieColors = ["#4C1D95", "#5B21B6", "#6D28D9", "#7C3AED", "#8B5CF6", "#A78BFA", "#C4B5FD", "#DDD6FE", "#EDE9FE", "#F5F3FF"];

              const holdingsData = allStrategyHoldings.map(h => ({
                id: h.symbol,
                name: h.name,
                ticker: h.symbol,
                logo: h.logo,
                isStrategy: h.isStrategy || false,
                securityId: h.securityId || null,
                topLogos: h.topLogos || [],
                strategyId: h.strategyId || null,
                strategyHoldings: h.strategyHoldings || [],
                currentValue: h.currentValue || 0,
                investedAmount: h.investedAmount || 0,
                change: h.change || 0,
                isPending: h.isPending || false,
                settlement_status: h.settlement_status || null,
                cashElement: h.cashElement || 0,
                positionsValue: h.positionsValue || 0,
              })).sort((a, b) => b.currentValue - a.currentValue);

              const flatPieData = (() => {
                const map = new Map();
                let totalCashPie = 0;
                holdingsData.forEach(h => {
                  if (h.isStrategy && h.strategyHoldings?.length > 0) {
                    // Use positionsValue (stocks only) so cash is shown separately
                    const stocksVal = h.positionsValue > 0 ? h.positionsValue : h.currentValue;
                    totalCashPie += h.cashElement || 0;
                    const totalWeight = h.strategyHoldings.reduce((s, c) => s + (c.weight || 0), 0) || 100;
                    h.strategyHoldings.forEach(c => {
                      const pct = (c.weight || 0) / totalWeight;
                      const val = stocksVal * pct;
                      const key = c.symbol || c.name;
                      if (map.has(key)) {
                        map.get(key).value += val;
                      } else {
                        map.set(key, { name: c.symbol || c.name, displayName: c.name || c.symbol, value: val });
                      }
                    });
                  } else if (!h.isStrategy) {
                    const key = h.ticker;
                    if (map.has(key)) {
                      map.get(key).value += h.currentValue;
                    } else {
                      map.set(key, { name: h.ticker, displayName: h.name, value: h.currentValue });
                    }
                  }
                });
                if (totalCashPie > 0) {
                  map.set('__CASH__', { name: 'Cash', displayName: 'Cash', value: totalCashPie, isCash: true });
                }
                return Array.from(map.values()).sort((a, b) => b.value - a.value);
              })();

              if (holdingsData.length === 0) {
                return (
                  <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-8">
                    <div
                      className="rounded-3xl p-8 backdrop-blur-xl shadow-sm border border-slate-100/50 text-center"
                      style={{ background: 'rgba(255,255,255,0.7)', fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                    >
                      <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
                        <TrendingUp className="h-7 w-7 text-violet-500" />
                      </div>
                      <p className="text-lg font-semibold text-slate-900 mb-1">No holdings yet</p>
                      <p className="text-sm text-slate-500">Your investment holdings will appear here once you start investing.</p>
                    </div>
                    {investmentGoals && investmentGoals.length > 0 && (
                      <section className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50">
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">Your Goals</p>
                          <span className="text-xs font-semibold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5">{investmentGoals.length}</span>
                        </div>
                        <div className="space-y-3">
                          {investmentGoals.map((g) => {
                            const currentValue = g.currentAmount || 0;
                            const invested = g.investedAmount || 0;
                            const target = g.targetAmount || 0;
                            const remaining = Math.max(0, target - currentValue);
                            const pct = target > 0 ? Math.min(100, (currentValue / target) * 100) : 0;
                            const gainLoss = currentValue - invested;
                            return (
                              <div key={g.id || (g.label + g.targetAmount)} className="rounded-2xl bg-slate-50 p-4">
                                <div className="flex items-center justify-between mb-1">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">{g.label}</p>
                                    <div className="flex items-center gap-1.5">
                                      {g.linkedAssetName && (
                                        <p className="text-[10px] text-slate-400">Linked to {g.linkedAssetName}</p>
                                      )}
                                      {g.targetDate && !isNaN(new Date(g.targetDate).getTime()) && (
                                        <p className="text-[10px] text-slate-400">
                                          {g.linkedAssetName ? '• ' : ''}{new Date(g.targetDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-xs font-semibold text-slate-600">
                                    {formatCurrency(currentValue)} / {formatCurrency(target)}
                                  </p>
                                </div>
                                <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden mb-2">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <div className="flex items-center justify-between">
                                  <p className="text-xs text-slate-500">
                                    {pct >= 100 ? "Goal reached!" : `${formatCurrency(remaining)} remaining`}
                                  </p>
                                  <div className="flex items-center gap-2">
                                    {gainLoss !== 0 && invested > 0 && (
                                      <span className={`text-[10px] font-semibold ${gainLoss > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {gainLoss > 0 ? '+' : ''}{formatCurrency(gainLoss)}
                                      </span>
                                    )}
                                    <p className="text-xs font-semibold text-violet-600">{pct.toFixed(0)}%</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}
                  </div>
                );
              }

              const totalValue = holdingsData.reduce((sum, h) => sum + h.currentValue, 0);
              const totalCostBasisValue = holdingsData.reduce((sum, h) => sum + (h.costBasis || h.currentValue), 0);
              const totalDistinct = flatPieData.length;

              const top10 = flatPieData.slice(0, 10).map((h, idx) => ({
                name: h.name,
                displayName: h.displayName,
                value: h.value,
                isCash: h.isCash || false,
                color: pieColors[idx % pieColors.length],
              }));
              const othersValue = flatPieData.slice(10).reduce((sum, h) => sum + h.value, 0);
              const pieData = othersValue > 0
                ? [...top10, { name: "Others", displayName: "Others", value: othersValue, color: "#E9D5FF" }]
                : top10;
              const totalCashRands = holdingsData.reduce((s, h) => s + (h.cashElement || 0), 0);
              const cashPieColor = (pieData.find(d => d.isCash) || {}).color || pieColors[pieColors.length - 1];

              return (
                <div className="relative mx-auto flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md md:px-8">
                  {/* Summary Card with Pie Chart */}
                  <div
                    className="rounded-3xl p-5 backdrop-blur-xl shadow-sm border border-slate-100/50"
                    style={{ background: 'rgba(255,255,255,0.7)', fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-3" data-coach-pf-summary="true">
                        <div>
                          <p className="text-xs text-slate-500 mb-0.5">Total Portfolio Value</p>
                          <p className="text-2xl font-bold text-slate-900">{formatCurrency(totalValue)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-3xl font-bold text-slate-900">{totalDistinct}</p>
                          <div className="flex flex-col justify-center">
                            <p className="text-xs text-slate-500 leading-tight">Total Holdings</p>
                            <p className="text-xs text-slate-500 leading-tight">assets</p>
                          </div>
                        </div>
                      </div>

                      {/* Right: Pie Chart */}
                      <div data-coach-pf-pie="true" className="relative h-44 w-44 -mr-4 md:mr-0" style={{ pointerEvents: isLoadingData ? 'none' : 'auto', opacity: isLoadingData ? 0.5 : 1, transition: 'opacity 0.3s ease' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <defs>
                              <filter id="glow">
                                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                                <feMerge>
                                  <feMergeNode in="coloredBlur" />
                                  <feMergeNode in="SourceGraphic" />
                                </feMerge>
                              </filter>
                            </defs>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              outerRadius={80}
                              paddingAngle={2}
                              dataKey="value"
                              stroke="rgba(255,255,255,0.9)"
                              strokeWidth={1.5}
                              animationBegin={0}
                              animationDuration={800}
                              animationEasing="ease-out"
                            >
                              {pieData.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={entry.color}
                                  opacity={activePieIndex >= 0 && activePieIndex !== index ? 0.4 : 1}
                                  style={{
                                    transform: activePieIndex === index
                                      ? 'scale(1.1)'
                                      : activePieIndex >= 0
                                        ? 'scale(0.94)'
                                        : 'scale(1)',
                                    transformOrigin: 'center',
                                    transition: 'transform 0.6s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.5s ease-out, filter 0.5s ease-out',
                                    cursor: 'pointer',
                                    filter: activePieIndex === index ? 'url(#glow)' : 'none'
                                  }}
                                  onMouseEnter={() => !isLoadingData && setActivePieIndex(index)}
                                  onMouseLeave={() => !isLoadingData && setActivePieIndex(-1)}
                                  onClick={() => !isLoadingData && setActivePieIndex(activePieIndex === index ? -1 : index)}
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              wrapperStyle={{ outline: 'none', zIndex: 100 }}
                              position={{ x: -80, y: -10 }}
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  const percent = ((data.value / totalValue) * 100).toFixed(1);
                                  return (
                                    <div
                                      className="px-3 py-2 rounded-xl shadow-2xl border border-white/20"
                                      style={{
                                        background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.9) 100%)',
                                        backdropFilter: 'blur(20px)',
                                        WebkitBackdropFilter: 'blur(20px)',
                                        minWidth: '70px',
                                        textAlign: 'center'
                                      }}
                                    >
                                      <p className="text-xs font-bold text-slate-800">{data.displayName || data.name}</p>
                                      <p className="text-base font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                                        {percent}%
                                      </p>
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
                  </div>

                  {/* Holdings List */}
                  {(() => {
                    const HOLDINGS_PER_PAGE = 6;
                    const holdingsTotalPages = Math.ceil(holdingsData.length / HOLDINGS_PER_PAGE);
                    const pagedHoldings = holdingsData.slice(holdingsPage * HOLDINGS_PER_PAGE, (holdingsPage + 1) * HOLDINGS_PER_PAGE);
                    return (
                      <>
                        <section
                          data-coach-pf-assets="true"
                          className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50"
                          style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                        >
                          <div className="flex items-center justify-between mb-4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">Your Assets</p>
                            {holdingsTotalPages > 1 && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setHoldingsPage(p => Math.max(0, p - 1))}
                                  disabled={holdingsPage === 0}
                                  className={`h-7 w-7 rounded-full flex items-center justify-center transition ${holdingsPage === 0 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                >
                                  <ChevronLeft className="h-4 w-4" />
                                </button>
                                <span className="text-xs font-medium text-slate-400 tabular-nums">{holdingsPage + 1}/{holdingsTotalPages}</span>
                                <button
                                  onClick={() => setHoldingsPage(p => Math.min(holdingsTotalPages - 1, p + 1))}
                                  disabled={holdingsPage >= holdingsTotalPages - 1}
                                  className={`h-7 w-7 rounded-full flex items-center justify-center transition ${holdingsPage >= holdingsTotalPages - 1 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            {pagedHoldings.map((stock) => {
                              const pctValue = totalValue > 0 ? ((stock.currentValue / totalValue) * 100) : 0;
                              const changePnl = stock.change || 0;
                              const isExpanded = stock.isStrategy && expandedStrategyId === stock.strategyId;
                              return (
                                <div key={stock.id} ref={isExpanded ? expandedRowRef : null}>
                                  <div
                                    className={`rounded-2xl bg-white/70 backdrop-blur-xl p-4 shadow-sm border transition-all duration-200 cursor-pointer active:scale-[0.98] ${stock.isStrategy ? 'border-violet-100/60' : 'border-slate-100/50'}`}
                                    onClick={() => {
                                      if (stock.isStrategy) {
                                        setExpandedStrategyId(isExpanded ? null : stock.strategyId);
                                      } else {
                                        setModalHolding(stock);
                                        setModalTimeFilter("W");
                                      }
                                    }}
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
                                              <p className="text-sm font-bold text-slate-900">
                                                {stock.isPending ? "—" : formatCurrency(stock.currentValue)}
                                              </p>
                                              {stock.isPending ? (
                                                <p className="text-xs text-amber-500 font-semibold">Pending</p>
                                              ) : (
                                                <div className="flex flex-col items-end">
                                                  <p className={`text-xs font-semibold ${changePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {changePnl >= 0 ? '+' : ''}{changePnl.toFixed(1)}% Total Return
                                                  </p>
                                                  {stock.ytd_return != null && (
                                                    <p className={`text-[10px] font-medium mt-0.5 ${stock.ytd_return >= 0 ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                                                      {stock.ytd_return >= 0 ? '+' : ''}{(stock.ytd_return * 100).toFixed(1)}% Strategy YTD
                                                    </p>
                                                  )}
                                                </div>
                                              )}
                                              <p className="text-[10px] text-slate-400">{pctValue.toFixed(1)}% of portfolio</p>
                                            </div>
                                            <ChevronDown className={`h-4 w-4 text-slate-400 flex-shrink-0 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                          </div>
                                        </div>
                                        <p className="text-sm font-bold tracking-[0.18em] uppercase text-slate-900">{stock.name}</p>
                                        <p className="text-xs text-slate-500 font-medium mt-0.5">{(stock.strategyHoldings || []).length} assets</p>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-3 w-full">
                                        <div className="h-11 w-11 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                          {!stock.logo || failedLogos[stock.ticker] ? (
                                            <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-violet-100 to-purple-100 text-xs font-bold text-violet-700">
                                              {(stock.ticker || '').slice(0, 2)}
                                            </div>
                                          ) : (
                                            <img
                                              src={stock.logo}
                                              alt={stock.name}
                                              className="h-full w-full object-cover"
                                              onError={() => setFailedLogos(prev => ({ ...prev, [stock.ticker]: true }))}
                                            />
                                          )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-semibold text-slate-900 truncate">{stock.name}</p>
                                          <p className="text-xs text-slate-500 font-medium">{stock.isStrategy ? `${(stock.strategyHoldings || []).length} assets` : stock.ticker}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <div className="text-right flex-shrink-0">
                                            <p className="text-sm font-bold text-slate-900">
                                              {stock.isPending ? "—" : formatCurrency(stock.currentValue)}
                                            </p>
                                            {stock.isPending ? (
                                              <p className="text-xs text-amber-500 font-semibold">Pending</p>
                                            ) : (
                                              <div className="flex flex-col items-end">
                                                <p className={`text-xs font-semibold ${changePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                  {changePnl >= 0 ? '+' : ''}{changePnl.toFixed(1)}%
                                                </p>
                                              </div>
                                            )}
                                            <p className="text-[10px] text-slate-400">{pctValue.toFixed(1)}% of portfolio</p>
                                          </div>
                                          {stock.isStrategy && (
                                            <ChevronDown className={`h-4 w-4 text-slate-400 flex-shrink-0 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Expandable constituent stocks */}
                                  {stock.isStrategy && isExpanded && stock.strategyHoldings?.length > 0 && (
                                    <div className="mt-1.5 ml-3 space-y-1.5 border-l-2 border-violet-100 pl-3">
                                      {stock.strategyHoldings.map((c, ci) => {
                                        const matchedHolding = (rawHoldings || []).find(h => h.symbol === c.symbol);
                                        const matchedStock = stocksList?.find(s => s.ticker === c.symbol);
                                        const logo = matchedHolding?.logo || matchedStock?.logo || null;
                                        const cQty = matchedHolding ? Math.abs(Number(matchedHolding.quantity || 0)) : 0;
                                        const cAvgFillRands = matchedHolding ? Number(matchedHolding.avg_fill || 0) / 100 : 0;
                                        const cLivePriceRands = liveQuotes[c.symbol]?.price ?? 0;
                                        const cHasLive = cQty > 0 && cLivePriceRands > 0 && cAvgFillRands > 0;
                                        let pnlRands, pnlPct;
                                        if (cHasLive) {
                                          pnlRands = (cLivePriceRands - cAvgFillRands) * cQty;
                                          pnlPct = (pnlRands / (cAvgFillRands * cQty)) * 100;
                                        } else if (c.pnlRands != null && !isNaN(c.pnlRands)) {
                                          pnlRands = c.pnlRands;
                                          pnlPct = (c.pnlPct != null && !isNaN(c.pnlPct)) ? c.pnlPct : 0;
                                        } else {
                                          const totalW = stock.strategyHoldings.reduce((s, x) => s + Number(x.weight || 0), 0) || 100;
                                          const fraction = Number(c.weight || 0) / totalW;
                                          const constituentCurrentVal = (stock.currentValue || 0) * fraction;
                                          const constituentCostBasis = (Number(stock.investedAmount) || Number(stock.currentValue) || 0) * fraction;
                                          pnlRands = constituentCurrentVal - constituentCostBasis;
                                          pnlPct = constituentCostBasis > 0 ? (pnlRands / constituentCostBasis) * 100 : 0;
                                        }
                                        pnlRands = isNaN(pnlRands) ? 0 : pnlRands;
                                        pnlPct = isNaN(pnlPct) ? 0 : pnlPct;
                                        const isGain = pnlRands >= 0;
                                        const onOpenConstituent = () => {
                                          if (!matchedStock) return;
                                          const rawH = (rawHoldings || []).find(h => h.security_id === matchedStock.id);
                                          const livePrice = liveQuotes[matchedStock.ticker]?.price || matchedStock.price || 0;
                                          const qty = rawH ? (rawH.quantity || 0) : 0;
                                          setModalHolding({ ...matchedStock, currentValue: qty * livePrice });
                                          setModalTimeFilter("W");
                                        };
                                        return (
                                          <button key={ci} onClick={onOpenConstituent} className="w-full rounded-xl bg-white/80 backdrop-blur-sm p-3 border border-slate-100/50 flex items-center gap-3 text-left transition hover:bg-white/95 active:scale-[0.98]">
                                            <div className="h-8 w-8 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                              {logo && !failedLogos[c.symbol] ? (
                                                <img
                                                  src={logo}
                                                  alt={c.symbol}
                                                  className="h-full w-full object-cover"
                                                  referrerPolicy="no-referrer"
                                                  crossOrigin="anonymous"
                                                  onError={() => setFailedLogos(prev => ({ ...prev, [c.symbol]: true }))}
                                                />
                                              ) : (
                                                <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
                                                  <span className="text-[9px] font-bold text-slate-500">{(c.symbol || '').slice(0, 3)}</span>
                                                </div>
                                              )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <p className="text-xs font-semibold text-slate-800 truncate">{c.name || c.symbol}</p>
                                              <p className="text-[10px] text-slate-500">{c.symbol}</p>
                                            </div>
                                            <div className="text-right flex-shrink-0">
                                              {stock.isPending ? (
                                                <SettlementBadge status="pending" size="xs" />
                                              ) : (
                                                <>
                                                  <p className={`text-xs font-bold ${isGain ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                    {isGain ? '+' : ''}{formatCurrency(pnlRands)}
                                                  </p>
                                                  <p className={`text-[10px] font-semibold ${isGain ? 'text-emerald-500' : 'text-rose-400'}`}>
                                                    {isGain ? '+' : ''}{pnlPct.toFixed(2)}%
                                                  </p>
                                                </>
                                              )}
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Cash row — buffer + residual combined */}
                          {totalCashRands > 0 && (
                            <div className="mt-3 rounded-2xl p-4 border border-slate-100/50 bg-white/70">
                              <div className="flex items-center gap-3 w-full">
                                <div className="h-11 w-11 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: cashPieColor }}>
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 6v2m0 8v2M9.5 9.5C9.5 8.4 10.6 7.5 12 7.5s2.5.9 2.5 2c0 2-5 2-5 4 0 1.1 1.1 2 2.5 2s2.5-.9 2.5-2" />
                                  </svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-900">Cash</p>
                                  <p className="text-xs text-slate-500 font-medium">Buffer &amp; residual</p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <p className="text-sm font-bold text-slate-900">{formatCurrency(totalCashRands)}</p>
                                  <p className="text-[10px] text-slate-400">{totalValue > 0 ? ((totalCashRands / totalValue) * 100).toFixed(1) : '0.0'}% of portfolio</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </section>

                        {closedHoldings && closedHoldings.length > 0 && (
                          <section className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900 mb-4">Closed Positions</p>
                            <div className="space-y-3">
                              {closedHoldings.map((h) => {
                                const exitPriceRands = (h.exit_price || 0) / 100;
                                const avgFillRands = (h.avg_fill || 0) / 100;
                                const pnlRands = (exitPriceRands - avgFillRands) * (h.quantity || 0);
                                const isGain = pnlRands >= 0;
                                return (
                                  <div key={h.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4">
                                    <div className="h-10 w-10 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                      {h.logo_url ? (
                                        <img src={h.logo_url} alt={h.name} className="h-full w-full object-cover" />
                                      ) : (
                                        <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-xs font-bold text-slate-500">
                                          {(h.symbol || '').slice(0, 2)}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-semibold text-slate-900 leading-snug break-words">{h.name}</p>
                                      <p className="text-xs text-slate-500">{h.symbol} · Exit: R{exitPriceRands.toFixed(2)}</p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <span className="inline-block text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 mb-1">Exited</span>
                                      {h.exit_price > 0 && (
                                        <p className={`text-xs font-bold ${isGain ? 'text-emerald-600' : 'text-rose-500'}`}>
                                          {isGain ? '+' : ''}R{Math.abs(pnlRands).toFixed(2)}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        )}

                        {(() => {
                          const STOCKS_PER_PAGE = 6;
                          const holdingsOtherStocks = stocksList.filter(s => !myStockIds.has(s.id));
                          const otherTotalPages = Math.ceil(holdingsOtherStocks.length / STOCKS_PER_PAGE);
                          const otherPagedStocks = holdingsOtherStocks.slice(otherStocksPage * STOCKS_PER_PAGE, (otherStocksPage + 1) * STOCKS_PER_PAGE);
                          if (holdingsOtherStocks.length === 0) return null;
                          return (
                            <section data-coach-pf-other="true" className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50 mt-4">
                              <div className="flex items-center justify-between mb-4">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">Other Stocks</p>
                                {otherTotalPages > 1 && (
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => setOtherStocksPage(p => Math.max(0, p - 1))}
                                      disabled={otherStocksPage === 0}
                                      className={`h-7 w-7 rounded-full flex items-center justify-center transition ${otherStocksPage === 0 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                    >
                                      <ChevronLeft className="h-4 w-4" />
                                    </button>
                                    <span className="text-xs font-medium text-slate-400 tabular-nums">{otherStocksPage + 1}/{otherTotalPages}</span>
                                    <button
                                      onClick={() => setOtherStocksPage(p => Math.min(otherTotalPages - 1, p + 1))}
                                      disabled={otherStocksPage >= otherTotalPages - 1}
                                      className={`h-7 w-7 rounded-full flex items-center justify-center transition ${otherStocksPage >= otherTotalPages - 1 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-100 active:bg-slate-200'}`}
                                    >
                                      <ChevronRight className="h-4 w-4" />
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div className="space-y-3">
                                {otherPagedStocks.map((stock) => {
                                  const livePrice = liveQuotes[stock.ticker]?.price || stock.price;
                                  const liveChange = liveQuotes[stock.ticker]?.changePercent ?? stock.dailyChange;
                                  const isPositive = liveChange >= 0;
                                  return (
                                    <button
                                      key={stock.id}
                                      onClick={() => { setModalHolding(stock); setModalTimeFilter("W"); }}
                                      className="w-full flex items-center gap-3 rounded-2xl bg-white/70 backdrop-blur-xl p-3 shadow-sm border border-slate-100/50 transition hover:bg-white/90 text-left"
                                    >
                                      <div className="h-11 w-11 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                                        {failedLogos[stock.ticker] ? (
                                          <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-violet-100 to-purple-100 text-xs font-bold text-violet-700">
                                            {stock.ticker.slice(0, 2)}
                                          </div>
                                        ) : (
                                          <img
                                            src={stock.logo}
                                            alt={stock.name}
                                            className="h-full w-full object-cover"
                                            onError={() => setFailedLogos(prev => ({ ...prev, [stock.ticker]: true }))}
                                          />
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-900 leading-snug break-words">{stock.name}</p>
                                        <p className="text-xs text-slate-500 font-medium">{stock.ticker}</p>
                                      </div>
                                      <div className="text-right flex-shrink-0">
                                        <p className="text-sm font-bold text-slate-900">{formatCurrency(livePrice)}</p>
                                        <p className={`text-xs font-medium ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                                          {isPositive ? '+' : ''}{liveChange.toFixed(2)}%
                                        </p>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })()}

                        {investmentGoals && investmentGoals.length > 0 && (
                          <section data-coach-pf-goals="true" className="rounded-3xl bg-white/70 backdrop-blur-xl p-5 shadow-sm border border-slate-100/50 mt-4">
                            <div className="flex items-center justify-between mb-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">Your Goals</p>
                              <span className="text-xs font-semibold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5">{investmentGoals.length}</span>
                            </div>
                            <div className="space-y-3">
                              {investmentGoals.map((g) => {
                                const currentValue = g.currentAmount || 0;
                                const invested = g.investedAmount || 0;
                                const target = g.targetAmount || 0;
                                const remaining = Math.max(0, target - currentValue);
                                const pct = target > 0 ? Math.min(100, (currentValue / target) * 100) : 0;
                                const gainLoss = currentValue - invested;
                                return (
                                  <div key={g.id || (g.label + g.targetAmount)} className="rounded-2xl bg-slate-50 p-4">
                                    <div className="flex items-center justify-between mb-1">
                                      <div>
                                        <p className="text-sm font-semibold text-slate-900">{g.label}</p>
                                        <div className="flex items-center gap-1.5">
                                          {g.linkedAssetName && (
                                            <p className="text-[10px] text-slate-400">Linked to {g.linkedAssetName}</p>
                                          )}
                                          {g.targetDate && !isNaN(new Date(g.targetDate).getTime()) && (
                                            <p className="text-[10px] text-slate-400">
                                              {g.linkedAssetName ? '• ' : ''}{new Date(g.targetDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                      <p className="text-xs font-semibold text-slate-600">
                                        {formatCurrency(currentValue)} / {formatCurrency(target)}
                                      </p>
                                    </div>
                                    <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden mb-2">
                                      <div
                                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-purple-600 transition-all"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <p className="text-xs text-slate-500">
                                        {pct >= 100 ? "Goal reached!" : `${formatCurrency(remaining)} remaining`}
                                      </p>
                                      <div className="flex items-center gap-2">
                                        {gainLoss !== 0 && invested > 0 && (
                                          <span className={`text-[10px] font-semibold ${gainLoss > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {gainLoss > 0 ? '+' : ''}{formatCurrency(gainLoss)}
                                          </span>
                                        )}
                                        <p className="text-xs font-semibold text-violet-600">{pct.toFixed(0)}%</p>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        )}
                      </>
                    );
                  })()}
                </div>
              );
            })()}

            {/* Withdraw — sell-flow entry point (relocated here from the balance card) */}
            {!holdingsLoading && allStrategyHoldings.length > 0 && onWithdraw && (
              <div className="relative mx-auto w-full max-w-sm px-4 pb-10 md:max-w-md md:px-8">
                <div data-coach-pf-withdraw="true" className="rounded-3xl border border-violet-100 bg-gradient-to-br from-white to-violet-50/40 p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
                      <ArrowUpRight size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">Withdraw</p>
                      <p className="mt-0.5 text-xs text-slate-500">Sell a holding or strategy to cash out.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onWithdraw}
                    className="mt-4 w-full rounded-2xl bg-violet-600 py-3.5 text-sm font-semibold text-white transition active:scale-[0.99]"
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Holding Stock Chart Modal */}
      <AnimatePresence>
        {modalHolding && (() => {
          const mHolding = modalHolding;
          const mRawHolding = (rawHoldings || []).find(h =>
            String(h.security_id) === String(modalSecurityId) ||
            String(h.security_id) === String(mHolding.securityId)
          );
          const mQty = mRawHolding ? (mRawHolding.quantity || 0) : 0;
          const mAvgFill = mRawHolding ? (mRawHolding.avg_fill || 0) / 100 : 0;
          const mCostBasis = mAvgFill * mQty;
          const mShowPnl = mQty > 0 && mAvgFill > 0;
          const mMarketValue = mHolding.currentValue || 0;
          // Filter-aware P&L: D/W/M from live intraday data; ALL = all-time
          let mPnl, mPnlPct;
          if (modalTimeFilter === "D" && modalLiveReturns?.d_abs != null) {
            mPnl = (modalLiveReturns.d_abs / 100) * mQty;
            mPnlPct = modalLiveReturns.d_pct ?? 0;
          } else if (modalTimeFilter === "W" && modalLiveReturns?.w_abs != null) {
            mPnl = (modalLiveReturns.w_abs / 100) * mQty;
            mPnlPct = modalLiveReturns.w_pct ?? 0;
          } else if (modalTimeFilter === "M" && modalLiveReturns?.m_abs != null) {
            mPnl = (modalLiveReturns.m_abs / 100) * mQty;
            mPnlPct = modalLiveReturns.m_pct ?? 0;
          } else {
            mPnl = mShowPnl ? mMarketValue - mCostBasis : 0;
            mPnlPct = mShowPnl && mCostBasis > 0 ? (mPnl / mCostBasis) * 100 : 0;
          }
          const mLiveChange = liveQuotes[mHolding.ticker]?.changePercent ?? mHolding.change ?? 0;

          // Use the date string as-is from the DB (no timezone conversion).
          const mPurchaseTs = modalPurchaseDate
            ? new Date(modalPurchaseDate.slice(0, 10) + 'T00:00:00').getTime()
            : null;

          // Format a date string to match each filter's x-axis label style.
          const mFormatLabel = (isoStr, filter) => {
            if (!isoStr) return '';
            const d = new Date(isoStr.slice(0, 10) + 'T00:00:00');
            const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const dow = d.getDay(), dy = d.getDate(), mo = d.getMonth(), yr = d.getFullYear();
            if (filter === 'D') return DAY[dow] + ' ' + dy + ' ' + MON[mo];
            if (filter === 'W') return DAY[dow] + ' ' + dy;
            if (filter === 'M') return dy + ' ' + MON[mo];
            return MON[mo] + " '" + String(yr).slice(-2);
          };
          const mPurchaseLabel = mFormatLabel(modalPurchaseDate, modalTimeFilter);
          const mNowLabel = mFormatLabel(new Date().toISOString(), modalTimeFilter);

          // Keep only chart points on or after the local purchase date.
          // Falls back to an empty array if bought today and no close price exists yet (e.g. weekend).
          const mBaseChartData = (() => {
            if (!modalRawChartData.length) return [];
            if (!mPurchaseTs) return modalRawChartData;
            return modalRawChartData.filter(d => (d.timestamp || 0) >= mPurchaseTs);
          })();

          const mIsPending = mQty > 0 && mAvgFill === 0;
          const mChartDataRaw = mIsPending
            ? [{ day: mPurchaseLabel || 'Purchase', value: 0 }, { day: mNowLabel || 'Now', value: 0 }]
            : mBaseChartData.length > 0
              ? (mShowPnl
                ? mBaseChartData.map(d => ({
                  ...d,
                  value: Number(((d.value * mQty) - mCostBasis).toFixed(2)),
                }))
                : mBaseChartData)
              // No closes after purchase yet (e.g. bought on weekend): flat line at current P&L.
              : (mShowPnl ? [{ day: mPurchaseLabel, value: 0 }, { day: mNowLabel, value: Number(mPnl.toFixed(2)) }] : []);

          // Normalize: subtract first point's value so the chart line always starts at R0.
          // This shows "change during the selected period" — the R0 reference line means
          // "same as start of period", regardless of absolute P&L from cost basis.
          const mChartData = (() => {
            if (mChartDataRaw.length < 2) return mChartDataRaw;
            const offset = mChartDataRaw[0].value;
            if (offset === 0) return mChartDataRaw;
            return mChartDataRaw.map((pt, i) => ({
              ...pt,
              value: i === 0 ? 0 : Number((pt.value - offset).toFixed(2)),
            }));
          })();

          // Period-aware P&L: for ALL tab use live total; for D/W/M use the chart's
          // last point (which is already the change during the selected period).
          const mPeriodLabels = { D: 'today', W: 'this week', M: 'this month', ALL: 'since purchase' };
          const mPeriodLabel = mPeriodLabels[modalTimeFilter] ?? 'since purchase';
          const mPeriodPnl = (() => {
            if (!mShowPnl) return 0;
            if (modalTimeFilter === 'ALL') return mPnl;
            if (modalTimeFilter === 'D') {
              // Use the intraday chart's normalized last point so the badge
              // matches exactly what the D chart shows.
              const last = mChartData[mChartData.length - 1];
              return last != null ? last.value : mPnl;
            }
            if (modalTimeFilter === 'W') {
              // stock_returns_c.5d_abs is in cents per share
              const abs = modalStockReturns?.['5d_abs'];
              if (abs != null) return (Number(abs) / 100) * mQty;
              const last = mChartData[mChartData.length - 1];
              return last != null ? last.value : mPnl;
            }
            if (modalTimeFilter === 'M') {
              // stock_returns_c.1m_abs is in cents per share
              const abs = modalStockReturns?.['1m_abs'];
              if (abs != null) return (Number(abs) / 100) * mQty;
              const last = mChartData[mChartData.length - 1];
              return last != null ? last.value : mPnl;
            }
            const last = mChartData[mChartData.length - 1];
            return last != null ? last.value : mPnl;
          })();
          const mPeriodPct = mShowPnl && mCostBasis > 0 ? (mPeriodPnl / mCostBasis) * 100 : 0;

          const mAxisConfig = computePnlAxisConfig(mChartData);
          return (
            <>
              <motion.div
                key="modal-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[1090]"
                onClick={() => setModalHolding(null)}
              />
              <motion.div
                key="modal-sheet"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                className="fixed bottom-0 left-0 right-0 z-[1100] rounded-t-3xl bg-white/95 backdrop-blur-2xl shadow-2xl"
                style={{ maxHeight: '92vh', overflowY: 'auto', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))', fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                onClick={e => e.stopPropagation()}
              >
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-10 h-1 rounded-full bg-slate-200" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-2 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-white border border-slate-200 shadow-sm overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {mHolding.logo && !failedLogos[mHolding.ticker] ? (
                        <img
                          src={mHolding.logo}
                          alt={mHolding.ticker}
                          className="h-full w-full object-contain"
                          onError={() => setFailedLogos(prev => ({ ...prev, [mHolding.ticker]: true }))}
                        />
                      ) : (
                        <span className="text-xs font-bold text-slate-500">{(mHolding.ticker || '').slice(0, 2)}</span>
                      )}
                    </div>
                    <div>
                      <p className="text-base font-semibold text-slate-900 leading-tight">{mHolding.name}</p>
                      <p className="text-xs font-medium text-slate-400">{mHolding.ticker}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setModalHolding(null)}
                    className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {/* Value + P&L */}
                <div className="px-6 mb-3">
                  {mIsPending ? (
                    <>
                      <p className="text-3xl font-bold text-amber-500">Pending</p>
                      <p className="text-sm mt-0.5 text-slate-400">Awaiting broker fill — value not yet settled</p>
                    </>
                  ) : mShowPnl ? (
                    <>
                      <p className="text-3xl font-bold text-slate-900">{formatCurrency(mMarketValue)}</p>
                      <p className={`text-sm mt-0.5 ${mPeriodPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {mPeriodPnl >= 0 ? '+' : '-'}{formatCurrency(Math.abs(mPeriodPnl))} ({mPeriodPct >= 0 ? '+' : ''}{mPeriodPct.toFixed(2)}%) {mPeriodLabel}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-3xl font-bold text-slate-900">{formatCurrency(mMarketValue)}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {(mShowPnl || (modalTimeFilter !== "ALL" && mQty > 0 && mPnl != null)) ? (
                          <>
                            <span className={`text-sm font-semibold ${mPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {mPnl >= 0 ? '+' : '-'}R{Math.abs(mPnl).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${mPnl >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
                              {mPnl >= 0 ? '+' : ''}{mPnlPct.toFixed(1)}%
                            </span>
                          </>
                        ) : (
                          <span className={`text-sm font-semibold ${mLiveChange >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {mLiveChange >= 0 ? '+' : ''}{mLiveChange.toFixed(2)}%
                          </span>
                        )}
                        {modalTimeFilter === "D" && <span className="text-[10px] text-slate-400 font-medium">Today</span>}
                        {modalTimeFilter === "W" && <span className="text-[10px] text-slate-400 font-medium">1 week</span>}
                        {modalTimeFilter === "M" && <span className="text-[10px] text-slate-400 font-medium">1 month</span>}
                        {modalTimeFilter === "ALL" && <span className="text-[10px] text-slate-400 font-medium">All time</span>}
                      </div>
                    </>
                  )}
                </div>

                {/* Time filter */}
                <div className="flex gap-1 px-5 mb-2">
                  {[{ id: "D", label: "D" }, { id: "W", label: "W" }, { id: "M", label: "M" }, { id: "ALL", label: "All" }].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setModalTimeFilter(f.id)}
                      className={`px-3 h-9 rounded-full text-sm font-bold transition-all ${modalTimeFilter === f.id
                          ? "bg-slate-700/80 text-white shadow-lg backdrop-blur-md border border-white/20"
                          : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/30"
                        }`}
                      style={modalTimeFilter === f.id ? { boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.1), 0 4px 12px rgba(0,0,0,0.15)' } : {}}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Chart */}
                <div style={{ width: '100%', height: 230, paddingBottom: 8, minWidth: 0 }}>
                  {mChartData.length === 0 ? (
                    (modalTimeFilter === "D" ? modalIntradayLoading : modalChartLoading) ? (
                      <div style={{ width: '100%', height: 230 }}>
                        <svg width="100%" height="230" viewBox="0 0 400 230" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                          <defs>
                            <linearGradient id="modalSkeletonFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.6" />
                              <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0.05" />
                            </linearGradient>
                            <linearGradient id="modalShimmer" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="transparent"><animate attributeName="offset" values="-1;0;1" dur="1.6s" repeatCount="indefinite" /></stop>
                              <stop offset="50%" stopColor="rgba(255,255,255,0.55)"><animate attributeName="offset" values="-0.5;0.5;1.5" dur="1.6s" repeatCount="indefinite" /></stop>
                              <stop offset="100%" stopColor="transparent"><animate attributeName="offset" values="0;1;2" dur="1.6s" repeatCount="indefinite" /></stop>
                            </linearGradient>
                            <mask id="modalShimmerMask"><rect width="400" height="230" fill="url(#modalShimmer)" /></mask>
                          </defs>
                          {[45,90,135,180].map((y, i) => <rect key={i} x="0" y={y} width="22" height="8" rx="4" fill="#e2e8f0" />)}
                          <path d="M32,170 C55,165 70,138 90,124 C110,110 125,132 145,114 C165,96 180,72 205,67 C230,62 245,84 265,75 C285,66 300,86 320,78 C340,70 360,88 380,80 L380,200 L32,200 Z" fill="url(#modalSkeletonFill)" />
                          <path d="M32,170 C55,165 70,138 90,124 C110,110 125,132 145,114 C165,96 180,72 205,67 C230,62 245,84 265,75 C285,66 300,86 320,78 C340,70 360,88 380,80" fill="none" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M32,170 C55,165 70,138 90,124 C110,110 125,132 145,114 C165,96 180,72 205,67 C230,62 245,84 265,75 C285,66 300,86 320,78 C340,70 360,88 380,80 L380,200 L32,200 Z" fill="url(#modalShimmer)" mask="url(#modalShimmerMask)" />
                          <line x1="32" y1="200" x2="400" y2="200" stroke="#e2e8f0" strokeWidth="1" />
                          {[55,128,200,272,345].map((x, i) => <rect key={i} x={x - 16} y="212" width="32" height="8" rx="4" fill="#e2e8f0" />)}
                        </svg>
                      </div>
                    ) : (
                      <div style={{ width: '100%', height: 230, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="text-slate-400 text-sm">No data available</div>
                      </div>
                    )
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={mChartData} margin={{ top: 10, right: 55, left: 5, bottom: 30 }}>
                        <defs>
                          <linearGradient id="modalStockGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
                            <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.2" />
                            <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.02" />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="day"
                          axisLine={false}
                          tickLine={false}
                          tickMargin={8}
                          ticks={modalTimeFilter === 'ytd' ? computeYtdMonthTicks(mChartData) : undefined}
                          interval={modalTimeFilter === 'D'
                            ? Math.max(0, Math.ceil(mChartData.length / 4) - 1)
                            : modalTimeFilter === 'ytd' ? 0
                            : mChartData.length <= 8 ? 0 : Math.max(0, Math.ceil(mChartData.length / 4) - 1)}
                          tick={({ x, y, payload }) => {
                            if (!payload.value) return null;
                            const val = String(payload.value);
                            if (modalTimeFilter === 'D') {
                              return <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={10} fontWeight={500}>{val}</text>;
                            }
                            if (val.includes('|')) {
                              const [dayPart, timePart] = val.split('|');
                              return (
                                <text x={x} y={y} textAnchor="middle" fill="#64748b" fontSize={10} fontWeight={500}>
                                  <tspan x={x} dy={10}>{dayPart}</tspan>
                                  <tspan x={x} dy={13}>{timePart}</tspan>
                                </text>
                              );
                            }
                            const label = modalTimeFilter === 'ytd' ? val.split(' ')[1] : val;
                            return <text x={x} y={y} dy={12} textAnchor="middle" fill="#64748b" fontSize={11} fontWeight={500}>{label}</text>;
                          }}
                        />
                        <YAxis
                          domain={mAxisConfig.domain}
                          ticks={mAxisConfig.ticks}
                          tickFormatter={formatPnlAxis}
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
                          axisLine={false}
                          tickLine={false}
                          width={55}
                        />
                        <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth={1} />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length) {
                              let fullDate = payload[0]?.payload?.fullDate || label;
                              if (typeof fullDate === 'string' && fullDate.includes('|')) fullDate = fullDate.replace('|', ' ');
                              const val = payload[0].value;
                              const isPos = val >= 0;
                              return (
                                <div className="bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg px-3 py-1.5 shadow-md">
                                  <div className="text-xs text-slate-500 mb-0.5">{fullDate}</div>
                                  <div className="text-sm font-bold text-violet-700">
                                    {mShowPnl ? (isPos ? '+' : '-') + 'R' + Math.abs(val).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'R' + val.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                          cursor={false}
                          wrapperStyle={{ outline: 'none' }}
                        />
                        <Area type="monotone" dataKey="value" stroke="none" fill="url(#modalStockGradient)" fillOpacity={1} />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#7c3aed"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          dot={false}
                          activeDot={{ r: 6, fill: '#7c3aed', stroke: '#c4b5fd', strokeWidth: 2 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Holdings detail row */}
                {mShowPnl && (
                  <div className="mx-5 mb-6 rounded-2xl bg-slate-50 px-4 py-3 flex items-center justify-between">
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Shares</p>
                      <p className="text-sm font-semibold text-slate-800">{Math.round(mQty)}</p>
                    </div>
                    <div className="w-px h-8 bg-slate-200" />
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Avg Price</p>
                      <p className="text-sm font-semibold text-slate-800">{formatCurrency(mAvgFill)}</p>
                    </div>
                    <div className="w-px h-8 bg-slate-200" />
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Cost Basis</p>
                      <p className="text-sm font-semibold text-slate-800">{formatCurrency(mCostBasis)}</p>
                    </div>
                    <div className="w-px h-8 bg-slate-200" />
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Return</p>
                      <p className={`text-sm font-semibold ${mPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {mPnl >= 0 ? '+' : ''}{formatCurrency(mPnl)}
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            </>
          );
        })()}
      </AnimatePresence>

      {/* First-timer walkthrough. Render is HARD-gated on this tab being the
          active, visible one — the tour portals to <body> at a high z-index, so
          without this it would appear over other tabs / the swipe-back preview. */}
      <SpotlightTour open={showTour && isActive && isDocumentVisible} steps={PF_TOUR_STEPS} onClose={closeTour} />

    </div>
  );
};

export default NewPortfolioPage;
