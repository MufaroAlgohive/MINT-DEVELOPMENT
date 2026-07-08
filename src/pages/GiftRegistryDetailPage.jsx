import React, { useState, useId, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { Heart } from "lucide-react";
import { useRegistryDetail, useRegistryContributions } from "../lib/useGiftRegistry.js";
import { useGiftRegistryRealtime } from "../lib/useGiftRegistryRealtime.js";
import { supabaseReady } from "../lib/supabase.js";
import {
  getItemFillPercent,
  OCCASION_LABELS,
  REGISTRY_STATUS_META,
  centsToRand,
} from "../lib/giftRegistryUtils.js";
import GiftRegistrySharePopup from "../components/GiftRegistrySharePopup.jsx";
import WishlistToast from "../components/WishlistToast.jsx";

/* ─── Sparkline helpers (deterministic, same approach as GiftStrategyPickerPage) ─── */

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

function ItemSparkline({ seed }) {
  const gradId = useId();
  const data = useMemo(() => generateSparkline(seed), [seed]);

  return (
    <div className="w-24 h-12">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5b21b6" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#5b21b6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke="#5b21b6"
            strokeWidth={2}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Strategy-card-style item card — identical look to Mint Baskets card ─── */

function WishlistItemCard({ item, onRemove, registryStatus, onPublish, publishLoading }) {
  const percent = getItemFillPercent(item);
  const filled = item.filled_quantity || 0;
  const target = item.target_quantity || 0;
  const priceCents = item.price_snapshot_cents || 0;
  const isFunded = filled >= target && target > 0;
  const isBasket = item.instrument_type === "BASKET";
  const reserved = item.reserved_quantity ?? 0;
  const isDraft = registryStatus === "DRAFT";

  // For BASKET items: holdings_snapshot is [{logo_url, symbol, name}] from server enrichment
  const holdingsSnapshot = item.holdings_snapshot || [];
  const totalHoldings = item.total_holdings || holdingsSnapshot.length;

  // Price label: for baskets, price_snapshot_cents is the SUM of holding prices (i.e. total basket cost),
  // NOT a meaningful per-unit minimum — so we omit it for baskets and show the type label only.
  // For equities: show price per share.
  const priceLabel = isBasket
    ? null
    : priceCents > 0
    ? `${centsToRand(priceCents)} / share`
    : null;

  return (
    <motion.div
      layout
      initial={false}
      exit={{ opacity: 0, scale: 0.82, x: -24, transition: { duration: 0.28, ease: "easeIn" } }}
      className={`relative flex-shrink-0 w-80 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all snap-center hover:shadow-md hover:border-slate-200 ${
        isFunded ? "opacity-70" : ""
      }`}
    >
      {/* Heart icon — bottom-right, unlikes/removes item from wishlist */}
      {onRemove && (
        <div className="absolute bottom-3 right-3 z-10">
          <motion.button
            type="button"
            whileTap={{ scale: 0.7 }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(item.id, item.name || item.isin); }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm"
            aria-label="Unlike and remove from wishlist"
          >
            <motion.span
              initial={{ scale: 1 }}
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 0.35 }}
            >
              <Heart className="h-5 w-5 fill-red-500 text-red-500" />
            </motion.span>
          </motion.button>
        </div>
      )}

      {/* Top row: name block + sparkline — identical layout to Mint Basket strategy card */}
      <div className="flex items-start gap-3">
        <div className="flex-1 flex items-start justify-between gap-4">
          <div className="text-left space-y-1 pr-8">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900 leading-snug">
              {item.name || item.isin}
            </p>
            <div>
              <p className="text-xs text-slate-600 line-clamp-1">
                {isBasket ? "Investment Basket" : "Equity"}
                {!isBasket && item.isin ? ` · ${item.isin}` : ""}
              </p>
              {priceLabel && (
                <p className="text-[11px] text-slate-400">{priceLabel}</p>
              )}
            </div>
          </div>
          <div className="flex items-center rounded-xl bg-slate-50 px-2">
            <ItemSparkline seed={item.isin || item.name || "item"} />
          </div>
        </div>
      </div>

      {/* Tags row — identical pill style to strategy card */}
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
          {isBasket
            ? totalHoldings > 0 ? `${totalHoldings} holdings` : "Basket"
            : "Equity"}
        </span>
        {isFunded ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600">
            Funded ✓
          </span>
        ) : !isBasket && (
          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-600">
            {filled} / {target} share{target !== 1 ? "s" : ""}
          </span>
        )}
        {reserved > 0 && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-600">
            {reserved} reserved
          </span>
        )}
      </div>

      {/* Gift-progress row — identical layout to YTD return row */}
      <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
        <span className="text-xs font-semibold text-slate-600">Gift progress</span>
        <span
          className={`text-xs font-bold ${
            percent === 100 ? "text-emerald-600" : "text-[#6B21A8]"
          }`}
        >
          {percent}%
        </span>
      </div>

      {/* Holdings snapshot — BASKET: overlapping logo circles; SHARE: single logo */}
      <div className="mt-3 flex items-center gap-3">
        {isBasket && holdingsSnapshot.length > 0 ? (
          <>
            <div className="flex -space-x-2">
              {holdingsSnapshot.slice(0, 3).map((h) => (
                <div
                  key={h.symbol}
                  className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow-sm"
                >
                  {h.logo_url ? (
                    <img src={h.logo_url} alt={h.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">
                      {h.symbol?.substring(0, 2)}
                    </div>
                  )}
                </div>
              ))}
              {totalHoldings > 3 && (
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-500">
                  +{totalHoldings - 3}
                </div>
              )}
            </div>
            <span className="text-xs font-semibold text-slate-500">Holdings snapshot</span>
          </>
        ) : (
          <>
            <div className="flex -space-x-2">
              {item.logo_url ? (
                <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow-sm">
                  <img src={item.logo_url} alt={item.name} className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white bg-violet-100 text-[8px] font-bold text-violet-700 shadow-sm">
                  {(item.name || item.isin || "?")[0]}
                </div>
              )}
            </div>
            <span className="text-xs font-semibold text-slate-500">Holdings snapshot</span>
          </>
        )}
      </div>

      {/* Publish to Share — shown on item cards when the registry is still a DRAFT */}
      {isDraft && onPublish && (
        <button
          onClick={(e) => { e.stopPropagation(); onPublish(); }}
          disabled={publishLoading}
          className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-black py-2.5 text-sm font-semibold text-white active:opacity-80 disabled:opacity-50 transition-opacity"
        >
          {publishLoading ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
          ) : (
            "Publish to Share"
          )}
        </button>
      )}
    </motion.div>
  );
}

