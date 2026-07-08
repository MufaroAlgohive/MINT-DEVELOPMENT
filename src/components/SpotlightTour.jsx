import { useState, useLayoutEffect, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

/**
 * SpotlightTour — generic guided walkthrough in the SAME frame and feel as the
 * Home tutorial (MintBasketsExplainer): frosted-glass dim (blur 7px, black/20)
 * with a clear hole over the target, the white pulsing ring, and the dark
 * glass callout (step dots → bold title → divider → word-by-word body →
 * Skip / Next buttons).
 *
 * Steps: [{ selector, title, body }] — steps whose selector isn't on the page
 * (e.g. "Your Goals" when the user has no goals) are skipped automatically.
 */

const PANEL = {
  backdropFilter: "blur(7px)",
  WebkitBackdropFilter: "blur(7px)",
  background: "rgba(0,0,0,0.20)",
  position: "fixed",
};

const GLASS = {
  background: "rgba(8,8,20,0.88)",
  backdropFilter: "blur(28px)",
  WebkitBackdropFilter: "blur(28px)",
  border: "1px solid rgba(255,255,255,0.14)",
};

/* Frosted dim in 4 panels around the hole (backdrop-filter needs real panels —
   a box-shadow can't blur what's behind it). Tapping anywhere advances. */
function HoleOverlay({ hole, onAdvance }) {
  if (!hole) {
    return <motion.div className="fixed inset-0" style={{ ...PANEL, zIndex: 100000 }} onClick={onAdvance}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />;
  }
  const { top: t, left: l, width: w, height: h } = hole;
  const r = l + w, b = t + h;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
      style={{ position: "fixed", inset: 0, zIndex: 100000 }} onClick={onAdvance}>
      <div style={{ ...PANEL, top: 0, left: 0, right: 0, height: Math.max(0, t) }} />
      <div style={{ ...PANEL, top: b, left: 0, right: 0, bottom: 0 }} />
      <div style={{ ...PANEL, top: t, left: 0, width: Math.max(0, l), height: h }} />
      <div style={{ ...PANEL, top: t, left: r, right: 0, height: h }} />
      {/* Transparent blocker over the hole — the spotlighted element can't be
          pressed mid-tour; tapping it advances instead. */}
      <div style={{ position: "fixed", zIndex: 100002, top: t, left: l, width: w, height: h, background: "transparent" }} />
    </motion.div>
  );
}

/* The Home tutorial's ring: solid white ring with dark outline + white glow,
   and two expanding pulse rings. */
function AnimatedRing({ rect, pad = 10, borderRadius = 20 }) {
  if (!rect) return null;
  const style = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  return (
    <div className="pointer-events-none fixed" style={{ ...style, zIndex: 100001 }}>
      <div className="absolute inset-0" style={{
        borderRadius,
        border: "2px solid rgba(255,255,255,0.90)",
        boxShadow: "0 0 0 1.5px rgba(0,0,0,0.28), 0 0 16px 4px rgba(255,255,255,0.22)",
      }} />
      <motion.div className="absolute inset-0" style={{ borderRadius, border: "1.5px solid rgba(255,255,255,0.60)" }}
        animate={{ opacity: [0.7, 0], scale: [1, 1.55] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }} />
      <motion.div className="absolute inset-0" style={{ borderRadius, border: "1px solid rgba(255,255,255,0.40)" }}
        animate={{ opacity: [0.5, 0], scale: [1, 1.85] }} transition={{ duration: 1.4, delay: 0.45, repeat: Infinity, ease: "easeOut" }} />
    </div>
  );
}

function WordReveal({ text, baseDelay = 0 }) {
  const words = useMemo(() => String(text).split(" "), [text]);
  return (
    <>
      {words.map((word, i) => (
        <motion.span key={i} initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: baseDelay + i * 0.048, duration: 0.26, ease: "easeOut" }}
          style={{ display: "inline-block", marginRight: "0.26em" }}>
          {word}
        </motion.span>
      ))}
    </>
  );
}

function StepDots({ step, total }) {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 10 }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{
          width: i === step ? 18 : 6, height: 6, borderRadius: 3,
          background: i === step ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.22)",
          transition: "width 0.3s ease",
        }} />
      ))}
    </div>
  );
}

