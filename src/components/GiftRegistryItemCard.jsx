import React from "react";
import GiftRegistryProgressBar from "./GiftRegistryProgressBar.jsx";
import {
  getItemGiftState,
  getItemFillPercent,
  centsToRand,
} from "../lib/giftRegistryUtils.js";

/**
 * Single wishlist item card — shows progress, price, min tranche, and gift CTA.
 *
 * Props:
 *   item          — gift_registry_items row (enriched with name/logo)
 *   onGift        — callback(item) — opens checkout sheet
 *   isOwner       — hides the Gift button when the registry creator is viewing
 *   canGift       — whether the viewer is logged in + KYC-complete (Decision 1/3)
 *   onAuthPrompt  — called when unauthenticated user taps Gift
 */
export default function GiftRegistryItemCard({
  item,
  onGift,
  isOwner = false,
  canGift = false,
  onAuthPrompt,
  alreadyGifted = false,
}) {
  const { state, available } = getItemGiftState(item);
  const percent = getItemFillPercent(item);
  const greyed = state === "GREYED_OUT";
  const remainderOnly = state === "REMAINDER_ONLY";

  function handleGiftTap() {
    if (!canGift) {
      if (typeof onAuthPrompt === "function") onAuthPrompt();
      return;
    }
    if (typeof onGift === "function") onGift(item);
  }

  return (
    <div
      className={`bg-white rounded-2xl p-4 shadow-sm border border-gray-100 ${
        greyed ? "opacity-50" : ""
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 mb-3">
        {item.logo_url ? (
          <img
            src={item.logo_url}
            alt={item.name}
            className="w-10 h-10 rounded-xl object-cover border border-gray-100"
          />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
            <span className="text-purple-700 font-bold text-sm">
              {(item.name || item.isin || "?")[0]}
            </span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 text-sm truncate">
            {item.name || item.isin}
          </p>
          <p className="text-xs text-gray-400">
            {item.instrument_type === "BASKET" ? "Investment Basket" : item.isin}
          </p>
        </div>

        {greyed ? (
          <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full shrink-0">
            Funded ✓
          </span>
        ) : alreadyGifted ? (
          <span className="text-xs bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full shrink-0 font-medium">
            Already gifted ✓
          </span>
        ) : null}
      </div>

      {/* Price & target */}
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs text-gray-400">
          ~{centsToRand(item.price_snapshot_cents)} / share
        </span>
        <span className="text-xs text-gray-500">
          {item.filled_quantity} / {item.target_quantity} share
          {item.target_quantity !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Progress bar */}
      <GiftRegistryProgressBar
        percent={percent}
        filledQty={item.filled_quantity}
        targetQty={item.target_quantity}
        showLabel={false}
        height="h-1.5"
      />

      {/* Min tranche info */}
      {item.min_tranche_quantity > 0 && !greyed && (
        <p className="text-[10px] text-gray-400 mt-1">
          Minimum gift: {item.min_tranche_quantity} share
          {item.min_tranche_quantity !== 1 ? "s" : ""} (
          {centsToRand(
            (item.min_tranche_quantity ?? 1) * (item.price_snapshot_cents ?? 0)
          )}
          )
        </p>
      )}

      {/* Gift button — only shown on gifter side */}
      {!isOwner && (
        <div className="mt-3">
          {greyed ? (
            <div className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-400 text-sm text-center font-medium">
              Fully funded
            </div>
          ) : alreadyGifted ? (
            <button
              onClick={handleGiftTap}
              className="w-full py-2.5 rounded-xl bg-violet-50 border border-violet-200 text-violet-600 text-sm text-center font-semibold active:opacity-80"
            >
              Gift again
            </button>
          ) : remainderOnly ? (
            <button
              onClick={handleGiftTap}
              className="w-full py-2.5 rounded-xl bg-amber-100 text-amber-700 text-sm text-center font-semibold"
            >
              Complete this gift ({available} left)
            </button>
          ) : (
            <button
              onClick={handleGiftTap}
              className="w-full py-2.5 rounded-xl bg-[#6B21A8] text-white text-sm text-center font-semibold active:opacity-80"
            >
              {canGift ? "Gift this" : "Sign in to gift"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
