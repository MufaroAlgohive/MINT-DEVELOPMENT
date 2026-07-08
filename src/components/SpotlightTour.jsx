import { useState, useLayoutEffect, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * SpotlightTour — a lightweight guided walkthrough in the same visual language
 * as the Home MintBasketsExplainer: a dimmed overlay with a rounded "hole"
 * spotlighting one element at a time, a pulsing ring, a word-revealed bubble,
 * step dots, and Next / Skip.
 *
 * Generic + reusable: point each step at an element via a CSS `selector`
 * (typically a data-coach-* attribute) and give it a title + body.
 *
 * Props:
 *   open      — whether the tour is showing
 *   steps     — [{ selector, title, body }]
 *   onClose   — called on finish/skip (persist "seen" in the caller)
 *   pad       — px of breathing room around the spotlighted element (default 10)
 */
export default function SpotlightTour({ open, steps = [], onClose, pad = 10 }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState(null);
  const rafRef = useRef(0);

  const step = steps[idx];

  // Measure the current step's target (after scrolling it into view). Recomputed
  // on step change, resize and scroll so the hole tracks the element.
  const measure = useCallback(() => {
    if (!step?.selector) { setRect(null); return; }
    const el = document.querySelector(step.selector);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  // On step change: scroll the target into view, then measure once settled.
  useLayoutEffect(() => {
    if (!open || !step?.selector) return;
    const el = document.querySelector(step.selector);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(measure, 320);       // let smooth-scroll settle
    return () => clearTimeout(t);
  }, [open, idx, step, measure]);

  // Keep the hole aligned while the page moves under it.
  useEffect(() => {
    if (!open) return;
    const onMove = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      cancelAnimationFrame(rafRef.current);
    };
  }, [open, measure]);

  // Reset to the first step each time it opens.
  useEffect(() => { if (open) setIdx(0); }, [open]);

  const finish = useCallback(() => { onClose?.(); }, [onClose]);
  const next = useCallback(() => {
    if (idx >= steps.length - 1) finish();
    else setIdx((i) => i + 1);
  }, [idx, steps.length, finish]);

  if (!open || !step) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 360;
  const vh = typeof window !== "undefined" ? window.innerHeight : 640;

  // Spotlight geometry (padded). Falls back to a centred card when the target
  // can't be found, so a missing element never blanks the tour.
  const hole = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  // Place the bubble below the hole if it's in the upper 55% of the screen,
  // otherwise above — so it never runs off-screen.
  const holeCentreY = hole ? hole.top + hole.height / 2 : vh / 2;
  const below = holeCentreY < vh * 0.55;
  const bubbleStyle = hole
    ? (below
        ? { top: Math.min(hole.top + hole.height + 16, vh - 40), left: 16, right: 16 }
        : { bottom: Math.max(vh - hole.top + 16, 40), left: 16, right: 16 })
    : { top: "50%", left: 16, right: 16, transform: "translateY(-50%)" };

  const isLast = idx === steps.length - 1;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100000 }} aria-modal="true" role="dialog">
      <style>{`
        @keyframes stDim { from { opacity: 0 } to { opacity: 1 } }
        @keyframes stRing { 0% { box-shadow: 0 0 0 0 rgba(139,92,246,.55) } 70% { box-shadow: 0 0 0 12px rgba(139,92,246,0) } 100% { box-shadow: 0 0 0 0 rgba(139,92,246,0) } }
        @keyframes stBubble { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes stWord { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
        .st-dim { animation: stDim .3s ease forwards }
        .st-ring { animation: stRing 1.8s cubic-bezier(.22,1,.36,1) infinite }
        .st-bubble { animation: stBubble .4s cubic-bezier(.22,1,.36,1) both }
        .st-word { display: inline-block; opacity: 0; animation: stWord .34s cubic-bezier(.22,1,.36,1) forwards }
      `}</style>

      {/* Dimmer with a transparent hole. The huge box-shadow on the hole element
          darkens everything around it; the hole itself stays clear. */}
      {hole ? (
        <div
          className="st-dim"
          onClick={next}
          style={{
            position: "absolute",
            top: hole.top, left: hole.left, width: hole.width, height: hole.height,
            borderRadius: 18,
            boxShadow: "0 0 0 9999px rgba(15,23,42,.74)",
            cursor: "pointer",
          }}
        >
          {/* Pulsing ring around the spotlight */}
          <div className="st-ring" style={{ position: "absolute", inset: 0, borderRadius: 18, border: "2px solid rgba(196,181,253,.9)" }} />
        </div>
      ) : (
        <div className="st-dim" onClick={next} style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,.74)", cursor: "pointer" }} />
      )}

      {/* Bubble */}
      <div className="st-bubble" style={{ position: "absolute", ...bubbleStyle }}>
        <div style={{ maxWidth: 460, margin: "0 auto", background: "#fff", borderRadius: 22, padding: "18px 20px", boxShadow: "0 20px 60px rgba(15,23,42,.35)" }}>
          {step.title && (
            <p style={{ fontSize: 15, fontWeight: 800, color: "#3b1b7a", margin: 0 }}>{step.title}</p>
          )}
          {step.body && (
            <p style={{ fontSize: 13, lineHeight: 1.55, color: "#475569", margin: "8px 0 0" }}>
              {String(step.body).split(" ").map((w, i) => (
                <span key={i} className="st-word" style={{ animationDelay: `${0.05 + i * 0.028}s`, marginRight: 4 }}>{w}</span>
              ))}
            </p>
          )}

          <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            {/* Step dots */}
            <div style={{ display: "flex", gap: 6 }}>
              {steps.map((_, i) => (
                <span key={i} style={{ width: i === idx ? 18 : 7, height: 7, borderRadius: 99, background: i === idx ? "#7c3aed" : "#e2e8f0", transition: "width .25s, background .25s" }} />
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {!isLast && (
                <button type="button" onClick={finish} style={{ border: "none", background: "none", color: "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Skip</button>
              )}
              <button type="button" onClick={next} style={{ border: "none", borderRadius: 12, background: "linear-gradient(135deg,#6d28d9,#7c3aed)", color: "#fff", fontSize: 13, fontWeight: 700, padding: "9px 18px", cursor: "pointer", boxShadow: "0 4px 14px rgba(124,58,237,.35)" }}>
                {isLast ? "Got it" : "Next →"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
