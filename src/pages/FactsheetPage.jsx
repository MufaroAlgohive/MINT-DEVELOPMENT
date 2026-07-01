import React, { useMemo, useState, useRef, useEffect } from "react";
import { ArrowLeft, X, Info, Heart, Wallet, FileText } from "lucide-react";
import generateFactsheetPdf from "../lib/generateFactsheetPdf";
import { supabase } from "../lib/supabase";
import { checkOnboardingComplete } from "../lib/checkOnboardingComplete";
import { useOnboardingStatus } from "../lib/useOnboardingStatus";
import { useDiscretionType } from "../lib/useDiscretionType";
import { useFees } from "../lib/useFees";
import { formatChangePct, getChangeColor, getStrategyPriceHistory } from "../lib/strategyData.js";
import { buildHoldingsBySymbol, calculateMinInvestmentSync, getAdjustedShares, computeExtendedSummary, enrichSecuritiesWithIntradayPrices } from "../lib/strategyUtils";
import {
  Area,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

const timeframeOptions = [
  { key: "5D", label: "5D", field: "5d_pct" },
  { key: "1M", label: "1M", field: "1m_pct" },
  { key: "6M", label: "6M", field: "6m_pct" },
  { key: "YTD", label: "YTD", field: "ytd_pct" },
];

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const FactsheetPage = ({ onBack, strategy, onOpenInvest, onNavigateToOnboarding, onUpdateMandate }) => {
  const { onboardingComplete, loading: onboardingLoading } = useOnboardingStatus();
  const { isLimited: isLimitedDiscretion } = useDiscretionType();
  const feeRates = useFees();
  const [timeframe, setTimeframe] = useState("YTD");
  const [activeLabel, setActiveLabel] = useState(null);
  const [selectedMetricModal, setSelectedMetricModal] = useState(null);
  const [calendarYear, setCalendarYear] = useState(2025);
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [holdingsSecurities, setHoldingsSecurities] = useState([]);
  const [strategyData, setStrategyData] = useState(strategy);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState(null);
  const [timeframeReturns, setTimeframeReturns] = useState({});
  const marqueeRef = useRef(null);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showDiscretionModal, setShowDiscretionModal] = useState(false);
  const [investChecking, setInvestChecking] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [performanceData, setPerformanceData] = useState({});
  const [calendarReturns, setCalendarReturns] = useState({});

  const strategyId = strategy?.id || strategy?.strategy_id || strategyData?.id || null;
  const strategySlug = strategy?.slug || strategyData?.slug || null;

  const formatPercent = (value) => {
    if (value == null || Number.isNaN(value)) return "N/A";
    return `${(Number(value) * 100).toFixed(2)}%`;
  };

  const formatPercentDirect = (value) => {
    if (value == null || Number.isNaN(value)) return "N/A";
    return `${Number(value).toFixed(2)}%`;
  };

  const formatCurrencyAmount = (amount, currencyCode = "ZAR") => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return null;
    try {
      return new Intl.NumberFormat("en-ZA", {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(numericAmount);
    } catch {
      return `${currencyCode} ${numericAmount.toFixed(2)}`;
    }
  };

  const analyticsTimestamp = analytics?.computed_at || analytics?.as_of_date || null;
  const analyticsUnavailable = !analytics || analytics?.error || analyticsError;
  const analyticsMessage = analytics?.error || analyticsError
    ? "Analytics unavailable. Data is being updated."
    : "Analytics not available yet.";
  const lastUpdatedLabel = analyticsTimestamp
    ? new Date(analyticsTimestamp).toLocaleString()
    : strategyData?.as_of_date
      ? new Date(strategyData.as_of_date).toLocaleString()
      : strategy?.as_of_date
        ? new Date(strategy.as_of_date).toLocaleString()
        : "";

  // Fetch strategy metadata + analytics
  useEffect(() => {
    let isMounted = true;

    const fetchStrategyData = async () => {
      try {
        if (!supabase) {
          if (isMounted) {
            setAnalyticsError("Database not connected");
            setLoading(false);
            setAnalyticsLoading(false);
          }
          return;
        }

        setLoading(true);
        setAnalyticsLoading(true);
        setAnalyticsError(null);

        let resolvedStrategy = strategyData || strategy;
        let resolvedId = strategyId;

        if (!resolvedId && strategySlug) {
          const { data, error } = await supabase
            .from("strategies_c")
            .select("id, slug, name, short_name, description, objective, risk_level, sector, tags, base_currency, icon_url, image_url, holdings, management_fee_bps, fee_type, benchmark_name, benchmark_symbol, min_investment, is_kid_strategy, created_at")
            .eq("slug", strategySlug)
            .maybeSingle();

          if (error) throw error;
          if (data) {
            resolvedStrategy = data;
            resolvedId = data.id;
            if (isMounted) {
              setStrategyData(data);
            }
          }
        }

        if (resolvedId) {
          const { data, error } = await supabase
            .from("strategies_c")
            .select("id, slug, name, short_name, description, objective, risk_level, sector, tags, base_currency, icon_url, image_url, holdings, management_fee_bps, fee_type, benchmark_name, benchmark_symbol, min_investment, is_kid_strategy, created_at")
            .eq("id", resolvedId)
            .maybeSingle();

          if (error) throw error;
          if (data && isMounted) {
            resolvedStrategy = data;
            setStrategyData(data);
          }

          // Fetch latest returns data from strategies_returns_c
          const { data: returnsData, error: returnsError } = await supabase
            .from("strategies_returns_c")
            .select("strategy_id, as_of_date, \"5d_pct\", \"1m_pct\", \"6m_pct\", ytd_pct, all_pct")
            .eq("strategy_id", resolvedId)
            .order("as_of_date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (returnsError) {
            if (isMounted) {
              setAnalyticsError(returnsError.message);
            }
          } else if (returnsData && isMounted) {
            setTimeframeReturns({
              "5D":  returnsData["5d_pct"] != null ? returnsData["5d_pct"] / 100 : null,
              "1M":  returnsData["1m_pct"] != null ? returnsData["1m_pct"] / 100 : null,
              "6M":  returnsData["6m_pct"] != null ? returnsData["6m_pct"] / 100 : null,
              "YTD": returnsData.ytd_pct   != null ? returnsData.ytd_pct   / 100 : null,
              "ALL": returnsData.all_pct   != null ? returnsData.all_pct   / 100 : null,
            });
            // Preserve any curves already populated by fetchCumulativeData (race condition fix)
            setAnalytics(prev => ({
              as_of_date: returnsData.as_of_date,
              curves: prev?.curves ?? {}
            }));
          }
        } else if (isMounted) {
          setAnalytics(null);
          setAnalyticsError("Strategy not found");
        }
      } catch (error) {
        console.error("Error fetching strategy data:", error);
        if (isMounted) {
          setAnalyticsError(error.message || "Unable to load analytics");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          setAnalyticsLoading(false);
        }
      }
    };

    fetchStrategyData();
    return () => {
      isMounted = false;
    };
  }, [strategyId, strategySlug]);

  const currentStrategy = strategyData || strategy || {
    name: "",
    tags: [],
    description: "",
    holdings: [],
  };

  const availableTimeframes = useMemo(() => {
    const curves = analytics?.curves || {};
    return timeframeOptions
      .map((option) => option.key)
      .filter((key) => Array.isArray(curves[key]) && curves[key].length > 0);
  }, [analytics]);

  useEffect(() => {
    if (availableTimeframes.length === 0) {
      return;
    }
    setTimeframe((prev) => {
      if (availableTimeframes.includes(prev)) return prev;
      if (availableTimeframes.includes("1M")) return "1M";
      return availableTimeframes[0];
    });
  }, [availableTimeframes]);

  // Fetch securities for strategy holdings with logos
  useEffect(() => {
    let isMounted = true;

    const fetchHoldingsSecurities = async () => {
      if (!supabase || !currentStrategy.holdings || currentStrategy.holdings.length === 0) return;

      try {
        const tickers = currentStrategy.holdings.map((h) => h.ticker || h.symbol || h);

        const { data, error } = await supabase
          .from("securities_c")
          .select("id, symbol, name, logo_url, last_price, change_percent, sector, isin")
          .in("symbol", tickers);

        if (error) throw error;
        if (isMounted && data) {
          const enriched = await enrichSecuritiesWithIntradayPrices(data);
          setHoldingsSecurities(enriched);
        }
      } catch (error) {
        console.error("Error fetching holdings securities:", error);
      }
    };

    fetchHoldingsSecurities();

    return () => {
      isMounted = false;
    };
  }, [currentStrategy]);

  // Fetch cumulative chart data for selected timeframe using holdings price history
  useEffect(() => {
    let isMounted = true;

    const fetchCumulativeData = async () => {
      if (!strategyId) return;

      // Map factsheet timeframe keys to getStrategyPriceHistory timeframe strings
      const tfMap = { "5D": "1W", "1M": "1M", "6M": "6M", "YTD": "YTD" };
      const priceTf = tfMap[timeframe];
      if (!priceTf) return;

      try {
        const navPoints = await getStrategyPriceHistory(strategyId, priceTf);

        if (!navPoints || navPoints.length === 0) {
          if (isMounted) {
            setAnalytics(prev => ({
              ...prev,
              curves: { ...prev?.curves, [timeframe]: [] }
            }));
          }
          return;
        }

        // For 5D: keep only the last 5 unique trading days
        let filtered = navPoints;
        if (timeframe === "5D") {
          const uniqueDates = [...new Set(navPoints.map(p => p.ts.split("T")[0]))];
          const last5 = uniqueDates.slice(-5);
          filtered = navPoints.filter(p => last5.includes(p.ts.split("T")[0]));
        }

        // Convert NAV series → cumulative % return from first point
        const baseNav = filtered[0]?.nav;
        if (!baseNav) {
          if (isMounted) setAnalytics(prev => ({ ...prev, curves: { ...prev?.curves, [timeframe]: [] } }));
          return;
        }

        const cumulativeData = filtered.map(p => ({
          d: p.ts.split("T")[0],
          v: Number(((p.nav - baseNav) / baseNav * 100).toFixed(2)),
        }));

        if (isMounted) {
          setAnalytics(prev => ({
            ...prev,
            curves: { ...prev?.curves, [timeframe]: cumulativeData }
          }));
        }
      } catch (error) {
        console.error("Error fetching cumulative data:", error);
      }
    };

    fetchCumulativeData();

    return () => {
      isMounted = false;
    };
  }, [strategyId, timeframe]);

  // Fetch performance summary and calendar returns
  useEffect(() => {
    let isMounted = true;

    const fetchPerformanceData = async () => {
      if (!supabase || !strategyId) return;

      try {
        const yearStart = `${calendarYear}-01-01`;
        const yearEnd = `${calendarYear}-12-31`;
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        const [{ data: dailyReturns, error: dailyError }, { data: q3Data }] = await Promise.all([
          supabase
            .from("strategies_returns_c")
            .select("strategy_id, as_of_date, \"1d_pct\", ytd_pct, \"1m_pct\"")
            .eq("strategy_id", strategyId)
            .gte("as_of_date", yearStart)
            .lte("as_of_date", yearEnd)
            .order("as_of_date", { ascending: true }),
          supabase
            .from("strategies_returns_c")
            .select("\"1d_pct\"")
            .eq("strategy_id", strategyId)
            .gte("as_of_date", ninetyDaysAgo)
            .order("as_of_date", { ascending: true }),
        ]);

        if (dailyError) throw dailyError;

        // Compounded 90-day return as a decimal (e.g. 0.0523 for 5.23%)
        const threeMonthReturn = q3Data?.length
          ? q3Data.reduce((prod, d) => prod * (1 + (d["1d_pct"] || 0) / 100), 1) - 1
          : null;

        if (dailyReturns && dailyReturns.length > 0 && isMounted) {
          // Calculate performance summary
          const dailyPcts = dailyReturns.map(d => d["1d_pct"] || 0);
          const bestDay = Math.max(...dailyPcts);
          const worstDay = Math.min(...dailyPcts);
          const avgDaily = dailyPcts.length > 0 ? dailyPcts.reduce((a, b) => a + b, 0) / dailyPcts.length : 0;
          const ytdReturn = dailyReturns[dailyReturns.length - 1]?.ytd_pct || 0;

          setPerformanceData({
            bestDay,
            worstDay,
            avgDaily,
            ytdReturn,
            threeMonthReturn,
          });

          // Build calendar returns (monthly) - sum all daily returns for each month
          const monthlyReturns = {};
          const monthlyDailyReturns = {};

          dailyReturns.forEach((day) => {
            const date = day.as_of_date;
            const yearMonth = date.slice(0, 7); // YYYY-MM
            const month = parseInt(yearMonth.split("-")[1]);

            if (!monthlyDailyReturns[month]) {
              monthlyDailyReturns[month] = [];
            }
            monthlyDailyReturns[month].push(day["1d_pct"] || 0);
          });

          // Sum the daily returns for each month
          Object.entries(monthlyDailyReturns).forEach(([month, dailyPcts]) => {
            const monthlyReturn = dailyPcts.reduce((sum, pct) => sum + pct, 0);
            monthlyReturns[month] = monthlyReturn;
          });

          setCalendarReturns(monthlyReturns);
        }
      } catch (error) {
        console.error("Error fetching performance data:", error);
      }
    };

    fetchPerformanceData();

    return () => {
      isMounted = false;
    };
  }, [strategyId, calendarYear]);

  // Generate chart data from analytics curves (index levels)
  const { data, yDomain, baseIndexValue } = useMemo(() => {
    const curves = analytics?.curves || {};
    const series = Array.isArray(curves[timeframe]) ? curves[timeframe] : [];
    const labelIndices = series.length ? [series.length - 1] : [];
    const values = series.map((point) => point?.v ?? 0);
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;
    const padding = (maxValue - minValue) * 0.2;
    const domain = values.length
      ? [minValue - padding, maxValue + padding]
      : [0, 0];

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
      data: mapped,
      yDomain: domain,
      baseIndexValue: values.length ? values[0] : null,
    };
  }, [analytics, timeframe]);

  const lastIndex = data.length - 1;
  const lastValue = data[lastIndex]?.returnPct ?? null;
  const firstValue = baseIndexValue;
  const periodReturn = timeframeReturns[timeframe];
  const formattedReturn = periodReturn != null
    ? `${periodReturn >= 0 ? "+" : ""}${(periodReturn * 100).toFixed(2)}%`
    : "—";
  const returnTextClass = periodReturn > 0
    ? "text-emerald-600"
    : periodReturn < 0
      ? "text-rose-600"
      : "text-slate-500";
  const chartLineColor = periodReturn > 0
    ? "#16a34a"
    : periodReturn < 0
      ? "#dc2626"
      : "#94a3b8";
    
  // Get current metrics

  // Calculate cumulative returns for calendar
  const calendarData = useMemo(() => {
    const result = {};
    result[calendarYear] = {};

    Object.entries(calendarReturns).forEach(([month, returnValue]) => {
      const monthKey = String(month).padStart(2, "0");
      result[calendarYear][monthKey] = returnValue;
    });

    return result;
  }, [calendarReturns, calendarYear]);

  const availableCalendarYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let year = 2025; year <= currentYear; year++) {
      years.push(String(year));
    }
    return years;
  }, []);

  const minimumInvestmentAmount = useMemo(() => {
    const holdingsMap = buildHoldingsBySymbol(holdingsSecurities);
    const calculated = Number(calculateMinInvestmentSync(currentStrategy, holdingsMap));
    if (Number.isFinite(calculated) && calculated > 0) {
      return calculated;
    }

    const strategyMin = Number(currentStrategy?.min_investment);
    return Number.isFinite(strategyMin) && strategyMin > 0 ? strategyMin : null;
  }, [currentStrategy, holdingsSecurities]);

  const cashHoldingAmount = useMemo(() => {
    if (!Number.isFinite(minimumInvestmentAmount) || minimumInvestmentAmount <= 0) {
      return null;
    }
    return minimumInvestmentAmount * 0.08;
  }, [minimumInvestmentAmount]);

  const holdingsWithMetrics = useMemo(() => {
    const holdings = Array.isArray(currentStrategy.holdings) ? currentStrategy.holdings : [];
    const totalWeight = holdings.reduce(
      (sum, holding) => sum + (Number(holding.weight) || 0),
      0,
    );
    const holdingsList = holdings.map((holding) => {
      const symbol = holding.ticker || holding.symbol || holding;
      const security = holdingsSecurities.find((s) => s.symbol === symbol);
      const rawWeight = Number(holding.weight) || 0;
      const weightNorm = totalWeight > 0 ? rawWeight / totalWeight : null;
      const securityDailyChange = security?.change_percent != null
        ? Number(security.change_percent)
        : null;
      return {
        symbol,
        name: holding.name || security?.name || symbol,
        weight: rawWeight,
        weightNorm,
        logoUrl: security?.logo_url,
        dailyChange: securityDailyChange,
        // ── FIX: forward sector from securities table so PDF pie chart works ──
        sector: security?.sector || null,
      };
    });

    const nonCashHoldings = holdingsList.filter(
      (holding) => String(holding.symbol || "").toUpperCase() !== "CASH"
    );

    const formattedCashAmount = formatCurrencyAmount(cashHoldingAmount, currentStrategy?.base_currency || "ZAR");
    nonCashHoldings.push({
      symbol: "CASH",
      name: formattedCashAmount ? `Cash (${formattedCashAmount})` : "Cash",
      weight: 8,
      weightNorm: null,
      logoUrl: null,
      dailyChange: null,
      sector: null,
    });

    return nonCashHoldings;
  }, [currentStrategy.holdings, currentStrategy?.base_currency, holdingsSecurities, cashHoldingAmount]);

  const performanceSummary = useMemo(() => {
    return [
      {
        label: "Best Day",
        value: formatPercentDirect(performanceData.bestDay),
        description: "The highest daily return this strategy has achieved.",
      },
      {
        label: "Worst Day",
        value: formatPercentDirect(performanceData.worstDay),
        description: "The lowest daily return (most negative) this strategy has experienced.",
      },
      {
        label: "Avg Daily Return",
        value: formatPercentDirect(performanceData.avgDaily),
        description: "The average daily percentage change across all trading days.",
      },
      {
        label: "YTD Return",
        value: formatPercentDirect(performanceData.ytdReturn),
        description: "Year-to-date return for the strategy.",
      },
    ];
  }, [performanceData]);

  // Auto-scroll removed to allow manual scrolling.

  const getReturnColor = (value) => {
    if (value == null) return "bg-slate-50 border border-slate-100 text-slate-400";
    if (value > 0) return "bg-emerald-50 border border-emerald-200 text-emerald-700";
    if (value < 0) return "bg-rose-50 border border-rose-200 text-rose-700";
    return "bg-slate-50 border border-slate-100 text-slate-400";
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex w-full max-w-sm flex-col px-3 pb-32 pt-12 md:max-w-md md:px-6">
        <header className="flex items-center justify-center gap-3 mb-6 relative">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm flex-shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">{currentStrategy.name}</h1>
          <div className="absolute right-0 flex items-center gap-2">
            <button
              type="button"
              disabled={pdfGenerating}
              onClick={async () => {
                setPdfGenerating(true);
                try {
                  let userPosition = null;
                  const { data: { session } } = await supabase.auth.getSession();
                  if (session?.user) {
                    const strategyName = currentStrategy?.name;
                    const { data: txns } = await supabase
                      .from("transactions")
                      .select("amount")
                      .eq("user_id", session.user.id)
                      .eq("status", "posted")
                      .like("name", `Strategy Investment: ${strategyName}`);
                    const totalInvested = (txns || []).reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
                    if (totalInvested > 0 && analytics?.latest_value != null) {
                      const navRatio = Number(analytics.latest_value) / 100;
                      const currentValue = totalInvested * navRatio;
                      const returnPct = (currentValue - totalInvested) / totalInvested;
                      userPosition = { invested: totalInvested / 100, currentValue: currentValue / 100, returnPct };
                    }
                  }

                  // Enrich analytics with computed stats.
                  // Uses DB values when present (after compute job runs),
                  // falls back to client-side calculation from curve data.
                  const extendedStats = computeExtendedSummary(analytics);
                  const enrichedAnalytics = {
                    ...analytics,
                    summary: {
                      ...analytics?.summary,
                      volatility:           analytics?.summary?.volatility           ?? extendedStats.volatility,
                      sharpe_ratio:         analytics?.summary?.sharpe_ratio         ?? extendedStats.sharpe_ratio,
                      max_drawdown:         analytics?.summary?.max_drawdown         ?? extendedStats.max_drawdown,
                      pct_positive_months:  analytics?.summary?.pct_positive_months  ?? extendedStats.pct_positive_months,
                    },
                  };

                  generateFactsheetPdf({
                    strategy: currentStrategy,
                    analytics: enrichedAnalytics,
                    holdingsWithMetrics,
                    holdingsSecurities,
                    userPosition,
                    calculatedMinInvestment: minimumInvestmentAmount,
                    performanceData,
                    timeframeReturns,
                    feeRates,
                  });
                } catch (e) {
                  console.error("PDF generation error:", e?.message || e?.toString?.() || e, e?.stack);
                } finally {
                  setPdfGenerating(false);
                }
              }}
              aria-label="View factsheet PDF"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm flex-shrink-0 disabled:opacity-50"
            >
              {pdfGenerating ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-violet-600" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsInWatchlist(!isInWatchlist)}
              aria-label="Add to watchlist"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm flex-shrink-0"
            >
              <Heart className={`h-5 w-5 ${isInWatchlist ? "fill-current text-rose-600" : ""}`} />
            </button>
          </div>
        </header>

        <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_16px_32px_rgba(15,23,42,0.08)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900">{currentStrategy.name}</h2>
              </div>
              <p className="text-xs font-semibold text-slate-400">
                {currentStrategy.risk_level || 'Balanced'} • Automated
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-1">
            <div className="flex items-baseline gap-3">
              <p className={`text-3xl font-semibold ${returnTextClass}`}>{formattedReturn}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{timeframe} return</span>
              <span>•</span>
              <span className={returnTextClass}>{formattedReturn}</span>
            </div>
            <p className="text-xs text-slate-500">
              {lastUpdatedLabel ? `Last updated ${lastUpdatedLabel}` : ""}
            </p>
          </div>

          <div className="mt-4 h-48 w-full">
            {analyticsError ? (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                <div className="text-center">
                  <p className="text-sm text-slate-500">{analyticsMessage}</p>
                  {analyticsTimestamp ? (
                    <p className="mt-1 text-xs text-slate-400">
                      As of {new Date(analyticsTimestamp).toLocaleString()}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={192}>
                <ComposedChart
                  data={data}
                  margin={{ top: 12, right: 16, left: 8, bottom: 28 }}
                  onMouseMove={(state) => {
                    if (state?.activeLabel) {
                      setActiveLabel(state.activeLabel);
                    }
                  }}
                  onMouseLeave={() => setActiveLabel(null)}
                >
                  <defs>
                    <linearGradient id="factsheetGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartLineColor} stopOpacity={0.25} />
                      <stop offset="70%" stopColor={chartLineColor} stopOpacity={0.1} />
                      <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <ReferenceLine y={100} stroke="#e2e8f0" strokeDasharray="3 3" />
                  {activeLabel ? (
                    <>
                      <ReferenceLine
                        x={activeLabel}
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
                          if (!baseIndexValue) {
                            return [`${Number(value).toFixed(2)}`, "Index"];
                          }
                          const delta = ((Number(value) - baseIndexValue) / baseIndexValue) * 100;
                          return [`${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`, "Change"];
                        }}
                        cursor={{ strokeDasharray: "3 3" }}
                      />
                    </>
                  ) : null}
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fontSize: 12, fill: "#64748b" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={false}
                    height={24}
                  />
                  <YAxis hide domain={yDomain} />
                  <Area
                    type="monotone"
                    dataKey="returnPct"
                    stroke="transparent"
                    fill="url(#factsheetGradient)"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="returnPct"
                    stroke={chartLineColor}
                    strokeWidth={2}
                    dot={false}
                    activeDot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {timeframeOptions.map((option) => {
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTimeframe(option.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    timeframe === option.key
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-3 text-[11px] font-semibold text-slate-400">
            {(currentStrategy.tags || []).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
        </section>

        {/* Marquee - Daily Change */}
        <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Daily Change</h2>
            {analyticsTimestamp ? (
              <p className="text-xs text-slate-500">Updated {new Date(analyticsTimestamp).toLocaleDateString()}</p>
            ) : null}
          </div>
          <div className="relative mt-4">
            <div
              ref={marqueeRef}
              className="flex gap-3 overflow-x-auto scroll-smooth pb-2 snap-x snap-mandatory"
              style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}
            >
              {holdingsWithMetrics.length > 0 ? (
                holdingsWithMetrics.map((holding) => (
                  <div
                    key={holding.symbol}
                    className="flex-shrink-0 w-48 rounded-2xl border border-slate-100 bg-slate-50 p-4 snap-center"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                        {holding.logoUrl ? (
                          <img
                            src={holding.logoUrl}
                            alt={holding.symbol}
                            className="h-full w-full object-cover"
                          />
                        ) : String(holding.symbol || "").toUpperCase() === "CASH" ? (
                          <Wallet className="h-4 w-4 text-slate-500" />
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-500">
                            {holding.symbol?.slice(0, 2)}
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-900">{holding.symbol}</p>
                        <p className="text-[10px] text-slate-500">{holding.name}</p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1">
                      {holding.dailyChange != null ? (
                        <p className={`text-sm font-semibold ${holding.dailyChange > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {holding.dailyChange > 0 ? "+" : ""}{Number(holding.dailyChange).toFixed(2)}%
                        </p>
                      ) : (
                        <p className="text-sm font-semibold text-slate-400">Data unavailable</p>
                      )}
                      <p className="text-xs text-slate-600">{Number(holding.weight || 0).toFixed(2)}% weight</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex h-32 w-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                  Data unavailable
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Performance Summary */}
        <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Performance Summary</h2>
            {analyticsTimestamp ? (
              <p className="text-xs text-slate-500">As of {new Date(analyticsTimestamp).toLocaleDateString()}</p>
            ) : null}
          </div>
          {analyticsUnavailable ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
              {analyticsMessage}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {performanceSummary.map((metric) => (
                <button
                  key={metric.label}
                  type="button"
                  onClick={() => setSelectedMetricModal(metric)}
                  className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-left"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500">{metric.label}</p>
                    <Info className="h-3 w-3 text-slate-400" />
                  </div>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{metric.value}</p>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Period Returns */}
        {(currentStrategy.r_1w != null || currentStrategy.r_1m != null || currentStrategy.r_3m != null || 
          currentStrategy.r_6m != null || currentStrategy.r_ytd != null || currentStrategy.r_1y != null) && (
          <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Performance Returns</h2>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {currentStrategy.r_1w != null && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <p className="text-xs font-semibold text-slate-600">1W</p>
                  <p className={`mt-1 text-sm font-semibold ${getChangeColor(currentStrategy.r_1w)}`}>
                    {formatChangePct(currentStrategy.r_1w)}
                  </p>
                </div>
              )}
              {currentStrategy.r_1m != null && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <p className="text-xs font-semibold text-slate-600">1M</p>
                  <p className={`mt-1 text-sm font-semibold ${getChangeColor(currentStrategy.r_1m)}`}>
                    {formatChangePct(currentStrategy.r_1m)}
                  </p>
                </div>
              )}
              {currentStrategy.r_3m != null && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <p className="text-xs font-semibold text-slate-600">3M</p>
                  <p className={`mt-1 text-sm font-semibold ${getChangeColor(currentStrategy.r_3m)}`}>
                    {formatChangePct(currentStrategy.r_3m)}
                  </p>
                </div>
              )}
              {currentStrategy.r_6m != null && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <p className="text-xs font-semibold text-slate-600">6M</p>
                  <p className={`mt-1 text-sm font-semibold ${getChangeColor(currentStrategy.r_6m)}`}>
                    {formatChangePct(currentStrategy.r_6m)}
                  </p>
                </div>
              )}
              {currentStrategy.r_ytd != null && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <p className="text-xs font-semibold text-slate-600">YTD</p>
                  <p className={`mt-1 text-sm font-semibold ${getChangeColor(currentStrategy.r_ytd)}`}>
                    {formatChangePct(currentStrategy.r_ytd)}
                  </p>
                </div>
              )}
              {currentStrategy.r_1y != null && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-center">
                  <p className="text-xs font-semibold text-slate-600">1Y</p>
                  <p className={`mt-1 text-sm font-semibold ${getChangeColor(currentStrategy.r_1y)}`}>
                    {formatChangePct(currentStrategy.r_1y)}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Strategy Description */}
        <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Strategy Description</h2>
          <p className="mt-3 text-sm text-slate-600">
            {currentStrategy.description}
          </p>
        </section>

        {/* Holdings */}
        <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Portfolio Holdings</h2>
          <p className="mt-1 text-xs text-slate-500">Top 10 by weight</p>
          <div className="mt-4 space-y-3">
            {holdingsWithMetrics.length > 0 ? (
              holdingsWithMetrics.map((holding, index) => {
                const displayWeight = holding.weightNorm != null
                  ? holding.weightNorm * 100
                  : holding.weight;
                return (
                  <div key={holding.symbol || index} className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                      {holding.logoUrl ? (
                        <img
                          src={holding.logoUrl}
                          alt={holding.name || holding.symbol}
                          className="h-full w-full object-cover"
                        />
                      ) : String(holding.symbol || "").toUpperCase() === "CASH" ? (
                        <Wallet className="h-4 w-4 text-slate-500" />
                      ) : (
                        <span className="text-xs font-semibold text-slate-400">{holding.symbol ? holding.symbol.slice(0, 2) : "—"}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900">{holding.symbol || "—"}</p>
                      <p className="text-[11px] text-slate-500 truncate">{holding.name || holding.symbol || "—"}</p>
                    </div>
                    <p className="text-xs font-semibold text-slate-900">{Number(displayWeight || 0).toFixed(2)}%</p>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
                Data unavailable
              </div>
            )}
          </div>
        </section>

        {/* Calendar Returns */}
        <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Calendar Returns</h2>
            {availableCalendarYears.length > 0 ? (
              <select
                value={calendarYear}
                onChange={(e) => setCalendarYear(Number(e.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
              >
                {availableCalendarYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {analyticsUnavailable || !availableCalendarYears.length ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
              {analyticsMessage}
            </div>
          ) : (
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-500">{calendarYear}</p>
              <div className="grid grid-cols-3 gap-2">
                {monthNames.map((label, index) => {
                  const monthKey = String(index + 1).padStart(2, "0");
                  const value = calendarData[String(calendarYear)]?.[monthKey];
                  return (
                    <div
                      key={`${calendarYear}-${label}`}
                      className={`rounded-xl px-2 py-3 text-center ${getReturnColor(value)}`}
                    >
                      <p className="text-[11px] font-medium opacity-60">{label}</p>
                      <p className="mt-1 text-sm font-bold">
                        {value == null ? <span className="text-slate-300 font-normal">—</span> : `${value > 0 ? "+" : ""}${Number(value).toFixed(2)}%`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Fees & Disclaimers */}
        <section className="mt-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Fees & Disclaimers</h2>
          <ul className="mt-3 space-y-2 text-xs text-slate-600">
            <li>• AUM fee: {+(feeRates.AUM_FEE_RATE * 100).toFixed(2)}% per annum</li>
            <li>• Broker fee ({+(feeRates.BROKER_FEE_RATE * 100).toFixed(3)}%)</li>
            <li>• Custody (R{+Number(feeRates.ISIN_FEE_PER_ASSET).toFixed(2)} per asset)</li>
            <li>• Past performance does not guarantee future results</li>
            <li>• All data is for informational purposes only</li>
          </ul>
        </section>
      </div>

      {/* Metric Info Modal */}
      {selectedMetricModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-sm rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{selectedMetricModal.label}</h3>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{selectedMetricModal.value}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMetricModal(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-4 text-sm text-slate-600">{selectedMetricModal.description}</p>
            <button
              type="button"
              onClick={() => setSelectedMetricModal(null)}
              className="mt-6 w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-2 text-sm font-semibold text-white"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {showOnboardingModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowOnboardingModal(false)}>
          <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-full bg-amber-100 text-amber-600 mb-4">
              <Info className="h-7 w-7" />
            </div>
            <h3 className="text-center text-lg font-semibold text-slate-900 mb-2">Complete Your Onboarding</h3>
            <p className="text-center text-sm text-slate-600 mb-6">
              You need to complete your identity verification and onboarding before you can start investing. This helps us keep your account secure.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowOnboardingModal(false);
                if (onNavigateToOnboarding) onNavigateToOnboarding();
              }}
              className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-3 text-sm font-semibold text-white shadow-lg"
            >
              Complete Onboarding
            </button>
            <button
              type="button"
              onClick={() => setShowOnboardingModal(false)}
              className="w-full mt-2 rounded-2xl py-3 text-sm font-semibold text-slate-500"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {showDiscretionModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowDiscretionModal(false)}>
          <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-full bg-violet-100 text-violet-600 mb-4">
              <Info className="h-7 w-7" />
            </div>
            <h3 className="text-center text-lg font-semibold text-slate-900 mb-2">Update your discretionary</h3>
            <p className="text-center text-sm text-slate-600 mb-6">
              You selected <span className="font-semibold text-slate-900">limited discretion</span>, which doesn&rsquo;t allow investing in our strategies. Please{" "}
              <button
                type="button"
                onClick={() => { setShowDiscretionModal(false); if (onUpdateMandate) onUpdateMandate(); else if (onNavigateToOnboarding) onNavigateToOnboarding(); }}
                className="font-semibold text-violet-600 underline"
              >
                update your discretionary
              </button>{" "}
              to invest in strategies.
            </p>
            <button
              type="button"
              onClick={() => { setShowDiscretionModal(false); if (onNavigateToOnboarding) onNavigateToOnboarding(); }}
              className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-3 text-sm font-semibold text-white shadow-lg"
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
        </div>
      )}

      {showUpgradeModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowUpgradeModal(false)}>
          <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 opacity-20 animate-pulse" />
              <Info className="h-8 w-8 text-violet-600 relative z-10" />
            </div>
            <h3 className="text-center text-lg font-bold text-slate-900 mb-1">Add Another Strategy</h3>
            <p className="text-center text-sm text-slate-600 mb-4">
              You already hold an active strategy. You're about to invest in an additional strategy: <span className="font-semibold text-slate-900">{currentStrategy.name}</span>.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowUpgradeModal(false);
                const hMap = buildHoldingsBySymbol(holdingsSecurities);
                const calcMin = calculateMinInvestmentSync(currentStrategy, hMap);
                const holdingsWithLogos = (currentStrategy.holdings || []).map(h => {
                  const sym = h.ticker || h.symbol || h;
                  const sec = holdingsSecurities.find(s => s.symbol === sym);
                  return { ...h, logo_url: sec?.logo_url || null, shares: getAdjustedShares(h, hMap) };
                });
                onOpenInvest?.({ ...currentStrategy, calculatedMinInvestment: calcMin, holdingsWithLogos, isAdditionalStrategy: true });
              }}
              className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-3 text-sm font-semibold text-white shadow-lg shadow-violet-200/60 mb-2"
            >
              I Understand, Continue
            </button>
            <button
              type="button"
              onClick={() => setShowUpgradeModal(false)}
              className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 text-xs font-semibold text-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 bg-slate-50 px-4 pb-6 pt-2">
        <button
          type="button"
          disabled={investChecking}
          onClick={async () => {
            // Limited-discretion users cannot trade strategies — prompt to update.
            if (isLimitedDiscretion) { setShowDiscretionModal(true); return; }
            setInvestChecking(true);
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session?.user) { setInvestChecking(false); return; }

              if (onboardingLoading) { setInvestChecking(false); return; }
              // Prefer the cached hook value, but never bounce a user to onboarding
              // on a stale `false` — confirm authoritatively first. (The hook can
              // latch false if it first ran before the session was ready.)
              let isOnboarded = onboardingComplete;
              if (!isOnboarded) {
                isOnboarded = await checkOnboardingComplete();
              }
              if (!isOnboarded) {
                setShowOnboardingModal(true);
                setInvestChecking(false);
                return;
              }

              const currentStrategyName = currentStrategy?.name || null;

              const { data: strategyTxns } = await supabase
                .from("transactions")
                .select("name")
                .eq("user_id", session.user.id)
                .like("name", "Strategy Investment:%");

              const investedStrategies = new Set(
                (strategyTxns || []).map(t => t.name.replace("Strategy Investment: ", "").trim())
              );
              const alreadyInvested = currentStrategyName && investedStrategies.has(currentStrategyName);

              if (!alreadyInvested && investedStrategies.size >= 1) {
                setShowUpgradeModal(true);
                setInvestChecking(false);
                return;
              }

              const hMap = buildHoldingsBySymbol(holdingsSecurities);
              const calcMin = calculateMinInvestmentSync(currentStrategy, hMap);
              const holdingsWithLogos = (currentStrategy.holdings || []).map(h => {
                const sym = h.ticker || h.symbol || h;
                const sec = holdingsSecurities.find(s => s.symbol === sym);
                return { ...h, logo_url: sec?.logo_url || null, shares: getAdjustedShares(h, hMap) };
              });
              onOpenInvest?.({ ...currentStrategy, calculatedMinInvestment: calcMin, holdingsWithLogos });
            } catch (e) {
              console.error("Invest check error:", e);
            } finally {
              setInvestChecking(false);
            }
          }}
          className="w-full rounded-2xl py-3 text-sm font-semibold shadow-lg disabled:opacity-70 bg-gradient-to-r from-[#111111] via-[#3b1b7a] to-[#5b21b6] text-white shadow-violet-200/60"
        >
          {investChecking ? "Checking..." : `Invest in ${currentStrategy.name}`}
        </button>
      </div>
    </div>
  );
};

export default FactsheetPage;
