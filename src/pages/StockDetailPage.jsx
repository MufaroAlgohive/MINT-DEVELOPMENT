import React, { useState, useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Star, Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getSecurityBySymbol, getSecurityPrices } from "../lib/marketData.js";
import { supabase } from "../lib/supabase.js";
import { useProfile } from "../lib/useProfile";
import { useOnboardingStatus } from "../lib/useOnboardingStatus";
import GoalLinkModal from "../components/GoalLinkModal.jsx";
import GiftToggleV2 from "../components/GiftToggleV2.jsx";
import { useFees } from "../lib/useFees";

const MIN_INVESTMENT = 200;

const fmt = (val, cur = "R") => `${cur} ${Number(val).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const StockDetailPage = ({ security: initialSecurity, onBack, onOpenBuy, onNavigateToOnboarding, onProceedToPayment, onGiftDone }) => {
  const { onboardingComplete, loading: onboardingLoading } = useOnboardingStatus();
  const { ISIN_FEE_PER_ASSET, BROKER_FEE_RATE, TRANSACTION_FEE_RATE, CASH_BUFFER_RATE } = useFees();
  const { profile } = useProfile();
  const [selectedPeriod, setSelectedPeriod] = useState("YTD");
  const [security, setSecurity] = useState(initialSecurity);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [buyChecking, setBuyChecking] = useState(false);
  const [priceHistory, setPriceHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState([]);
  const [watchlistAnimating, setWatchlistAnimating] = useState(false);
  const [buttonsVisible, setButtonsVisible] = useState(false);
  // Buy sheet + goal modal state
  const [showBuySheet, setShowBuySheet] = useState(false);
  const [buyShares, setBuyShares] = useState(1);
  const [buyFeeExpanded, setBuyFeeExpanded] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState(null);
  const [isGift, setIsGift] = useState(false);

  const handleGiftToggle = (val) => { setIsGift(val); };
  const periods = ["1W", "1M", "3M", "6M", "YTD", "1Y", "ALL"];

  useEffect(() => {
    if (profile?.watchlist && Array.isArray(profile.watchlist)) {
      setWatchlist(profile.watchlist);
    }
  }, [profile]);

  useEffect(() => {
    const handleScroll = () => {
      setButtonsVisible((prev) => {
        if (!prev && window.scrollY > 520) return true;
        if (prev && window.scrollY < 380) return false;
        return prev;
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isWatched = useMemo(() => {
    return watchlist.includes(initialSecurity?.symbol);
  }, [watchlist, initialSecurity?.symbol]);

  const toggleWatchlist = async () => {
    if (!profile?.id || !initialSecurity?.symbol) return;

    const symbol = initialSecurity.symbol;
    const wasWatched = watchlist.includes(symbol);
    const newWatchlist = wasWatched
      ? watchlist.filter((t) => t !== symbol)
      : [...watchlist, symbol];

    setWatchlist(newWatchlist);
    setWatchlistAnimating(true);
    setTimeout(() => setWatchlistAnimating(false), 600);

    const { error } = await supabase
      .from('profiles')
      .update({ watchlist: newWatchlist })
      .eq('id', profile.id);

    if (error) {
      setWatchlist(watchlist);
      console.error("Watchlist sync failed:", error);
    }
  };

  console.log("🔍 Initial security prop:", {
    symbol: initialSecurity?.symbol,
    currentPrice: initialSecurity?.currentPrice,
    changeAbs: initialSecurity?.changeAbs,
    change_abs: initialSecurity?.change_abs,
    changePct: initialSecurity?.changePct
  });

  // Fetch updated security data with metrics
  useEffect(() => {
    const fetchSecurityData = async () => {
      if (!initialSecurity?.symbol) return;
      
      try {
        const updatedSecurity = await getSecurityBySymbol(initialSecurity.symbol);
        if (updatedSecurity) {
          console.log("📊 Updated security data:", {
            currentPrice: updatedSecurity.currentPrice,
            changeAbs: updatedSecurity.changeAbs,
            change_abs: updatedSecurity.change_abs,
            changePct: updatedSecurity.changePct
          });
          setSecurity(updatedSecurity);
        }
      } catch (error) {
        console.error("Error fetching security data:", error);
      }
    };

    fetchSecurityData();
  }, [initialSecurity?.symbol]);

  // Fetch price history when period changes
  useEffect(() => {
    const fetchPriceHistory = async () => {
      if (!security?.id) return;
      
      setLoading(true);
      try {
        const prices = await getSecurityPrices(security.id, selectedPeriod, security.symbol);
        setPriceHistory(prices);
      } catch (error) {
        console.error("Error fetching price history:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchPriceHistory();
  }, [security?.id, selectedPeriod]);

  // Always prefer fetched security data, fallback to initialSecurity for display
  const displaySecurity = security?.id ? security : initialSecurity;
  
  console.log("💰 Display data:", {
    currentPrice: displaySecurity?.currentPrice,
    changeAbs: displaySecurity?.changeAbs,
    change_abs: displaySecurity?.change_abs,
    changePct: displaySecurity?.changePct,
    hasCurrentPrice: displaySecurity?.currentPrice != null,
    hasChangeAbs: displaySecurity?.changeAbs != null,
  });
  
  const currentPrice = displaySecurity?.currentPrice != null 
    ? Number(displaySecurity.currentPrice).toFixed(2)
    : "—";
    // changeAbs is already in Rands from processSecurity()
    const priceChange = displaySecurity?.changeAbs != null
      ? (Number(displaySecurity.changeAbs) >= 0 ? '+' : '') + Number(displaySecurity.changeAbs).toFixed(2)
      : "—";
  const rawPercentChange = displaySecurity?.change_percentage != null
    ? Number(displaySecurity.change_percentage)
    : displaySecurity?.change_percent != null
      ? Number(displaySecurity.change_percent)
      : displaySecurity?.changePct != null
        ? Number(displaySecurity.changePct)
        : null;
  const percentChange = rawPercentChange != null
    ? (rawPercentChange >= 0 ? '+' : '') + rawPercentChange.toFixed(2) + '%'
    : "—";
  const isPositive = rawPercentChange != null && rawPercentChange >= 0;

  // Generate chart data from price history - filter out nulls
  const chartData = priceHistory.length > 0 
    ? priceHistory.filter(p => p.close != null).map(p => p.close) 
    : [];
  
  // Calculate chart return for the selected period
  const chartReturn = chartData.length >= 2 
    ? ((chartData[chartData.length - 1] - chartData[0]) / chartData[0]) * 100
    : 0;
  const isChartPositive = chartReturn >= 0;
  
  // Get return from security metrics for selected period
  const getSelectedPeriodReturn = () => {
    if (!displaySecurity?.returns) return null;
    const periodMap = {
      '1W': displaySecurity.returns.w1,
      '1M': displaySecurity.returns.m1,
      '3M': displaySecurity.returns.m3,
      '6M': displaySecurity.returns.m6,
      'YTD': displaySecurity.returns.ytd,
      '1Y': displaySecurity.returns.y1
    };
    return periodMap[selectedPeriod];
  };
  const selectedPeriodReturn = getSelectedPeriodReturn();
  
  // Calculate Y-axis domain with 5% padding (TradingView style)
  const dataMin = chartData.length > 0 ? Math.min(...chartData) : 0;
  const dataMax = chartData.length > 0 ? Math.max(...chartData) : 0;
  let range = dataMax - dataMin;
  
  // If range is 0 (flat line), use small percentage of max value
  if (range === 0) {
    range = dataMax * 0.001 || 1;
  }
  
  // Apply 5% padding on top and bottom for breathing room
  const minValue = dataMin - (range * 0.05);
  const maxValue = dataMax + (range * 0.05);
  const paddedRange = maxValue - minValue;
  const hasValidRange = paddedRange > 0 && chartData.length > 1;

  const formatTimestamp = () => {
    // AsOfTime is a text field in format like "16:30" or "2024-01-15 16:30:00"
    if (displaySecurity?.AsOfTime) {
      // If it's a full timestamp, extract time
      if (displaySecurity.AsOfTime.includes(' ')) {
        return displaySecurity.AsOfTime.split(' ')[1].substring(0, 5);
      }
      // If it's just time, use it directly
      if (displaySecurity.AsOfTime.includes(':')) {
        return displaySecurity.AsOfTime.substring(0, 5);
      }
    }
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  // Helper function to calculate Y position with proper domain
  const getYPosition = (value) => {
    if (!hasValidRange) return 50;
    // Map value to SVG Y coordinate: maxValue -> 0% (top), minValue -> 100% (bottom)
    return ((maxValue - value) / paddedRange) * 100;
  };

  // Format date for X-axis labels (short format: "Jan 29")
  const formatXAxisDate = (index) => {
    if (priceHistory.length === 0 || index >= priceHistory.length) return '';
    const date = new Date(priceHistory[index].ts);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // ── Buy sheet fee calculations ──────────────────────────────────────────────
  const { displayCurrency, priceValue } = useMemo(() => {
    const currency = displaySecurity?.currency || "R";
    const normalized = currency.toUpperCase() === "ZAC" ? "R" : currency;
    const price = Number(displaySecurity?.currentPrice ?? 0);
    const normPrice = currency.toUpperCase() === "ZAC" ? price / 100 : price;
    return { displayCurrency: normalized, priceValue: Number.isFinite(normPrice) ? normPrice : 0 };
  }, [displaySecurity]);

  const minShares = useMemo(() => {
    if (priceValue <= 0) return 1;
    return Math.ceil(MIN_INVESTMENT / priceValue);
  }, [priceValue]);

  const validBuyShares = Number.isFinite(buyShares) && buyShares > 0 ? buyShares : 0;
  const buyTotalAmount = validBuyShares * priceValue;
  const buyIsInvalid = !Number.isFinite(buyShares) || buyShares <= 0 || buyShares < minShares;

  const buyFees = useMemo(() => {
    const buffered = buyTotalAmount * (1 + CASH_BUFFER_RATE);
    const broker = buffered * BROKER_FEE_RATE;
    const isin = ISIN_FEE_PER_ASSET * (validBuyShares > 0 ? 1 : 0);
    const txn = buffered * TRANSACTION_FEE_RATE;
    return { broker, isin, txn, total: buffered + broker + isin + txn };
  }, [buyTotalAmount, validBuyShares, CASH_BUFFER_RATE, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, TRANSACTION_FEE_RATE]);

  const handleOpenBuySheet = () => {
    if (onboardingLoading) return;
    if (!onboardingComplete) { setShowOnboardingModal(true); return; }
    setBuyShares(minShares);
    setBuyFeeExpanded(false);
    setIsGift(false);
    setShowBuySheet(true);
  };

  const handleBuySheetInvest = () => {
    if (buyIsInvalid) return;
    setPendingCheckout({
      security: displaySecurity,
      amount: buyFees.total,
      baseAmount: buyTotalAmount,
      shareCount: validBuyShares,
    });
    setShowBuySheet(false);
    setTimeout(() => setShowGoalModal(true), 320);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-[calc(5rem+env(safe-area-inset-bottom))]">
      {/* Header */}
      <div className="rounded-b-[36px] bg-gradient-to-b from-[#111111] via-[#3b1b7a] to-[#5b21b6] px-4 pb-8 pt-12 text-white">
        <div className="mx-auto w-full max-w-sm md:max-w-md">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm active:scale-95"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <button
              onClick={toggleWatchlist}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 active:scale-90 ${
                isWatched ? "bg-yellow-400/20" : "bg-white/10"
              } ${watchlistAnimating ? "scale-125" : "scale-100"}`}
              aria-label={isWatched ? "Remove from Watchlist" : "Add to Watchlist"}
            >
              <Star className={`h-5 w-5 transition-all duration-300 ${
                isWatched ? "fill-yellow-400 text-yellow-400" : "text-white/60"
              } ${watchlistAnimating ? "scale-110" : ""}`} />
            </button>
          </div>

          <div className="mt-6 flex items-start gap-4">
            {security.logo_url ? (
              <img
                src={security.logo_url}
                alt={security.symbol}
                className="h-14 w-14 rounded-full border border-white/20 object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-lg font-bold text-white">
                {security.symbol?.substring(0, 2) || "—"}
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-xl font-bold text-white">
                {security.name || security.short_name}
              </h1>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-sm text-white/60">{security.symbol}</p>
                <span className="text-white/30">•</span>
                <div className="flex items-center gap-1">
                  <img
                    src="https://flagcdn.com/w20/za.png"
                    alt="South Africa"
                    className="h-3 w-4 rounded-sm object-cover"
                  />
                  <p className="text-sm text-white/60">{security.exchange}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Price Section */}
          <div className="mt-6">
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-bold text-white">{currentPrice}</p>
              <span className="text-sm text-white/50">{security.currency || "ZAR"}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className={`text-lg font-semibold ${isPositive ? "text-emerald-300" : "text-rose-300"}`}>
                {priceChange}
              </span>
              <span className={`text-lg font-semibold ${isPositive ? "text-emerald-300" : "text-rose-300"}`}>
                {percentChange}
              </span>
            </div>
            <p className="mt-1 text-xs text-white/40">
              As of today at {formatTimestamp()} GMT+2
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 px-4">
        <div className="flex gap-6">
          {["Overview"].map((tab, idx) => (
            <button
              key={tab}
              className={`pb-3 text-sm font-semibold transition-colors ${
                idx === 0
                  ? "border-b-2 border-slate-900 text-slate-900"
                  : "text-slate-400"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-10">
        {/* Chart Section */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Chart</h2>
            <button className="text-sm text-slate-500">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </button>
          </div>

          {/* Period Selector */}
          <div className="mt-4">
            <div className="flex gap-2">
              {periods.map((period) => (
                <button
                  key={period}
                  onClick={() => setSelectedPeriod(period)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                    selectedPeriod === period
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
            {(() => {
              const periodReturnValue = selectedPeriodReturn != null ? selectedPeriodReturn : (!loading && chartData.length >= 2 ? chartReturn : null);
              if (periodReturnValue == null) return null;
              const isPeriodPositive = periodReturnValue >= 0;
              return (
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className={`text-lg font-bold ${isPeriodPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isPeriodPositive ? '+' : ''}{periodReturnValue.toFixed(2)}%
                  </span>
                  <span className="text-xs text-slate-400">{selectedPeriod} return</span>
                </div>
              );
            })()}
          </div>

          {/* Chart */}
          <div className="relative mt-6 h-64">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-sm text-slate-400">Loading chart...</div>
              </div>
            ) : chartData.length < 2 ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-sm text-slate-400">
                  {chartData.length === 0 ? 'No price data available' : 'Insufficient data for chart'}
                </div>
              </div>
            ) : (
              <svg 
                width="100%" 
                height="100%" 
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="overflow-visible"
              >
                {/* Grid lines (horizontal only) */}
                {[0, 0.25, 0.5, 0.75, 1].map((y) => (
                  <line
                    key={y}
                    x1="0"
                    y1={y * 100}
                    x2="100"
                    y2={y * 100}
                    stroke="#e2e8f0"
                    strokeWidth="0.3"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

                {/* Area fill */}
                <defs>
                  <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={isChartPositive ? "#10b981" : "#ef4444"} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={isChartPositive ? "#10b981" : "#ef4444"} stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Chart line and area */}
                <g>
                  {/* Area path */}
                  <path
                    d={`M 0 ${getYPosition(chartData[0])} ${chartData
                      .map((value, i) => {
                        const x = (i / Math.max(1, chartData.length - 1)) * 100;
                        const y = getYPosition(value);
                        return `L ${x} ${y}`;
                      })
                      .join(' ')} L 100 100 L 0 100 Z`}
                    fill="url(#areaGradient)"
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* Line path */}
                  <path
                    d={`M 0 ${getYPosition(chartData[0])} ${chartData
                      .map((value, i) => {
                        const x = (i / Math.max(1, chartData.length - 1)) * 100;
                        const y = getYPosition(value);
                        return `L ${x} ${y}`;
                      })
                      .join(' ')}`}
                    fill="none"
                    stroke={isChartPositive ? "#10b981" : "#ef4444"}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              </svg>
            )}
          </div>
        </section>

        {/* Key Stats */}
        {(security.pe || security.eps || security.dividend_yield || security.beta) && (
          <section className="mt-8">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Key Statistics</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {security.pe && (
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">P/E Ratio</p>
                  <p className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900">{Number(security.pe).toFixed(2)}</p>
                </div>
              )}
              {security.eps && (
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">EPS</p>
                  <p className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900">{Number(security.eps).toFixed(2)}</p>
                </div>
              )}
              {security.dividend_yield && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 shadow-sm">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-600/70">Dividend Yield</p>
                  <p className="mt-2.5 text-2xl font-bold tracking-tight text-emerald-600">{Number(security.dividend_yield).toFixed(2)}%</p>
                </div>
              )}
              {security.beta && (
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Beta</p>
                  <p className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900">{Number(security.beta).toFixed(2)}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* About */}
        {security.description && (
          <section className="mt-8">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">About</p>
            <p className="mt-3 text-[15px] font-normal leading-7 text-slate-600">{security.description}</p>
            {security.website && (
              <a
                href={security.website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-purple-600"
              >
                Visit website
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M7 7h10v10"/></svg>
              </a>
            )}
          </section>
        )}

        {/* Sector & Industry */}
        {(security.sector || security.industry) && (
          <section className="mt-8">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Classification</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {security.sector && (
                <span className="rounded-full border border-purple-200 bg-purple-50 px-3.5 py-1.5 text-xs font-semibold text-purple-700">
                  {security.sector}
                </span>
              )}
              {security.industry && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3.5 py-1.5 text-xs font-semibold text-blue-700">
                  {security.industry}
                </span>
              )}
            </div>
          </section>
        )}

      </div>

      {/* Sticky Action Bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex gap-3 px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-2 transition-all duration-300 ease-out"
        style={{
          transform: buttonsVisible ? "translateY(0)" : "translateY(calc(100% + 2rem))",
          opacity: buttonsVisible ? 1 : 0,
          pointerEvents: buttonsVisible ? "auto" : "none",
        }}
      >
        {/* Watchlist — compact squircle */}
        <button
          onClick={toggleWatchlist}
          className={`relative flex h-[68px] w-[100px] flex-shrink-0 flex-col items-center justify-center gap-1.5 rounded-[22px] text-[10px] font-semibold uppercase tracking-widest shadow-[0_6px_24px_rgba(0,0,0,0.10)] ring-1 transition-all duration-300 active:scale-95 ${
            isWatched
              ? "bg-amber-50 text-amber-700 ring-amber-200/80"
              : "bg-white/95 text-slate-500 ring-slate-200/70"
          } ${watchlistAnimating ? "scale-95" : ""}`}
          style={{ backdropFilter: "blur(14px)" }}
        >
          <span className={`transition-transform duration-300 ${watchlistAnimating ? "scale-125" : "scale-100"}`}>
            {isWatched ? (
              <Star className={`h-6 w-6 fill-amber-400 text-amber-400 ${watchlistAnimating ? "animate-[spin_0.4s_ease-out]" : ""}`} />
            ) : (
              <Star className="h-6 w-6 text-slate-400" />
            )}
          </span>
          <span>{isWatched ? "Saved" : "Watchlist"}</span>
        </button>

        {/* Invest — dominant elongated pill */}
        <button
          type="button"
          onClick={handleOpenBuySheet}
          className="relative flex h-[68px] flex-1 items-center justify-center overflow-hidden rounded-full bg-gradient-to-r from-[#0a0a0a] via-[#2d0f6b] to-[#7c3aed] text-[15px] font-bold tracking-wide text-white shadow-[0_10px_40px_rgba(109,40,217,0.50)] transition-all active:scale-[0.97]"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          Invest
        </button>
      </div>

      {/* ── Buy Sheet Modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showBuySheet && (
          <motion.div
            key="buy-sheet-overlay"
            className="fixed inset-0 z-[9000] flex items-end justify-center bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) { setIsGift(false); setShowBuySheet(false); } }}
          >
            <motion.div
              className="w-full max-w-md rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl"
              initial={{ y: "100%" }}
              animate={{ y: isGift ? "110%" : 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              style={{ pointerEvents: isGift ? "none" : "auto" }}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-3">
                  {displaySecurity?.logo_url ? (
                    <img src={displaySecurity.logo_url} alt={displaySecurity.symbol} className="h-8 w-8 rounded-full border border-slate-100 object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                      {displaySecurity?.symbol?.substring(0, 2)}
                    </div>
                  )}
                  <h2 className="text-base font-semibold text-slate-900">Invest in {displaySecurity?.symbol}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => { setIsGift(false); setShowBuySheet(false); }}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[75vh] overflow-y-auto px-5 py-5 space-y-4">
                {/* Price per share */}
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Price per share</p>
                  <p className="mt-2 text-3xl font-bold text-slate-900">{displayCurrency}{priceValue.toFixed(2)}</p>
                </div>

                {/* Shares input */}
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Number of shares</label>
                  <input
                    type="number"
                    min={minShares}
                    step="1"
                    value={buyShares}
                    onChange={(e) => setBuyShares(Number(e.target.value))}
                    className={`mt-2 w-full rounded-2xl border bg-white px-4 py-3.5 text-base text-slate-800 shadow-sm outline-none focus:border-violet-400 ${buyIsInvalid ? "border-red-300" : "border-slate-200"}`}
                  />
                  {buyIsInvalid && (
                    <p className="mt-1.5 text-xs text-red-500">
                      Minimum {minShares} share{minShares !== 1 ? "s" : ""} required ({displayCurrency}{MIN_INVESTMENT.toLocaleString()} minimum)
                    </p>
                  )}
                </div>

                {/* Investment amount */}
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
                  <span className="text-sm text-slate-600">Investment Amount</span>
                  <span className="font-semibold text-slate-900">{fmt(buyTotalAmount, displayCurrency)}</span>
                </div>

                {/* Total cost */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700">Total Cost</p>
                  <p className="text-sm font-bold text-slate-900">{fmt(buyFees.total, displayCurrency)}</p>
                </div>

                {/* Invest button — hidden when gift mode is active */}
                {!isGift && (
                  <button
                    type="button"
                    disabled={buyIsInvalid}
                    onClick={handleBuySheetInvest}
                    className={`w-full rounded-2xl py-4 text-sm font-bold uppercase tracking-[0.18em] text-white shadow-lg transition-all active:scale-95 ${
                      buyIsInvalid
                        ? "cursor-not-allowed bg-slate-300"
                        : "bg-gradient-to-r from-[#0a0a0a] via-[#2d0f6b] to-[#7c3aed] shadow-[0_8px_24px_rgba(109,40,217,0.40)]"
                    }`}
                  >
                    Invest
                  </button>
                )}

                {/* Send as a gift */}
                <div className="mb-1">
                  <GiftToggleV2
                    enabled={isGift}
                    onToggle={handleGiftToggle}
                    onDone={() => { setIsGift(false); setShowBuySheet(false); onGiftDone?.(); }}
                    security={{ id: displaySecurity?.id, name: displaySecurity?.name || displaySecurity?.symbol, symbol: displaySecurity?.symbol }}
                    totalCostCents={Math.round(buyFees.total * 100)}
                    amountDisplay={`${displayCurrency}${buyFees.total.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    assetType="stock"
                  />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Goal Link Modal ──────────────────────────────────────────────────── */}
      <GoalLinkModal
        isOpen={showGoalModal}
        onClose={() => setShowGoalModal(false)}
        onConfirm={(goalId) => {
          setShowGoalModal(false);
          if (onProceedToPayment && pendingCheckout) {
            onProceedToPayment({ ...pendingCheckout, goalId });
          }
        }}
        investmentAmount={pendingCheckout?.baseAmount}
        assetName={pendingCheckout?.security?.name || pendingCheckout?.security?.symbol}
      />

      {showOnboardingModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowOnboardingModal(false)}>
          <div className="mx-6 w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-50 mx-auto mb-4">
              <Star className="h-7 w-7 text-violet-600" />
            </div>
            <h3 className="text-center text-lg font-semibold text-slate-900 mb-2">Complete Your Onboarding</h3>
            <p className="text-center text-sm text-slate-500 mb-6">
              You need to complete your identity verification and onboarding before you can start investing. This helps us keep your account secure.
            </p>
            <button
              onClick={() => {
                setShowOnboardingModal(false);
                if (onNavigateToOnboarding) onNavigateToOnboarding();
              }}
              className="w-full rounded-2xl bg-gradient-to-r from-black to-purple-600 py-3 text-sm font-semibold text-white shadow-lg"
            >
              Complete Onboarding
            </button>
            <button
              onClick={() => setShowOnboardingModal(false)}
              className="w-full mt-2 rounded-2xl py-3 text-sm font-semibold text-slate-500"
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockDetailPage;
