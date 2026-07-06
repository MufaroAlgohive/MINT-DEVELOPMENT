import React from "react";

/**
 * Reusable horizontal progress bar for registry item fill state.
 * Props:
 *   percent      — 0-100
 *   filledQty    — number of shares funded
 *   targetQty    — total target shares
 *   showLabel    — whether to show "N / M shares" text (default true)
 *   height       — Tailwind height class (default "h-2")
 *   colorClass   — Tailwind fill colour (default purple gradient)
 */
export default function GiftRegistryProgressBar({
  percent = 0,
  filledQty,
  targetQty,
  showLabel = true,
  height = "h-2",
  colorClass = "bg-gradient-to-r from-[#6B21A8] to-[#9333EA]",
}) {
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <div className="w-full">
      <div className={`w-full ${height} bg-gray-100 rounded-full overflow-hidden`}>
        <div
          className={`${height} ${colorClass} rounded-full transition-all duration-500`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && filledQty != null && targetQty != null && (
        <p className="text-[10px] text-gray-400 mt-1">
          {filledQty} / {targetQty} share{targetQty !== 1 ? "s" : ""} funded ({clamped}%)
        </p>
      )}
    </div>
  );
}
