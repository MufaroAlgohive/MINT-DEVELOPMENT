import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookMarked, Bookmark, Gift, Heart, Search, Sparkles, TrendingUp, X } from "lucide-react";
import GiftRegistryCreateSheet from "../components/GiftRegistryCreateSheet.jsx";
import WishlistPickerSheet from "../components/WishlistPickerSheet.jsx";
import { AreaChart, Area, LineChart, Line, ResponsiveContainer } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { SparklesText } from "../components/ui/sparkles-text";
import { getPublicStrategies, formatChangePct } from "../lib/strategyData";
import { calculateMinInvestmentSync, enrichSecuritiesWithIntradayPrices, buildHoldingsBySymbol } from "../lib/strategyUtils";
import { supabase } from "../lib/supabase";
import { formatCurrency } from "../lib/formatCurrency";
import WishlistToast from "../components/WishlistToast.jsx";

const HOME_BG = {
  backgroundColor: '#f8f6fa',
  backgroundImage: 'linear-gradient(180deg, #0d0d12 0%, #0e0a14 0.5%, #100b18 1%, #120c1c 1.5%, #150e22 2%, #181028 2.5%, #1c122f 3%, #201436 3.5%, #25173e 4%, #2a1a46 5%, #301d4f 6%, #362158 7%, #3d2561 8%, #44296b 9%, #4c2e75 10%, #54337f 11%, #5d3889 12%, #663e93 13%, #70449d 14%, #7a4aa7 15%, #8451b0 16%, #8e58b9 17%, #9860c1 18%, #a268c8 19%, #ac71ce 20%, #b57ad3 21%, #be84d8 22%, #c68edc 23%, #cd98e0 24%, #d4a2e3 25%, #daace6 26%, #dfb6e9 27%, #e4c0eb 28%, #e8c9ed 29%, #ecd2ef 30%, #efdaf1 31%, #f2e1f3 32%, #f4e7f5 33%, #f6ecf7 34%, #f8f0f9 35%, #f9f3fa 36%, #faf5fb 38%, #fbf7fc 40%, #fcf9fd 42%, #fdfafd 45%, #faf8fc 55%, #f8f6fa 100%)',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 100vh',
};

const RISK_COLORS = {
  Low: { bg: "bg-emerald-500/10", text: "text-emerald-600", dot: "bg-emerald-500" },
  Balanced: { bg: "bg-blue-500/10", text: "text-blue-600", dot: "bg-blue-500" },
  Growth: { bg: "bg-amber-500/10", text: "text-amber-600", dot: "bg-amber-500" },
  High: { bg: "bg-red-500/10", text: "text-red-600", dot: "bg-red-500" },
};

