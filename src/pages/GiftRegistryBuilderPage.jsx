import React, { useState, useEffect, useId, useMemo } from "react";
import { useRegistryDetail } from "../lib/useGiftRegistry.js";
import { supabaseReady, supabase as supabaseSync } from "../lib/supabase.js";
import { centsToRand, calcMinTrancheForAsset } from "../lib/giftRegistryUtils.js";
import GiftRegistryShareSheet from "../components/GiftRegistryShareSheet.jsx";
import GiftRegistryProgressBar from "../components/GiftRegistryProgressBar.jsx";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { Search, BookMarked, ArrowLeft, X } from "lucide-react";

const HOME_BG = {
  backgroundColor: '#f8f6fa',
  backgroundImage: 'linear-gradient(180deg, #0d0d12 0%, #0e0a14 0.5%, #100b18 1%, #120c1c 1.5%, #150e22 2%, #181028 2.5%, #1c122f 3%, #201436 3.5%, #25173e 4%, #2a1a46 5%, #301d4f 6%, #362158 7%, #3d2561 8%, #44296b 9%, #4c2e75 10%, #54337f 11%, #5d3889 12%, #663e93 13%, #70449d 14%, #7a4aa7 15%, #8451b0 16%, #8e58b9 17%, #9860c1 18%, #a268c8 19%, #ac71ce 20%, #b57ad3 21%, #be84d8 22%, #c68edc 23%, #cd98e0 24%, #d4a2e3 25%, #daace6 26%, #dfb6e9 27%, #e4c0eb 28%, #e8c9ed 29%, #ecd2ef 30%, #efdaf1 31%, #f2e1f3 32%, #f4e7f5 33%, #f6ecf7 34%, #f8f0f9 35%, #f9f3fa 36%, #faf5fb 38%, #fbf7fc 40%, #fcf9fd 42%, #fdfafd 45%, #faf8fc 55%, #f8f6fa 100%)',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 100vh',
};

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function generateSparkline(seed, length = 12) {
  let h = hashStr(seed || "default");
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

function MiniSparkline({ seed }) {
  const gradId = useId();
  const data = useMemo(() => generateSparkline(seed), [seed]);
  const color = "#a78bfa";
  return (
    <div className="w-16 h-8">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 1, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const CATEGORIES = [
  { key: "ALL", label: "All" },
  { key: "SHARE", label: "Shares" },
  { key: "ETF", label: "ETFs" },
  { key: "BASKET", label: "Baskets" },
];

function SecurityCard({ sec, quantityMap, setQuantityMap, onAdd, addingId }) {
  const minQty = calcMinTrancheForAsset(sec.last_price);
  const qty = quantityMap[sec.id || sec.isin] || minQty;
  const isAdding = addingId === (sec.id || sec.isin);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/90 backdrop-blur-sm rounded-2xl border border-white/60 shadow-sm p-4 flex items-center gap-3"
    >
      {sec.logo_url ? (
        <img src={sec.logo_url} className="w-10 h-10 rounded-xl object-cover border border-gray-100 shrink-0" alt={sec.name} />
      ) : (
        <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
          <span className="text-violet-700 font-bold text-sm">{(sec.name || "?")[0]}</span>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{sec.name}</p>
        <p className="text-xs text-gray-400">{sec.ticker || sec.isin} · ~{centsToRand(sec.last_price)}</p>
      </div>

      <MiniSparkline seed={sec.isin} />

      <div className="flex flex-col items-center gap-1.5 shrink-0">
        <div className="flex items-center gap-1 bg-gray-50 rounded-xl border border-gray-200">
          <button
            onClick={() => setQuantityMap(m => ({ ...m, [sec.id || sec.isin]: Math.max(minQty, (m[sec.id || sec.isin] || minQty) - 1) }))}
            className="w-7 h-7 flex items-center justify-center text-gray-500 text-sm font-medium"
          >−</button>
          <span className="text-sm font-semibold text-gray-800 w-6 text-center">{qty}</span>
          <button
            onClick={() => setQuantityMap(m => ({ ...m, [sec.id || sec.isin]: (m[sec.id || sec.isin] || minQty) + 1 }))}
            className="w-7 h-7 flex items-center justify-center text-gray-500 text-sm font-medium"
          >+</button>
        </div>
        <button
          onClick={() => onAdd(sec)}
          disabled={isAdding}
          className="px-3 py-1 rounded-xl bg-[#6B21A8] text-white text-xs font-semibold disabled:opacity-50 w-full text-center"
        >
          {isAdding ? "…" : "Add"}
        </button>
      </div>
    </motion.div>
  );
}

export default function GiftRegistryBuilderPage({ registryId, registry: initialRegistry, onNavigate, onBack, pendingItemKey }) {
  const { registry, loading, reload } = useRegistryDetail(registryId);
  const [search, setSearch] = useState(() => {
    if (!pendingItemKey || pendingItemKey.startsWith("strategy:")) return "";
    return pendingItemKey;
  });
  const [category, setCategory] = useState("ALL");
  const [searchResults, setSearchResults] = useState([]);
  const [topSecurities, setTopSecurities] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [quantityMap, setQuantityMap] = useState({});
  const [error, setError] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const current = registry || initialRegistry;
  const items = current?.items || [];
  const isPublished = ["ACTIVE", "PAUSED", "COMPLETED", "EXPIRED"].includes(current?.status);

  // Query securities_c directly via Supabase (same pattern as MarketsPage)
  async function fetchSecurities({ q = "", type = "ALL", limit = 20 } = {}) {
    const db = (await supabaseReady) || supabaseSync;
    if (!db) return [];
    let query = db
      .from("securities_c")
      .select("id, isin, symbol, name, logo_url, last_price, instrument_type")
      .limit(limit);
    if (q) {
      query = query.or(`name.ilike.%${q}%,symbol.ilike.%${q}%,isin.ilike.%${q}%`);
    } else {
      query = query.order("last_price", { ascending: false });
    }
    if (type && type !== "ALL") {
      query = query.eq("instrument_type", type);
    }
    const { data, error } = await query;
    if (error) {
      // Fallback: retry without instrument_type filter if column doesn't exist
      if (error.message?.includes("instrument_type") || error.code === "42703") {
        let fb = db.from("securities_c").select("id, isin, symbol, name, logo_url, last_price").limit(limit);
        if (q) fb = fb.or(`name.ilike.%${q}%,symbol.ilike.%${q}%,isin.ilike.%${q}%`);
        else fb = fb.order("last_price", { ascending: false });
        const { data: fbData } = await fb;
        return (fbData || []).map(s => ({ ...s, ticker: s.symbol, type: "SHARE" }));
      }
      return [];
    }
    return (data || []).map(s => ({ ...s, ticker: s.symbol, type: s.instrument_type || "SHARE" }));
  }

  // Fetch top securities for the selected category (shown when not searching)
  useEffect(() => {
    let cancelled = false;
    fetchSecurities({ type: category, limit: 20 }).then(results => {
      if (!cancelled) setTopSecurities(results);
    });
    return () => { cancelled = true; };
  }, [category]);

  // Search with debounce
  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await fetchSecurities({ q: search.trim(), type: category, limit: 15 });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search, category]);

  async function publishRegistry() {
    setPublishing(true);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      await fetch(`/api/gift-registry/${registryId}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      reload();
    } catch (e) {
      console.warn("[builder] auto-publish failed:", e.message);
    } finally {
      setPublishing(false);
    }
  }

  async function handleAdd(security) {
    const wasEmpty = items.length === 0;
    const qty = quantityMap[security.id || security.isin] || calcMinTrancheForAsset(security.last_price);
    setAddingId(security.id || security.isin);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch("/api/gift-registry/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          registryId,
          isin: security.isin,
          instrumentType: security.type || security.instrument_type || "SHARE",
          targetQuantity: qty,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not add item");
      reload();

      // Auto-publish on first item and show share sheet
      if (wasEmpty && !isPublished) {
        await publishRegistry();
        setShowShare(true);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setAddingId(null);
    }
  }

  async function handleRemove(itemId) {
    setRemovingId(itemId);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch(`/api/gift-registry/items/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not remove item");
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setRemovingId(null);
    }
  }

  const displayResults = search.trim() ? searchResults : topSecurities;
  const addedIsins = new Set(items.map(i => i.isin));
  const filteredResults = displayResults.filter(s => !addedIsins.has(s.isin));

  return (
    <div className="min-h-screen pb-28" style={HOME_BG}>
      {/* Header */}
      <div className="px-5 pt-14 pb-5">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={onBack} className="p-2 -ml-2 rounded-xl text-white/80">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white">Add to Wishlist</h1>
            <p className="text-xs text-white/60 truncate">{current?.title || "Your wishlist"}</p>
          </div>
          {isPublished && current?.share_token && (
            <button
              onClick={() => setShowShare(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 text-white text-xs font-semibold"
            >
              <BookMarked className="w-3.5 h-3.5" />
              Share
            </button>
          )}
          {publishing && (
            <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          )}
        </div>
      </div>

      {/* Search bar */}
      <div className="px-5 mb-4">
        <div className="relative">
          <Search className="w-4 h-4 text-white/50 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            className="w-full bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl px-4 py-3 pl-10 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
            placeholder="Search shares, ETFs, baskets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/50">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category pills */}
      <div className="px-5 mb-5">
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                category === cat.key
                  ? "bg-white text-[#6B21A8] shadow-sm"
                  : "bg-white/15 text-white/80 border border-white/20"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 space-y-5">
        {error && (
          <div className="bg-red-500/10 border border-red-400/30 rounded-2xl px-4 py-3">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Search results / top picks */}
        <div>
          {search.trim() && (
            <p className="text-xs text-white/50 font-medium mb-3">
              {searching ? "Searching…" : `${filteredResults.length} result${filteredResults.length !== 1 ? "s" : ""}`}
            </p>
          )}
          {!search.trim() && (
            <p className="text-xs text-white/50 font-medium mb-3">
              {category === "ALL" ? "Popular picks" : `Top ${CATEGORIES.find(c => c.key === category)?.label}`}
            </p>
          )}

          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {filteredResults.map(sec => (
                <SecurityCard
                  key={sec.id || sec.isin}
                  sec={sec}
                  quantityMap={quantityMap}
                  setQuantityMap={setQuantityMap}
                  onAdd={handleAdd}
                  addingId={addingId}
                />
              ))}
            </AnimatePresence>

            {searching && (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
              </div>
            )}

            {!searching && search.trim() && filteredResults.length === 0 && (
              <div className="text-center py-8">
                <p className="text-white/50 text-sm">No results for "{search}"</p>
              </div>
            )}
          </div>
        </div>

        {/* Current wishlist items */}
        {items.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-white/50 font-medium">
                Your wishlist ({items.length} item{items.length !== 1 ? "s" : ""})
              </p>
              {isPublished && current?.share_token && (
                <button
                  onClick={() => setShowShare(true)}
                  className="text-xs text-violet-300 font-semibold"
                >
                  Share link →
                </button>
              )}
            </div>

            <div className="space-y-2">
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="bg-white/90 backdrop-blur-sm rounded-2xl p-3.5 flex items-center gap-3 border border-white/60 shadow-sm"
                >
                  {item.logo_url ? (
                    <img src={item.logo_url} className="w-9 h-9 rounded-xl border border-gray-100 shrink-0" alt={item.name} />
                  ) : (
                    <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                      <span className="text-violet-700 font-bold text-sm">{(item.name || item.isin || "?")[0]}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{item.name || item.isin}</p>
                    <p className="text-xs text-gray-400">
                      {item.target_quantity} share{item.target_quantity !== 1 ? "s" : ""} · ~{centsToRand(item.price_snapshot_cents)}/share
                    </p>
                    {(item.filled_quantity > 0 || item.reserved_quantity > 0) && (
                      <div className="mt-1">
                        <GiftRegistryProgressBar
                          percent={Math.round(((item.filled_quantity + item.reserved_quantity) / item.target_quantity) * 100)}
                          showLabel={false}
                          height="h-1"
                        />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemove(item.id)}
                    disabled={removingId === item.id}
                    className="p-2 rounded-xl text-red-400 hover:bg-red-50 disabled:opacity-40 shrink-0"
                  >
                    {removingId === item.id ? (
                      <div className="w-4 h-4 border-2 border-red-400/50 border-t-red-400 rounded-full animate-spin" />
                    ) : (
                      <X className="w-4 h-4" />
                    )}
                  </button>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {loading && !current && (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 bg-white/20 rounded-2xl animate-pulse" />
            ))}
          </div>
        )}
      </div>

      {/* Share sheet */}
      {showShare && (registry?.share_token || current?.share_token) && (
        <GiftRegistryShareSheet
          token={registry?.share_token || current?.share_token}
          title={registry?.title || current?.title}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
