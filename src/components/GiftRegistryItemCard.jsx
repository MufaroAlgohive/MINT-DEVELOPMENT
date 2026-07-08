import React from "react";
import { Gift, Calendar } from "lucide-react";
import GiftRegistryProgressBar from "./GiftRegistryProgressBar.jsx";
import { getItemGiftState, getItemFillPercent } from "../lib/giftRegistryUtils.js";
import { formatChangePct, getChangeColor } from "../lib/strategyData.js";

function SparkLine({ positive = true }) {
  const values = positive
    ? [20, 21, 23, 22, 25, 27, 26, 29, 31, 32]
    : [32, 31, 29, 30, 27, 25, 26, 23, 21, 20];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 96, h = 48;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h * 0.8) - h * 0.1;
      return `${x},${y}`;
    })
    .join(" ");
  const lastX = w;
  const lastY = h - ((values[values.length - 1] - min) / range) * (h * 0.8) - h * 0.1;
  const color = positive ? "#5b21b6" : "#ef4444";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={4} fill="white" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}

/**
 * Gift registry item card — BASKET items rendered identically to the MarketsPage
 * strategy card; SHARE items use a clean compact variant.
 *
 * Props:
 *   item         — enriched gift_registry_items row
 *   onGift       — callback(item)
 *   isOwner      — hides gift CTA
 *   canGift      — user is logged in + KYC complete
 *   onAuthPrompt — called when unauthenticated user taps Gift
 *   alreadyGifted — whether the viewer has already contributed to this item
 */
