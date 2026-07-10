import React from "react";

/**
 * Renders a stacked-circle holding preview inside a wishlist/registry card,
 * matching the strategy-card aesthetic (overlapping circular avatars).
 *
 * items: array of { logo_url, name, isin } — up to 5 shown, rest as "+N"
 */
export default function WishlistPreviewGrid({ items = [] }) {
  const visible = items.slice(0, 5);
  const extraCount = Math.max(0, items.length - 5);
  if (visible.length === 0) return null;

  // Avatar size scales with how many we show
  const size = visible.length <= 3 ? 40 : 34;
  const overlap = Math.round(size * 0.35);

  return (
    <div
      className="absolute inset-x-0 flex items-center justify-center pointer-events-none"
      style={{ top: "50%", transform: "translateY(-62%)", zIndex: 1 }}
    >
      <div className="flex items-center" style={{ marginRight: -(overlap * (visible.length - 1)) }}>
        {visible.map((item, i) => { // eslint-disable-line react/no-array-index-key
          const initials = (item.name || item.isin || "?")
            .replace(/\.[A-Z]+$/, "") // strip exchange suffix e.g. ".JO"
            .slice(0, 2)
            .toUpperCase();

          return (
            <div
              key={i}
              className="rounded-full border-2 border-white/80 bg-white overflow-hidden flex items-center justify-center flex-shrink-0 shadow-md"
              style={{
                width: size,
                height: size,
                marginRight: i < visible.length - 1 ? -overlap : 0,
                zIndex: visible.length - i,
              }}
            >
              {item.logo_url ? (
                <img
                  src={item.logo_url}
                  alt={initials}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = "none";
                    e.target.nextSibling && (e.target.nextSibling.style.display = "flex");
                  }}
                />
              ) : null}
              <span
                className="text-[10px] font-bold text-slate-500 items-center justify-center w-full h-full"
                style={{ display: item.logo_url ? "none" : "flex" }}
              >
                {initials}
              </span>
            </div>
          );
        })}

        {extraCount > 0 && (
          <div
            className="rounded-full border-2 border-white/80 bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0 shadow-md"
            style={{ width: size, height: size, marginLeft: -overlap, zIndex: 0 }}
          >
            <span className="text-[9px] font-bold text-white drop-shadow">+{extraCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}
