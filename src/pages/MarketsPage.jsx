import React, { useEffect, useState, useRef, useMemo, useId } from "react";
import { createPortal } from "react-dom";
import MaintenanceModal from "../components/MaintenanceModal.jsx";
import GoalLinkModal from "../components/GoalLinkModal.jsx";
import { useFees } from "../lib/useFees";
import { useOnboardingStatus } from "../lib/useOnboardingStatus";
import { registerCacheResetCallback } from "../lib/userCacheReset.js";
import { supabase } from "../lib/supabase.js";
import { getMarketsSecuritiesWithMetrics, getSecurityPrices, clearMarketDataCache } from "../lib/marketData.js";
import { useRealtimePrices } from "../lib/useRealtimePrices";
import { getStrategiesWithMetrics, getPublicStrategies, formatChangePct, formatChangeAbs, getChangeColor } from "../lib/strategyData.js";
import { useProfile } from "../lib/useProfile";
import { TrendingUp, Search, SlidersHorizontal, X, ChevronRight, Bookmark, HelpCircle, Gift, Heart, Wallet, BarChart3, AlertCircle, ArrowLeft, Download } from "lucide-react";
import PdfViewer from "../components/PdfViewer";
import WishlistModal from "../components/WishlistModal.jsx";
import WishlistPickerSheet from "../components/WishlistPickerSheet.jsx";
import WishlistToast from "../components/WishlistToast.jsx";
import ChildInvestModal from "../components/ChildInvestModal.jsx";
import GiftRegistryCreateSheet from "../components/GiftRegistryCreateSheet.jsx";
import ChildMarketPromptModal from "../components/ChildMarketPromptModal.jsx";
import { saveMarketsInvestFilters, loadMarketsInvestFilters, saveMarketsStrategyFilters, loadMarketsStrategyFilters, buildInvestChips, buildChipsFromFilters } from "../lib/usePersistedFilters.js";
import NotificationBell from "../components/NotificationBell";
import FamilyDropdown from "../components/FamilyDropdown";
import Skeleton from "../components/Skeleton";
import { ChartContainer } from "../components/ui/line-charts-2";
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { formatCurrency } from "../lib/formatCurrency";
import { normalizeSymbol, getHoldingsArray, getHoldingSymbol, buildHoldingsBySymbol, getStrategyHoldingsSnapshot, calculateMinInvestment, calculateMinInvestmentSync, getAdjustedShares, enrichSecuritiesWithIntradayPrices } from "../lib/strategyUtils";
import MintBasketsExplainer, { BASKETS_EXPLAINER_KEY } from "../components/MintBasketsExplainer.jsx";
import { symbolToHue, generateSparkline, CompactSecurityRow, SecuritySparklineCard, CollapsibleSection } from "../components/SecurityCards.jsx";
import { hasSeenAnimation } from "../lib/animationSeen.js";

const sortOptions = ["Market Cap", "Dividend Yield", "P/E Ratio", "1M Performance", "YTD Performance"];

const MIN_ASSET_VALUE_DISPLAY = 1000;

const CHILD_BROKER_FEE_RATE = 0.0025;
const CHILD_ISIN_FEE_PER_ASSET = 69;
const CHILD_TRANSACTION_FEE_RATE = 0.038;
const CHILD_CASH_BUFFER_RATE = 0.08;

const strategySortOptions = [
  "Recommended",
  "Best performance",
  "Lowest max drawdown",
  "Lowest volatility",
  "Lowest minimum",
  "Most popular",
];

const riskOptions = ["Low risk", "Balanced", "Growth", "High risk"];
const minInvestmentOptions = ["R500+", "R2,500+", "R10,000+"];
const exposureOptions = ["Local", "Global", "Mixed", "Equities", "ETFs"];
const timeHorizonOptions = ["Short", "Medium", "Long"];
const strategySectorOptions = ["Technology", "Consumer", "Healthcare", "Energy", "Financials"];
const strategyTimeframeOptions = [
  { key: "1W", label: "1W" },
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "6M", label: "6M" },
  { key: "YTD", label: "YTD" },
];
const previewFallbackLength = 140;