export default function GiftRegistryItemCard({
  item,
  onGift,
  isOwner = false,
  canGift = false,
  onAuthPrompt,
  alreadyGifted = false,
  startDate = null,
  endDate = null,
}) {
  const { state, available } = getItemGiftState(item);
  const percent = getItemFillPercent(item);
  const greyed = state === "GREYED_OUT";
  const remainderOnly = state === "REMAINDER_ONLY";
  const isBasket = item.instrument_type === "BASKET";

  function handleGiftTap() {
    if (!canGift) {
      if (typeof onAuthPrompt === "function") onAuthPrompt();
      return;
    }
    if (typeof onGift === "function") onGift(item);
  }

  // Price with 1.08 markup to match markets page display
  const minRands = item.price_snapshot_cents
    ? (item.price_snapshot_cents / 100) * 1.08
    : null;
  const formattedMin = minRands
    ? `Min. R\u00A0${minRands.toLocaleString("en-ZA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : null;

  const displayName = item.short_name || item.name || item.isin;
  const ytdPositive = (item.r_ytd || 0) >= 0;
  const holdingsSnapshot = item.holdings_snapshot || [];

  if (isBasket) {
    return (
      <div className={greyed ? "opacity-50" : ""}>
        {/* Strategy card — identical layout to MarketsPage */}
        <div className="relative w-full rounded-2xl border border-slate-100 bg-white shadow-sm p-4">
          {/* Already gifted badge */}
          {alreadyGifted && !greyed && (
            <div className="absolute top-3 right-3 bg-violet-50 border border-violet-200 text-violet-600 text-[10px] font-semibold px-2 py-0.5 rounded-full">
              Gifted ✓
            </div>
          )}
          {greyed && (
            <div className="absolute top-3 right-3 bg-gray-100 text-gray-400 text-[10px] font-semibold px-2 py-0.5 rounded-full">
              Funded ✓
            </div>
          )}

          {/* Header: name + mini chart */}
          <div className="flex items-start justify-between gap-4 pr-16">
            <div className="space-y-1 flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900 truncate">
                {displayName}
              </p>
              <p className="text-xs text-slate-600 line-clamp-1">
                {item.risk_level || "Balanced"}
                {item.objective ? ` • ${item.objective}` : ""}
              </p>
              <p className="text-[11px] text-slate-400">
                {formattedMin || "Investment Basket"}
              </p>
            </div>
            <div className="flex items-center rounded-xl bg-slate-50 px-2 py-1 shrink-0">
              <SparkLine positive={ytdPositive} />
            </div>
          </div>

          {/* Tags */}
          <div className="mt-3 flex flex-wrap gap-2">
            {((item.tags && item.tags.length > 0)
              ? item.tags.slice(0, 2)
              : [item.risk_level || "Balanced"]
            ).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
              >
                {tag}
              </span>
            ))}
            {item.is_featured && (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-600">
                Featured
              </span>
            )}
          </div>

          {/* Wishlist window — when this basket started and closes */}
          {(startDate || endDate) && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              {startDate && endDate
                ? `${startDate} – ${endDate}`
                : startDate
                ? `From ${startDate}`
                : `Closes ${endDate}`}
            </div>
          )}

          {/* YTD return row */}
          <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
            <span className="text-xs font-semibold text-slate-600">YTD return</span>
            <div className="flex flex-col items-end gap-0.5">
              <span
                className={`text-xs font-semibold ${
                  item.r_ytd != null ? getChangeColor(item.r_ytd) : "text-slate-400"
                }`}
              >
                {item.r_ytd != null ? formatChangePct(item.r_ytd) : "—"}
              </span>
              {item.ytd_as_of_date && (
                <span className="text-[10px] text-slate-500">
                  {new Date(item.ytd_as_of_date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>

          {/* Holdings snapshot */}
          {holdingsSnapshot.length > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <div className="flex -space-x-2">
                {holdingsSnapshot.slice(0, 3).map((h, i) => (
                  <div
                    key={h.symbol || i}
                    className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white bg-white shadow-sm"
                  >
                    {h.logo_url ? (
                      <img
                        src={h.logo_url}
                        alt={h.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[8px] font-bold text-slate-600">
                        {h.symbol?.substring(0, 2)}
                      </div>
                    )}
                  </div>
                ))}
                {holdingsSnapshot.length > 3 && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-500">
                    +{Math.max(0, (item.total_holdings || holdingsSnapshot.length) - 3)}
                  </div>
                )}
              </div>
              <span className="text-xs font-semibold text-slate-500">
                Holdings snapshot
              </span>
            </div>
          )}

          {/* Progress — inside the card, below holdings */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex justify-between text-xs text-slate-500 mb-1.5">
              <span>
                {item.filled_quantity} / {item.target_quantity} share
                {item.target_quantity !== 1 ? "s" : ""} funded
              </span>
              <span className="font-medium">{percent}%</span>
            </div>
            <GiftRegistryProgressBar
              percent={percent}
              filledQty={item.filled_quantity}
              targetQty={item.target_quantity}
              showLabel={false}
              height="h-1.5"
            />
          </div>
        </div>

        {/* Gift CTA — sits below the card */}
        {!isOwner && (
          <div className="mt-2">
            {greyed ? (
              <div className="w-full py-3 rounded-2xl bg-slate-100 text-slate-400 text-sm text-center font-medium">
                Fully funded
              </div>
            ) : alreadyGifted ? (
              <div className="w-full py-3 rounded-2xl bg-violet-50 border border-violet-200 text-violet-600 text-sm text-center font-medium">
                Already gifted ✓
              </div>
            ) : remainderOnly ? (
              <button
                onClick={handleGiftTap}
                className="w-full py-3 rounded-2xl bg-amber-100 text-amber-700 text-sm text-center font-semibold active:opacity-80"
              >
                Complete this gift ({available} left)
              </button>
            ) : (
              <button
                onClick={handleGiftTap}
                className="w-full py-3 rounded-2xl bg-slate-900 text-white text-sm text-center font-semibold flex items-center justify-center gap-2 active:opacity-80"
              >
                <Gift className="w-4 h-4" />
                {canGift ? "Gift this" : "Sign in to gift"}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── SHARE item — clean compact card ──────────────────────────────────────────
  return (
    <div className={greyed ? "opacity-50" : ""}>
      <div className="relative w-full rounded-2xl border border-slate-100 bg-white shadow-sm p-4">
        {alreadyGifted && !greyed && (
          <div className="absolute top-3 right-3 bg-violet-50 border border-violet-200 text-violet-600 text-[10px] font-semibold px-2 py-0.5 rounded-full">
            Gifted ✓
          </div>
        )}
        {greyed && (
          <div className="absolute top-3 right-3 bg-gray-100 text-gray-400 text-[10px] font-semibold px-2 py-0.5 rounded-full">
            Funded ✓
          </div>
        )}

        <div className="flex items-center gap-3 pr-16">
          {item.logo_url ? (
            <img
              src={item.logo_url}
              alt={item.name}
              className="w-10 h-10 rounded-xl object-cover border border-gray-100 shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <span className="text-slate-600 font-bold text-sm">
                {(item.name || item.isin || "?")[0]}
              </span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 text-sm truncate">
              {item.name || item.isin}
            </p>
            <p className="text-xs text-slate-400">{item.isin}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
          <span className="text-xs font-semibold text-slate-600">Price / share</span>
          <span className="text-xs font-semibold text-slate-800">
            {formattedMin || "—"}
          </span>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>
              {item.filled_quantity} / {item.target_quantity} share
              {item.target_quantity !== 1 ? "s" : ""} funded
            </span>
            <span className="font-medium">{percent}%</span>
          </div>
          <GiftRegistryProgressBar
            percent={percent}
            filledQty={item.filled_quantity}
            targetQty={item.target_quantity}
            showLabel={false}
            height="h-1.5"
          />
        </div>
      </div>

      {!isOwner && (
        <div className="mt-2">
          {greyed ? (
            <div className="w-full py-3 rounded-2xl bg-slate-100 text-slate-400 text-sm text-center font-medium">
              Fully funded
            </div>
          ) : alreadyGifted ? (
            <div className="w-full py-3 rounded-2xl bg-violet-50 border border-violet-200 text-violet-600 text-sm text-center font-medium">
              Already gifted ✓
            </div>
          ) : remainderOnly ? (
            <button
              onClick={handleGiftTap}
              className="w-full py-3 rounded-2xl bg-amber-100 text-amber-700 text-sm text-center font-semibold active:opacity-80"
            >
              Complete this gift ({available} left)
            </button>
          ) : (
            <button
              onClick={handleGiftTap}
              className="w-full py-3 rounded-2xl bg-slate-900 text-white text-sm text-center font-semibold flex items-center justify-center gap-2 active:opacity-80"
            >
              <Gift className="w-4 h-4" />
              {canGift ? "Gift this" : "Sign in to gift"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