/* ─── Gifter avatar (unchanged) ─── */

function GifterAvatar({ name, email }) {
  const initials = name
    ? name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()
    : email
    ? email[0].toUpperCase()
    : "?";
  return (
    <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
      <span className="text-violet-700 font-bold text-xs">{initials}</span>
    </div>
  );
}

/* ─── Main page ─── */

export default function GiftRegistryDetailPage({ registryId, onNavigate, onBack }) {
  const { registry, loading, reload } = useRegistryDetail(registryId);
  const { contributions } = useRegistryContributions(registryId);
  const [showShare, setShowShare] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishedToken, setPublishedToken] = useState(null); // share_token from publish response, before reload settles
  const [viewCount, setViewCount] = useState(null);
  const [activeTab, setActiveTab] = useState("items"); // "items" | "history"
  const [removingIds, setRemovingIds] = useState(new Set());
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  useGiftRegistryRealtime(registryId, () => reload());

  useEffect(() => {
    if (!registryId || !["ACTIVE", "PAUSED", "COMPLETED"].includes(registry?.status)) return;
    let cancelled = false;
    (async () => {
      try {
        const sb = await supabaseReady;
        const { data: { session } } = await sb.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const res = await fetch(`/api/gift-registry/${registryId}/view-count`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setViewCount(json.count ?? null);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [registryId, registry?.status]);

  const items = registry?.items || [];
  const meta = REGISTRY_STATUS_META[registry?.status] || REGISTRY_STATUS_META.DRAFT;

  const daysRemaining = useMemo(() => {
    if (!registry?.event_date) return null;
    const diff = new Date(registry.event_date).getTime() - Date.now();
    const d = Math.ceil(diff / 86_400_000);
    return d > 0 ? d : null;
  }, [registry?.event_date]);

  const OCCASION_EMOJI = { BIRTHDAY: "🎂", WEDDING: "💍", BABY: "👶", GRADUATION: "🎓", FESTIVE: "🎄", CUSTOM: "🎉" };

  async function removeItem(itemId, itemName) {
    // Play the unlike/exit animation immediately, then delete once it has visually left.
    setRemovingIds((prev) => new Set(prev).add(itemId));
    setToastMsg(`Removed "${itemName || "item"}" from wishlist`);
    setToastVisible(true);

    await new Promise((r) => setTimeout(r, 300));

    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch(`/api/gift-registry/items/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Could not remove item");
      }
      reload();
    } catch (e) {
      console.error("[registry] remove item error:", e.message);
      // Removal failed server-side — bring the card back and let the user know.
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      setToastMsg("Could not remove item — please try again");
      setToastVisible(true);
    }
  }

  async function handlePublish() {
    setPublishLoading(true);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch(`/api/gift-registry/${registryId}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not publish wishlist");
      // Capture the share_token immediately from the API response so the
      // popup can open before the reload() re-fetch settles.
      const newToken = json.registry?.share_token;
      if (newToken) setPublishedToken(newToken);
      reload();
      setShowShare(true);
    } catch (e) {
      console.error("[registry] publish error:", e.message);
    } finally {
      setPublishLoading(false);
    }
  }

  if (loading && !registry) {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fc] pb-24">
      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 rounded-xl text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-800 truncate">{registry?.title}</h1>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${meta.color}`}>
                {meta.label}
              </span>
              <span className="text-xs text-gray-400">
                {OCCASION_LABELS[registry?.occasion] || registry?.occasion}
              </span>
            </div>
          </div>
          {registry?.share_token && ["ACTIVE", "PAUSED"].includes(registry?.status) && (
            <button
              onClick={() => setShowShare(true)}
              className="p-2 rounded-xl bg-purple-50 text-[#6B21A8]"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Countdown + view count pills */}
      {(daysRemaining || viewCount !== null) && (
        <div className="px-5 pt-4 flex flex-wrap gap-2">
          {daysRemaining && (
            <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
              <span className="text-base leading-none">{OCCASION_EMOJI[registry?.occasion] || "🎉"}</span>
              <span className="text-xs font-semibold text-amber-700">
                {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} to go
              </span>
            </div>
          )}
          {viewCount !== null && viewCount > 0 && (
            <div className="inline-flex items-center gap-1.5 bg-violet-50 border border-violet-200 rounded-full px-3 py-1.5">
              <span className="text-base leading-none">👀</span>
              <span className="text-xs font-semibold text-violet-700">
                {viewCount} viewer{viewCount !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="px-5 pt-4">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[
            { key: "items", label: "Items" },
            { key: "history", label: `Gift history${contributions.length > 0 ? ` (${contributions.length})` : ""}` },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                activeTab === tab.key
                  ? "bg-white text-[#6B21A8] shadow-sm"
                  : "text-gray-500"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 pt-5 space-y-5">
        {/* ── Items tab ── */}
        {activeTab === "items" && (
          <>
            {items.length > 0 && (
              <div>
                <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-5 px-5">
                  <AnimatePresence initial={false}>
                    {items
                      .filter((item) => !removingIds.has(item.id))
                      .map((item) => (
                        <WishlistItemCard
                          key={item.id}
                          item={item}
                          onRemove={removeItem}
                          registryStatus={registry?.status}
                          onPublish={handlePublish}
                          publishLoading={publishLoading}
                        />
                      ))}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* Share CTA — shown when registry is published */}
            {registry?.share_token && ["ACTIVE", "PAUSED"].includes(registry?.status) && (
              <button
                onClick={() => setShowShare(true)}
                className="w-full flex items-center justify-between gap-3 rounded-2xl bg-[#6B21A8] px-5 py-4 text-white active:opacity-80 transition-opacity"
              >
                <div className="text-left">
                  <p className="text-sm font-bold leading-tight">Share your wishlist</p>
                  <p className="text-[11px] text-purple-200 mt-0.5">Send the link to friends &amp; family</p>
                </div>
                <svg className="w-5 h-5 shrink-0 text-purple-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </button>
            )}
          </>
        )}

        {/* ── Gift history tab ── */}
        {activeTab === "history" && (
          <div>
            {contributions.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-2xl mb-2">🎁</p>
                <p className="text-sm font-semibold text-gray-700">No gifts yet</p>
                <p className="text-xs text-gray-400 mt-1">Gifts will appear here once someone contributes to your wishlist</p>
              </div>
            ) : (
              <div className="space-y-3">
                {contributions.map((c) => {
                  const displayName = c.gifter_name || c.gifter_email || "Anonymous";
                  const subLabel = c.gifter_name && c.gifter_email && c.gifter_name !== c.gifter_email
                    ? c.gifter_email
                    : null;
                  const amountCents = c.executed_amount_cents || c.quoted_amount_cents || 0;
                  const itemForContrib = items.find((it) => it.id === c.registry_item_id);
                  const itemLabel = itemForContrib?.name || itemForContrib?.isin || null;

                  return (
                    <div
                      key={c.id}
                      className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <GifterAvatar name={c.gifter_name} email={c.gifter_email} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{displayName}</p>
                          {subLabel && (
                            <p className="text-xs text-gray-400 truncate">{subLabel}</p>
                          )}
                          {itemLabel && (
                            <p className="text-xs text-violet-600 font-medium truncate mt-0.5">{itemLabel}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-gray-800">{amountCents > 0 ? centsToRand(amountCents) : "—"}</p>
                          <span
                            className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-medium mt-1 ${
                              c.status === "SETTLED"
                                ? "bg-green-100 text-green-700"
                                : c.status === "FAILED"
                                ? "bg-red-100 text-red-600"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {c.status === "PAID" ? "Processing" : c.status === "SETTLED" ? "Settled" : c.status}
                          </span>
                        </div>
                      </div>
                      {c.gifter_message && (
                        <p className="mt-3 text-xs text-gray-500 italic border-t border-gray-100 pt-2">
                          "{c.gifter_message}"
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {showShare && (publishedToken || registry?.share_token) && (
        <GiftRegistrySharePopup
          token={publishedToken || registry.share_token}
          title={registry?.title}
          registryId={registryId}
          onClose={() => { setShowShare(false); setPublishedToken(null); }}
          onNavigate={onNavigate}
        />
      )}

      <WishlistToast
        message={toastMsg}
        visible={toastVisible}
        onHide={() => setToastVisible(false)}
      />
    </div>
  );
}