// Mini chart component for strategy cards
const StrategyMiniChart = ({ values }) => {
  const chartConfig = {
    returnPct: {
      label: "Return",
      color: "var(--color-mint-purple, #5b21b6)",
    },
  };
  const data = useMemo(
    () =>
      values.map((value, index) => ({
        label: `P${index + 1}`,
        returnPct: value,
      })),
    [values],
  );
  const lastIndex = data.length - 1;
  const gradientId = useId();
  const [activeLabel, setActiveLabel] = useState(null);
  const renderLastDot = ({ cx, cy, index }) => {
    if (index !== lastIndex) return null;
    return (
      <g>
        <circle cx={cx} cy={cy} r={5} fill="#ffffff" opacity={0.95} />
        <circle cx={cx} cy={cy} r={2.5} fill={chartConfig.returnPct.color} />
      </g>
    );
  };

  return (
    <ChartContainer config={chartConfig} className="h-12 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 4, right: 6, left: 6, bottom: 4 }}
          onMouseMove={(state) => {
            if (state?.activeLabel) {
              setActiveLabel(state.activeLabel);
            }
          }}
          onMouseLeave={() => {
            setActiveLabel(null);
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5b21b6" stopOpacity={0.22} />
              <stop offset="70%" stopColor="#3b1b7a" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
            </linearGradient>
          </defs>

          {activeLabel ? (
            <ReferenceLine
              x={activeLabel}
              stroke="#CBD5E1"
              strokeOpacity={0.7}
              strokeDasharray="3 3"
            />
          ) : null}

          <Area
            type="monotone"
            dataKey="returnPct"
            stroke="transparent"
            fill={`url(#${gradientId})`}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="returnPct"
            stroke={chartConfig.returnPct.color}
            strokeWidth={2}
            dot={renderLastDot}
            activeDot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
};


let _mkSecurities = null;
let _mkSecuritiesTs = 0;
const MK_SECURITIES_TTL = 60_000;
let _mkStrategies = null;
let _mkPublicStrategies = null;
let _mkHoldingsSecurities = null;

registerCacheResetCallback(() => {
  _mkSecurities = null;
  _mkSecuritiesTs = 0;
  _mkStrategies = null;
  _mkHoldingsSecurities = null;
});

const MarketsPage = ({ onBack, onOpenNotifications, onOpenStockDetail, onOpenNewsArticle, onOpenFactsheet, onInvestNow, onProceedToPayment, initialViewMode, onViewModeChange, childFilter, onNavigateToHome, onNavigateToInvest, onOpenMyWishlists, onContinueToRegistry }) => {
  const { profile, loading: profileLoading } = useProfile();
  const { ISIN_FEE_PER_ASSET, BROKER_FEE_RATE, TRANSACTION_FEE_RATE, CASH_BUFFER_RATE } = useFees();
  const { onboardingComplete, loading: onboardingLoading } = useOnboardingStatus();
  const [portalTarget, setPortalTarget] = useState(null);
  const { lastUpdated: pricesLastUpdated } = useRealtimePrices();
  const [securities, setSecurities] = useState(() => _mkSecurities || []);
  const [strategies, setStrategies] = useState(() => _mkStrategies || []);
  const [publicStrategies, setPublicStrategies] = useState(() => _mkPublicStrategies || []);
  const [holdingsSecurities, setHoldingsSecurities] = useState([]);
  const [newsArticles, setNewsArticles] = useState([]);
  const [loading, setLoading] = useState(() => !_mkSecurities);
  const [strategiesLoading, setStrategiesLoading] = useState(() => !_mkStrategies);
  const [publicStrategiesLoading, setPublicStrategiesLoading] = useState(() => !_mkPublicStrategies);
  const [searchQuery, setSearchQuery] = useState("");
  const [strategiesSearchQuery, setStrategiesSearchQuery] = useState("");
  const [newsSearchQuery, setNewsSearchQuery] = useState("");
  const [showOpenStrategiesMaintenance, setShowOpenStrategiesMaintenance] = useState(false);
  const [viewMode, setViewMode] = useState(
    childFilter ? "openstrategies" : (initialViewMode || "invest")
  ); // "openstrategies", "invest", "news"

  useEffect(() => {
    if (initialViewMode) {
      setViewMode(initialViewMode);
    }
  }, [initialViewMode]);

  useEffect(() => {
    onViewModeChange?.(viewMode);
  }, [viewMode]);

  const [showBasketsExplainer, setShowBasketsExplainer] = useState(false);
  const basketsTabRef = useRef(null);
  useEffect(() => {
    if (viewMode === "openstrategies" && !childFilter) {
      // Source of truth is the DB (`animation` table); localStorage is only a
      // fast cache inside hasSeenAnimation. Once seen (on any device), the
      // explainer never auto-plays again.
      let cancelled = false;
      hasSeenAnimation("home_baskets_explainer", BASKETS_EXPLAINER_KEY).then((seen) => {
        if (!cancelled) setShowBasketsExplainer(!seen);
      });
      return () => { cancelled = true; };
    } else {
      setShowBasketsExplainer(false);
    }
  }, [viewMode, childFilter]);

  const handleReplayTutorial = () => {
    localStorage.removeItem(BASKETS_EXPLAINER_KEY);
    setShowBasketsExplainer(true);
  };

  // Pre-fetch Lottie JSON on page mount so the browser cache is warm
  useEffect(() => {
    fetch("https://lottie.host/abde670e-c9ef-40b6-9009-6dfb6bbebc0a/1ank9HLrmf.json")
      .catch(() => {});
  }, []);

  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [selectedSecurity, setSelectedSecurity] = useState(null);

  // ── Security buy sheet state ─────────────────────────────────────────────
  const [investingSecurity, setInvestingSecurity] = useState(null);
  const [showSecurityBuySheet, setShowSecurityBuySheet] = useState(false);
  const [securityBuyShares, setSecurityBuyShares] = useState(1);
  const [pendingSecurityCheckout, setPendingSecurityCheckout] = useState(null);
  const [showSecurityGoalModal, setShowSecurityGoalModal] = useState(false);
  const [showSecurityOnboardingModal, setShowSecurityOnboardingModal] = useState(false);
  const [securityBuyWalletBalance, setSecurityBuyWalletBalance] = useState(null);
  const [securityBuyAgreementChecked, setSecurityBuyAgreementChecked] = useState(false);
  const [securityBuyAgreementError, setSecurityBuyAgreementError] = useState(false);
  const [securityBuyShakeAgreement, setSecurityBuyShakeAgreement] = useState(false);
  const [securityBuyShowMandateModal, setSecurityBuyShowMandateModal] = useState(false);

  // Fetch wallet balance when the security buy sheet opens; reset agreement state
  useEffect(() => {
    if (!showSecurityBuySheet) return;
    setSecurityBuyAgreementChecked(false);
    setSecurityBuyAgreementError(false);
    setSecurityBuyShakeAgreement(false);
    setSecurityBuyWalletBalance(null);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const { data } = await supabase
          .from("wallets")
          .select("balance")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (data) setSecurityBuyWalletBalance(data.balance ?? 0);
      } catch { /* ignore */ }
    })();
  }, [showSecurityBuySheet]);

  const [selectedStrategyTimeframe, setSelectedStrategyTimeframe] = useState("YTD");
  const [selectedStrategyActiveLabel, setSelectedStrategyActiveLabel] = useState(null);
  const [selectedStrategyAnalytics, setSelectedStrategyAnalytics] = useState(null);
  const [selectedStrategyAnalyticsLoading, setSelectedStrategyAnalyticsLoading] = useState(false);

  // Child invest modal state
  const [showChildInvestModal, setShowChildInvestModal] = useState(false);
  const [strategyYtdById, setStrategyYtdById] = useState({});
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [sheetOffset, setSheetOffset] = useState(0);
  const dragStartY = useRef(null);
  const isDragging = useRef(false);

  // ── Security buy sheet — computed fee values ─────────────────────────────
  const securityDisplayCurrency = useMemo(() => {
    const c = investingSecurity?.currency || "R";
    return c.toUpperCase() === "ZAC" ? "R" : c;
  }, [investingSecurity]);

  const securityPriceValue = useMemo(() => {
    const c = investingSecurity?.currency || "R";
    const p = Number(investingSecurity?.currentPrice ?? 0);
    return c.toUpperCase() === "ZAC" ? p / 100 : p;
  }, [investingSecurity]);

  const securityMinShares = useMemo(() => {
    if (!securityPriceValue || securityPriceValue <= 0) return 1;
    return Math.ceil(200 / securityPriceValue);
  }, [securityPriceValue]);

  const securityValidShares = Number.isFinite(securityBuyShares) && securityBuyShares > 0 ? securityBuyShares : 0;
  const securityBuyTotal = securityValidShares * securityPriceValue;
  const securityBuyIsInvalid = !Number.isFinite(securityBuyShares) || securityBuyShares <= 0 || securityBuyShares < securityMinShares;

  const securityBuyFees = useMemo(() => {
    const buffered = securityBuyTotal * (1 + CASH_BUFFER_RATE);
    const broker = buffered * BROKER_FEE_RATE;
    const isin = ISIN_FEE_PER_ASSET * (securityValidShares > 0 ? 1 : 0);
    const txn = buffered * TRANSACTION_FEE_RATE;
    return { total: buffered + broker + isin + txn };
  }, [securityBuyTotal, securityValidShares, CASH_BUFFER_RATE, BROKER_FEE_RATE, ISIN_FEE_PER_ASSET, TRANSACTION_FEE_RATE]);

  const fmtSecAmt = (val) => `${securityDisplayCurrency} ${Number(val).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Filter states for Invest view (restored from localStorage)
  const _savedInvest = useMemo(() => loadMarketsInvestFilters(), []);
  const [selectedSort, setSelectedSort] = useState(_savedInvest?.sort || "Market Cap");
  const [selectedSectors, setSelectedSectors] = useState(_savedInvest?.sectors || new Set());
  const [selectedExchanges, setSelectedExchanges] = useState(_savedInvest?.exchanges || new Set());
  const [draftSort, setDraftSort] = useState(_savedInvest?.sort || "Market Cap");
  const [draftSectors, setDraftSectors] = useState(_savedInvest?.sectors || new Set());
  const [draftExchanges, setDraftExchanges] = useState(_savedInvest?.exchanges || new Set());
  
  const _savedStrat = useMemo(() => loadMarketsStrategyFilters(), []);
  const [strategySort, setStrategySort] = useState(_savedStrat?.sort || "Recommended");
  const [selectedRisks, setSelectedRisks] = useState(_savedStrat?.risks || new Set());
  const [selectedMinInvestment, setSelectedMinInvestment] = useState(_savedStrat?.minInvestment ?? null);
  const [selectedExposure, setSelectedExposure] = useState(_savedStrat?.exposure || new Set());
  const [selectedTimeHorizon, setSelectedTimeHorizon] = useState(_savedStrat?.timeHorizon || new Set());
  const [selectedStrategySectors, setSelectedStrategySectors] = useState(_savedStrat?.sectors || new Set());
  const [draftStrategySort, setDraftStrategySort] = useState(_savedStrat?.sort || "Recommended");
  const [draftRisks, setDraftRisks] = useState(_savedStrat?.risks || new Set());
  const [draftMinInvestment, setDraftMinInvestment] = useState(_savedStrat?.minInvestment ?? null);
  const [draftExposure, setDraftExposure] = useState(_savedStrat?.exposure || new Set());
  const [draftTimeHorizon, setDraftTimeHorizon] = useState(_savedStrat?.timeHorizon || new Set());
  const [draftStrategySectors, setDraftStrategySectors] = useState(_savedStrat?.sectors || new Set());

  // Category (sector) display order, set by the CRM (app_settings 'category_order'
  // → { [sector]: number }). Lower number shows first; unset categories fall to
  // the end in their natural order. Controls the order of the basket sections.
  const [categoryOrder, setCategoryOrder] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("app_settings").select("value").eq("key", "category_order").maybeSingle();
        if (!cancelled && data?.value && typeof data.value === "object") setCategoryOrder(data.value);
      } catch { /* non-fatal: fall back to natural order */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const [activeChips, setActiveChips] = useState(() => {
    if (viewMode === "openstrategies" && _savedStrat) return buildChipsFromFilters(_savedStrat);
    if (viewMode === "invest" && _savedInvest) return buildInvestChips(_savedInvest);
    return [];
  });

  const [watchlist, setWatchlist] = useState([]);
  const [showWishlistMenu, setShowWishlistMenu] = useState(false);
  const wishlistMenuRef = useRef(null);
  const [showChildWishlistCreate, setShowChildWishlistCreate] = useState(false);
  const childData = childFilter && typeof childFilter === "object" ? childFilter : null;

  // Child market prompt — parent browses kid strategies from the wishlist guard
  const [showChildMarketPrompt, setShowChildMarketPrompt] = useState(false);
  const [localChildFilter, setLocalChildFilter] = useState(null); // overrides childFilter prop
  const [wishlistPickerIsKid, setWishlistPickerIsKid] = useState(null);

  // Wishlist (heart) state — loaded from Supabase user_metadata, not localStorage
  const [wishlistedKeys, setWishlistedKeys] = useState(new Set());
  const [strategyWatchlist, setStrategyWatchlist] = useState([]);
  const [wishlistPickerKey, setWishlistPickerKey] = useState(null); // itemKey awaiting picker
  const [wishlistToastMsg, setWishlistToastMsg] = useState("");
  const [wishlistToastVisible, setWishlistToastVisible] = useState(false);
  const [wishlistToastRegistryId, setWishlistToastRegistryId] = useState(null);

  // Load wishlisted keys + strategy watchlist from API on mount.
  // When in a child's dashboard context, scope hearts to that child's registries only
  // so that sibling children's liked items don't bleed into each other's heart state.
  useEffect(() => {
    async function loadPrefs() {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (!token) return;
        const url = childData?.id
          ? `/api/gift-wishlist-prefs?childFamilyMemberId=${encodeURIComponent(childData.id)}`
          : "/api/gift-wishlist-prefs";
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const { wishlistedKeys: keys = [], watchlist = [] } = await res.json();
          setWishlistedKeys(new Set(keys));
          setStrategyWatchlist(watchlist);
        }
      } catch (e) {
        console.error("[MarketsPage] loadPrefs error:", e);
      }
    }
    loadPrefs();
  }, [childData?.id]);

  async function updateWishlistPrefs(patch) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return;
      await fetch("/api/gift-wishlist-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
    } catch (e) {
      console.error("[MarketsPage] updatePrefs error:", e);
    }
  }

  const toggleWishlistItem = (e, itemKey) => {
    e.stopPropagation();
    if (wishlistedKeys.has(itemKey)) {
      const next = new Set(wishlistedKeys);
      next.delete(itemKey);
      setWishlistedKeys(next);
      updateWishlistPrefs({ wishlistedKeys: [...next] });
    } else {
      // Determine if the strategy is a kid strategy (for the wishlist picker guard).
      // Default to false when not found — safer to block than to allow.
      if (itemKey.startsWith("strategy:")) {
        const stratId = itemKey.slice(9);
        const strat = publicStrategiesWithMetrics.find(s => s.id === stratId);
        setWishlistPickerIsKid(strat ? strat.is_kid_strategy === true : false);
      } else {
        setWishlistPickerIsKid(null); // single securities — not a strategy at all, bypass child guard
      }
      // Show the wishlist picker so the user can choose a category
      setWishlistPickerKey(itemKey);
    }
  };

  const toggleStrategyWatchlist = (e, strategyId) => {
    e.stopPropagation();
    const isW = strategyWatchlist.includes(strategyId);
    const next = isW ? strategyWatchlist.filter(id => id !== strategyId) : [...strategyWatchlist, strategyId];
    setStrategyWatchlist(next);
    updateWishlistPrefs({ watchlist: next });
  };

  useEffect(() => {
    if (!showWishlistMenu) return;
    function handleClickOutside(e) {
      if (wishlistMenuRef.current && !wishlistMenuRef.current.contains(e.target)) {
        setShowWishlistMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showWishlistMenu]);

  useEffect(() => { setPortalTarget(document.body); }, []);

  useEffect(() => {
    if (profile?.watchlist && Array.isArray(profile.watchlist)) {
      setWatchlist(profile.watchlist);
    }
  }, [profile]);

  const toggleWatchlist = async (e, symbol) => {
    e.stopPropagation();
    if (!profile?.id) return;

    const isWatched = watchlist.includes(symbol);
    const newWatchlist = isWatched
      ? watchlist.filter((t) => t !== symbol)
      : [...watchlist, symbol];

    setWatchlist(newWatchlist);

    const { error } = await supabase
      .from('profiles')
      .update({ watchlist: newWatchlist })
      .eq('id', profile.id);

    if (error) {
      setWatchlist(watchlist);
      console.error("Watchlist sync failed:", error);
    }
  };

  const watchedSecurities = useMemo(() => {
    return securities.filter((s) => watchlist.includes(s.symbol));
  }, [securities, watchlist]);

  // Section refs for scroll-based expand detection
  const secRefWatchlist = useRef(null);
  const secRefLargest   = useRef(null);
  const secRefDividend  = useRef(null);
  const secRefGainers   = useRef(null);

  // Mirror state in a ref so the scroll handler avoids stale-closure bugs.
  const [expandedSections, setExpandedSections] = useState(() => new Set(["largest"]));
  const expandedRef = useRef(new Set(["largest"]));
  // Always-current watchlist length — read inside the scroll handler so it
  // never has a stale view of which sections are pinned.
  const watchedLengthRef = useRef(watchedSecurities.length);
  useEffect(() => {
    watchedLengthRef.current = watchedSecurities.length;
  }, [watchedSecurities.length]);

  // Set initial expanded / pinned state whenever securities or watchlist changes.
  useEffect(() => {
    if (!securities.length) return;

    const wLen = watchedSecurities.length;
    const hasWatchlist = wLen > 0;
    const firstKey  = hasWatchlist ? "watchlist" : "largest";
    const secondKey = hasWatchlist ? "largest"   : "dividend";
    const firstItems = hasWatchlist ? watchedSecurities : largestCompanies;

    const initial = new Set([firstKey]);
    if (firstItems.length < 2) initial.add(secondKey);

    expandedRef.current = initial;
    setExpandedSections(new Set(initial));
  }, [watchedSecurities.length, securities.length]);

  useEffect(() => {
    if (!securities.length) return;

    const sectionMap = {
      watchlist: secRefWatchlist,
      largest:   secRefLargest,
      dividend:  secRefDividend,
      gainers:   secRefGainers,
    };

    const check = () => {
      const threshold = window.innerHeight * 0.3;

      // Derive pinned keys fresh on every scroll tick from the live ref.
      const wLen = watchedLengthRef.current;
      const hasWatchlist = wLen > 0;
      const firstKey  = hasWatchlist ? "watchlist" : "largest";
      const secondKey = hasWatchlist ? "largest"   : "dividend";
      const firstFew  = wLen < 2; // first section has fewer than 2 assets

      let changed = false;

      for (const [key, ref] of Object.entries(sectionMap)) {
        if (!ref.current) continue;

        const isPinned = key === firstKey || (firstFew && key === secondKey);

        if (isPinned) {
          // Pinned sections must always be expanded.
          if (!expandedRef.current.has(key)) {
            expandedRef.current = new Set([...expandedRef.current, key]);
            changed = true;
          }
          continue;
        }

        const { top } = ref.current.getBoundingClientRect();
        const shouldBeExpanded = top < threshold;
        const isExpanded = expandedRef.current.has(key);

        if (shouldBeExpanded && !isExpanded) {
          expandedRef.current = new Set([...expandedRef.current, key]);
          changed = true;
        } else if (!shouldBeExpanded && isExpanded) {
          const next = new Set(expandedRef.current);
          next.delete(key);
          expandedRef.current = next;
          changed = true;
        }
      }

      if (changed) setExpandedSections(new Set(expandedRef.current));
    };

    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [securities.length]);

  // Real price history for sparkline cards — keyed by security id
  const [sparklineData, setSparklineData] = useState({});

  useEffect(() => {
    if (!securities.length) return;
    let cancelled = false;

    const fetchSparklines = async () => {
      // Collect unique ids from all card sections (up to ~30 securities)
      const byMarketCap = [...securities]
        .filter((s) => s.market_cap)
        .sort((a, b) => b.market_cap - a.market_cap)
        .slice(0, 10);
      const byDividend = [...securities]
        .filter((s) => s.dividend_yield && s.dividend_yield > 0)
        .sort((a, b) => b.dividend_yield - a.dividend_yield)
        .slice(0, 10);
      const byGain = [...securities]
        .filter((s) => s.changePct != null)
        .sort((a, b) => (b.changePct || 0) - (a.changePct || 0))
        .slice(0, 10);
      const watched = securities.filter((s) => watchlist.includes(s.symbol));

      const seen = new Set();
      const toFetch = [];
      for (const s of [...watched, ...byMarketCap, ...byDividend, ...byGain]) {
        if (s.id && !seen.has(s.id)) { seen.add(s.id); toFetch.push(s); }
      }

      const results = await Promise.allSettled(
        toFetch.map((s) => getSecurityPrices(s.id, "1M").then((pts) => ({ id: s.id, pts: pts.slice(-14) })))
      );

      if (cancelled) return;

      const map = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.pts && r.value.pts.length >= 2) {
          const pts = r.value.pts;
          const closes = pts.map((p) => p.close).filter((c) => c != null);
          const min = Math.min(...closes);
          const max = Math.max(...closes);
          const range = max - min || 1;
          map[r.value.id] = pts
            .filter((p) => p.close != null)
            .map((p, i) => ({ i, v: ((p.close - min) / range) * 90 + 5 }));
        }
      }
      setSparklineData(map);
    };

    fetchSparklines();
    return () => { cancelled = true; };
  }, [securities.length, watchlist.join(",")]);


  const holdingsBySymbol = useMemo(() => buildHoldingsBySymbol(holdingsSecurities), [holdingsSecurities]);
  const previewGradientId = useId();
  
  // News pagination
  const [newsPage, setNewsPage] = useState(1);
  const newsPerPage = 7;

  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const fetchSecurities = async (force = false) => {
    const now = Date.now();
    const cacheValid = _mkSecurities && (now - _mkSecuritiesTs) < MK_SECURITIES_TTL;
    if (!force && cacheValid) { setLoading(false); return; }
    if (!force && _mkSecurities && !cacheValid) {
      _mkSecurities = null;
      _mkSecuritiesTs = 0;
      clearMarketDataCache();
    }
    setLoading(true);
    try {
      const data = await getMarketsSecuritiesWithMetrics();
      _mkSecurities = data;
      _mkSecuritiesTs = Date.now();
      setSecurities(data);
    } catch (error) {
      console.error("Error fetching securities:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSecurities();
  }, []);

  useEffect(() => {
    if (!pricesLastUpdated) return;
    _mkSecurities = null;
    _mkSecuritiesTs = 0;
    clearMarketDataCache();
    fetchSecurities(true);
  }, [pricesLastUpdated]);

  // Fetch strategies with metrics
  useEffect(() => {
    const fetchStrategies = async () => {
      if (_mkStrategies) { setStrategiesLoading(false); return; }
      setStrategiesLoading(true);
      try {
        const data = await getStrategiesWithMetrics();
        _mkStrategies = data;
        setStrategies(data);
      } catch (error) {
        console.error("Error fetching strategies:", error);
        setStrategies([]);
      } finally {
        setStrategiesLoading(false);
      }
    };

    fetchStrategies();
  }, []);

  // Fetch public strategies for OpenStrategies view
  useEffect(() => {
    const fetchPublicStrategies = async () => {
      if (_mkPublicStrategies) { setPublicStrategiesLoading(false); return; }
      setPublicStrategiesLoading(true);
      try {
        const data = await getPublicStrategies();
        _mkPublicStrategies = data;
        setPublicStrategies(data);
      } catch (error) {
        console.error("Error fetching public strategies:", error);
        setPublicStrategies([]);
      } finally {
        setPublicStrategiesLoading(false);
      }
    };

    fetchPublicStrategies();
  }, []);

  // Fetch performance metrics for OpenStrategies cards
  useEffect(() => {
    const fetchPerformanceMetrics = async () => {
      if (!supabase || publicStrategies.length === 0) {
        setStrategyYtdById({});
        return;
      }

      try {
        const strategyIds = publicStrategies.map(s => s.id);

        // Fetch latest returns for each strategy from strategies_returns_c
        const { data: returns, error } = await supabase
          .from("strategy_returns_effective_c")
          .select("strategy_id, ytd_pct, as_of_date")
          .in("strategy_id", strategyIds)
          .order("as_of_date", { ascending: false });

        if (error) throw error;

        // Create map with ytd_pct and as_of_date for each strategy
        const nextMap = {};
        (returns || []).forEach(ret => {
          if (!nextMap[ret.strategy_id]) {
            nextMap[ret.strategy_id] = {
              ytd: ret.ytd_pct ? ret.ytd_pct / 100 : null,
              as_of_date: ret.as_of_date
            };
          }
        });
        setStrategyYtdById(nextMap);
      } catch (error) {
        console.error("Error fetching performance metrics:", error);
        setStrategyYtdById({});
      }
    };

    fetchPerformanceMetrics();
  }, [publicStrategies]);

  // Fetch holdings securities for strategy cards (only if we have mock data)
  useEffect(() => {
    const fetchHoldingsSecurities = async () => {
      const strategySources = [...strategies, ...publicStrategies];
      if (!supabase || strategySources.length === 0) return;

      try {
        // Get all unique ticker symbols from strategies if they have holdings
        const allTickers = [...new Set(
          strategySources
            .flatMap((strategy) => getHoldingsArray(strategy).flatMap((h) => {
              const rawSymbol = h.ticker || h.symbol || h;
              const normalizedSymbol = normalizeSymbol(rawSymbol);
              return normalizedSymbol && normalizedSymbol !== rawSymbol
                ? [rawSymbol, normalizedSymbol]
                : [rawSymbol];
            }))
        )];
        
        if (allTickers.length === 0) return;

        const chunkSize = 50;
        const chunks = [];
        for (let i = 0; i < allTickers.length; i += chunkSize) {
          chunks.push(allTickers.slice(i, i + chunkSize));
        }

        const results = await Promise.all(
          chunks.map((symbols) => (
            supabase
              .from("securities_c")
              .select("id, symbol, logo_url, name, last_price")
              .in("symbol", symbols)
          )),
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
          const enriched = await enrichSecuritiesWithIntradayPrices(merged);
          setHoldingsSecurities(enriched);
        }
      } catch (error) {
        console.error("Error fetching holdings securities:", error);
      }
    };

    fetchHoldingsSecurities();
  }, [strategies, publicStrategies]);

  // Fetch news articles
  useEffect(() => {
    const fetchNewsArticles = async () => {
      if (!supabase) {
        console.log("❌ Supabase not initialized");
        return;
      }

      try {
        console.log("🔍 Fetching news articles from News_articles table...");
        const { data, error, count } = await supabase
          .from("News_articles")
          .select("id, title, source, published_at", { count: 'exact' })
          .order("published_at", { ascending: false })
          .limit(50);

        if (error) {
          console.error("❌ Error fetching news articles:", error);
          console.error("Error code:", error.code);
          console.error("Error message:", error.message);
          console.error("Error hint:", error.hint);
          console.error("Error details:", error.details);
          console.error("Full error:", JSON.stringify(error, null, 2));
        } else {
          console.log("✅ News articles fetched successfully!");
          console.log("📊 Total count in DB:", count);
          console.log("📰 Articles returned:", data?.length || 0);
          console.log("Sample article:", data?.[0]);
          setNewsArticles(data || []);
        }
      } catch (error) {
        console.error("💥 Exception while fetching news articles:", error);
      }
    };

    fetchNewsArticles();
  }, []);

  // Reset news page when search query changes
  useEffect(() => {
    setNewsPage(1);
  }, [newsSearchQuery]);

  const sectors = useMemo(() => {
    return [...new Set(securities.map((s) => s.sector).filter(Boolean))];
  }, [securities]);

  const exchanges = useMemo(() => {
    return [...new Set(securities.map((s) => s.exchange).filter(Boolean))];
  }, [securities]);

  const filteredSecurities = useMemo(() => {
    let filtered = securities.filter((security) => {
      const matchesSearch =
        security.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        security.symbol?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        security.sector?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSector = selectedSectors.size === 0 || selectedSectors.has(security.sector);
      const matchesExchange = selectedExchanges.size === 0 || selectedExchanges.has(security.exchange);

      return matchesSearch && matchesSector && matchesExchange;
    });

    // Sort
    if (selectedSort === "Market Cap") {
      filtered.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
    } else if (selectedSort === "Dividend Yield") {
      filtered.sort((a, b) => (b.dividend_yield || 0) - (a.dividend_yield || 0));
    } else if (selectedSort === "P/E Ratio") {
      filtered.sort((a, b) => (a.pe || Infinity) - (b.pe || Infinity));
    } else if (selectedSort === "Beta") {
      filtered.sort((a, b) => (b.beta || 0) - (a.beta || 0));
    } else if (selectedSort === "1M Performance") {
      filtered.sort((a, b) => (b.returns?.m1 || 0) - (a.returns?.m1 || 0));
    } else if (selectedSort === "YTD Performance") {
      filtered.sort((a, b) => (b.returns?.ytd || 0) - (a.returns?.ytd || 0));
    }

    return filtered;
  }, [securities, searchQuery, selectedSectors, selectedExchanges, selectedSort]);

  const largestCompanies = useMemo(() => {
    return filteredSecurities
      .filter((s) => s.market_cap)
      .sort((a, b) => b.market_cap - a.market_cap)
      .slice(0, 10);
  }, [filteredSecurities]);

  const highestDividendYield = useMemo(() => {
    return filteredSecurities
      .filter((s) => s.dividend_yield && s.dividend_yield > 0)
      .sort((a, b) => b.dividend_yield - a.dividend_yield)
      .slice(0, 10);
  }, [filteredSecurities]);

  const publicStrategiesWithMetrics = useMemo(() => {
    if (!publicStrategies.length) return [];

    const strategiesById = new Map(strategies.map((strategy) => [strategy.id, strategy]));

    return publicStrategies.map((publicStrategy) => {
      const strategyWithMetrics = strategiesById.get(publicStrategy.id);
      const analyticsData = strategyYtdById[publicStrategy.id];
      if (!strategyWithMetrics) {
        return {
          ...publicStrategy,
          r_ytd: analyticsData?.ytd ?? null,
          ytd_as_of_date: analyticsData?.as_of_date ?? null,
        };
      }

      return {
        ...publicStrategy,
        r_ytd: analyticsData?.ytd ?? strategyWithMetrics.r_ytd ?? strategyWithMetrics.latest_metric?.r_ytd ?? null,
        ytd_as_of_date: analyticsData?.as_of_date ?? null,
      };
    });
  }, [publicStrategies, strategies, strategyYtdById]);

  const filteredStrategies = useMemo(() => {
    // Use publicStrategies for OpenStrategies view
    const results = publicStrategiesWithMetrics.filter((strategy) => {
      if ((localChildFilter || childFilter) && !strategy.is_kid_strategy) return false;

      const matchesName =
        strategiesSearchQuery.length === 0
          ? true
          : (strategy.name?.toLowerCase().includes(strategiesSearchQuery.toLowerCase()) ||
             strategy.short_name?.toLowerCase().includes(strategiesSearchQuery.toLowerCase()) ||
             strategy.description?.toLowerCase().includes(strategiesSearchQuery.toLowerCase()) ||
             (strategy.tags && strategy.tags.some(tag => tag.toLowerCase().includes(strategiesSearchQuery.toLowerCase()))));
      
      const matchesRisk = selectedRisks.size
        ? selectedRisks.has(strategy.risk_level)
        : true;
      
      const minInvest = calculateMinInvestmentSync(strategy, holdingsBySymbol);
      let investmentCategory = null;
      if (minInvest != null) {
        if (minInvest >= 10000) investmentCategory = "R10,000+";
        else if (minInvest >= 2500) investmentCategory = "R2,500+";
        else investmentCategory = "R500+";
      }
      
      const matchesMinInvestment = selectedMinInvestment && selectedMinInvestment !== "Any"
        ? minInvest != null && investmentCategory === selectedMinInvestment
        : true;
      
      const matchesExposure = selectedExposure.size
        ? selectedExposure.has(strategy.objective)
        : true;
      
      const matchesTimeHorizon = selectedTimeHorizon.size
        ? (strategy.tags && strategy.tags.some(tag => selectedTimeHorizon.has(tag)))
        : true;
      
      const matchesSector = selectedStrategySectors.size
        ? (strategy.sector && selectedStrategySectors.has(strategy.sector))
        : true;

      return (
        matchesName &&
        matchesRisk &&
        matchesMinInvestment &&
        matchesExposure &&
        matchesTimeHorizon &&
        matchesSector
      );
    });

    // Sort strategies - already ordered by is_featured desc, name asc from database
    // But apply client-side sorts if selected
    const sorted = [...results];
    if (strategySort === "Best performance") {
      // Would need performance metrics for this
      sorted.sort((a, b) => (b.performance_score || 0) - (a.performance_score || 0));
    }
    if (strategySort === "Lowest minimum") {
      sorted.sort((a, b) => (calculateMinInvestmentSync(a, holdingsBySymbol) || 0) - (calculateMinInvestmentSync(b, holdingsBySymbol) || 0));
    }

    return sorted;
  }, [
    publicStrategiesWithMetrics,
    childFilter,
    localChildFilter,
    strategiesSearchQuery,
    selectedRisks,
    selectedMinInvestment,
    selectedExposure,
    selectedTimeHorizon,
    selectedStrategySectors,
    strategySort,
  ]);

  const gainers = useMemo(() => {
    return filteredSecurities
      .filter((s) => s.changePct != null)
      .sort((a, b) => (b.changePct || 0) - (a.changePct || 0))
      .slice(0, 10);
  }, [filteredSecurities]);

  const filteredNews = useMemo(() => {
    return newsArticles.filter(article => 
      newsSearchQuery.length === 0 ||
      article.title?.toLowerCase().includes(newsSearchQuery.toLowerCase()) ||
      article.source?.toLowerCase().includes(newsSearchQuery.toLowerCase())
    );
  }, [newsArticles, newsSearchQuery]);

  const paginatedNews = useMemo(() => {
    const startIndex = (newsPage - 1) * newsPerPage;
    const endIndex = startIndex + newsPerPage;
    return filteredNews.slice(startIndex, endIndex);
  }, [filteredNews, newsPage, newsPerPage]);

  const totalNewsPages = Math.ceil(filteredNews.length / newsPerPage);

  const formatMarketCap = (value) => {
    if (!value) return "—";
    const num = Number(value);
    if (num >= 1e12) return `R${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `R${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `R${(num / 1e6).toFixed(2)}M`;
    return `R${num.toFixed(2)}`;
  };

  const getDisplayCurrency = () => "R";

  const formatPrice = (security) => {
    if (security.currentPrice != null) {
      return Number(security.currentPrice).toFixed(2);
    }
    return "—";
  };


  useEffect(() => {
    if (!selectedStrategy) {
      setSelectedStrategyAnalytics(null);
      setSelectedStrategyAnalyticsLoading(false);
      return;
    }

    let isMounted = true;
    const fetchAnalytics = async () => {
      if (!supabase) {
        if (isMounted) {
          setSelectedStrategyAnalytics(null);
        }
        return;
      }

      setSelectedStrategyAnalyticsLoading(true);

      try {
        const strategyId = selectedStrategy.id || selectedStrategy.strategy_id;
        if (!strategyId) {
          setSelectedStrategyAnalytics(null);
          return;
        }

        // Fetch daily returns from strategies_returns_c for YTD cumulative calculation
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
          if (isMounted) {
            setSelectedStrategyAnalytics(null);
          }
          return;
        }

        // Calculate cumulative returns — skip rows with null 1d_pct to avoid flat tails
        const cumulativeData = [];
        let cumulative = 0;

        dailyReturns.forEach((day) => {
          if (day["1d_pct"] == null) return; // skip days with no data
          const dailyReturn = day["1d_pct"] / 100;
          cumulative += dailyReturn;
          cumulativeData.push({
            d: day.as_of_date,
            v: Number((cumulative * 100).toFixed(2))
          });
        });

        if (isMounted) {
          setSelectedStrategyAnalytics({
            strategy_id: strategyId,
            as_of_date: dailyReturns[dailyReturns.length - 1].as_of_date,
            curves: {
              YTD: cumulativeData
            }
          });
        }
      } catch (error) {
        if (isMounted) {
          setSelectedStrategyAnalytics(null);
        }
      } finally {
        if (isMounted) {
          setSelectedStrategyAnalyticsLoading(false);
        }
      }
    };

    fetchAnalytics();
    return () => {
      isMounted = false;
    };
  }, [selectedStrategy]);

  useEffect(() => {
    if (!selectedStrategy) return;

    const originalOverflow = document.body.style.overflow;
    const appContent = document.querySelector(".app-content");
    const originalAppContentOverflow = appContent?.style.overflow;

    document.body.style.overflow = "hidden";
    if (appContent) {
      appContent.style.overflow = "hidden";
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      if (appContent) {
        appContent.style.overflow = originalAppContentOverflow || "";
      }
    };
  }, [selectedStrategy]);

  const availablePreviewTimeframes = useMemo(() => {
    const curves = selectedStrategyAnalytics?.curves || {};
    return strategyTimeframeOptions
      .map((option) => option.key)
      .filter((key) => Array.isArray(curves[key]) && curves[key].length > 0);
  }, [selectedStrategyAnalytics]);

  useEffect(() => {
    if (!availablePreviewTimeframes.length) return;
    setSelectedStrategyTimeframe((prev) => {
      if (availablePreviewTimeframes.includes(prev)) return prev;
      if (availablePreviewTimeframes.includes("1M")) return "1M";
      return availablePreviewTimeframes[0];
    });
  }, [availablePreviewTimeframes]);

  const { previewChartData, previewChartDomain, previewBaseIndexValue } = useMemo(() => {
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
    let series = Array.isArray(curves[selectedStrategyTimeframe]) && curves[selectedStrategyTimeframe].length > 0
      ? curves[selectedStrategyTimeframe]
      : fallbackSeries;

    // Detect data order: if first value is higher than last value, data is likely reversed (newest-first)
    // For YTD/period returns, the value should generally increase or at least the direction should be consistent
    // If we see high at start and low at end, reverse it to oldest-first ordering
    if (series.length > 1) {
      const firstVal = series[0]?.v ?? 0;
      const lastVal = series[series.length - 1]?.v ?? 0;
      const firstDate = series[0]?.d ? new Date(series[0].d) : null;
      const lastDate = series[series.length - 1]?.d ? new Date(series[series.length - 1].d) : null;

      // If dates exist and show reversed order, flip the array
      if (firstDate && lastDate && firstDate > lastDate) {
        series = [...series].reverse();
        console.log('[Chart] Data was reversed (newest-first), now oldest-first');
      }
      // Also check if the first value is significantly higher (suggesting reversed order even without valid dates)
      else if (firstVal > lastVal * 1.05) {
        series = [...series].reverse();
        console.log('[Chart] Data appears reversed by value comparison, flipping');
      }
    }

    const labelIndices = series.length ? [0, Math.floor(series.length / 2), series.length - 1] : [];
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

    // Log for debugging
    if (values.length > 0) {
      const baseValue = values[0];
      const endValue = values[values.length - 1];
      const calculatedReturn = ((endValue - baseValue) / baseValue) * 100;
      console.log(`[Chart] TimeFrame: ${selectedStrategyTimeframe}, Base: ${baseValue}, End: ${endValue}, Return: ${calculatedReturn.toFixed(2)}%`);
    }

    const baseValue = values.length ? values[0] : null;
    return {
      previewChartData: mapped,
      previewChartDomain: domain,
      previewBaseIndexValue: baseValue,
    };
  }, [selectedStrategyAnalytics, selectedStrategyTimeframe]);

  const previewLastIndex = previewChartData.length - 1;
  const previewLastValue = previewChartData[previewLastIndex]?.returnPct ?? null;
  const previewFirstValue = previewBaseIndexValue;
  const previewPeriodReturn = previewChartData.length > 1 && previewFirstValue
    ? ((previewLastValue - previewFirstValue) / previewFirstValue) * 100
    : null;
  const previewChartLineColor = (selectedStrategy?.r_ytd ?? previewPeriodReturn ?? 0) > 0
    ? "#16a34a"
    : (selectedStrategy?.r_ytd ?? previewPeriodReturn ?? 0) < 0
      ? "#dc2626"
      : "#94a3b8";


  const resetSheetPosition = () => {
    setSheetOffset(0);
    dragStartY.current = null;
    isDragging.current = false;
  };

  const handleSheetPointerDown = (event) => {
    dragStartY.current = event.clientY;
    isDragging.current = true;
  };

  const handleSheetPointerMove = (event) => {
    if (!isDragging.current || dragStartY.current === null) return;
    const delta = event.clientY - dragStartY.current;
    setSheetOffset(delta > 0 ? delta : 0);
  };

  const handleSheetPointerUp = () => {
    if (!isDragging.current) return;
    if (sheetOffset > 80) {
      setIsFilterOpen(false);
    }
    resetSheetPosition();
  };

  const applyFilters = () => {
    const newSectors = new Set(draftSectors);
    const newExchanges = new Set(draftExchanges);
    setSelectedSort(draftSort);
    setSelectedSectors(newSectors);
    setSelectedExchanges(newExchanges);
    
    const chips = [];
    if (draftSectors.size) chips.push(...Array.from(draftSectors));
    if (draftExchanges.size) chips.push(...Array.from(draftExchanges));
    setActiveChips(chips);
    setIsFilterOpen(false);
    saveMarketsInvestFilters({ sort: draftSort, sectors: newSectors, exchanges: newExchanges });
  };

  const clearAllFilters = () => {
    setSelectedSort("Market Cap");
    setSelectedSectors(new Set());
    setSelectedExchanges(new Set());
    setDraftSort("Market Cap");
    setDraftSectors(new Set());
    setDraftExchanges(new Set());
    setActiveChips([]);
    saveMarketsInvestFilters({ sort: "Market Cap", sectors: new Set(), exchanges: new Set() });
  };

  const removeChip = (chip) => {
    let newSectors = selectedSectors;
    let newExchanges = selectedExchanges;
    if (sectors.includes(chip)) {
      newSectors = new Set(selectedSectors);
      newSectors.delete(chip);
      setSelectedSectors(newSectors);
    } else if (exchanges.includes(chip)) {
      newExchanges = new Set(selectedExchanges);
      newExchanges.delete(chip);
      setSelectedExchanges(newExchanges);
    }
    setActiveChips((prev) => prev.filter((item) => item !== chip));
    saveMarketsInvestFilters({ sort: selectedSort, sectors: newSectors, exchanges: newExchanges });
  };

  const applyStrategyFilters = () => {
    const newRisks = new Set(draftRisks);
    const newExposure = new Set(draftExposure);
    const newTimeHorizon = new Set(draftTimeHorizon);
    const newSectors = new Set(draftStrategySectors);
    setStrategySort(draftStrategySort);
    setSelectedRisks(newRisks);
    setSelectedMinInvestment(draftMinInvestment);
    setSelectedExposure(newExposure);
    setSelectedTimeHorizon(newTimeHorizon);
    setSelectedStrategySectors(newSectors);
    
    const chips = [];
    if (draftRisks.size) chips.push(...Array.from(draftRisks));
    if (draftExposure.size) chips.push(...Array.from(draftExposure));
    if (draftMinInvestment) chips.push(draftMinInvestment);
    if (draftTimeHorizon.size) chips.push(...Array.from(draftTimeHorizon));
    if (draftStrategySectors.size) chips.push(...Array.from(draftStrategySectors));
    setActiveChips(chips);
    setIsFilterOpen(false);
    saveMarketsStrategyFilters({ sort: draftStrategySort, risks: newRisks, minInvestment: draftMinInvestment, exposure: newExposure, timeHorizon: newTimeHorizon, sectors: newSectors });
  };

  const clearAllStrategyFilters = () => {
    setStrategySort("Recommended");
    setSelectedRisks(new Set());
    setSelectedMinInvestment(null);
    setSelectedExposure(new Set());
    setSelectedTimeHorizon(new Set());
    setSelectedStrategySectors(new Set());
    setDraftStrategySort("Recommended");
    setDraftRisks(new Set());
    setDraftMinInvestment(null);
    setDraftExposure(new Set());
    setDraftTimeHorizon(new Set());
    setDraftStrategySectors(new Set());
    setActiveChips([]);
    saveMarketsStrategyFilters({ sort: "Recommended", risks: new Set(), minInvestment: null, exposure: new Set(), timeHorizon: new Set(), sectors: new Set() });
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)]">
        <div className="rounded-b-[36px] bg-gradient-to-b from-[#111111] via-[#3b1b7a] to-[#5b21b6] px-4 pb-12 pt-12">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-6 md:max-w-md">
            <header className="flex items-center justify-between">
              <Skeleton className="h-10 w-10 rounded-full" />
              <Skeleton className="h-10 w-10 rounded-full" />
            </header>
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        </div>
        <div className="mx-auto -mt-10 flex w-full max-w-sm flex-col gap-4 px-4 pb-10 md:max-w-md">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)] text-slate-900">
      {showOpenStrategiesMaintenance && <MaintenanceModal onClose={() => setShowOpenStrategiesMaintenance(false)} />}


      {showBasketsExplainer && (
        <MintBasketsExplainer
          onDone={() => setShowBasketsExplainer(false)}
          tabRef={basketsTabRef}
          onOpenStrategyForCoach={(name) => {
            const target =
              strategies.find(s => (s.short_name || s.name) === name) ??
              strategies.find(s => (s.short_name || s.name || '').toLowerCase().includes('famous')) ??
              strategies[0];
            if (target) setSelectedStrategy(target);
          }}
          onNavigateToFactsheetForCoach={() => {
            const btn = document.querySelector('[data-coach-factsheet-btn="true"]');
            if (btn) btn.click();
          }}
          onCloseStrategyForCoach={() => setSelectedStrategy(null)}
          onNavigateToHome={() => onNavigateToHome?.()}
          onNavigateToInvest={() => onNavigateToInvest?.()}
        />
      )}
      {/* Header */}
      <div className="rounded-b-[36px] bg-gradient-to-b from-[#111111] via-[#3b1b7a] to-[#5b21b6] px-4 pb-6 pt-12 text-white md:px-8">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6 md:max-w-md">
          <header className="flex items-center justify-between text-white">
            {(onBack || childFilter || localChildFilter) ? (
              <button
                type="button"
                onClick={
                  localChildFilter
                    ? () => { setLocalChildFilter(null); setViewMode("openstrategies"); }
                    : onBack || (() => window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "childDashboard" } })))
                }
                aria-label="Back"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            ) : (
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
            )}
            <h1 className="text-sm font-bold tracking-[0.18em] uppercase">{(childFilter || localChildFilter) ? "Child Market" : "Markets"}</h1>
            <div className="flex items-center gap-2">
              <div className="relative" ref={wishlistMenuRef}>
                <button
                  type="button"
                  aria-label="Wishlist"
                  onClick={() => setShowWishlistMenu((v) => !v)}
                  className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur-md"
                >
                  <Bookmark className="h-5 w-5" />
                </button>

                <AnimatePresence>
                  {showWishlistMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-12 z-50 w-44 overflow-hidden rounded-2xl bg-white text-slate-900 shadow-xl ring-1 ring-black/5"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setShowWishlistMenu(false);
                          window.dispatchEvent(new CustomEvent("navigate-within-app", {
                            detail: {
                              page: "giftRegistryDashboard",
                              ...(childData ? { childFamilyMemberId: childData.id } : {}),
                            }
                          }));
                        }}
                        className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Bookmark className="h-4 w-4 text-violet-600" />
                        My Wishlist
                      </button>
                      <div className="h-px bg-slate-100" />
                      <button
                        type="button"
                        onClick={() => {
                          setShowWishlistMenu(false);
                          if (childData) {
                            setShowChildWishlistCreate(true);
                          } else {
                            window.dispatchEvent(new CustomEvent("navigate-within-app", { detail: { page: "giftStrategies", openWishlistCreate: true } }));
                          }
                        }}
                        className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Gift className="h-4 w-4 text-violet-600" />
                        New Wishlist
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <NotificationBell onClick={onOpenNotifications} />
            </div>
          </header>

          {/* Toggle between Mint Baskets and Markets */}
          {viewMode !== "news" && (
            <div className="flex gap-1.5 rounded-2xl bg-black/20 p-1 backdrop-blur-sm ring-1 ring-white/10">
              <button
                ref={basketsTabRef}
                onClick={() => {
                  setViewMode("openstrategies");
                  setActiveChips(buildChipsFromFilters(_savedStrat));
                }}
                className={`flex-1 rounded-xl px-3 py-2.5 text-[10px] font-semibold tracking-[0.18em] uppercase transition-all duration-200 ${
                  viewMode === "openstrategies"
                    ? "bg-white text-slate-900 shadow-[0_2px_8px_rgba(0,0,0,0.18)]"
                    : "text-white/60 hover:text-white/85"
                }`}
              >
                Mint Baskets
              </button>
              <button
                onClick={() => {
                  setViewMode("invest");
                  setActiveChips(buildInvestChips({ sectors: selectedSectors, exchanges: selectedExchanges }));
                }}
                className={`flex-1 rounded-xl px-3 py-2.5 text-[10px] font-semibold tracking-[0.18em] uppercase transition-all duration-200 ${
                  viewMode === "invest"
                    ? "bg-white text-slate-900 shadow-[0_2px_8px_rgba(0,0,0,0.18)]"
                    : "text-white/60 hover:text-white/85"
                }`}
              >
                Markets
              </button>
            </div>
          )}

          {viewMode === "openstrategies" && (
            <div className="flex items-start justify-between gap-3 -mt-2">
              <p className="text-[11px] text-white/70 leading-relaxed flex-1">
                A MINT Basket is a professionally managed selection of assets, built and managed by MINT's investment team. The assets are held directly in your name, not pooled.
              </p>
              <button
                type="button"
                onClick={handleReplayTutorial}
                title="Watch tutorial"
                aria-label="Watch tutorial"
                className="group flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 transition-all"
              >
                <HelpCircle className="h-4 w-4 text-white/70 group-hover:text-white transition-colors" />
              </button>
            </div>
          )}

          {viewMode === "invest" && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-white/70" />
                <input
                  type="text"
                  placeholder="Search by name, symbol, or sector..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-2xl border border-white/20 bg-white/10 py-3 pl-10 pr-4 text-sm text-white placeholder-white/50 focus:border-white/40 focus:bg-white/15 focus:outline-none"
                />
              </div>
            </>
          )}

          {viewMode === "openstrategies" && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-white/70" />
                <input
                  type="text"
                  placeholder="Search strategies..."
                  value={strategiesSearchQuery}
                  onChange={(e) => setStrategiesSearchQuery(e.target.value)}
                  className="w-full rounded-2xl border border-white/20 bg-white/10 py-3 pl-10 pr-4 text-sm text-white placeholder-white/50 focus:border-white/40 focus:bg-white/15 focus:outline-none"
                />
              </div>
            </>
          )}

          {viewMode === "news" && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-white/70" />
                <input
                  type="text"
                  placeholder="Search news..."
                  value={newsSearchQuery}
                  onChange={(e) => setNewsSearchQuery(e.target.value)}
                  className="w-full rounded-2xl border border-white/20 bg-white/10 py-3 pl-10 pr-4 text-sm text-white placeholder-white/50 focus:border-white/40 focus:bg-white/15 focus:outline-none"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto -mt-2 flex w-full max-w-sm flex-col gap-6 px-4 pb-10 md:max-w-md md:px-8">
        {viewMode === "openstrategies" && (
          <>
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  setIsFilterOpen(true);
                  setDraftStrategySort(strategySort);
                  setDraftRisks(new Set(selectedRisks));
                  setDraftMinInvestment(selectedMinInvestment);
                  setDraftExposure(new Set(selectedExposure));
                  setDraftTimeHorizon(new Set(selectedTimeHorizon));
                  setDraftStrategySectors(new Set(selectedStrategySectors));
                }}
                className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 active:scale-95"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
              </button>
              <span className="text-sm font-medium text-slate-500">
                {filteredStrategies.length} {filteredStrategies.length === 1 ? 'strategy' : 'strategies'}
              </span>
            </div>

            {/* Active Filter Chips for OpenStrategies */}
            {(selectedRisks.size > 0 || 
              selectedMinInvestment !== null && selectedMinInvestment !== "Any" || 
              selectedExposure.size > 0 || 
              selectedTimeHorizon.size > 0 || 
              selectedStrategySectors.size > 0) && (
              <div className="flex flex-wrap gap-2">
                {Array.from(selectedRisks).map((risk) => (
                  <button
                    key={risk}
                    onClick={() => {
                      const next = new Set(selectedRisks);
                      next.delete(risk);
                      setSelectedRisks(next);
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-all active:scale-95"
                  >
                    {risk}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                {selectedMinInvestment !== null && selectedMinInvestment !== "Any" && (
                  <button
                    onClick={() => setSelectedMinInvestment("Any")}
                    className="flex items-center gap-1.5 rounded-full bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-all active:scale-95"
                  >
                    {selectedMinInvestment}
                    <X className="h-3 w-3" />
                  </button>
                )}
                {Array.from(selectedExposure).map((exp) => (
                  <button
                    key={exp}
                    onClick={() => {
                      const next = new Set(selectedExposure);
                      next.delete(exp);
                      setSelectedExposure(next);
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-all active:scale-95"
                  >
                    {exp}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                {Array.from(selectedTimeHorizon).map((th) => (
                  <button
                    key={th}
                    onClick={() => {
                      const next = new Set(selectedTimeHorizon);
                      next.delete(th);
                      setSelectedTimeHorizon(next);
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-all active:scale-95"
                  >
                    {th}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                {Array.from(selectedStrategySectors).map((sector) => (
                  <button
                    key={sector}
                    onClick={() => {
                      const next = new Set(selectedStrategySectors);
                      next.delete(sector);
                      setSelectedStrategySectors(next);
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-all active:scale-95"
                  >
                    {sector}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                <button
                  onClick={clearAllStrategyFilters}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all active:scale-95"
                >
                  Clear all
                </button>
              </div>
            )}
          </>
        )}

        {viewMode === "invest" ? (
          <>
            {/* Inline skeleton cards — only shown on genuine first load when no data yet */}
            {loading && securities.length === 0 && (
              <div className="flex flex-col gap-6">
                {/* Horizontal sparkline card skeleton */}
                <div>
                  <Skeleton className="mb-3 h-5 w-36 rounded-lg" />
                  <div className="flex gap-3 overflow-x-hidden">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-32 w-44 flex-shrink-0 rounded-2xl" />
                    ))}
                  </div>
                </div>
                {/* List card skeletons */}
                <div>
                  <Skeleton className="mb-3 h-5 w-28 rounded-lg" />
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <Skeleton key={i} className="h-20 w-full rounded-3xl" />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Filter bar + sections — hidden while skeleton is showing */}
            {!(loading && securities.length === 0) && <>
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  setIsFilterOpen(true);
                  setDraftSort(selectedSort);
                  setDraftSectors(new Set(selectedSectors));
                  setDraftExchanges(new Set(selectedExchanges));
                }}
                className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm transition-all active:scale-95"
              >
                <SlidersHorizontal className="h-4 w-4 text-slate-600" />
                <span className="text-sm font-semibold text-slate-700">Filter & Sort</span>
              </button>
              <span className="text-sm font-medium text-slate-500">
                {filteredSecurities.length} stocks
              </span>
            </div>

            {/* Active Filter Chips */}
            {activeChips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {activeChips.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => removeChip(chip)}
                    className="flex items-center gap-1.5 rounded-full bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-all active:scale-95"
                  >
                    {chip}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                <button
                  onClick={clearAllFilters}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all active:scale-95"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Grouped Sections - only show when NOT searching */}
            {!searchQuery && (
              <>
                <CollapsibleSection
                  title="My Watch List"
                  securities={watchedSecurities}
                  onOpenStockDetail={setSelectedSecurity}
                  onToggleWatchlist={toggleWatchlist}
                  onToggleWishlist={toggleWishlistItem}
                  watchlist={watchlist}
                  wishlistedKeys={wishlistedKeys}
                  sparklineData={sparklineData}
                  isExpanded={expandedSections.has("watchlist")}
                  sectionRef={secRefWatchlist}
                />

                <CollapsibleSection
                  title="Largest companies"
                  securities={largestCompanies}
                  onOpenStockDetail={setSelectedSecurity}
                  onToggleWatchlist={toggleWatchlist}
                  onToggleWishlist={toggleWishlistItem}
                  watchlist={watchlist}
                  wishlistedKeys={wishlistedKeys}
                  sparklineData={sparklineData}
                  isExpanded={expandedSections.has("largest")}
                  sectionRef={secRefLargest}
                />

                <CollapsibleSection
                  title="Highest dividend yield"
                  securities={highestDividendYield}
                  onOpenStockDetail={setSelectedSecurity}
                  onToggleWatchlist={toggleWatchlist}
                  onToggleWishlist={toggleWishlistItem}
                  watchlist={watchlist}
                  wishlistedKeys={wishlistedKeys}
                  sparklineData={sparklineData}
                  isExpanded={expandedSections.has("dividend")}
                  sectionRef={secRefDividend}
                />

                <CollapsibleSection
                  title="Gainers"
                  securities={gainers}
                  onOpenStockDetail={setSelectedSecurity}
                  onToggleWatchlist={toggleWatchlist}
                  onToggleWishlist={toggleWishlistItem}
                  watchlist={watchlist}
                  wishlistedKeys={wishlistedKeys}
                  sparklineData={sparklineData}
                  isExpanded={expandedSections.has("gainers")}
                  sectionRef={secRefGainers}
                />

            {/* All Section */}
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">All</h2>
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </div>
              <div className="space-y-3">
                {filteredSecurities.map((security) => (
                  <button
                    key={security.id}
                    onClick={() => setSelectedSecurity(security)}
                    className="relative w-full rounded-3xl border border-slate-100/80 bg-white/90 backdrop-blur-sm p-4 text-left shadow-[0_2px_16px_-2px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.12)] active:scale-[0.97]"
                  >
                    <div className="flex items-start gap-3">
                      {security.logo_url ? (
                        <img
                          src={security.logo_url}
                          alt={security.symbol}
                          className="h-12 w-12 rounded-full border border-slate-100 object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-purple-600 text-sm font-bold text-white">
                          {security.symbol?.substring(0, 2) || "—"}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">
                              {security.short_name || security.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {security.symbol} · {security.exchange}
                            </p>
                          </div>
                          <div className="text-right">
                            {security.currentPrice != null ? (
                              <>
                                <p className="text-sm font-semibold text-slate-900">
                                  <span className="text-xs text-slate-400 font-normal">{getDisplayCurrency(security)}</span>{' '}
                                  {formatPrice(security)}
                                </p>
                                {security.changePct != null && (
                                  <p className={`text-xs font-semibold ${
                                    security.changePct >= 0 ? 'text-emerald-600' : 'text-red-600'
                                  }`}>
                                    {security.changePct >= 0 ? '+' : ''}{security.changePct.toFixed(2)}%
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-xs text-slate-500">No pricing data</p>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          {security.sector && (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">
                              {security.sector}
                            </span>
                          )}
                          {security.pe && (
                            <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700">
                              P/E {Number(security.pe).toFixed(2)}
                            </span>
                          )}
                          {security.returns?.ytd != null && (
                            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                              security.returns.ytd >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                            }`}>
                              YTD {formatChangePct(security.returns.ytd)}
                            </span>
                          )}
                        </div>

                        {/* Bookmark + Heart — bottom-right */}
                        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 z-10">
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWatchlist(e, security.symbol); }}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 shadow-sm active:scale-90 transition-transform"
                          >
                            <Bookmark className={`h-5 w-5 ${watchlist.includes(security.symbol) ? "fill-yellow-400 text-yellow-400" : "text-slate-400"}`} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWishlistItem(e, security.symbol); }}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 shadow-sm active:scale-90 transition-transform"
                          >
                            <Heart className={`h-5 w-5 ${wishlistedKeys.has(security.symbol) ? "fill-red-500 text-red-500" : "text-slate-400"}`} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
              </>
            )}
            </>}

            {/* All Securities List */}
            {searchQuery && (
              <section>
                <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Search results</h2>
                {filteredSecurities.length === 0 ? (
                  <div className="rounded-3xl bg-white px-6 py-12 text-center shadow-md">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                      <Search className="h-8 w-8 text-slate-400" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">No securities found</p>
                    <p className="mt-1 text-xs text-slate-400">Try adjusting your search or filter</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredSecurities.map((security) => (
                      <button
                        key={security.id}
                        onClick={() => setSelectedSecurity(security)}
                        className="relative w-full rounded-3xl border border-slate-100/80 bg-white/90 backdrop-blur-sm p-4 text-left shadow-[0_2px_16px_-2px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.12)] active:scale-[0.97]"
                      >
                        <div className="flex items-start gap-3">
                          {security.logo_url ? (
                            <img
                              src={security.logo_url}
                              alt={security.symbol}
                              className="h-12 w-12 rounded-full border border-slate-100 object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-purple-600 text-sm font-bold text-white">
                              {security.symbol?.substring(0, 2) || "—"}
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">
                                  {security.short_name || security.name}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {security.symbol} · {security.exchange}
                                </p>
                              </div>
                              <div className="text-right">
                                {security.currentPrice != null ? (
                                  <>
                                    <p className="text-sm font-semibold text-slate-900">
                                      <span className="text-xs text-slate-400 font-normal">{getDisplayCurrency(security)}</span>{' '}
                                      {formatPrice(security)}
                                    </p>
                                    {security.changePct != null && (
                                      <p className={`text-xs font-semibold ${
                                        security.changePct >= 0 ? 'text-emerald-600' : 'text-red-600'
                                      }`}>
                                        {security.changePct >= 0 ? '+' : ''}{security.changePct.toFixed(2)}%
                                      </p>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-xs text-slate-400">—</p>
                                )}
                              </div>
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                              {security.sector && (
                                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">
                                  {security.sector}
                                </span>
                              )}
                              {security.pe && (
                                <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700">
                                  P/E {Number(security.pe).toFixed(2)}
                                </span>
                              )}
                            </div>

                            {/* Bookmark + Heart — bottom-right */}
                            <div className="absolute bottom-3 right-3 flex items-center gap-1.5 z-10">
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWatchlist(e, security.symbol); }}
                                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 shadow-sm active:scale-90 transition-transform"
                              >
                                <Bookmark className={`h-5 w-5 ${watchlist.includes(security.symbol) ? "fill-yellow-400 text-yellow-400" : "text-slate-400"}`} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWishlistItem(e, security.symbol); }}
                                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 shadow-sm active:scale-90 transition-transform"
                              >
                                <Heart className={`h-5 w-5 ${wishlistedKeys.has(security.symbol) ? "fill-red-500 text-red-500" : "text-slate-400"}`} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        ) : viewMode === "openstrategies" ? (
          /* OpenStrategies View */
          <>
            {publicStrategiesLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-64 w-full rounded-2xl" />
                <Skeleton className="h-64 w-full rounded-2xl" />
              </div>
            ) : filteredStrategies.length === 0 ? (
              <div className="rounded-3xl bg-white px-6 py-12 text-center shadow-md">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                  <Search className="h-8 w-8 text-slate-400" />
                </div>
                <p className="text-sm font-semibold text-slate-700">No strategies available</p>
                <p className="mt-1 text-xs text-slate-400">Check back soon for new investment strategies</p>
              </div>
            ) : (
              <>
              {/* Strategies grouped by sector. Order priority:
                  1) CRM-set category order (app_settings 'category_order') when present;
                  2) else a sensible default (Equities first, ETFs last);
                  3) else natural order. CRM-numbered categories always sort ahead of
                  un-numbered ones, so the CRM control wins whenever it's used. */}
              {[
                ...(strategyWatchlist.length > 0 ? ['__WATCHLIST__'] : []),
                ...[...new Set(filteredStrategies.map(s => s.sector || 'General'))]
                  .sort((a, b) => {
                    const DEFAULTS = { 'Equities': 0, 'Fixed Income': 1, 'General': 2, 'ETFs': 3 };
                    const rank = (s) => {
                      const crm = Number(categoryOrder[s]);
                      if (Number.isFinite(crm)) return crm;               // CRM-set: use directly
                      const d = DEFAULTS[s];                              // else fallback default,
                      return (d != null ? d : 50) + 1000;                // pushed after CRM-numbered
                    };
                    return rank(a) - rank(b);
                  }),
              ]
                .map((sector) => {
                const sectorStrategies = (sector === '__WATCHLIST__'
                  ? filteredStrategies.filter(s => strategyWatchlist.includes(s.id))
                  : filteredStrategies.filter(s => (s.sector || 'General') === sector)
                ).slice().sort((a, b) => {
                  // Sort by YTD performance highest → lowest within each category.
                  // Null/undefined YTD values fall to the end.
                  const ytdA = a.r_ytd ?? null;
                  const ytdB = b.r_ytd ?? null;
                  if (ytdA === null && ytdB === null) return 0;
                  if (ytdA === null) return 1;
                  if (ytdB === null) return -1;
                  return ytdB - ytdA;
                });
                
                if (sectorStrategies.length === 0) return null;
              
              return (
                <section key={sector}>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{sector === '__WATCHLIST__' ? 'Watchlist' : (sector === 'General' ? (childFilter ? 'Child Friendly' : 'Strategies') : sector)}</h2>
                    {/* Show how many baskets are in this category instead of a chevron. */}
                    <span className="text-[11px] font-semibold tabular-nums text-slate-400">({sectorStrategies.length})</span>
                  </div>
                  <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 scrollbar-hide">
                    {sectorStrategies.map((strategy) => {
                      // Use short_name if available, otherwise use name
                      const displayName = strategy.short_name || strategy.name;
                      
                      // Truncate description to 110-140 chars
                      const truncatedDescription = strategy.description 
                        ? strategy.description.length > 140
                          ? strategy.description.substring(0, 137) + '...'
                          : strategy.description
                        : '';
                      
                      const calcMin = calculateMinInvestmentSync(strategy, holdingsBySymbol);
                      const formattedMinInvestment = calcMin ? `Min. ${formatCurrency(calcMin * 1.08, "R")}` : null;
                      
                      const sparkline = [20, 22, 21, 24, 26, 25, 28, 30, 29, 32];
                      
                      const holdingsSnapshot = getStrategyHoldingsSnapshot(strategy, holdingsBySymbol);
                      
                      return (
                      <button
                        key={strategy.id}
                        type="button"
                        onClick={() => {
                          setSelectedStrategy({ ...strategy, slug: strategy.slug });
                          if (childFilter) setShowChildInvestModal(true);
                        }}
                        data-coach-target={displayName?.toLowerCase().includes('famous') ? 'true' : undefined}
                        data-coach-first={sectorStrategies[0]?.id === strategy.id ? 'true' : undefined}
                        data-coach-name={displayName}
                        data-coach-desc={truncatedDescription || ''}
                        className="relative flex-shrink-0 w-80 rounded-2xl border border-slate-100 bg-white shadow-sm hover:shadow-md hover:border-slate-200 p-4 transition-all snap-center"
                      >
                        {/* Bookmark + Heart icons — bottom-right */}
                        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 z-10">
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleStrategyWatchlist(e, strategy.id); }}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm active:scale-90 transition-transform"
                          >
                            <Bookmark className={`h-5 w-5 ${strategyWatchlist.includes(strategy.id) ? "fill-yellow-400 text-yellow-400" : "text-slate-400"}`} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWishlistItem(e, `strategy:${strategy.id}`); }}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm active:scale-90 transition-transform"
                          >
                            <Heart className={`h-5 w-5 ${wishlistedKeys.has(`strategy:${strategy.id}`) ? "fill-red-500 text-red-500" : "text-slate-400"}`} />
                          </button>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 flex items-start justify-between gap-4">
                            <div className="text-left space-y-1 pr-16">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">{displayName}</p>
                              <div>
                                <p className="text-xs text-slate-600 line-clamp-1">
                                  {strategy.risk_level || 'Balanced'} {strategy.objective && `• ${strategy.objective}`}
                                </p>
                                <p className="text-[11px] text-slate-400 line-clamp-1">
                                  {holdingsBySymbol.size === 0
                                    ? <span className="inline-block h-2.5 w-20 rounded-full bg-slate-200 animate-pulse align-middle" />
                                    : formattedMinInvestment}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center rounded-xl bg-slate-50 px-2">
                              <StrategyMiniChart values={sparkline} />
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {(strategy.tags && strategy.tags.length > 0 ? strategy.tags.slice(0, 2) : [strategy.risk_level || 'Balanced']).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 uppercase"
                            >
                              {tag}
                            </span>
                          ))}
                          {strategy.is_featured && (
                            <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-600 uppercase">
                              Featured
                            </span>
                          )}
                        </div>

                        <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                          <span className="text-xs font-semibold text-slate-600">YTD return</span>
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-xs font-semibold ${getChangeColor(strategy.r_ytd)}`}>
                              {formatChangePct(strategy.r_ytd)}
                            </span>
                            {strategy.ytd_as_of_date && (
                              <span className="text-[10px] text-slate-500">
                                {new Date(strategy.ytd_as_of_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        </div>

                        {holdingsSnapshot.length > 0 && (
                          <div className="mt-3 flex items-center gap-3">
                            <div className="flex -space-x-2">
                              {holdingsSnapshot.slice(0, 3).map((holding) => (
                                <div
                                  key={`${displayName}-${holding.id || holding.symbol}-snapshot`}
                                  className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow-sm"
                                >
                                  {holding.logo_url ? (
                                    <img
                                      src={holding.logo_url}
                                      alt={holding.name}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">
                                      {holding.symbol?.substring(0, 2)}
                                    </div>
                                  )}
                                </div>
                              ))}
                              {holdingsSnapshot.length > 3 ? (
                                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-500">
                                  +{Math.max(0, holdingsSnapshot.length - 3)}
                                </div>
                              ) : null}
                            </div>
                            <span className="text-xs font-semibold text-slate-500">Holdings snapshot</span>
                          </div>
                        )}
                      </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
              </>
            )}
          </>
        ) : (
          /* News View */
          <div className="space-y-3">
            {filteredNews.length === 0 ? (
              <div className="rounded-3xl bg-white px-6 py-16 text-center shadow-md">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100">
                  <TrendingUp className="h-10 w-10 text-slate-400" />
                </div>
                <p className="text-sm font-semibold text-slate-700">No news articles available</p>
                <p className="mt-2 text-xs text-slate-400">
                  Stay tuned for the latest market updates and insights
                </p>
              </div>
            ) : (
              <>
                {paginatedNews.map((article) => {
                  const publishedDate = new Date(article.published_at);
                  const now = new Date();
                  const diffInHours = Math.floor((now - publishedDate) / (1000 * 60 * 60));
                  let timeText;
                  
                  if (diffInHours < 1) {
                    const diffInMinutes = Math.floor((now - publishedDate) / (1000 * 60));
                    timeText = diffInMinutes <= 1 ? "Just now" : `${diffInMinutes}m ago`;
                  } else if (diffInHours < 24) {
                    timeText = `${diffInHours}h ago`;
                  } else {
                    const diffInDays = Math.floor(diffInHours / 24);
                    timeText = diffInDays === 1 ? "Yesterday" : `${diffInDays}d ago`;
                  }

                  return (
                    <button
                      key={article.id}
                      onClick={() => onOpenNewsArticle(article.id)}
                      className="w-full rounded-3xl bg-white p-5 shadow-md transition-all active:scale-[0.98] text-left"
                    >
                      <h3 className="text-sm font-semibold text-slate-900 line-clamp-2">
                        {article.title}
                      </h3>
                      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1.5">
                          <img
                            src="/assets/mint-logo.svg"
                            alt="Mint"
                            className="h-3.5 w-3.5"
                          />
                          <span className="font-medium">Mint News</span>
                        </span>
                        <span>•</span>
                        <span>{timeText}</span>
                      </div>
                    </button>
                  );
                })}
                
                {/* Pagination Controls */}
                {totalNewsPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-4">
                    <button
                      onClick={() => setNewsPage(p => Math.max(1, p - 1))}
                      disabled={newsPage === 1}
                      className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-slate-600">
                      Page {newsPage} of {totalNewsPages}
                    </span>
                    <button
                      onClick={() => setNewsPage(p => Math.min(totalNewsPages, p + 1))}
                      disabled={newsPage === totalNewsPages}
                      className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Strategy Preview Modal — hidden in child mode (child uses its own modal below) */}
      {portalTarget && !childFilter && createPortal(
        <AnimatePresence>
          {selectedStrategy && (
            <>
              {/* Backdrop */}
              <motion.div
                key="preview-backdrop"
                className="fixed inset-0"
                style={{ zIndex: 9998, background: "rgba(15,10,30,0.65)", pointerEvents: showBasketsExplainer ? "none" : undefined }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => { if (showBasketsExplainer) return; setSelectedStrategy(null); }}
              />
              {/* Sheet */}
              <motion.div
                key="preview-sheet"
                className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl"
                style={{ zIndex: 9999, maxHeight: "92dvh", pointerEvents: showBasketsExplainer ? "none" : undefined }}
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
                  <div>
                    <h2 className="text-[15px] font-bold text-slate-900">{selectedStrategy.name}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {(() => {
                        const _m = calculateMinInvestmentSync(selectedStrategy, holdingsBySymbol);
                        if (_m) return `Min. ${formatCurrency(_m * 1.08, "R")}`;
                        if (holdingsBySymbol.size === 0) return <span className="inline-block h-2.5 w-24 rounded-full bg-slate-200 animate-pulse align-middle" />;
                        return "Calculating...";
                      })()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedStrategy(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-6"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  <div className="flex items-center gap-3 mb-6">
                {(() => {
                  const minInvest = calculateMinInvestmentSync(selectedStrategy, holdingsBySymbol);
                  if (minInvest) return (
                    <>
                      <p className="text-2xl font-semibold text-slate-900">
                        {formatCurrency(minInvest * 1.08, selectedStrategy.currency || 'R')}
                      </p>
                      <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-500">
                        Min. investment
                      </span>
                    </>
                  );
                  if (holdingsBySymbol.size === 0) return (
                    <div className="flex items-center gap-3">
                      <span className="inline-block h-7 w-28 rounded-xl bg-slate-200 animate-pulse" />
                      <span className="inline-block h-6 w-24 rounded-full bg-slate-100 animate-pulse" />
                    </div>
                  );
                  if (selectedStrategy.last_close !== null && selectedStrategy.last_close !== undefined) return (
                    <>
                      <p className="text-2xl font-semibold text-slate-900">
                        {formatCurrency(Math.max(selectedStrategy.last_close, MIN_ASSET_VALUE_DISPLAY), selectedStrategy.currency || 'R')}
                      </p>
                      <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-500">
                        Min. investment
                      </span>
                    </>
                  );
                  return null;
                })()}
              </div>

              <div className="mb-5">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>YTD return</span>
                  <div className="flex flex-col items-end gap-1">
                    <span className={selectedStrategy?.r_ytd > 0 ? "text-emerald-600" : selectedStrategy?.r_ytd < 0 ? "text-rose-600" : "text-slate-500"}>
                      {selectedStrategy?.r_ytd != null ? `${selectedStrategy.r_ytd >= 0 ? "+" : ""}${(selectedStrategy.r_ytd * 100).toFixed(2)}%` : "—"}
                    </span>
                    {selectedStrategy?.ytd_as_of_date && (
                      <span className="text-[10px] text-slate-400">
                        {new Date(selectedStrategy.ytd_as_of_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-44 w-full">
                  {selectedStrategyAnalyticsLoading ? (
                    <div className="flex h-full items-end gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
                      {[45, 65, 35, 80, 55, 70, 40, 90, 60, 50, 75, 85].map((h, i) => (
                        <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
                      ))}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={previewChartData}
                        margin={{ top: 12, right: 16, left: 8, bottom: 28 }}
                        onMouseMove={(state) => {
                          if (state?.activeLabel) {
                            setSelectedStrategyActiveLabel(state.activeLabel);
                          }
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
                                if (!previewBaseIndexValue) {
                                  return [`${Number(value).toFixed(2)}`, "Index"];
                                }
                                const delta = ((Number(value) - previewBaseIndexValue) / previewBaseIndexValue) * 100;
                                return [`${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%`, "Change"];
                              }}
                              cursor={{ strokeDasharray: "3 3" }}
                            />
                          </>
                        ) : null}
                        <XAxis
                          dataKey="dateLabel"
                          tick={false}
                          axisLine={false}
                          tickLine={false}
                          height={0}
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
                {(selectedStrategy.tags || [selectedStrategy.risk_level || 'Balanced']).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {selectedStrategy.holdings && selectedStrategy.holdings.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Top Holdings</p>
                <div className="mt-3 space-y-2">
                  {selectedStrategy.holdings.slice(0, 5).map((holdingItem) => {
                    const ticker = typeof holdingItem === 'string' ? holdingItem : (holdingItem.ticker || holdingItem.symbol);
                    const holding = holdingsSecurities.find(s => s.symbol === ticker);
                    return (
                      <div key={ticker} className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-white">
                          {holding?.logo_url ? (
                            <img src={holding.logo_url} alt={ticker} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-slate-100 text-xs font-bold text-slate-600">
                              {ticker?.substring(0, 2)}
                            </div>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-slate-900">{holding?.name || ticker}</p>
                          <p className="text-xs text-slate-500">{ticker}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

              <div className="mt-6 flex flex-col gap-2">
                <button
                  onClick={() => {
                    if (showBasketsExplainer) return;
                    const hArr = getHoldingsArray(selectedStrategy);
                    const enrichedHoldings = hArr.map(h => {
                      const sym = h.ticker || h.symbol || h;
                      const sec = holdingsBySymbol.get(sym) || holdingsBySymbol.get(normalizeSymbol(sym));
                      return { ...h, logo_url: sec?.logo_url || null, shares: getAdjustedShares(h, holdingsBySymbol) };
                    });
                    const enrichedStrategy = { ...selectedStrategy, calculatedMinInvestment: calculateMinInvestmentSync(selectedStrategy, holdingsBySymbol), holdingsWithLogos: enrichedHoldings };
                    setSelectedStrategy(null);
                    setTimeout(() => onInvestNow?.(enrichedStrategy), 220);
                  }}
                  data-coach-invest-btn="true"
                  className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-4 font-semibold text-white shadow-lg transition-all active:scale-95"
                >
                  Invest Now
                </button>
                <button
                  onClick={() => {
                    if (showBasketsExplainer) return;
                    setSelectedStrategy(null);
                    const hArr = getHoldingsArray(selectedStrategy);
                    const enrichedHoldings = hArr.map(h => {
                      const sym = h.ticker || h.symbol || h;
                      const sec = holdingsBySymbol.get(sym) || holdingsBySymbol.get(normalizeSymbol(sym));
                      return { ...h, logo_url: sec?.logo_url || null, shares: getAdjustedShares(h, holdingsBySymbol) };
                    });
                    onOpenFactsheet({ ...selectedStrategy, calculatedMinInvestment: calculateMinInvestmentSync(selectedStrategy, holdingsBySymbol), holdingsWithLogos: enrichedHoldings });
                  }}
                  data-coach-factsheet-btn="true"
                  className="w-full rounded-2xl border border-slate-200 bg-white py-4 font-semibold text-slate-700 transition-all active:scale-95"
                >
                  View Factsheet
                </button>
              </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      , portalTarget)}

      {/* Security Preview Sheet — shown when a single security is tapped in Markets/Invest view */}
      {portalTarget && createPortal(
        <AnimatePresence>
          {selectedSecurity && (
            <>
              {/* Backdrop */}
              <motion.div
                key="sec-preview-backdrop"
                className="fixed inset-0"
                style={{ zIndex: 9998, background: "rgba(15,10,30,0.65)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSelectedSecurity(null)}
              />
              {/* Sheet */}
              <motion.div
                key="sec-preview-sheet"
                className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl"
                style={{ zIndex: 9999, maxHeight: "92dvh" }}
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
                  <div className="flex items-center gap-3">
                    {selectedSecurity.logo_url ? (
                      <img src={selectedSecurity.logo_url} alt={selectedSecurity.symbol} className="h-10 w-10 rounded-full border border-slate-100 object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-purple-600 text-sm font-bold text-white">
                        {selectedSecurity.symbol?.substring(0, 2) || "—"}
                      </div>
                    )}
                    <div>
                      <h2 className="text-[15px] font-bold text-slate-900">{selectedSecurity.short_name || selectedSecurity.name}</h2>
                      <p className="text-xs text-slate-400 mt-0.5">{selectedSecurity.symbol} · {selectedSecurity.exchange}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedSecurity(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-6"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  {/* Price block */}
                  <div className="flex items-center gap-3 mb-6">
                    {selectedSecurity.currentPrice != null ? (
                      <>
                        <p className="text-2xl font-semibold text-slate-900">
                          <span className="text-sm font-normal text-slate-400 mr-1">{getDisplayCurrency(selectedSecurity)}</span>
                          {formatPrice(selectedSecurity)}
                        </p>
                        {selectedSecurity.changePct != null && (
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            selectedSecurity.changePct >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                          }`}>
                            {selectedSecurity.changePct >= 0 ? "+" : ""}{selectedSecurity.changePct.toFixed(2)}%
                          </span>
                        )}
                      </>
                    ) : (
                      <p className="text-2xl font-semibold text-slate-400">—</p>
                    )}
                  </div>

                  {/* Sparkline chart */}
                  {(() => {
                    const points = sparklineData[selectedSecurity.symbol];
                    if (!points || points.length < 2) return null;
                    const chartData = points.map((v, i) => ({ i, v }));
                    const isPositive = (selectedSecurity.changePct ?? 0) >= 0;
                    const lineColor = isPositive ? "#10b981" : "#ef4444";
                    const gradId = `sec-preview-grad-${selectedSecurity.symbol}`;
                    return (
                      <div className="mb-5">
                        <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
                          <span>Price trend</span>
                          {selectedSecurity.returns?.ytd != null && (
                            <span className={selectedSecurity.returns.ytd >= 0 ? "text-emerald-600" : "text-rose-600"}>
                              YTD {selectedSecurity.returns.ytd >= 0 ? "+" : ""}{(selectedSecurity.returns.ytd * 100).toFixed(2)}%
                            </span>
                          )}
                        </div>
                        <div className="h-44 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
                              <defs>
                                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                                  <stop offset="70%" stopColor={lineColor} stopOpacity={0.1} />
                                  <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <XAxis dataKey="i" hide />
                              <YAxis hide domain={["auto", "auto"]} />
                              <Area type="monotone" dataKey="v" stroke="transparent" fill={`url(#${gradId})`} dot={false} />
                              <Line type="monotone" dataKey="v" stroke={lineColor} strokeWidth={2} dot={false} activeDot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Tags */}
                  <div className="flex flex-wrap gap-2 mb-6">
                    {selectedSecurity.sector && (
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
                        {selectedSecurity.sector}
                      </span>
                    )}
                    {selectedSecurity.exchange && (
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
                        {selectedSecurity.exchange}
                      </span>
                    )}
                    {selectedSecurity.pe && (
                      <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                        P/E {Number(selectedSecurity.pe).toFixed(2)}
                      </span>
                    )}
                    {selectedSecurity.returns?.ytd != null && (
                      <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                        selectedSecurity.returns.ytd >= 0
                          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                          : "border-red-100 bg-red-50 text-red-700"
                      }`}>
                        YTD {formatChangePct(selectedSecurity.returns.ytd)}
                      </span>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="mt-6 flex flex-col gap-2">
                    <button
                      onClick={() => {
                        if (onboardingLoading) return;
                        const sec = selectedSecurity;
                        setSelectedSecurity(null);
                        if (!onboardingComplete) {
                          setInvestingSecurity(sec);
                          setTimeout(() => setShowSecurityOnboardingModal(true), 220);
                          return;
                        }
                        setInvestingSecurity(sec);
                        setSecurityBuyShares(Math.max(1, Math.ceil(200 / (() => {
                          const c = sec?.currency || "R";
                          const p = Number(sec?.currentPrice ?? 0);
                          return c.toUpperCase() === "ZAC" ? p / 100 : p;
                        })())));
                        setTimeout(() => setShowSecurityBuySheet(true), 220);
                      }}
                      className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-4 font-semibold text-white shadow-lg transition-all active:scale-95"
                    >
                      Invest Now
                    </button>
                    <button
                      onClick={() => {
                        const sec = selectedSecurity;
                        setSelectedSecurity(null);
                        onOpenStockDetail(sec);
                      }}
                      className="w-full rounded-2xl border border-slate-200 bg-white py-4 font-semibold text-slate-700 transition-all active:scale-95"
                    >
                      View Factsheet
                    </button>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      , portalTarget)}

      {/* ── Security Buy Sheet ────────────────────────────────────────────── */}
      {portalTarget && createPortal(
        <AnimatePresence>
          {showSecurityBuySheet && investingSecurity && (
            <>
              {/* Backdrop */}
              <motion.div
                key="sec-buy-backdrop"
                className="fixed inset-0"
                style={{ zIndex: 9998, background: "rgba(15,10,30,0.65)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setShowSecurityBuySheet(false)}
              />
              {/* Sheet */}
              <motion.div
                key="sec-buy-sheet"
                className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl"
                style={{ zIndex: 9999, maxHeight: "92dvh", paddingBottom: "env(safe-area-inset-bottom)" }}
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
                  <div>
                    <h2 className="text-[15px] font-bold text-slate-900 leading-tight">Complete Investment</h2>
                    <p className="text-[11px] text-slate-400 mt-0.5">{investingSecurity.short_name || investingSecurity.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSecurityBuySheet(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-6"
                  style={{ WebkitOverflowScrolling: "touch" }}
                >
                  {/* Security card */}
                  <div className="mb-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-slate-100 bg-slate-50 overflow-hidden">
                        {investingSecurity.logo_url ? (
                          <img src={investingSecurity.logo_url} alt={investingSecurity.symbol} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-sm font-bold text-slate-500 uppercase">{investingSecurity.symbol?.slice(0, 2) || "—"}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-semibold text-slate-900 leading-tight">{investingSecurity.short_name || investingSecurity.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {investingSecurity.symbol}{investingSecurity.exchange ? ` · ${investingSecurity.exchange}` : ""}
                        </p>
                        {securityPriceValue > 0 && (
                          <p className="text-xs font-semibold text-slate-600 mt-1">
                            Price per share: <span className="text-slate-900">{fmtSecAmt(securityPriceValue)}</span>
                          </p>
                        )}
                      </div>
                      {investingSecurity.changePct != null && (
                        <span className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded-full ${investingSecurity.changePct >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                          {investingSecurity.changePct >= 0 ? "+" : ""}{Number(investingSecurity.changePct).toFixed(2)}%
                        </span>
                      )}
                    </div>
                    {investingSecurity.sector && (
                      <div className="pt-3 border-t border-slate-100">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-600">
                          {investingSecurity.sector}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Stat chips */}
                  <div className="flex gap-3 mb-4">
                    <div className="flex-1 rounded-2xl p-3.5 border border-slate-100" style={{ background: "linear-gradient(135deg,#f5f3ff,#ede9fe)" }}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Wallet className="h-3 w-3 text-purple-400" />
                        <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wide">My Balance</p>
                      </div>
                      <p className="text-base font-bold text-purple-900 tabular-nums">
                        {securityBuyWalletBalance === null ? "…" : fmtSecAmt(securityBuyWalletBalance)}
                      </p>
                    </div>
                    <div className="flex-1 rounded-2xl p-3.5 border border-slate-100 bg-white">
                      <div className="flex items-center gap-1.5 mb-1">
                        <BarChart3 className="h-3 w-3 text-indigo-400" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Price / Share</p>
                      </div>
                      <p className="text-base font-bold text-slate-900 tabular-nums">
                        {securityPriceValue > 0 ? fmtSecAmt(securityPriceValue) : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Shares stepper */}
                  <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-5 mb-4">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center mb-4">Number of Shares</p>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setSecurityBuyShares(s => Math.max(securityMinShares, (s || 1) - 1))}
                        className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 text-xl font-semibold transition active:scale-90 shadow-sm"
                      >
                        −
                      </button>
                      <div className="text-center flex-1">
                        <p className="text-4xl font-black text-slate-900 tabular-nums tracking-tight">{securityBuyShares}</p>
                        <p className="text-xs text-slate-400 mt-1">Total: {fmtSecAmt(securityBuyTotal)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSecurityBuyShares(s => (s || 1) + 1)}
                        className="flex h-11 w-11 items-center justify-center rounded-2xl text-white text-xl font-semibold shadow-md transition active:scale-90"
                        style={{ background: "linear-gradient(135deg,#6366f1,#7c3aed)" }}
                      >
                        +
                      </button>
                    </div>
                    {securityBuyIsInvalid && securityPriceValue > 0 && (
                      <p className="mt-3 text-center text-xs text-red-500">
                        Min. {securityMinShares} share{securityMinShares !== 1 ? "s" : ""} required (R200 minimum)
                      </p>
                    )}
                  </div>

                  {/* Agreement checkbox */}
                  <motion.div
                    className={`mb-4 rounded-2xl border p-4 shadow-sm ${securityBuyAgreementError && !securityBuyAgreementChecked ? "border-red-300 bg-red-50" : "border-slate-100 bg-white"}`}
                    animate={securityBuyShakeAgreement ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
                    transition={{ duration: 0.45, ease: "easeInOut" }}
                  >
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={securityBuyAgreementChecked}
                        onChange={e => { setSecurityBuyAgreementChecked(e.target.checked); if (e.target.checked) setSecurityBuyAgreementError(false); }}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 flex-shrink-0"
                      />
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-slate-900">
                          I agree to Risk Disclosure, Fee Schedule &{" "}
                          <button
                            type="button"
                            onClick={e => { e.preventDefault(); setSecurityBuyShowMandateModal(true); }}
                            className="underline text-violet-700 hover:text-violet-900"
                          >
                            Strategy Mandate
                          </button>
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          By continuing, you confirm you have reviewed and agree to all terms and conditions
                        </p>
                      </div>
                    </label>
                    {securityBuyAgreementError && !securityBuyAgreementChecked && (
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-red-500">
                        <AlertCircle size={11} />Please tick this box before investing
                      </p>
                    )}
                  </motion.div>

                  {/* Invest button */}
                  <button
                    type="button"
                    disabled={securityBuyIsInvalid}
                    onClick={() => {
                      if (!securityBuyAgreementChecked) {
                        setSecurityBuyAgreementError(true);
                        setSecurityBuyShakeAgreement(true);
                        setTimeout(() => setSecurityBuyShakeAgreement(false), 500);
                        return;
                      }
                      if (securityBuyIsInvalid) return;
                      setPendingSecurityCheckout({
                        security: investingSecurity,
                        amount: securityBuyFees.total,
                        baseAmount: securityBuyTotal,
                        shareCount: securityValidShares,
                      });
                      setShowSecurityBuySheet(false);
                      setTimeout(() => setShowSecurityGoalModal(true), 320);
                    }}
                    className={`w-full rounded-2xl py-4 font-semibold text-white shadow-lg transition-all active:scale-95 ${
                      securityBuyIsInvalid
                        ? "cursor-not-allowed bg-slate-300"
                        : "bg-gradient-to-r from-[#5b21b6] to-[#7c3aed]"
                    }`}
                  >
                    Invest
                  </button>
                </div>

                {/* Strategy Mandate PDF overlay */}
                <AnimatePresence>
                  {securityBuyShowMandateModal && (
                    <motion.div
                      key="sec-mandate-overlay"
                      className="fixed inset-0 flex flex-col bg-white"
                      style={{ zIndex: 10000 }}
                      initial={{ y: "100%" }}
                      animate={{ y: 0 }}
                      exit={{ y: "100%" }}
                      transition={{ type: "spring", damping: 30, stiffness: 300 }}
                    >
                      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setSecurityBuyShowMandateModal(false)}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                        <h2 className="text-sm font-semibold text-slate-900">Risk Disclosure</h2>
                        <a
                          href="/strategy-disclosures.pdf"
                          download="Risk-Disclosure.pdf"
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <PdfViewer file="/strategy-disclosures.pdf" style={{ height: "100%" }} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      , portalTarget)}

      {/* ── Goal Link Modal (for security buy flow) ───────────────────────── */}
      <GoalLinkModal
        isOpen={showSecurityGoalModal}
        onClose={() => setShowSecurityGoalModal(false)}
        onConfirm={(goalId) => {
          setShowSecurityGoalModal(false);
          if (onProceedToPayment && pendingSecurityCheckout) {
            onProceedToPayment({ ...pendingSecurityCheckout, goalId });
          }
        }}
        investmentAmount={pendingSecurityCheckout?.baseAmount}
        assetName={pendingSecurityCheckout?.security?.name || pendingSecurityCheckout?.security?.symbol}
      />

      {/* ── Onboarding guard (for security buy flow) ─────────────────────── */}
      {showSecurityOnboardingModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowSecurityOnboardingModal(false)}>
          <div className="mx-6 w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-50 mx-auto mb-4">
              <TrendingUp className="h-7 w-7 text-violet-600" />
            </div>
            <h3 className="text-center text-lg font-semibold text-slate-900 mb-2">Complete Your Onboarding</h3>
            <p className="text-center text-sm text-slate-500 mb-6">
              You need to complete your identity verification before you can start investing.
            </p>
            <button
              onClick={() => setShowSecurityOnboardingModal(false)}
              className="w-full rounded-2xl bg-gradient-to-r from-black to-purple-600 py-3 text-sm font-semibold text-white shadow-lg"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {childFilter && selectedStrategy && showChildInvestModal && (
        <ChildInvestModal
          child={childFilter}
          strategy={{ ...selectedStrategy, calculatedMinInvestment: calculateMinInvestmentSync(selectedStrategy, holdingsBySymbol) }}
          initialStep="preview"
          onClose={() => { setSelectedStrategy(null); setShowChildInvestModal(false); }}
          onOpenFactsheet={(strategy) => {
            setShowChildInvestModal(false);
            onOpenFactsheet(strategy);
          }}
        />
      )}

      {/* Child Invest Modal (legacy disabled) */}
      {childFilter && selectedStrategy && showChildInvestModal && false && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 overscroll-contain"
          style={{ paddingBottom: "calc(var(--navbar-height, 64px) + 8px)" }}
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close"
            onClick={closeChildInvest}
          />
          <motion.div
            className="relative z-10 flex w-full max-w-sm flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl"
            style={{ maxHeight: "calc(90vh - var(--navbar-height, 64px) - 16px)" }}
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={closeChildInvest}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 z-10"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            {childInvestStep === 'success' ? (
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6">
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
                    {`R${childBaseAmount.toFixed(2)} invested in ${selectedStrategy?.name} for ${childFirstName}.`}
                  </p>
                  <button
                    onClick={closeChildInvest}
                    className="mt-6 w-full rounded-xl py-3.5 text-sm font-bold text-white active:scale-[0.98]"
                    style={{ background: "linear-gradient(135deg,#1e1b4b,#312e81)" }}
                  >
                    Done
                  </button>
                </motion.div>
              </div>
            ) : childInvestStep === 'preview' ? (
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6" style={{ WebkitOverflowScrolling: "touch" }}>
                {/* Child wallet balance pill */}
                <div className="flex items-center gap-2 rounded-xl bg-purple-50 border border-purple-100 px-4 py-2.5 mb-5">
                  <Wallet className="h-3.5 w-3.5 text-purple-500" />
                  <span className="text-xs font-semibold text-purple-600">{childFirstName}'s balance:</span>
                  <span className="text-xs font-bold text-purple-800 ml-auto tabular-nums">
                    R{(childBalance / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="flex items-start gap-3 mb-5">
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-slate-900">{selectedStrategy.name}</h2>
                  </div>
                </div>

                <div className="flex items-center gap-3 mb-5">
                  {childStrategyMinimum ? (
                    <>
                      <p className="text-2xl font-semibold text-slate-900">
                        R{childStrategyMinimum.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <span className="rounded-full px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-500">Min. investment</span>
                    </>
                  ) : null}
                </div>

                {/* YTD return + chart */}
                <div className="mb-5">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>YTD return</span>
                    <div className="flex flex-col items-end gap-1">
                      <span className={selectedStrategy?.r_ytd > 0 ? "text-emerald-600" : selectedStrategy?.r_ytd < 0 ? "text-rose-600" : "text-slate-500"}>
                        {selectedStrategy?.r_ytd != null
                          ? `${selectedStrategy.r_ytd >= 0 ? '+' : ''}${(typeof selectedStrategy.r_ytd === 'number' && Math.abs(selectedStrategy.r_ytd) <= 1 ? selectedStrategy.r_ytd * 100 : selectedStrategy.r_ytd).toFixed(2)}%`
                          : '—'}
                      </span>
                      {selectedStrategy?.ytd_as_of_date && (
                        <span className="text-[10px] text-slate-400">
                          {new Date(selectedStrategy.ytd_as_of_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
                        <ComposedChart data={previewChartData} margin={{ top: 12, right: 16, left: 8, bottom: 28 }}>
                          <defs>
                            <linearGradient id="child-preview-gradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={previewChartLineColor} stopOpacity={0.25} />
                              <stop offset="70%" stopColor={previewChartLineColor} stopOpacity={0.1} />
                              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <ReferenceLine y={100} stroke="#e2e8f0" strokeDasharray="3 3" />
                          <XAxis dataKey="dateLabel" tick={false} axisLine={false} tickLine={false} height={0} />
                          <YAxis hide domain={previewChartDomain} />
                          <Area type="monotone" dataKey="returnPct" stroke="transparent" fill="url(#child-preview-gradient)" dot={false} />
                          <Line type="monotone" dataKey="returnPct" stroke={previewChartLineColor} strokeWidth={2} dot={false} activeDot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {(Array.isArray(selectedStrategy.tags) && selectedStrategy.tags.length > 0
                    ? selectedStrategy.tags
                    : [selectedStrategy.risk_level || 'Balanced', selectedStrategy.sector].filter(Boolean)
                  ).map((tag) => (
                    <span key={tag} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Top Holdings */}
                {(() => {
                  const hArr = getHoldingsArray(selectedStrategy);
                  const enriched = hArr.map(h => {
                    const sym = h.ticker || h.symbol || h;
                    const sec = holdingsBySymbol.get(sym) || holdingsBySymbol.get(normalizeSymbol(sym));
                    return { ...h, symbol: sym, name: sec?.name || h.name || sym, logo_url: sec?.logo_url || null };
                  });
                  if (!enriched.length) return null;
                  return (
                    <div className="mt-4 mb-4">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Top Holdings</p>
                      <div className="space-y-2">
                        {enriched.slice(0, 5).map((h) => (
                          <div key={h.symbol} className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-100 bg-white">
                              {h.logo_url
                                ? <img src={h.logo_url} alt={h.symbol} className="h-full w-full object-cover" />
                                : <div className="flex h-full w-full items-center justify-center bg-slate-100 text-xs font-bold text-slate-600">{h.symbol?.substring(0, 2)}</div>}
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-slate-900">{h.name}</p>
                              <p className="text-xs text-slate-500">{h.symbol}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Action buttons */}
                <div className="mt-6 space-y-3">
                  <button
                    onClick={() => setChildInvestStep('amount')}
                    disabled={!childStrategyMinimum}
                    className="w-full rounded-2xl bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] py-4 font-semibold text-white shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Invest Now
                  </button>
                  <button
                    onClick={() => {
                      const hArr = getHoldingsArray(selectedStrategy);
                      const enrichedHoldings = hArr.map(h => {
                        const sym = h.ticker || h.symbol || h;
                        const sec = holdingsBySymbol.get(sym) || holdingsBySymbol.get(normalizeSymbol(sym));
                        return { ...h, logo_url: sec?.logo_url || null, shares: getAdjustedShares(h, holdingsBySymbol) };
                      });
                      closeChildInvest();
                      onOpenFactsheet({ ...selectedStrategy, calculatedMinInvestment: childStrategyMinimum, holdingsWithLogos: enrichedHoldings });
                    }}
                    className="w-full rounded-2xl border border-slate-300 bg-white py-3 font-semibold text-slate-700 shadow-sm transition-all active:scale-95"
                  >
                    View Factsheet
                  </button>
                </div>
              </div>
            ) : childInvestStep === 'amount' ? (
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6" style={{ WebkitOverflowScrolling: "touch" }}>
                {/* Header with back button */}
                <div className="flex items-center gap-3 mb-5">
                  <button
                    onClick={() => setChildInvestStep('preview')}
                    className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition active:scale-95"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#ede9fe,#ddd6fe)" }}>
                    <BarChart3 className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-slate-900">Invest Amount</p>
                    <p className="text-xs text-slate-400">{selectedStrategy.short_name || selectedStrategy.name}</p>
                  </div>
                </div>

                {/* Child balance pill */}
                <div className="flex items-center gap-2 rounded-xl bg-purple-50 border border-purple-100 px-4 py-2.5 mb-4">
                  <Wallet className="h-3.5 w-3.5 text-purple-500" />
                  <span className="text-xs font-semibold text-purple-600">{childFirstName}'s balance:</span>
                  <span className="text-xs font-bold text-purple-800 ml-auto tabular-nums">
                    R{(childBalance / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Strategy info card */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#ede9fe,#ddd6fe)" }}>
                      <BarChart3 className="h-5 w-5 text-purple-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-900">{selectedStrategy.short_name || selectedStrategy.name}</p>
                      <p className="text-xs text-slate-500 mt-1">{selectedStrategy.description?.substring(0, 60)}</p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-slate-100">
                    <p className="text-xs text-slate-500 mb-1">Minimum investment</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {childStrategyMinimum
                        ? `R${childStrategyMinimum.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : 'Calculating...'}
                    </p>
                  </div>
                </div>

                {/* Units / amount selector */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Investment Amount</p>
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={() => setChildInvestUnits(u => Math.max(1, u - 1))}
                      disabled={childInvestUnits <= 1 || !childStrategyMinimum}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition text-xl font-semibold leading-none"
                    >
                      −
                    </button>
                    <div className="flex-1 text-center">
                      <p className="text-3xl font-bold text-slate-900 tabular-nums">
                        R{childStrategyMinimum && childBaseAmount > 0
                          ? childBaseAmount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '0.00'}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{childInvestUnits} unit{childInvestUnits !== 1 ? 's' : ''}</p>
                    </div>
                    <button
                      onClick={() => setChildInvestUnits(u => u + 1)}
                      disabled={!childStrategyMinimum || childInsufficient}
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
                    R{childFees.totalCost.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>

                {childInsufficient && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-4">
                    <p className="text-xs font-semibold text-red-700">
                      Insufficient funds. {childFirstName} needs R{(childFees.totalCost - childBalance / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} more.
                    </p>
                  </div>
                )}

                {childInvestError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-4">
                    <p className="text-xs font-semibold text-red-700">{childInvestError}</p>
                  </div>
                )}

                <button
                  onClick={handleChildInvest}
                  disabled={childInsufficient || childBaseAmountCents <= 0 || childInvestSaving || !childStrategyMinimum}
                  className="w-full rounded-2xl bg-purple-600 py-3.5 font-semibold text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {childInvestSaving ? 'Processing...' : 'Confirm Investment'}
                </button>
              </div>
            ) : null}
          </motion.div>
        </div>
      , portalTarget)}

      {/* Filter Sheet */}
      {isFilterOpen && portalTarget && createPortal(
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 px-4 pb-6">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close filters"
            onClick={() => {
              setIsFilterOpen(false);
              resetSheetPosition();
            }}
          />
          <div
            className="relative z-10 flex h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl"
            style={{ transform: `translateY(${sheetOffset}px)` }}
            onPointerDown={handleSheetPointerDown}
            onPointerMove={handleSheetPointerMove}
            onPointerUp={handleSheetPointerUp}
            onPointerCancel={handleSheetPointerUp}
          >
            {/* Drag Handle */}
            <div className="flex items-center justify-center pt-3">
              <div className="h-1.5 w-12 rounded-full bg-slate-200" />
            </div>

            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 pb-4 pt-3">
              <h3 className="text-lg font-semibold text-slate-900">
                {viewMode === "openstrategies" ? "Filters" : "Filter & Sort"}
              </h3>
              <button
                type="button"
                onClick={viewMode === "openstrategies" ? clearAllStrategyFilters : clearAllFilters}
                className="text-sm font-semibold text-slate-500"
              >
                Clear all
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {viewMode === "openstrategies" ? (
                /* OpenStrategies Filters */
                <>
                  <div className="space-y-5">
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-slate-800">Sort</p>
                      <div className="flex flex-wrap gap-2">
                        {strategySortOptions.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setDraftStrategySort(option)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              draftStrategySort === option
                                ? "border-transparent bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] text-white"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-slate-800">Risk level</p>
                      <div className="flex flex-wrap gap-2">
                        {riskOptions.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setDraftRisks((prev) => {
                                const next = new Set(prev);
                                if (next.has(option)) {
                                  next.delete(option);
                                } else {
                                  next.add(option);
                                }
                                return next;
                              });
                            }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              draftRisks.has(option)
                                ? "border-transparent bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] text-white"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-slate-800">Minimum investment</p>
                      <div className="flex flex-wrap gap-2">
                        {minInvestmentOptions.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setDraftMinInvestment(option)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              draftMinInvestment === option
                                ? "border-transparent bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] text-white"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-slate-800">Asset exposure</p>
                      <div className="flex flex-wrap gap-2">
                        {exposureOptions.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setDraftExposure((prev) => {
                                const next = new Set(prev);
                                if (next.has(option)) {
                                  next.delete(option);
                                } else {
                                  next.add(option);
                                }
                                return next;
                              });
                            }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              draftExposure.has(option)
                                ? "border-transparent bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] text-white"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-slate-800">Time horizon</p>
                      <div className="flex flex-wrap gap-2">
                        {timeHorizonOptions.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setDraftTimeHorizon(new Set([option]))}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              draftTimeHorizon.has(option)
                                ? "border-transparent bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] text-white"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-slate-800">Sector</p>
                      <div className="flex flex-wrap gap-2">
                        {strategySectorOptions.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setDraftStrategySectors((prev) => {
                                const next = new Set(prev);
                                if (next.has(option)) {
                                  next.delete(option);
                                } else {
                                  next.add(option);
                                }
                                return next;
                              });
                            }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              draftStrategySectors.has(option)
                                ? "border-transparent bg-gradient-to-r from-[#5b21b6] to-[#7c3aed] text-white"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* Invest Filters */
                <>
                  {/* Sort Options */}
                  <section className="mb-6">
                    <h4 className="mb-3 text-sm font-semibold text-slate-700">Sort by</h4>
                    <div className="space-y-2">
                      {sortOptions.map((option) => (
                        <button
                          key={option}
                          onClick={() => setDraftSort(option)}
                          className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition-all ${
                            draftSort === option
                              ? "bg-purple-50 text-purple-700 ring-2 ring-purple-200"
                              : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Sector Filter */}
                  <section className="mb-6">
                    <h4 className="mb-3 text-sm font-semibold text-slate-700">Sector</h4>
                    <div className="flex flex-wrap gap-2">
                      {sectors.map((sector) => (
                        <button
                          key={sector}
                          onClick={() => {
                            const next = new Set(draftSectors);
                            if (next.has(sector)) {
                              next.delete(sector);
                            } else {
                              next.add(sector);
                            }
                            setDraftSectors(next);
                          }}
                          className={`rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                            draftSectors.has(sector)
                              ? "bg-purple-600 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {sector}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Exchange Filter */}
                  <section className="mb-6">
                    <h4 className="mb-3 text-sm font-semibold text-slate-700">Exchange</h4>
                    <div className="flex flex-wrap gap-2">
                      {exchanges.map((exchange) => (
                        <button
                          key={exchange}
                          onClick={() => {
                            const next = new Set(draftExchanges);
                            if (next.has(exchange)) {
                              next.delete(exchange);
                            } else {
                              next.add(exchange);
                            }
                            setDraftExchanges(next);
                          }}
                          className={`rounded-full px-4 py-2 text-xs font-semibold transition-all ${
                            draftExchanges.has(exchange)
                              ? "bg-purple-600 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {exchange}
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>

            {/* Apply Button */}
            <div className="sticky bottom-0 border-t border-slate-100 bg-white px-5 pb-5 pt-3">
              <div className="pointer-events-none absolute left-0 right-0 top-0 h-6 bg-gradient-to-b from-white to-transparent" />
              <button
                type="button"
                onClick={() => {
                  if (viewMode === "openstrategies") {
                    applyStrategyFilters();
                  } else {
                    applyFilters();
                  }
                  resetSheetPosition();
                }}
                className="relative w-full rounded-2xl bg-gradient-to-r from-[#111111] via-[#3b1b7a] to-[#5b21b6] py-3 text-sm font-semibold text-white shadow-lg shadow-violet-200/60"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      , portalTarget)}

      {/* Wishlist picker — Airbnb-style category selector */}
      {wishlistPickerKey && (
        <WishlistPickerSheet
          itemKey={wishlistPickerKey}
          isKidStrategy={wishlistPickerIsKid}
          onGoToChildMarket={() => {
            setWishlistPickerKey(null);
            setShowChildMarketPrompt(true);
          }}
          childFamilyMemberId={childData?.id || null}
          onClose={() => setWishlistPickerKey(null)}
          onSaved={(savedItemKey, listName, registryId) => {
            const next = new Set([...wishlistedKeys, savedItemKey]);
            setWishlistedKeys(next);
            updateWishlistPrefs({ wishlistedKeys: [...next] });
            setWishlistPickerKey(null);
            setWishlistToastMsg(`Added to "${listName}"`);
            setWishlistToastRegistryId(registryId || null);
            setWishlistToastVisible(true);
          }}
          onCreateNew={(name) => {
            const key = wishlistPickerKey;
            setWishlistPickerKey(null);
            onContinueToRegistry?.(key, name || null);
          }}
        />
      )}

      <WishlistToast
        message={wishlistToastMsg}
        visible={wishlistToastVisible}
        onHide={() => setWishlistToastVisible(false)}
        actionLabel="View →"
        onAction={() => {
          setWishlistToastVisible(false);
          window.dispatchEvent(new CustomEvent("navigate-within-app", {
            detail: { page: "giftRegistryDashboard", registryId: wishlistToastRegistryId }
          }));
        }}
      />

      {/* Child wishlist create sheet — only used when childFilter is a child object */}
      {childData && (
        <GiftRegistryCreateSheet
          open={showChildWishlistCreate}
          onClose={() => setShowChildWishlistCreate(false)}
          preselectedChild={childData}
          onSaved={() => setShowChildWishlistCreate(false)}
        />
      )}

      {/* Child market prompt — shown when parent hits the guard from the wishlist picker */}
      <ChildMarketPromptModal
        open={showChildMarketPrompt}
        onClose={() => setShowChildMarketPrompt(false)}
        onSelectChild={(child) => {
          setLocalChildFilter(child);
          setViewMode("openstrategies");
          setShowChildMarketPrompt(false);
        }}
      />
    </div>
  );
};

export default MarketsPage;
