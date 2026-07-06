import React from "react";

/**
 * Renders an asset logo mosaic inside a wishlist/registry card.
 * items: array of { logo_url } objects (up to 4 shown)
 * fromColor / toColor: gradient stops for the tinted panel background
 */
export default function WishlistPreviewGrid({ items = [], fromColor, toColor }) {
  const logos = items.slice(0, 4).map((it) => it?.logo_url).filter(Boolean);
  const n = logos.length;
  if (n === 0) return null;

  const panelStyle = {
    background: `linear-gradient(135deg, ${fromColor}cc, ${toColor}cc)`,
  };

  const Logo = ({ url, style }) => (
    <div
      className="absolute overflow-hidden flex items-center justify-center"
      style={{ ...panelStyle, ...style }}
    >
      <img
        src={url}
        alt=""
        className="w-[70%] h-[70%] object-contain drop-shadow-sm"
        onError={(e) => { e.target.style.display = "none"; }}
      />
    </div>
  );

  return (
    <div className="absolute inset-0 rounded-2xl overflow-hidden">
      {n === 1 && (
        <Logo url={logos[0]} style={{ inset: 0 }} />
      )}
      {n === 2 && (
        <>
          <Logo url={logos[0]} style={{ top: 0, left: 0, right: "50%", bottom: 0, borderRight: "1px solid rgba(255,255,255,0.15)" }} />
          <Logo url={logos[1]} style={{ top: 0, left: "50%", right: 0, bottom: 0 }} />
        </>
      )}
      {n === 3 && (
        <>
          <Logo url={logos[0]} style={{ top: 0, left: 0, right: "50%", bottom: 0, borderRight: "1px solid rgba(255,255,255,0.15)" }} />
          <Logo url={logos[1]} style={{ top: 0, left: "50%", right: 0, bottom: "50%", borderBottom: "1px solid rgba(255,255,255,0.15)" }} />
          <Logo url={logos[2]} style={{ top: "50%", left: "50%", right: 0, bottom: 0 }} />
        </>
      )}
      {n >= 4 && (
        <>
          <Logo url={logos[0]} style={{ top: 0, left: 0, right: "50%", bottom: "50%", borderRight: "1px solid rgba(255,255,255,0.15)", borderBottom: "1px solid rgba(255,255,255,0.15)" }} />
          <Logo url={logos[1]} style={{ top: 0, left: "50%", right: 0, bottom: "50%", borderBottom: "1px solid rgba(255,255,255,0.15)" }} />
          <Logo url={logos[2]} style={{ top: "50%", left: 0, right: "50%", bottom: 0, borderRight: "1px solid rgba(255,255,255,0.15)" }} />
          <Logo url={logos[3]} style={{ top: "50%", left: "50%", right: 0, bottom: 0 }} />
        </>
      )}
      {/* Bottom scrim so text stays readable */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{ height: "55%", background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 100%)", borderRadius: "0 0 16px 16px" }}
      />
    </div>
  );
}