function getRiskStyle(level) {
  return RISK_COLORS[level] || RISK_COLORS.Balanced;
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function generateSparkline(seed, length = 12) {
  let h = hashStr(seed);
  const points = [];
  let val = 20 + (h % 30);
  for (let i = 0; i < length; i++) {
    h = ((h * 1103515245 + 12345) & 0x7fffffff);
    val += ((h % 7) - 3) * 0.8;
    val = Math.max(5, Math.min(60, val));
    points.push({ i, v: val });
  }
  return points;
}

function MiniSparkline({ strategyId, positive }) {
  const gradId = useId();
  const data = useMemo(() => generateSparkline(strategyId || "default"), [strategyId]);
  const color = positive ? "#7c3aed" : "#7c3aed";

  return (
    <div className="w-20 h-10">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function StrategyCard({ strategy, ytd, holdingsBySymbol, onGift, featured, isWishlisted, isWatchlisted, onToggleWishlist, onToggleWatchlist }) {
  const currency = strategy.base_currency || "R";
  const calcMin = calculateMinInvestmentSync(strategy, holdingsBySymbol);
  const minInvest = calcMin ? formatCurrency(calcMin * 1.08, currency) : null;

  const holdings = Array.isArray(strategy.holdings) ? strategy.holdings : [];
  const holdingLogos = holdings.slice(0, 4).map(h => {
    const sym = h.ticker || h.symbol || h;
    const sec = holdingsBySymbol?.get(sym);
    return { sym, logo_url: sec?.logo_url };
  });
  const extraCount = Math.max(0, holdings.length - 4);

  const ytdValue = ytd?.ytd;
  const ytdPositive = ytdValue == null || ytdValue >= 0;
  const risk = strategy.risk_level || "Balanced";
  const riskStyle = getRiskStyle(risk);

  return (
    <button
      type="button"
      onClick={() => onGift(strategy)}
      className="w-full text-left group"
    >
      <div className={`relative rounded-2xl border transition-shadow duration-200 active:scale-[0.98] overflow-hidden ${
        featured
          ? "bg-white border-violet-200 shadow-md shadow-violet-100/50 ring-1 ring-violet-100"
          : "bg-white border-slate-200/80 shadow-sm hover:shadow-md hover:border-slate-300"
      }`}>
        {featured && (
          <div className="absolute top-0 right-0">
            <div className="bg-gradient-to-l from-violet-500 to-violet-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-bl-xl">
              Top Performer
            </div>
          </div>
        )}

        {/* Bookmark + Heart icons — bottom-right */}
        <div className="absolute bottom-4 right-4 flex items-center gap-1.5 z-10">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleWatchlist?.(e, strategy.id); }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm active:scale-90 transition-transform"
          >
            <Bookmark className={`h-5 w-5 ${isWatchlisted ? "fill-yellow-400 text-yellow-400" : "text-slate-400"}`} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleWishlist?.(e, `gift:${strategy.id}`); }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm active:scale-90 transition-transform"
          >
            <Heart className={`h-5 w-5 ${isWishlisted ? "fill-red-500 text-red-500" : "text-slate-400"}`} />
          </button>
        </div>

        <div className="p-4">
          {/* Top row: logos + chart */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex -space-x-2">
              {holdingLogos.map(h => (
                <div key={h.sym} className="w-8 h-8 rounded-full border-2 border-white bg-slate-100 overflow-hidden flex items-center justify-center flex-shrink-0 shadow-sm">
                  {h.logo_url
                    ? <img src={h.logo_url} alt={h.sym} className="h-full w-full object-cover" />
                    : <span className="text-[9px] font-bold text-slate-400">{h.sym?.slice(0, 2)}</span>
                  }
                </div>
              ))}
              {extraCount > 0 && (
                <div className="w-8 h-8 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[9px] font-bold text-slate-400 flex-shrink-0 shadow-sm">
                  +{extraCount}
                </div>
              )}
            </div>
            <MiniSparkline strategyId={strategy.id} positive={ytdPositive} />
          </div>

          {/* Name + description */}
          <h3 className="font-bold text-[15px] text-slate-900 leading-tight mb-0.5 line-clamp-1">
            {strategy.name}
          </h3>
          {strategy.objective && (
            <p className="text-xs text-slate-400 line-clamp-1 mb-3">{strategy.objective}</p>
          )}

          {/* Bottom row: risk + YTD + min invest + gift icon */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold ${riskStyle.bg} ${riskStyle.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${riskStyle.dot}`} />
                {risk}
              </span>
              {ytdValue != null && (
                <span className={`px-2 py-1 rounded-md text-[10px] font-bold ${
                  ytdPositive ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
                }`}>
                  {formatChangePct(ytdValue)}
                </span>
              )}
              {minInvest && (
                <span className="text-[10px] text-slate-400 font-medium">
                  from {minInvest}
                </span>
              )}
            </div>
            <div className="w-7 h-7 rounded-full bg-violet-50 flex items-center justify-center group-hover:bg-violet-100 transition-colors">
              <Gift size={13} className="text-violet-500" />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function CategoryPill({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
        active
          ? "bg-white text-slate-900 shadow-sm"
          : "bg-white/20 text-white/70 hover:bg-white/30"
      }`}
    >
      {label}
    </button>
  );
}

export default function GiftStrategyPickerPage({ onBack, onNavigate, autoOpenWishlist }) {
  const [strategies, setStrategies] = useState([]);
  const [ytdMap, setYtdMap] = useState({});
  const [securitiesMap, setSecuritiesMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [showSearch, setShowSearch] = useState(false);
  const [showRegistrySheet, setShowRegistrySheet] = useState(false);
  const [showWishlistMenu, setShowWishlistMenu] = useState(false);
  // Wishlist (heart) state — loaded from Supabase user_metadata, not localStorage
  const [wishlistedKeys, setWishlistedKeys] = useState(new Set());
  const [giftStrategyWatchlist, setGiftStrategyWatchlist] = useState([]);
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  const searchRef = useRef(null);
  const wishlistMenuRef = useRef(null);

  // Load wishlisted keys + watchlist from Supabase user_metadata on mount
  useEffect(() => {
    async function loadPrefs() {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/gift-wishlist-prefs", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const { wishlistedKeys: keys = [], watchlist = [] } = await res.json();
          setWishlistedKeys(new Set(keys));
          setGiftStrategyWatchlist(watchlist);
        }
      } catch (e) {
        console.error("[GiftStrategyPicker] loadPrefs error:", e);
      }
    }
    loadPrefs();
  }, []);

  async function updatePrefs(patch) {
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
      console.error("[GiftStrategyPicker] updatePrefs error:", e);
    }
  }

  const [wishlistPickerKey, setWishlistPickerKey] = useState(null); // itemKey awaiting picker
  const [pendingRegistryItem, setPendingRegistryItem] = useState(null); // preserved when transitioning picker → create sheet
  const [pendingRegistryTitle, setPendingRegistryTitle] = useState(null); // name entered in the empty-state Step-1 form

  function toggleWishlistItem(e, key) {
    e.preventDefault(); e.stopPropagation();
    if (wishlistedKeys.has(key)) {
      const next = new Set(wishlistedKeys);
      next.delete(key);
      setWishlistedKeys(next);
      updatePrefs({ wishlistedKeys: [...next] });
    } else {
      // Show picker so the user can choose a wishlist category
      setWishlistPickerKey(key);
    }
  }

  function toggleGiftStrategyWatchlist(e, id) {
    e.preventDefault(); e.stopPropagation();
    setGiftStrategyWatchlist(prev => {
      const next = prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id];
      updatePrefs({ watchlist: next });
      return next;
    });
  }

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getPublicStrategies();
        if (cancelled) return;
        setStrategies(data || []);
        if (!data?.length || !supabase) return;

        const ids = data.map(s => s.id);
        const { data: returns } = await supabase
          .from("strategies_returns_c")
          .select("strategy_id, ytd_pct, as_of_date")
          .in("strategy_id", ids)
          .order("as_of_date", { ascending: false });

        const ytd = {};
        (returns || []).forEach(r => {
          if (!ytd[r.strategy_id]) {
            ytd[r.strategy_id] = { ytd: r.ytd_pct ? r.ytd_pct / 100 : null, as_of_date: r.as_of_date };
          }
        });
        if (!cancelled) setYtdMap(ytd);

        const tickers = [...new Set(data.flatMap(s =>
          (Array.isArray(s.holdings) ? s.holdings : []).map(h => h.ticker || h.symbol || h)
        ).filter(Boolean))];
        if (tickers.length) {
          const { data: secs } = await supabase
            .from("securities_c")
            .select("id, symbol, logo_url, last_price")
            .in("symbol", tickers);
          const enriched = await enrichSecuritiesWithIntradayPrices(secs || []);
          if (!cancelled) setSecuritiesMap(buildHoldingsBySymbol(enriched));
        }
      } catch (e) {
        console.error("[GiftStrategyPicker] load error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (showSearch && searchRef.current) searchRef.current.focus();
  }, [showSearch]);

  useEffect(() => {
    if (autoOpenWishlist) setShowRegistrySheet(true);
  }, [autoOpenWishlist]);

  const sectors = ["All", ...new Set(strategies.map(s => s.sector || "General"))];

  const filtered = strategies.filter(s => {
    const matchCategory = activeCategory === "All" || (s.sector || "General") === activeCategory;
    const matchSearch = !searchQuery || s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.objective?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  const bestPerformerId = useMemo(() => {
    let bestId = null;
    let bestYtd = -Infinity;
    for (const s of filtered) {
      const ytd = ytdMap[s.id]?.ytd;
      if (ytd != null && ytd > bestYtd) {
        bestYtd = ytd;
        bestId = s.id;
      }
    }
    return bestId;
  }, [filtered, ytdMap]);

  const featuredStrategies = bestPerformerId ? filtered.filter(s => s.id === bestPerformerId) : [];
  const otherStrategies = filtered.filter(s => s.id !== bestPerformerId);

  function handleGift(strategy) {
    onNavigate?.("giftStrategyInvest", {
      strategy: { ...strategy, calculatedMinInvestment: calculateMinInvestmentSync(strategy, securitiesMap) },
    });
  }

  return (
    <div
      className="flex flex-col min-h-screen text-slate-900 relative overflow-x-hidden"
      style={HOME_BG}
    >
      {/* Header */}
      <header className="rounded-b-[36px] bg-gradient-to-b from-[#111111] via-[#3b1b7a] to-[#5b21b6] px-4 pb-6 pt-12 text-white">
        <div className="mx-auto w-full max-w-sm md:max-w-md">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-6">
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <SparklesText
              text="Gift a Basket"
              colors={{ first: "#c4b5fd", second: "#f0abfc" }}
              sparklesCount={6}
              className="text-base tracking-wide text-white"
            />
            <div className="flex items-center gap-2">
              <div className="relative" ref={wishlistMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowWishlistMenu((v) => !v)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm"
                  title="Wishlist"
                >
                  <BookMarked className="h-4 w-4" />
                </button>

                <AnimatePresence>
                  {showWishlistMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-12 z-50 w-44 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-black/5"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setShowWishlistMenu(false);
                          onNavigate?.("giftRegistryDashboard");
                        }}
                        className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <BookMarked className="h-4 w-4 text-violet-600" />
                        My Wishlist
                      </button>
                      <div className="h-px bg-slate-100" />
                      <button
                        type="button"
                        onClick={() => {
                          setShowWishlistMenu(false);
                          setShowRegistrySheet(true);
                        }}
                        className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Sparkles className="h-4 w-4 text-violet-600" />
                        New Wishlist
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button
                type="button"
                onClick={() => setShowSearch(!showSearch)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm"
              >
                {showSearch ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Search bar (collapsible) */}
          <div className={`overflow-hidden transition-all duration-300 ${showSearch ? "max-h-14 opacity-100 mb-4" : "max-h-0 opacity-0"}`}>
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search baskets..."
                className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white/10 border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/25 backdrop-blur-sm"
              />
            </div>
          </div>

          {/* Subtitle */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="flex items-center gap-2.5 mb-2"
          >
            <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">
              <Gift size={15} className="text-violet-200" />
            </div>
            <p className="text-xs text-white/60 leading-relaxed">
              Pick a basket to gift. Recipient claims with SA ID + code.
            </p>
          </motion.div>

          {/* Category pills */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pt-2 pb-1">
            {sectors.map((sector, i) => (
              <motion.div
                key={sector}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.25 + i * 0.05 }}
              >
                <CategoryPill
                  label={sector === "General" ? "Child Friendly" : sector}
                  active={activeCategory === sector}
                  onClick={() => setActiveCategory(sector)}
                />
              </motion.div>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-grow px-4 pt-5 pb-10">
        <div className="mx-auto max-w-sm md:max-w-md space-y-3">
          {loading ? (
            <>
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="rounded-2xl bg-white border border-slate-200/80 p-4 animate-pulse shadow-sm">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex -space-x-2">
                      {[1, 2, 3].map(j => (
                        <div key={j} className="w-8 h-8 rounded-full bg-slate-100 border-2 border-white" />
                      ))}
                    </div>
                    <div className="w-20 h-10 rounded-lg bg-slate-100" />
                  </div>
                  <div className="h-4 w-3/4 rounded bg-slate-100 mb-2" />
                  <div className="h-3 w-1/2 rounded bg-slate-50 mb-3" />
                  <div className="flex gap-2">
                    <div className="h-6 w-16 rounded-md bg-slate-50" />
                    <div className="h-6 w-14 rounded-md bg-slate-50" />
                  </div>
                </div>
              ))}
            </>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-16 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-white shadow-sm flex items-center justify-center">
                <Search size={22} className="text-slate-300" />
              </div>
              <p className="text-slate-400 text-sm">
                {searchQuery ? "No baskets match your search." : "No baskets available."}
              </p>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); setActiveCategory("All"); }}
                  className="text-violet-600 text-xs font-semibold"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              {featuredStrategies.length > 0 && (
                <div className="space-y-3">
                  {activeCategory === "All" && (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4 }}
                      className="flex items-center gap-2 px-1 pt-1"
                    >
                      <Sparkles size={12} className="text-violet-500" />
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">Top Performer</p>
                    </motion.div>
                  )}
                  {featuredStrategies.map((strategy, i) => (
                    <motion.div
                      key={strategy.id}
                      initial={{ opacity: 0, y: 20, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.45, delay: i * 0.08, ease: [0.25, 0.46, 0.45, 0.94] }}
                    >
                      <StrategyCard
                        strategy={strategy}
                        ytd={ytdMap[strategy.id]}
                        holdingsBySymbol={securitiesMap}
                        onGift={handleGift}
                        featured
                        isWishlisted={wishlistedKeys.has(`gift:${strategy.id}`)}
                        isWatchlisted={giftStrategyWatchlist.includes(strategy.id)}
                        onToggleWishlist={toggleWishlistItem}
                        onToggleWatchlist={toggleGiftStrategyWatchlist}
                      />
                    </motion.div>
                  ))}
                </div>
              )}

              {otherStrategies.length > 0 && (
                <div className="space-y-3">
                  {featuredStrategies.length > 0 && activeCategory === "All" && (
                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: featuredStrategies.length * 0.08 + 0.15 }}
                      className="flex items-center gap-2 px-1 pt-3"
                    >
                      <TrendingUp size={12} className="text-slate-400" />
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">All Baskets</p>
                    </motion.div>
                  )}
                  {otherStrategies.map((strategy, i) => (
                    <motion.div
                      key={strategy.id}
                      initial={{ opacity: 0, y: 20, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{
                        duration: 0.45,
                        delay: (featuredStrategies.length + i) * 0.08 + 0.2,
                        ease: [0.25, 0.46, 0.45, 0.94],
                      }}
                    >
                      <StrategyCard
                        strategy={strategy}
                        ytd={ytdMap[strategy.id]}
                        holdingsBySymbol={securitiesMap}
                        onGift={handleGift}
                        featured={false}
                        isWishlisted={wishlistedKeys.has(`gift:${strategy.id}`)}
                        isWatchlisted={giftStrategyWatchlist.includes(strategy.id)}
                        onToggleWishlist={toggleWishlistItem}
                        onToggleWatchlist={toggleGiftStrategyWatchlist}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Wishlist picker — Airbnb-style category selector */}
      {wishlistPickerKey && (
        <WishlistPickerSheet
          itemKey={wishlistPickerKey}
          onClose={() => setWishlistPickerKey(null)}
          onSaved={(savedItemKey, listName) => {
            const next = new Set([...wishlistedKeys, savedItemKey]);
            setWishlistedKeys(next);
            updatePrefs({ wishlistedKeys: [...next] });
            setWishlistPickerKey(null);
            setToastMsg(`Saved to "${listName}"`);
            setToastVisible(true);
          }}
          onCreateNew={(name) => {
            const key = wishlistPickerKey;
            setWishlistPickerKey(null);
            setPendingRegistryItem(key);
            setPendingRegistryTitle(name || null);
            setShowRegistrySheet(true);
          }}
        />
      )}

      {/* Wishlist creation bottom sheet */}
      <GiftRegistryCreateSheet
        open={showRegistrySheet}
        pendingItemKey={pendingRegistryItem}
        initialTitle={pendingRegistryTitle}
        initialStep={pendingRegistryTitle ? 2 : 1}
        onClose={() => { setShowRegistrySheet(false); setPendingRegistryItem(null); setPendingRegistryTitle(null); }}
        onSaved={(registry, title) => {
          setShowRegistrySheet(false);
          // Mark the pending item as wishlisted now that it's been saved to a new wishlist
          if (pendingRegistryItem) {
            const next = new Set([...wishlistedKeys, pendingRegistryItem]);
            setWishlistedKeys(next);
            updatePrefs({ wishlistedKeys: [...next] });
          }
          setPendingRegistryItem(null);
          setToastMsg(`"${title}" created!`);
          setToastVisible(true);
          if (onNavigate && registry?.id) {
            onNavigate("giftRegistryDashboard", { registryId: registry.id, registry, pendingItemKey: null });
          }
        }}
        onNavigate={onNavigate}
      />

      {/* Wishlist saved toast */}
      <WishlistToast
        message={toastMsg}
        visible={toastVisible}
        onHide={() => setToastVisible(false)}
      />
    </div>
  );
}
