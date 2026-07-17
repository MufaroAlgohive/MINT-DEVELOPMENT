import React from "react";

/**
 * Renders overlapping circular avatars for items in a wishlist card.
 * Designed as a normal-flow element (not absolutely positioned) so it
 * sits cleanly in a flex-column card without overlapping sibling text.
 *
 * items: array of { logo_url, name, isin } — up to 5 shown, rest as "+N"
 */
export default function WishlistPreviewGrid({ items = [] }) {
  const visible = items.slice(0, 5);
  const extraCount = Math.max(0, items.length - 5);
  if (visible.length === 0) return null;

  const size = 32;
  const overlap = 10;

  return (
    <div className="flex items-center" style={{ gap: 0 }}>
      {visible.map((item, i) => {
        const initials = (item.name || item.isin || "?")
          .replace(/\.[A-Z]+$/, "")
          .slice(0, 2)
          .toUpperCase();

        return (
          <div
            key={i}
            className="rounded-full border-2 border-white/70 bg-white overflow-hidden flex items-center justify-center flex-shrink-0 shadow"
            style={{
              width: size,
              height: size,
              marginLeft: i === 0 ? 0 : -overlap,
              zIndex: visible.length - i,
              position: "relative",
            }}
          >
            {item.logo_url ? (
              <img
                src={item.logo_url}
                alt={initials}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = "none";
                  if (e.target.nextSibling) e.target.nextSibling.style.display = "flex";
                }}
              />
            ) : null}
            <span
              className="text-[9px] font-bold text-slate-500 items-center justify-center w-full h-full"
              style={{ display: item.logo_url ? "none" : "flex" }}
            >
              {initials}
            </span>
          </div>
        );
      })}

      {extraCount > 0 && (
        <div
          className="rounded-full border-2 border-white/70 bg-white/25 backdrop-blur-sm flex items-center justify-center flex-shrink-0 shadow"
          style={{ width: size, height: size, marginLeft: -overlap, position: "relative", zIndex: 0 }}
        >
          <span className="text-[9px] font-bold text-white drop-shadow">+{extraCount}</span>
        </div>
      )}
    </div>
  );
}