export default function SpotlightTour({ open, steps = [], onClose, pad = 10 }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState(null);
  const [liveSteps, setLiveSteps] = useState([]);
  const rafRef = useRef(0);

  // On open: keep only the steps whose target exists (no goals → no goals step).
  useEffect(() => {
    if (!open) return;
    setLiveSteps(steps.filter((s) => s.selector && document.querySelector(s.selector)));
    setIdx(0);
  }, [open, steps]);

  const step = liveSteps[idx];

  const measure = useCallback(() => {
    if (!step?.selector) { setRect(null); return; }
    const el = document.querySelector(step.selector);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  // Scroll the target into view, then measure once settled.
  useLayoutEffect(() => {
    if (!open || !step?.selector) return;
    setRect(null); // hide the ring while travelling to the next target
    const el = document.querySelector(step.selector);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(measure, 380);
    return () => clearTimeout(t);
  }, [open, idx, step, measure]);

  // Track scroll/resize with rAF-throttled, passive listeners (cheap on a heavy page).
  useEffect(() => {
    if (!open) return;
    const onMove = () => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(measure); };
    window.addEventListener("resize", onMove, { passive: true });
    window.addEventListener("scroll", onMove, { passive: true, capture: true });
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, { capture: true });
      cancelAnimationFrame(rafRef.current);
    };
  }, [open, measure]);

  const finish = useCallback(() => onClose?.(), [onClose]);
  const next = useCallback(() => {
    if (idx >= liveSteps.length - 1) finish();
    else setIdx((i) => i + 1);
  }, [idx, liveSteps.length, finish]);

  if (!open || !step) return null;

  const vh = typeof window !== "undefined" ? window.innerHeight : 640;
  const vw = typeof window !== "undefined" ? window.innerWidth : 390;
  const panelMaxWidth = Math.min(vw - 40, 420);

  const hole = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null;

  // Callout above the hole when there's room, else below (Home behaviour).
  const spaceAbove = hole ? hole.top - 20 : 0;
  const panelTop = !hole
    ? vh * 0.30
    : spaceAbove > 200
      ? Math.max(20, hole.top - 208)
      : Math.min(hole.top + hole.height + 16, vh - 220);

  const isLast = idx === liveSteps.length - 1;

  return createPortal(
    <AnimatePresence>
      <div key={`step-${idx}`}>
        <HoleOverlay hole={hole} onAdvance={next} />
        {rect && <AnimatedRing rect={rect} pad={pad} />}

        {/* Dark glass callout — Home tutorial frame */}
        <div className="pointer-events-none fixed" style={{ top: panelTop, left: "50%", transform: "translateX(-50%)", width: panelMaxWidth, zIndex: 100004 }}>
          <motion.div className="pointer-events-auto" style={{ ...GLASS, borderRadius: 20, padding: "16px 18px 14px" }}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ delay: 0.28, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <StepDots step={idx} total={liveSteps.length} />
            <motion.p style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.1, letterSpacing: "-0.02em", color: "#fff", marginBottom: 7 }}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38, duration: 0.28, ease: "easeOut" }}>
              {step.title}
            </motion.p>
            <motion.div style={{ height: 1, background: "rgba(255,255,255,0.22)", marginBottom: 9, originX: 0 }}
              initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.48, duration: 0.28 }} />
            <motion.p style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.65, color: "rgba(255,255,255,0.72)", marginBottom: 14 }}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.56, duration: 0.26, ease: "easeOut" }}>
              <WordReveal text={step.body} baseDelay={0.64} />
            </motion.p>
            <motion.div style={{ display: "flex", gap: 8 }}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 0.26, ease: "easeOut" }}>
              <motion.button onClick={finish} whileTap={{ scale: 0.97 }}
                style={{ flex: 1, padding: "10px 0", borderRadius: 12, fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.70)", background: "transparent", border: "1px solid rgba(255,255,255,0.22)", cursor: "pointer" }}>
                Skip
              </motion.button>
              <motion.button onClick={next} whileTap={{ scale: 0.97 }}
                style={{ flex: 2, padding: "10px 0", borderRadius: 12, fontSize: 13, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg,#7c3aed,#5b21b6)", border: "none", cursor: "pointer" }}>
                {isLast ? "Got it ✓" : "Next →"}
              </motion.button>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
