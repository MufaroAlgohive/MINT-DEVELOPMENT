/**
 * Shared security card components used by both MarketsPage and GiftStrategyPickerPage.
 * SecuritySparklineCard  — horizontal sparkline card (CollapsibleSection expanded view)
 * CompactSecurityRow     — 2-column compact tile (CollapsibleSection collapsed view)
 * CollapsibleSection     — section wrapper that toggles between the two views
 */
import React, { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, Heart, ChevronRight } from "lucide-react";
import { Area, ComposedChart, ResponsiveContainer } from "recharts";

// Deterministic hue from ticker symbol so each asset gets its own pastel colour
export function symbolToHue(symbol) {
  const str = symbol || "XX";
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash * 31) + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

// Deterministic sparkline from symbol string — used as fallback before real data loads
export function generateSparkline(security) {
  const sym = security.symbol || "XX";
  const seed = sym.split("").reduce((acc, c, i) => acc + c.charCodeAt(0) * (i + 1), 0);
  const changePct = security.changePct || 0;
  const points = [];
  let val = 50;
  for (let i = 0; i < 14; i++) {
    const pseudo = ((seed * (i + 7) * 2654435761) >>> 0) % 1000;
    const noise = (pseudo / 1000 - 0.5) * 6;
    const trend = changePct * 0.12;
    val = Math.max(5, Math.min(95, val + noise + trend));
    points.push(val);
  }
  return points.map((p, i) => ({ i, v: p }));
}

export const CompactSecurityRow = ({ security, onClick }) => {
  const isPositive = (security.changePct ?? 0) >= 0;
  const hue = symbolToHue(security.symbol);
  const bg = `linear-gradient(135deg, hsl(${hue},18%,98.5%) 0%, hsl(${(hue + 25) % 360},12%,96.5%) 100%)`;
  const borderColor = `hsl(${hue},15%,92%)`;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full rounded-2xl px-3.5 py-2.5 text-left active:scale-[0.97] transition-transform border"
      style={{ background: bg, borderColor }}
    >
      {security.logo_url ? (
        <img src={security.logo_url} alt={security.symbol} className="h-9 w-9 rounded-full border border-white/70 object-cover flex-shrink-0 shadow-sm" />
      ) : (
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-purple-600 text-[10px] font-bold text-white shadow-sm">
          {security.symbol?.substring(0, 2) || "—"}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-900 truncate">{security.symbol}</p>
        <p className={`text-xs font-semibold ${isPositive ? "text-emerald-600" : "text-red-500"}`}>
          {isPositive ? "+" : ""}{security.changePct != null ? security.changePct.toFixed(2) : "—"}%
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-400/70 flex-shrink-0" />
    </button>
  );
};

export const SecuritySparklineCard = ({ security, onClick, onToggleWatchlist, onToggleWishlist, isWatched, isWishlisted, sparklinePoints }) => {
  const hasRealData = sparklinePoints && sparklinePoints.length >= 2;
  const sparkData = useMemo(() => {
    if (hasRealData) return sparklinePoints;
    return generateSparkline(security);
  }, [sparklinePoints, security.symbol, security.changePct]);
  const isPositive = (security.changePct ?? 0) >= 0;
  const gradientId = `sg-${security.id || security.symbol}`;

  return (
    <button
      onClick={onClick}
      className="relative flex-shrink-0 w-44 snap-center rounded-2xl text-left shadow-[0_2px_12px_-2px_rgba(0,0,0,0.08)] border border-[#e8edf8] transition-all active:scale-[0.96] overflow-hidden"
      style={{ background: "#eef1fa" }}
    >
      {/* Header */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex items-center gap-1.5 mb-2">
          {security.logo_url ? (
            <img
              src={security.logo_url}
              alt={security.symbol}
              className="h-7 w-7 rounded-full border border-slate-100 object-cover flex-shrink-0"
            />
          ) : (
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-purple-600 text-[10px] font-bold text-white">
              {security.symbol?.substring(0, 2) || "—"}
            </div>
          )}
          <span className="flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">{security.symbol}</span>
        </div>

        {/* Change % */}
        <p className={`text-base font-bold leading-tight ${isPositive ? "text-emerald-500" : "text-red-500"}`}>
          {isPositive ? "+" : ""}{security.changePct != null ? security.changePct.toFixed(2) : "—"}%
        </p>

        {/* Price */}
        <p className="mt-0.5 leading-none">
          {security.currentPrice != null ? (
            <>
              <span className="text-[10px] font-semibold text-slate-400 tracking-widest align-middle">R</span>
              <span className="ml-0.5 text-sm font-bold text-slate-700 tracking-tight tabular-nums">
                {Number(security.currentPrice).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </>
          ) : (
            <span className="text-sm text-slate-400">—</span>
          )}
        </p>
      </div>

      {/* Bookmark + Heart — bottom-right overlay */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 z-10">
        {onToggleWatchlist && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleWatchlist(e, security.symbol); }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/70 backdrop-blur-sm shadow-sm active:scale-90 transition-transform"
          >
            <Bookmark className={`h-5 w-5 ${isWatched ? "fill-yellow-400 text-yellow-400" : "text-slate-400"}`} />
          </button>
        )}
        {onToggleWishlist && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleWishlist(e, security.symbol); }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/70 backdrop-blur-sm shadow-sm active:scale-90 transition-transform"
          >
            <Heart className={`h-5 w-5 ${isWishlisted ? "fill-red-500 text-red-500" : "text-slate-400"}`} />
          </button>
        )}
      </div>

      {/* Sparkline chart */}
      <div className="relative w-full" style={{ height: 60 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={sparkData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="v"
              stroke="#2563eb"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={false}
              isAnimationActive={hasRealData}
              animationBegin={0}
              animationDuration={700}
              animationEasing="ease-out"
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Left-to-right shimmer sweep while real price data is still loading */}
        <AnimatePresence>
          {!hasRealData && (
            <motion.div
              key="chart-shimmer"
              className="pointer-events-none absolute inset-0"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent"
                initial={{ x: "-100%" }}
                animate={{ x: "100%" }}
                transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.25 }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </button>
  );
};

export const CollapsibleSection = ({ title, securities, onOpenStockDetail, onToggleWatchlist, onToggleWishlist, watchlist, wishlistedKeys, sparklineData, isExpanded, sectionRef }) => {
  if (securities.length === 0) return null;

  return (
    <section ref={sectionRef}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</h2>
        <ChevronRight className="h-4 w-4 text-slate-300" />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {isExpanded ? (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-4 scrollbar-hide"
          >
            {securities.map((security) => (
              <SecuritySparklineCard
                key={security.id}
                security={security}
                onClick={() => onOpenStockDetail(security)}
                onToggleWatchlist={onToggleWatchlist}
                onToggleWishlist={onToggleWishlist}
                isWatched={watchlist?.includes(security.symbol)}
                isWishlisted={wishlistedKeys?.has(security.symbol)}
                sparklinePoints={sparklineData?.[security.id]}
              />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="collapsed"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="grid grid-cols-2 gap-1.5 pb-2"
          >
            {securities.slice(0, 4).map((security) => (
              <CompactSecurityRow
                key={security.id}
                security={security}
                onClick={() => onOpenStockDetail(security)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};
