// Advanced debugging helper for tracking down "stuck overlay" bugs where a
// fixed-position, high z-index element silently swallows clicks even though
// it's invisible or supposed to be closed.
//
// Usage: call window.__gtvScanOverlays("some label") from anywhere (console,
// effects, click handlers) and it will:
//  1. Walk every element in the document.
//  2. Keep the ones that are `position: fixed` (or `sticky`) with a z-index
//     >= 1000, since those are the only realistic candidates for "invisible
//     blocker" bugs in this app.
//  3. Report their computed opacity, pointer-events, visibility, size and
//     the actual element under the exact center of the viewport
//     (`document.elementFromPoint`), which tells us definitively what would
//     receive a click right now.
//
// This is intentionally verbose — it's meant to be read in the browser
// console while reproducing the bug, not shipped as silent telemetry.

function describeEl(el) {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    id: el.id || undefined,
    className: typeof el.className === "string" ? el.className.slice(0, 120) : undefined,
    zIndex: cs.zIndex,
    position: cs.position,
    opacity: cs.opacity,
    pointerEvents: cs.pointerEvents,
    visibility: cs.visibility,
    display: cs.display,
    transform: cs.transform !== "none" ? cs.transform : undefined,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
  };
}

export function scanOverlays(label = "") {
  const all = Array.from(document.querySelectorAll("body *"));
  const suspects = all.filter((el) => {
    const cs = window.getComputedStyle(el);
    const z = parseInt(cs.zIndex, 10);
    return (cs.position === "fixed" || cs.position === "sticky") && !Number.isNaN(z) && z >= 1000;
  });

  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const elAtCenter = document.elementFromPoint(centerX, centerY);
  const elAtTopArea = document.elementFromPoint(centerX, 80); // near header/buttons

  console.groupCollapsed(
    `%c[overlayDebug] scan @ ${label || new Date().toISOString()} — ${suspects.length} fixed/sticky high-z element(s)`,
    "color:#f59e0b;font-weight:bold"
  );
  suspects
    .sort((a, b) => (parseInt(window.getComputedStyle(b).zIndex, 10) || 0) - (parseInt(window.getComputedStyle(a).zIndex, 10) || 0))
    .forEach((el, i) => {
      const info = describeEl(el);
      const blocking = info.opacity !== "0" && info.pointerEvents !== "none" && info.display !== "none" && info.visibility !== "hidden";
      console.log(
        `%c#${i} z=${info.zIndex} ${blocking ? "⚠️ COULD BLOCK CLICKS" : "(inert)"} :: ${JSON.stringify(info)}`,
        blocking ? "color:#ef4444;font-weight:bold" : "color:#94a3b8"
      );
    });
  console.log(`Element at viewport center :: ${elAtCenter ? JSON.stringify(describeEl(elAtCenter)) : "null"}`);
  console.log(`Element near top (y=80) :: ${elAtTopArea ? JSON.stringify(describeEl(elAtTopArea)) : "null"}`);
  console.groupEnd();

  const blockingSuspects = suspects.filter((el) => {
    const cs = window.getComputedStyle(el);
    return cs.opacity !== "0" && cs.pointerEvents !== "none" && cs.display !== "none" && cs.visibility !== "hidden";
  });

  window.__gtvLastScan = {
    label,
    time: Date.now(),
    blockingCount: blockingSuspects.length,
    totalSuspects: suspects.length,
    centerEl: elAtCenter ? describeEl(elAtCenter) : null,
  };
  window.dispatchEvent(new CustomEvent("gtv-overlay-scan", { detail: window.__gtvLastScan }));

  return { suspects, elAtCenter, elAtTopArea };
}

if (typeof window !== "undefined") {
  window.__gtvScanOverlays = scanOverlays;
}
