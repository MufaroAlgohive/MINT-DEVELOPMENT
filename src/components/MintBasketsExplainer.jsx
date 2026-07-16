import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import PaymentSuccessPage from "../pages/PaymentSuccessPage.jsx";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { markAnimationSeen } from "../lib/animationSeen.js";

export const BASKETS_EXPLAINER_KEY = "mint_baskets_explainer_seen";

const PANEL = {
  backdropFilter: "blur(7px)",
  background: "rgba(0,0,0,0.20)",
  position: "fixed",
  zIndex: 10000,
  pointerEvents: "auto",
};

/* ─────────────────────────────────────────────────────────
   Single-hole 4-panel overlay (Phase 0 — tab only)
───────────────────────────────────────────────────────── */
function SingleHoleOverlay({ hole }) {
  if (!hole) return (
    <motion.div
      className="fixed inset-0 pointer-events-auto"
      style={{ ...PANEL, zIndex: 10000 }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    />
  );

  const { top: t, left: l, right: r, bottom: b } = hole;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none" }}
    >
      <div style={{ ...PANEL, top: 0, left: 0, right: 0, height: t }} />
      <div style={{ ...PANEL, top: b, left: 0, right: 0, bottom: 0 }} />
      <div style={{ ...PANEL, top: t, left: 0, width: l, height: b - t }} />
      <div style={{ ...PANEL, top: t, left: r, right: 0, height: b - t }} />
      {/* Transparent blocker over the hole — absorbs taps so the spotlighted
          button cannot be pressed. z-index above the ring (10001) so it wins. */}
      <div style={{
        position: "fixed", zIndex: 10002,
        top: t, left: l, width: r - l, height: b - t,
        background: "transparent", pointerEvents: "auto",
      }} />
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   Dual-hole overlay (Phase 1 — tab + card both clear)
   7 panels: top / tab-left / tab-right / middle / card-left / card-right / bottom
───────────────────────────────────────────────────────── */
function DualHoleOverlay({ tabHole, cardHole }) {
  if (!tabHole || !cardHole) return (
    <motion.div
      className="fixed inset-0 pointer-events-auto"
      style={{ ...PANEL, zIndex: 10000 }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    />
  );

  const { top: tt, left: tl, right: tr, bottom: tb } = tabHole;
  const { top: ct, left: cl, right: cr, bottom: cb } = cardHole;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none" }}
    >
      {/* above tab */}
      <div style={{ ...PANEL, top: 0, left: 0, right: 0, height: tt }} />
      {/* tab row — left of tab */}
      <div style={{ ...PANEL, top: tt, left: 0, width: tl, height: tb - tt }} />
      {/* tab row — right of tab */}
      <div style={{ ...PANEL, top: tt, left: tr, right: 0, height: tb - tt }} />
      {/* between tab and card */}
      <div style={{ ...PANEL, top: tb, left: 0, right: 0, height: Math.max(0, ct - tb) }} />
      {/* card row — left of card */}
      <div style={{ ...PANEL, top: ct, left: 0, width: cl, height: cb - ct }} />
      {/* card row — right of card */}
      <div style={{ ...PANEL, top: ct, left: cr, right: 0, height: cb - ct }} />
      {/* below card */}
      <div style={{ ...PANEL, top: cb, left: 0, right: 0, bottom: 0 }} />
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   Reusable pulsing ring
───────────────────────────────────────────────────────── */
function AnimatedRing({ rect, pad = 9, borderRadius = 16, zIndex = 10001, pulse = true }) {
  if (!rect) return null;
  const style = {
    top:    rect.top    - pad,
    left:   rect.left   - pad,
    width:  rect.width  + pad * 2,
    height: rect.height + pad * 2,
  };

  return (
    <div className="pointer-events-none fixed" style={{ ...style, zIndex }}>
      {/* Solid ring — dark outline makes it pop on both light and dark backgrounds */}
      <div className="absolute inset-0"
        style={{
          borderRadius,
          border: "2px solid rgba(255,255,255,0.90)",
          boxShadow: [
            "0 0 0 1.5px rgba(0,0,0,0.28)",      // dark outline → visible on white
            "0 0 16px 4px rgba(255,255,255,0.22)", // white glow → visible on dark
          ].join(", "),
        }}
      />
      {pulse && (
        <>
          <motion.div className="absolute inset-0"
            style={{ borderRadius, border: "1.5px solid rgba(255,255,255,0.60)" }}
            animate={{ opacity: [0.7, 0], scale: [1, 1.55] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div className="absolute inset-0"
            style={{ borderRadius, border: "1px solid rgba(255,255,255,0.40)" }}
            animate={{ opacity: [0.5, 0], scale: [1, 1.85] }}
            transition={{ duration: 1.4, delay: 0.45, repeat: Infinity, ease: "easeOut" }}
          />
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Word-by-word reveal animation
───────────────────────────────────────────────────────── */
function WordReveal({ text, baseDelay = 0, wordStyle }) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 9 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: baseDelay + i * 0.048, duration: 0.26, ease: "easeOut" }}
          style={{ display: "inline-block", marginRight: "0.26em", ...wordStyle }}
        >
          {word}
        </motion.span>
      ))}
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Step progress dots — shown at the top of every callout
───────────────────────────────────────────────────────── */
function StepDots({ step, total = 6 }) {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 10 }}>
      {Array.from({ length: total }, (_, i) => {
        const active = i + 1 === step;
        return (
          <div key={i} style={{
            width: active ? 18 : 6,
            height: 6,
            borderRadius: 3,
            background: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.22)",
            transition: "width 0.3s ease",
          }} />
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Phase 4 — Purchase Successful card spotlight
───────────────────────────────────────────────────────── */
function SuccessCardSpotlight({ cardRect, onNext, onSkip }) {
  if (!cardRect) return null;

  const pad = 16;
  const hole = {
    top:    cardRect.top    - pad,
    left:   cardRect.left   - pad,
    right:  cardRect.right  + pad,
    bottom: cardRect.bottom + pad,
    width:  cardRect.width  + pad * 2,
    height: cardRect.height + pad * 2,
  };

  const ringRadius = 28;
  const screenW = typeof window !== "undefined" ? window.innerWidth : 390;
  const panelMaxWidth = Math.min(screenW - 40, 420);

  // Place callout above the card if there's room, otherwise below
  const spaceAbove = hole.top - 20;
  const panelTop = spaceAbove > 140
    ? Math.max(20, hole.top - 160)
    : hole.bottom + 16;

  const glassBg = {
    background: "rgba(8,8,20,0.88)",
    backdropFilter: "blur(28px)",
    WebkitBackdropFilter: "blur(28px)",
    border: "1px solid rgba(255,255,255,0.14)",
  };

  return (
    <>
      <SingleHoleOverlay hole={hole} onClick={onNext} />
      <AnimatedRing rect={cardRect} pad={pad} borderRadius={ringRadius} zIndex={10001} pulse={true} />

      {/* Glass callout */}
      <div
        className="pointer-events-none fixed z-[10004]"
        style={{ top: panelTop, left: "50%", transform: "translateX(-50%)", width: panelMaxWidth }}
      >
        <motion.div
          className="pointer-events-auto"
          style={{ ...glassBg, borderRadius: 20, padding: "16px 18px 14px" }}
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.28, duration: 0.40, ease: [0.22, 1, 0.36, 1] }}
        >
          <StepDots step={4} />
          <motion.p
            style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.1, letterSpacing: "-0.02em", color: "#fff", marginBottom: 7 }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, duration: 0.28, ease: "easeOut" }}
          >
            Purchase Successful!
          </motion.p>
          <motion.div
            style={{ height: 1, background: "rgba(255,255,255,0.22)", marginBottom: 9, originX: 0 }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ delay: 0.48, duration: 0.28 }}
          />
          <motion.p
            style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.65, color: "rgba(255,255,255,0.72)", marginBottom: 14 }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.56, duration: 0.26, ease: "easeOut" }}
          >
            <WordReveal
              text="This is what you'll see after investing. Your order has been placed and is being processed — you'll be notified as soon as it's confirmed."
              baseDelay={0.64}
            />
          </motion.p>
          <motion.div
            style={{ display: "flex", gap: 8 }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.6, duration: 0.26, ease: "easeOut" }}
          >
            <motion.button
              onClick={onSkip}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.70)",
                background: "transparent", border: "1px solid rgba(255,255,255,0.22)", cursor: "pointer",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Skip
            </motion.button>
            <motion.button
              onClick={onNext}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 12,
                fontSize: 13, fontWeight: 700, color: "#fff",
                background: "linear-gradient(135deg,#7c3aed,#5b21b6)",
                border: "none", cursor: "pointer",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Next →
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Phase 5 — Pending orders spotlight on live Home page
───────────────────────────────────────────────────────── */
function PendingOrdersSpotlight({ pendingRect, onDone, onNext, onSkip }) {
  if (!pendingRect) return null;

  const padH = 16;    // horizontal
  const padTop = 12;  // slight breathing room above the "Pending orders" heading border
  const padBot = 20;  // clone has margin:0 so we add positive bottom padding inside the hole

  const ringRadius = 24;
  const screenW = typeof window !== "undefined" ? window.innerWidth : 390;
  const screenH = typeof window !== "undefined" ? window.innerHeight : 844;

  const hole = {
    top:    Math.max(0, pendingRect.top    - padTop),
    left:   Math.max(0, pendingRect.left   - padH),
    right:  Math.min(screenW, pendingRect.right  + padH),
    bottom: Math.min(screenH, pendingRect.bottom + padBot),
    get width()  { return this.right - this.left; },
    get height() { return this.bottom - this.top; },
  };
  const panelMaxWidth = Math.min(screenW - 40, 420);

  // Centre the panel on the card, not on the full viewport.
  // On mobile the card is full-width so this equals 50%; on desktop where the
  // section may sit to the right of a sidebar the panel follows the card.
  const cardCenterX = (pendingRect.left + pendingRect.right) / 2;
  const panelLeft = Math.min(
    Math.max(panelMaxWidth / 2 + 20, cardCenterX),
    screenW - panelMaxWidth / 2 - 20,
  );

  const spaceBelow = screenH - hole.bottom - 20;
  const panelTop = spaceBelow > 160
    ? hole.bottom + 24
    : Math.max(20, hole.top - 180);

  const glassBg = {
    background: "rgba(8,8,20,0.88)",
    backdropFilter: "blur(28px)",
    WebkitBackdropFilter: "blur(28px)",
    border: "1px solid rgba(255,255,255,0.14)",
  };

  return (
    <>
      <SingleHoleOverlay hole={hole} onClick={onDone} />
      <AnimatedRing rect={pendingRect} pad={padH} borderRadius={ringRadius} zIndex={10001} pulse={true} />

      <div
        className="pointer-events-none fixed z-[10004]"
        style={{ top: panelTop, left: panelLeft, transform: "translateX(-50%)", width: panelMaxWidth }}
      >
        <motion.div
          className="pointer-events-auto"
          style={{ ...glassBg, borderRadius: 20, padding: "16px 18px 14px" }}
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.28, duration: 0.40, ease: [0.22, 1, 0.36, 1] }}
        >
          <StepDots step={5} />
          <motion.p
            style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.1, letterSpacing: "-0.02em", color: "#fff", marginBottom: 7 }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, duration: 0.28, ease: "easeOut" }}
          >
            Pending orders
          </motion.p>
          <motion.div
            style={{ height: 1, background: "rgba(255,255,255,0.22)", marginBottom: 9, originX: 0 }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ delay: 0.48, duration: 0.28 }}
          />
          <motion.p
            style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.65, color: "rgba(255,255,255,0.72)", marginBottom: 14 }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.56, duration: 0.26, ease: "easeOut" }}
          >
            Your strategy appears as <strong style={{ color: "#fff" }}>Pending</strong> while being filled. Once settled, your investment reflects live on your home balance card — showing portfolio value and performance in real time.
          </motion.p>
          <motion.div
            style={{ display: "flex", gap: 8 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.72, duration: 0.26 }}
          >
            <motion.button
              onClick={onSkip}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.70)",
                background: "transparent", border: "1px solid rgba(255,255,255,0.22)", cursor: "pointer",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Skip
            </motion.button>
            <motion.button
              onClick={onNext ?? onDone}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 12, fontSize: 13, fontWeight: 700,
                letterSpacing: "0.04em", color: "#fff",
                background: "linear-gradient(135deg, #7C3AED, #5B21B6)",
                border: "none", cursor: "pointer",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Next →
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Phase 6 — Self-contained mock balance card (portal-rendered)
   Centred on all screen sizes, mock data baked in.
───────────────────────────────────────────────────────── */
const MOCK_LINE = "M 0,44 L 28,40 L 50,42 L 74,33 L 94,29 L 114,33 L 136,24 L 158,20 L 176,23 L 198,12 L 222,8 L 248,11 L 280,2";
const MOCK_FILL = `${MOCK_LINE} L 280,50 L 0,50 Z`;

function MockBalanceCard({ cardRef, hBounds }) {
  // hBounds = { left, width, top } from the real balance card's getBoundingClientRect()
  // Compute pixel-based left so we never mix CSS translateX(-50%) with framer-motion's
  // own transform system (scale/y), which would clobber the centering offset.
  const screenW = typeof window !== "undefined" ? window.innerWidth : 390;
  const cardWidth = hBounds ? hBounds.width : Math.min(screenW - 32, 440);
  const cardLeft  = hBounds ? hBounds.left  : Math.round((screenW - cardWidth) / 2);
  const cardTop   = hBounds ? hBounds.top   : 52;

  return (
    // Outer plain div owns the fixed position so getBoundingClientRect() is stable.
    // Inner motion.div owns only the entrance animation — no positioning transforms.
    <div
      ref={cardRef}
      className="pointer-events-none fixed z-[10003]"
      style={{ top: cardTop, left: cardLeft, width: cardWidth }}
    >
    <motion.div
      style={{
        width: "100%",
        borderRadius: 24,
        background: "linear-gradient(135deg, hsl(270 55% 30%) 0%, hsl(265 45% 22%) 45%, hsl(260 40% 15%) 100%)",
        boxShadow: "0 20px 60px -20px hsl(270 60% 35% / 0.5), inset 0 1px 0 hsl(0 0% 100% / 0.06)",
        padding: "14px 16px",
        border: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
      }}
      initial={{ opacity: 0, y: -10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Ambient glows */}
      <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, borderRadius: "50%", background: "rgba(139,92,246,0.28)", filter: "blur(40px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: -48, left: -32, width: 128, height: 128, borderRadius: "50%", background: "rgba(109,40,217,0.15)", filter: "blur(40px)", pointerEvents: "none" }} />

      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", color: "rgba(255,255,255,0.6)" }}>PORTFOLIO VALUE</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
          <span style={{ fontSize: 9, letterSpacing: "0.1em", color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>LIVE</span>
        </div>
      </div>

      {/* Balance + YTD row */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <motion.h2
            style={{ fontSize: 30, fontWeight: 700, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 4 }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.28 }}
          >
            R12,450.00
          </motion.h2>
          <motion.div
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(74,222,128,0.14)", borderRadius: 20, padding: "3px 10px" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.30, duration: 0.24 }}
          >
            <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 700 }}>↑ YTD: +R1,558.90</span>
            <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>+14.2%</span>
          </motion.div>
        </div>
        <motion.span
          style={{ fontSize: 9, color: "rgba(167,139,250,0.7)", fontWeight: 600, letterSpacing: "0.1em", paddingBottom: 2 }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.2 }}
        >
          SIMULATION
        </motion.span>
      </div>

      {/* Timeframe pills */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {["5D", "M", "YTD", "All"].map((label, i) => (
          <span key={label} style={{
            flex: 1, textAlign: "center", padding: "5px 0", borderRadius: 20,
            fontSize: 12, fontWeight: 600,
            color: i === 2 ? "#1a0a2e" : "rgba(255,255,255,0.55)",
            background: i === 2 ? "#fff" : "transparent",
          }}>{label}</span>
        ))}
      </div>

      {/* Animated equity curve */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 0.22, duration: 0.30 }}
        style={{ marginBottom: 10 }}
      >
        <svg viewBox="0 0 280 50" width="100%" height={48} style={{ overflow: "visible", display: "block" }}>
          <defs>
            <linearGradient id="mock6-card-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <motion.path d={MOCK_FILL} fill="url(#mock6-card-grad)"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 0.5 }}
          />
          <motion.path d={MOCK_LINE} fill="none" stroke="#a78bfa" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ delay: 0.30, duration: 1.4, ease: "easeInOut" }}
          />
          <motion.circle cx={280} cy={2} r={3.5} fill="#a78bfa"
            initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1.65, duration: 0.22 }}
          />
        </svg>
      </motion.div>

      {/* Footer: CASH / SIMULATION label */}
      <div style={{ display: "flex", gap: 8, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", marginBottom: 2 }}>CASH</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>R3,200.00</div>
        </div>
        <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", marginBottom: 2 }}>INVESTED</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>R9,250.00</div>
        </div>
      </div>
    </motion.div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Phase 6 — Callout panel that sits below the mock card
───────────────────────────────────────────────────────── */
function Phase6BalanceCardSpotlight({ cardRect, onDone }) {
  if (!cardRect) return null;

  const pad = 14;
  const screenW = typeof window !== "undefined" ? window.innerWidth : 390;
  const screenH = typeof window !== "undefined" ? window.innerHeight : 844;
  const panelMaxWidth = Math.min(screenW - 40, 440);

  // Always place the callout below the mock card
  const panelTop = Math.min(cardRect.bottom + pad + 14, screenH - 180);

  // Center the callout horizontally over the card (not the full viewport)
  const cardCenterX = cardRect.left + cardRect.width / 2;
  const panelLeft = Math.max(16, Math.min(cardCenterX - panelMaxWidth / 2, screenW - panelMaxWidth - 16));

  const glassBg = {
    background: "rgba(8,8,20,0.88)",
    backdropFilter: "blur(28px)",
    WebkitBackdropFilter: "blur(28px)",
    border: "1px solid rgba(255,255,255,0.14)",
  };

  return (
    <>
      {/* Solid full-dim overlay — no hole, so real home content never bleeds through.
          The MockBalanceCard sits above this at z-index 10003. */}
      <div
        className="fixed inset-0 z-[10000]"
        style={{ background: "rgba(0,0,0,0.72)" }}
      />
      <AnimatedRing rect={cardRect} pad={pad} borderRadius={26} zIndex={10004} pulse={true} />

      <div
        className="pointer-events-none fixed z-[10005]"
        style={{ top: panelTop, left: panelLeft, width: panelMaxWidth }}
      >
        <motion.div
          className="pointer-events-auto"
          style={{ ...glassBg, borderRadius: 18, padding: "14px 16px 14px" }}
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.30, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        >
          <StepDots step={6} />
          <motion.p
            style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.15, letterSpacing: "-0.02em", color: "#fff", marginBottom: 6 }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.40, duration: 0.26, ease: "easeOut" }}
          >
            Your Performance Over Time
          </motion.p>
          <motion.div
            style={{ height: 1, background: "rgba(255,255,255,0.20)", marginBottom: 8, originX: 0 }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ delay: 0.50, duration: 0.26 }}
          />
          <motion.p
            style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.65, color: "rgba(255,255,255,0.72)", marginBottom: 12 }}
            initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.58, duration: 0.24, ease: "easeOut" }}
          >
            <WordReveal
              text="Once you invest, your balance card tracks your portfolio value and gains in real time. Switch timeframes — 5D, Monthly, YTD or All-time — to see exactly how your wealth is growing."
              baseDelay={0.66}
            />
          </motion.p>
          <motion.button
            onClick={onDone}
            style={{
              width: "100%", padding: "10px 0", borderRadius: 12,
              fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", color: "#fff",
              background: "linear-gradient(135deg, #7C3AED, #5B21B6)",
              border: "none", cursor: "pointer",
            }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 1.80, duration: 0.26 }}
            whileTap={{ scale: 0.97 }}
          >
            Got it →
          </motion.button>
        </motion.div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Phase 3 — Invest Now button spotlight
───────────────────────────────────────────────────────── */
function InvestBtnSpotlight({ btnRect, onNext, onSkip }) {
  if (!btnRect) return null;

  const pad = 12;
  const hole = {
    top:    btnRect.top    - pad,
    left:   btnRect.left   - pad,
    right:  btnRect.right  + pad,
    bottom: btnRect.bottom + pad,
    width:  btnRect.width  + pad * 2,
    height: btnRect.height + pad * 2,
  };

  const ringRadius = 28;
  const screenW = typeof window !== "undefined" ? window.innerWidth : 390;
  const panelMaxWidth = Math.min(screenW - 40, 420);
  const panelTop = Math.max(20, Math.round(hole.top * 0.36));

  const glassBg = {
    background: "rgba(8,8,20,0.88)",
    backdropFilter: "blur(28px)",
    WebkitBackdropFilter: "blur(28px)",
    border: "1px solid rgba(255,255,255,0.14)",
  };

  return (
    <>
      <SingleHoleOverlay hole={hole} onClick={onNext} />
      <AnimatedRing rect={btnRect} pad={pad} borderRadius={ringRadius} zIndex={10001} pulse={true} />

      {/* Bouncing arrow pointing at the button */}
      <motion.div
        className="pointer-events-none fixed z-[10002] flex flex-col items-center"
        style={{ top: hole.top - 34, left: hole.left + hole.width / 2, transform: "translateX(-50%)" }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
      >
        <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M8 3L8 13M13 8L8 13L3 8" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.div>
      </motion.div>

      {/* Dark glass callout */}
      <div className="pointer-events-none fixed z-[10004]"
        style={{ top: panelTop, left: "50%", transform: "translateX(-50%)", width: panelMaxWidth }}
      >
        <motion.div
          className="pointer-events-auto"
          style={{ ...glassBg, borderRadius: 20, padding: "16px 18px 14px" }}
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.32, duration: 0.40, ease: [0.22, 1, 0.36, 1] }}
        >
          <StepDots step={3} />
          <motion.p
            style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.1, letterSpacing: "-0.02em", color: "#fff", marginBottom: 7 }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, duration: 0.28, ease: "easeOut" }}
          >
            Invest Now
          </motion.p>
          <motion.div
            style={{ height: 1, background: "rgba(255,255,255,0.22)", marginBottom: 9, originX: 0 }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ delay: 0.52, duration: 0.30 }}
          />
          <motion.p
            style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.4, color: "rgba(255,255,255,0.96)", marginBottom: 8 }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.60, duration: 0.26, ease: "easeOut" }}
          >
            Ready to grow your wealth?
          </motion.p>
          <p style={{ fontSize: 11.5, fontWeight: 400, lineHeight: 1.65, color: "rgba(255,255,255,0.70)", marginBottom: 16 }}>
            <WordReveal
              text="Tap Invest Now to put money into this basket. You choose the amount and we take care of the rest."
              baseDelay={0.70}
            />
          </p>
          <motion.div
            style={{ display: "flex", gap: 8 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 1.05, duration: 0.26 }}
          >
            <motion.button
              onClick={onSkip}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.70)",
                background: "transparent", border: "1px solid rgba(255,255,255,0.22)", cursor: "pointer",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Skip
            </motion.button>
            <motion.button
              onClick={onNext}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 12,
                fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", color: "#fff",
                background: "linear-gradient(135deg, #7C3AED, #5B21B6)",
                border: "none", cursor: "pointer",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Next →
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Phase 0 — Tab coach mark
───────────────────────────────────────────────────────── */
function TabSpotlight({ rect, onLottieLoad }) {
  if (!rect) return null;
  const pad = 9;
  const hole = {
    top:    rect.top    - pad,
    left:   rect.left   - pad,
    right:  rect.right  + pad,
    bottom: rect.bottom + pad,
    width:  rect.width  + pad * 2,
    height: rect.height + pad * 2,
  };

  // Position: 82% of the way from top of screen down to the tab,
  // centered horizontally — sits low in the open space just above the tab.
  const lottieTop = Math.round(hole.top * 0.82);

  return (
    <>
      <SingleHoleOverlay hole={hole} />
      <AnimatedRing rect={rect} pad={pad} borderRadius={16} zIndex={10001} />

      {/* Lottie animation — lower-centered in the open space above the tab */}
      <motion.div
        className="pointer-events-none fixed z-[10002]"
        style={{
          top:  lottieTop,
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
        initial={{ opacity: 0, scale: 0.88 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <DotLottieReact
          src="https://lottie.host/abde670e-c9ef-40b6-9009-6dfb6bbebc0a/1ank9HLrmf.json"
          loop
          autoplay
          style={{ width: 260, height: 260 }}
          dotLottieRefCallback={(dLottie) => {
            if (!dLottie) return;
            dLottie.addEventListener("load", () => onLottieLoad?.());
          }}
        />
      </motion.div>

      {/* Arrow + label below the tab ring */}
      <motion.div
        className="pointer-events-none fixed z-[10002] flex flex-col items-center gap-1.5"
        style={{
          top:  hole.top + hole.height + 12,
          left: hole.left + hole.width / 2,
          transform: "translateX(-50%)",
        }}
        initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        transition={{ delay: 0.3 }}
      >
        <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 1.1, repeat: Infinity }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M8 13L8 3M3 8L8 3L13 8" stroke="white" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.div>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.18em",
          textTransform: "uppercase", color: "rgba(255,255,255,0.92)" }}>
          Mint Baskets
        </span>
      </motion.div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Phase 2 — View Factsheet button spotlight
   Matches the Phase 0 tab-spotlight style:
   • Blurred 4-panel overlay with a clean hole around the button
   • Pulsing AnimatedRing (same component as Phase 0/1)
   • Bouncing down-arrow just above the button
   • Glass text callout centred above, fading in after the ring
───────────────────────────────────────────────────────── */
function FactsheetBtnSpotlight({ btnRect, onNext, onSkip }) {
  if (!btnRect) return null;

  const pad = 12;
  const hole = {
    top:    btnRect.top    - pad,
    left:   btnRect.left   - pad,
    right:  btnRect.right  + pad,
    bottom: btnRect.bottom + pad,
    width:  btnRect.width  + pad * 2,
    height: btnRect.height + pad * 2,
  };

  // 16px (rounded-2xl on the button) + 12px pad = 28px — ring exactly follows button shape
  const ringRadius = 28;
  const screenW  = typeof window !== "undefined" ? window.innerWidth  : 390;
  const screenH  = typeof window !== "undefined" ? window.innerHeight : 844;

  // Text panel: centred, sits in the space between the modal top and the hole.
  // Use 36% of the distance from screen-top to the hole as the panel's top edge.
  const panelMaxWidth = Math.min(screenW - 40, 420);
  const panelTop = Math.max(20, Math.round(hole.top * 0.36));

  const glassBg = {
    background: "rgba(8,8,20,0.88)",
    backdropFilter: "blur(28px)",
    WebkitBackdropFilter: "blur(28px)",
    border: "1px solid rgba(255,255,255,0.14)",
  };

  return (
    <>
      {/* Blurred 4-panel overlay — hole reveals only the factsheet button */}
      <SingleHoleOverlay hole={hole} onClick={onNext} />

      {/* Pulsing ring — identical style to Phase 0 AnimatedRing */}
      <AnimatedRing rect={btnRect} pad={pad} borderRadius={ringRadius} zIndex={10001} pulse={true} />

      {/* Bouncing down-arrow pointing at the button — appears just above the ring */}
      <motion.div
        className="pointer-events-none fixed z-[10002] flex flex-col items-center"
        style={{
          top:       hole.top - 34,
          left:      hole.left + hole.width / 2,
          transform: "translateX(-50%)",
        }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
      >
        <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M8 3L8 13M13 8L8 13L3 8" stroke="white" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.div>
      </motion.div>

      {/* Glass callout — fades in ~300 ms after the ring, above the hole */}
      <div
        className="pointer-events-none fixed z-[10004]"
        style={{ top: panelTop, left: "50%", transform: "translateX(-50%)", width: panelMaxWidth }}
      >
        <motion.div
          className="pointer-events-auto"
          style={{ ...glassBg, borderRadius: 20, padding: "16px 18px 14px" }}
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.32, duration: 0.40, ease: [0.22, 1, 0.36, 1] }}
        >
          <StepDots step={2} />
          <motion.p
            style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.1,
              letterSpacing: "-0.02em", color: "#fff", marginBottom: 7 }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, duration: 0.28, ease: "easeOut" }}
          >
            Strategy Factsheet
          </motion.p>

          <motion.div
            style={{ height: 1, background: "rgba(255,255,255,0.22)", marginBottom: 9, originX: 0 }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ delay: 0.52, duration: 0.30 }}
          />

          <motion.p
            style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em",
              lineHeight: 1.4, color: "rgba(255,255,255,0.96)", marginBottom: 8 }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.60, duration: 0.26, ease: "easeOut" }}
          >
            Your complete investment guide.
          </motion.p>

          <p style={{ fontSize: 11.5, fontWeight: 400, lineHeight: 1.65,
            color: "rgba(255,255,255,0.70)", marginBottom: 16 }}>
            <WordReveal
              text="A factsheet shows you everything — performance history, what the basket holds, fees, and risk profile. Tap to explore."
              baseDelay={0.70}
            />
          </p>

          <motion.div
            style={{ display: "flex", gap: 8 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 1.05, duration: 0.26 }}
          >
            <motion.button
              onClick={onSkip}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.70)",
                background: "transparent", border: "1px solid rgba(255,255,255,0.22)", cursor: "pointer",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Skip
            </motion.button>
            <motion.button
              onClick={onNext}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 12,
                fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", color: "#fff",
                background: "linear-gradient(135deg, #7C3AED, #5B21B6)",
                border: "none", cursor: "pointer",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Next →
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Phase 1 — Dual spotlight + card text callout
───────────────────────────────────────────────────────── */
function CardSpotlight({ cardRect, cardRadius, tabRect, cardName, cardDesc, onDone, onNext, onSkip }) {
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPressed(true), 350);
    return () => clearTimeout(t);
  }, []);

  if (!cardRect) return null;

  const cpad = 12;
  const tpad = 9;

  const cardHole = {
    top:    cardRect.top    - cpad,
    left:   cardRect.left   - cpad,
    right:  cardRect.right  + cpad,
    bottom: cardRect.bottom + 2,          // minimal bottom pad — prevents next card bleeding through
    width:  cardRect.width  + cpad * 2,
    height: cardRect.height + cpad + 2,
  };
  const tabHole = tabRect ? {
    top:    tabRect.top    - tpad,
    left:   tabRect.left   - tpad,
    right:  tabRect.right  + tpad,
    bottom: tabRect.bottom + tpad,
    width:  tabRect.width  + tpad * 2,
    height: tabRect.height + tpad * 2,
  } : null;

  // Callout vertically centred in the gap between the highlighted tab and the
  // highlighted card — never hugging the tab edge and never overlapping the card.
  // estimatedPanelHeight must match the actual rendered height (title + desc +
  // explanation + button + padding ≈ 230px).
  const gapTop    = tabHole ? tabHole.bottom + 12 : 80;
  const gapBottom = cardHole.top - 12;
  const estimatedPanelHeight = 230;
  // Centre the panel in the gap, but clamp so it never extends into the card hole.
  const panelTopCentered = Math.round((gapTop + gapBottom) / 2 - estimatedPanelHeight / 2);
  const panelTop = Math.max(gapTop, Math.min(panelTopCentered, gapBottom - estimatedPanelHeight));
  const panelMaxWidth = 460;
  const panelWidth = Math.min(typeof window !== "undefined" ? window.innerWidth - 32 : panelMaxWidth, panelMaxWidth);

  const desc =
    "Top JSE companies — built for long-term growth.";
  const explanation =
    "A MINT Basket is a professionally managed selection of assets, built and managed by MINT's investment team. " +
    "The assets are held directly in your name, not pooled.";
  // Ensure "Mint" → "MINT" in the card name
  const displayName = cardName.replace(/\bMint\b/g, "MINT");

  // Use the card's actual border radius for the ring
  const ringRadius = Math.max(16, (cardRadius ?? 20) + cpad * 0.6);

  // Shared glass panel style
  const glassBg = {
    background: "rgba(8,8,20,0.88)",
    backdropFilter: "blur(28px)",
    WebkitBackdropFilter: "blur(28px)",
    border: "1px solid rgba(255,255,255,0.14)",
  };

  return (
    <>
      <DualHoleOverlay tabHole={tabHole} cardHole={cardHole} />

      {/* Tab ring stays alive */}
      <AnimatedRing rect={tabRect} pad={tpad} borderRadius={16} zIndex={10003} pulse={true} />

      {/* Card ring — matches card shape */}
      <motion.div
        className="pointer-events-none fixed z-[10001]"
        style={{ top: cardHole.top, left: cardHole.left, width: cardHole.width, height: cardHole.height }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, scale: pressed ? [1, 0.975, 1] : 1 }}
        exit={{ opacity: 0 }}
        transition={{ opacity: { duration: 0.3 }, scale: pressed ? { duration: 0.38 } : {} }}
      >
        <div className="absolute inset-0"
          style={{ borderRadius: ringRadius,
            border: "2px solid rgba(255,255,255,0.90)",
            boxShadow: "0 0 0 1.5px rgba(0,0,0,0.28), 0 0 24px 6px rgba(255,255,255,0.16)" }}
        />
        <motion.div className="absolute inset-0"
          style={{ borderRadius: ringRadius, border: "1.5px solid rgba(255,255,255,0.50)" }}
          animate={{ opacity: [0.6, 0.15, 0.6] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>

      {/* Callout panel — always centred horizontally between the highlighted
          tab above and the highlighted card below, on all screen sizes.
          Outer div owns the fixed position + centering so Framer Motion's
          `y` animation on the inner div never clobbers the translateX(-50%). */}
      <div
        className="pointer-events-none fixed z-[10004]"
        style={{
          top:       panelTop,
          left:      "50%",
          transform: "translateX(-50%)",
          width:     panelWidth,
        }}
      >
        <motion.div
          className="pointer-events-auto"
          style={{ ...glassBg, borderRadius: 18, padding: "14px 18px 14px" }}
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.28, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        >
          <StepDots step={1} />
          <motion.p
            style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.1,
              letterSpacing: "-0.02em", color: "#fff", marginBottom: 7 }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34, duration: 0.30, ease: "easeOut" }}
          >
            {displayName}
          </motion.p>

          <motion.div
            style={{ height: 1, background: "rgba(255,255,255,0.22)", marginBottom: 9, originX: 0 }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ delay: 0.46, duration: 0.28 }}
          />

          <motion.p
            style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
              lineHeight: 1.4, color: "rgba(255,255,255,0.95)", marginBottom: 8 }}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.54, duration: 0.28, ease: "easeOut" }}
          >
            {desc}
          </motion.p>

          <p style={{ fontSize: 11.5, fontWeight: 400, lineHeight: 1.65,
            color: "rgba(255,255,255,0.68)", marginBottom: 14 }}>
            <WordReveal text={explanation} baseDelay={0.66} />
          </p>

          <motion.div
            style={{ display: "flex", gap: 8 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.90, duration: 0.24 }}
          >
            <motion.button
              onClick={onSkip}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 12,
                fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.70)",
                background: "transparent", border: "1px solid rgba(255,255,255,0.22)", cursor: "pointer",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Skip
            </motion.button>
            <motion.button
              onClick={onNext ?? onDone}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 12,
                fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", color: "#fff",
                background: "linear-gradient(135deg, #7C3AED, #5B21B6)",
                border: "none", cursor: "pointer",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Next →
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────── */
export default function MintBasketsExplainer({
  onDone,
  tabRef,
  onOpenStrategyForCoach,
  onNavigateToFactsheetForCoach,
  onNavigateToHome,
  onCloseStrategyForCoach,
  onNavigateToInvest,
}) {
  const [phase, setPhase]         = useState(0);
  const [tabRect, setTabRect]     = useState(null);
  const [cardRect, setCardRect]   = useState(null);
  const [cardRadius, setCardRadius] = useState(20);
  const [cardName, setCardName]   = useState("Mint Famous Brands");
  const [cardDesc, setCardDesc]   = useState(
    "A high growth equity strategy targeting leading JSE companies with strong long term upside."
  );
  const [visible, setVisible]         = useState(true);
  const [panelExiting, setPanelExiting] = useState(false);
  const [lottieReady, setLottieReady]  = useState(false);
  const [phase2BtnRect, setPhase2BtnRect] = useState(null);
  const [phase3BtnRect, setPhase3BtnRect] = useState(null);
  const [phase4CardRect, setPhase4CardRect] = useState(null);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [phase5PendingRect, setPhase5PendingRect] = useState(null);
  const [phase6BalanceRect, setPhase6BalanceRect] = useState(null);
  const [showMockCard, setShowMockCard] = useState(false);
  const [mockCardHBounds, setMockCardHBounds] = useState(null);
  const phaseTimer    = useRef(null);
  const cardSectionRef    = useRef(null); // element we translateY to make room
  const hiddenSiblingsRef = useRef([]);   // sibling sections hidden during push
  const pendingStickyElRef = useRef(null); // pending section whose sticky is removed during phase 5
  const prevHOverflowsRef = useRef([]);   // saved h-scroll states for partial restore
  const modalScrollElRef  = useRef(null); // modal scroll container padded in phase 2
  const mockCardRef       = useRef(null); // ref to MockBalanceCard DOM node for phase 6

  // ── Mark explainer as seen immediately on mount ──────────────────────────
  // This ensures it won't replay even if the user navigates away before
  // the animation fully completes (handleDone never fires in that case).
  useEffect(() => {
    markAnimationSeen("home_baskets_explainer", BASKETS_EXPLAINER_KEY);
  }, []);

  // ── Lock scroll + hide bottom nav for the duration of the explainer ──────
  useEffect(() => {
    // Slide bottom nav offscreen
    const style = document.createElement('style');
    style.id = '__mint_coach_style__';
    style.textContent = `
      body > nav {
        transform: translateY(110%) !important;
        transition: transform 0.35s cubic-bezier(0.4,0,1,1) !important;
        pointer-events: none !important;
      }
      [data-coach-target="true"],
      [data-coach-first="true"],
      [data-coach-factsheet-btn="true"],
      [data-coach-invest-btn="true"] {
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);

    // Lock vertical scrolling on body (prevents scroll on the html/body layer)
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // NOTE: we deliberately do NOT set overflow:hidden on .app-content because
    // doing so prevents programmatic scrollTop assignment later (phase 4→5
    // needs to scroll the container to position the pending-orders section).
    // The event-based locks below (wheel/touchmove/keydown) are sufficient.

    // Block all scroll input — overflow:hidden alone doesn't stop native
    // touch momentum on iOS/Android, and doesn't stop mouse-wheel or
    // keyboard scrolling in a browser / WebView preview.
    const SCROLL_KEYS = new Set(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ']);
    const blockScroll = (e) => {
      if (e.target.closest('button, input, select, textarea, a, [role="button"]')) return;
      e.preventDefault();
    };
    const blockKey = (e) => {
      if (SCROLL_KEYS.has(e.key) && !e.target.closest('input, textarea, select')) {
        e.preventDefault();
      }
    };
    document.addEventListener('touchmove', blockScroll, { passive: false });
    document.addEventListener('wheel',     blockScroll, { passive: false });
    document.addEventListener('keydown',   blockKey,   { passive: false });

    // Lock ALL horizontal scroll containers so the user cannot swipe
    // sideways through the strategy card list while the animation is active.
    const hScrollEls = Array.from(document.querySelectorAll('.overflow-x-auto, [class*="overflow-x-scroll"]'));
    const prevHOverflows = hScrollEls.map(el => ({ el, overflow: el.style.overflowX, scrollLeft: el.scrollLeft }));
    prevHOverflowsRef.current = prevHOverflows;
    hScrollEls.forEach(el => { el.style.overflowX = 'hidden'; });

    return () => {
      document.getElementById('__mint_coach_style__')?.remove();
      document.body.style.overflow = prevBodyOverflow;
      document.removeEventListener('touchmove', blockScroll);
      document.removeEventListener('wheel',     blockScroll);
      document.removeEventListener('keydown',   blockKey);
      // Restore horizontal scroll containers (if not already restored by partialCleanup)
      prevHOverflowsRef.current.forEach(({ el, overflow, scrollLeft }) => {
        el.style.overflowX = overflow;
        el.scrollLeft = scrollLeft;
      });
      prevHOverflowsRef.current = [];
    };
  }, []);

  // Track tab rect (updates on resize)
  useEffect(() => {
    if (!tabRef?.current) return;
    const update = () => setTabRect(tabRef.current?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [tabRef]);

  // Phase 0 → 1: advance 2.5 s after Lottie loads, or after 5 s max as fallback
  // The fallback ensures the tour continues even if the Lottie load event never fires
  // (network error, DotLottie API mismatch, browser blocking external URLs).
  useEffect(() => {
    if (phase !== 0) return;
    const fallback = setTimeout(() => setPhase(1), 5000);
    return () => clearTimeout(fallback);
  }, [phase]);

  useEffect(() => {
    if (phase !== 0 || !lottieReady) return;
    phaseTimer.current = setTimeout(() => setPhase(1), 2500);
    return () => clearTimeout(phaseTimer.current);
  }, [phase, lottieReady]);

  // Phase 1 — three-beat choreography:
  //   Beat 1 (~0 ms)   : sections ABOVE fade out + collapse height → section
  //                       naturally rises as the space above it disappears.
  //                       Sections BELOW disappear instantly (off-screen).
  //   Beat 2 (~480 ms) : horizontal scroll plays smoothly to the target card.
  //   Beat 3 (~1300 ms): sibling cards are hidden, spotlight rect captured.
  useEffect(() => {
    if (phase !== 1) return;

    let el = document.querySelector('[data-coach-target="true"]');
    if (!el) el = document.querySelector('[data-coach-first="true"]');
    if (!el) { handleDone(); return; }

    const name = el.getAttribute("data-coach-name");
    const desc = el.getAttribute("data-coach-desc");
    if (name) setCardName(name);
    if (desc) setCardDesc(desc);

    const computed = window.getComputedStyle(el);
    const rawRadius = parseFloat(computed.borderRadius || computed.borderTopLeftRadius || "20");
    setCardRadius(isNaN(rawRadius) ? 20 : rawRadius);

    const scrollContainer = el.closest(".overflow-x-auto");
    const section = scrollContainer?.parentElement ?? null;
    const hidden = [];

    // ── Beat 1: animate-out sections above, hide sections below ──────────
    if (section) {
      // Sections ABOVE — fade + collapse so the gap closes smoothly
      let prev = section.previousElementSibling;
      while (prev) {
        const p = prev;
        const h = p.getBoundingClientRect().height;
        p.style.overflow   = 'hidden';
        p.style.maxHeight  = `${h}px`;
        p.style.opacity    = '1';
        // Kick off transitions on next paint so the browser sees the initial values first
        requestAnimationFrame(() => {
          p.style.transition = 'opacity 0.38s ease, max-height 0.42s cubic-bezier(0.4,0,0.2,1)';
          p.style.opacity    = '0';
          p.style.maxHeight  = '0px';
        });
        hidden.push(p);
        prev = prev.previousElementSibling;
      }
      // Sections BELOW — instant (they're off-screen; no visible effect)
      let next = section.nextElementSibling;
      while (next) {
        next.style.visibility = 'hidden';
        hidden.push(next);
        next = next.nextElementSibling;
      }
    }
    hiddenSiblingsRef.current = hidden;

    // ── Beat 2: after collapse finishes, scroll sideways to the card ──────
    const t1 = setTimeout(() => {
      if (scrollContainer) {
        scrollContainer.style.overflowX = 'auto';
        const targetLeft = el.offsetLeft - Math.floor(window.innerWidth * 0.42);
        scrollContainer.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
      }
    }, 480);

    // ── Beat 3: after scroll settles, hide sibling cards + capture rect ───
    const t2 = setTimeout(() => {
      if (scrollContainer) scrollContainer.style.overflowX = 'hidden';

      // Hide sibling cards within the same row
      const cardList = el.parentElement;
      if (cardList) {
        cardList.dataset.coachOverflow = cardList.style.overflow;
        cardList.style.overflow = 'hidden';
        Array.from(cardList.children).forEach(sibling => {
          if (sibling !== el) {
            sibling.style.opacity = '0';
            sibling.style.pointerEvents = 'none';
            hiddenSiblingsRef.current.push(sibling);
          }
        });
      }

      // Push the card section DOWN to open up gap for the callout panel.
      // Without this, the gap between the tab ring and the card top is only ~200px
      // — too small for the ~230px callout. Pushing 90px creates a clean buffer.
      if (section) {
        cardSectionRef.current = section;
        section.style.transition = 'transform 0.38s cubic-bezier(0.4,0,0.2,1)';
        section.style.transform  = 'translateY(90px)';
      }

      // Capture rect AFTER the push animation settles (0.38s push + margin)
      const t3 = setTimeout(() => setCardRect(el.getBoundingClientRect()), 480);
      timers.push(t3);
    }, 1350);

    const timers = [t1, t2];
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  // partialCleanup: restores Phase 1 transforms/scroll but keeps the explainer mounted
  // Used when transitioning from Phase 1 → Phase 2 (strategy modal opens).
  const partialCleanup = useCallback(() => {
    document.getElementById('__mint_coach_style__')?.remove();
    document.body.style.overflow = '';
    const appContent = document.querySelector('.app-content');
    if (appContent) appContent.style.overflow = '';
    // Slide the card section back up
    if (cardSectionRef.current) {
      cardSectionRef.current.style.transition = 'transform 0.45s cubic-bezier(0.4,0,0.2,1)';
      cardSectionRef.current.style.transform  = '';
      cardSectionRef.current = null;
    }
    // Restore sibling visibility + opacity + collapse styles
    hiddenSiblingsRef.current.forEach(el => {
      el.style.transition  = '';
      el.style.maxHeight   = '';
      el.style.overflow    = '';
      el.style.visibility  = '';
      el.style.opacity     = '';
      el.style.pointerEvents = '';
    });
    hiddenSiblingsRef.current = [];
    // Restore card list overflow that was set to 'hidden' during tour
    const cardList = document.querySelector('[data-coach-overflow]');
    if (cardList) {
      cardList.style.overflow = cardList.dataset.coachOverflow || '';
      delete cardList.dataset.coachOverflow;
    }
    // Remove the cloned pending section and restore the original
    if (pendingStickyElRef.current) {
      const p = pendingStickyElRef.current;
      if (p.clone) {
        p.clone.remove();
        p.original.style.visibility = '';
      } else {
        p.style.position = '';
        p.style.top = '';
        p.style.marginTop = '';
      }
      pendingStickyElRef.current = null;
    }
    // Restore horizontal scroll containers
    prevHOverflowsRef.current.forEach(({ el, overflow, scrollLeft }) => {
      el.style.overflowX = overflow;
      el.scrollLeft = scrollLeft;
    });
    prevHOverflowsRef.current = [];
  }, []);

  // handleNext: Phase 1 → gap → modal opens at top → scrolls down → Phase 2 spotlight
  // The "gap" phase (phase = 1.5) renders nothing, so there is zero bleed-through
  // of phase 1 text/overlay while the strategy modal is opening.
  const handleNext = useCallback(() => {
    // 1. Jump to gap state — nothing is rendered, overlay fully disappears instantly
    setPhase(1.5);

    // 2. Restore card-section transforms (modal must open cleanly without the push)
    setTimeout(() => {
      partialCleanup();

      // 3. Open the strategy modal — it will be at the TOP by default
      onOpenStrategyForCoach?.(cardName);

      // 4. Let the modal open and settle (~900 ms), then pause at the top for 1 s
      setTimeout(() => {
        const btn = document.querySelector('[data-coach-factsheet-btn="true"]');
        if (!btn) { handleDone(); return; }

        const scrollEl = btn.closest('.overflow-y-auto');

        // 5. Ensure modal is scrolled to top first (reset), so user sees it open at top
        if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: 'instant' });

        // 6. After the 1-second pause at the top, smooth-scroll down to the factsheet btn.
        //    Add padding-bottom to the scroll container BEFORE scrolling so there is
        //    90px of empty space below the button — this lifts the button 90px above
        //    the bottom edge of the modal when scrolled to the end.
        setTimeout(() => {
          if (scrollEl) {
            // Store ref so cleanup can remove the padding when tour ends
            modalScrollElRef.current = scrollEl;
            scrollEl.style.paddingBottom = '90px';
            scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
          } else {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }

          // 7. After scroll settles, capture the rect and show phase 2 spotlight
          setTimeout(() => {
            const freshBtn = document.querySelector('[data-coach-factsheet-btn="true"]');
            if (!freshBtn) { handleDone(); return; }
            setPhase2BtnRect(freshBtn.getBoundingClientRect());
            setPhase(2);
          }, 650);
        }, 1000); // 1-second pause at top
      }, 900);
    }, 40);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partialCleanup, cardName, onOpenStrategyForCoach]);

  // handleGoToPhase3: Phase 2 → 3 — spotlight the Invest button
  const handleGoToPhase3 = useCallback(() => {
    const investBtn = document.querySelector('[data-coach-invest-btn="true"]');
    if (!investBtn) { handleDone(); return; }
    setPhase3BtnRect(investBtn.getBoundingClientRect());
    setPhase(3);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // handleGoToPhase4: Phase 3 → 4 — show PaymentSuccessPage portal then spotlight its card
  const handleGoToPhase4 = useCallback(() => {
    setShowSuccessOverlay(true);
  }, []);

  // Once showSuccessOverlay mounts, capture the card rect (after browser paint)
  useEffect(() => {
    if (!showSuccessOverlay) return;
    const id = requestAnimationFrame(() => {
      // Give the portal one more frame to actually paint
      requestAnimationFrame(() => {
        const el = document.querySelector('[data-coach-success-card="true"]');
        if (el) {
          setPhase4CardRect(el.getBoundingClientRect());
          setPhase(4);
        }
      });
    });
    return () => cancelAnimationFrame(id);
  }, [showSuccessOverlay]);

  // Phase 4 — no auto-advance; user proceeds via the "Next" button in SuccessCardSpotlight

  // Phase 6: when showMockCard becomes true the MockBalanceCard mounts and we read its rect
  useEffect(() => {
    if (!showMockCard) return;
    // Give the component one frame to paint before measuring
    const id = setTimeout(() => {
      const el = mockCardRef.current;
      if (el) {
        setPhase6BalanceRect(el.getBoundingClientRect());
        setPhase(6);
      }
    }, 80);
    return () => clearTimeout(id);
  }, [showMockCard]);

  // handleGoToPhase6: Phase 5 → 6 — clean up pending clone, show self-contained mock card
  const handleGoToPhase6 = useCallback(() => {
    // Clear the simulated pending order so it stops showing on the home tab
    sessionStorage.removeItem('mint_coach_pending_sim');
    window.dispatchEvent(new CustomEvent('mint-coach-sim-update'));

    // 1. Remove the phase 5 pending clone + restore the original element
    if (pendingStickyElRef.current) {
      const p = pendingStickyElRef.current;
      if (p.clone) {
        p.clone.remove();
        p.original.style.visibility = '';
      } else {
        p.style.position = '';
        p.style.top = '';
        p.style.marginTop = '';
      }
      pendingStickyElRef.current = null;
    }
    // 2. Restore siblings hidden during phase 5
    hiddenSiblingsRef.current.forEach(el => {
      el.style.visibility = '';
      el.style.opacity = '';
      el.style.pointerEvents = '';
      el.style.maxHeight = '';
      el.style.overflow = '';
      el.style.transition = '';
    });
    hiddenSiblingsRef.current = [];

    // 3. Capture the real balance card's pixel position so the mock card
    //    aligns exactly with it regardless of viewport / embedding width.
    const realCard = document.querySelector('[data-coach-balance-card="true"]');
    if (realCard) {
      const r = realCard.getBoundingClientRect();
      // Keep the card at the same horizontal position as the real card,
      // but snap to top: 52 so it's always fully visible.
      setMockCardHBounds({ left: r.left, width: r.width, top: 52 });
    }

    // 4. Mount the self-contained MockBalanceCard via React state.
    //    The useEffect above captures its rect and advances to phase 6.
    setShowMockCard(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDone = useCallback(() => {
    // Mark the explainer as seen so it won't auto-play again (DB + local cache)
    markAnimationSeen("home_baskets_explainer", BASKETS_EXPLAINER_KEY);

    // Clear any simulated pending order from the coach tour
    sessionStorage.removeItem('mint_coach_pending_sim');

    // ── Step 1: Fade the coach overlay out, restore scroll ──
    setShowMockCard(false);
    setPanelExiting(true);
    document.getElementById('__mint_coach_style__')?.remove();
    document.body.style.overflow = '';
    if (modalScrollElRef.current) {
      modalScrollElRef.current.style.paddingBottom = '';
      modalScrollElRef.current = null;
    }

    // ── Step 2: Build an imperative full-screen exit curtain on document.body ──
    //    This lives outside React's tree so it persists past component unmount.
    const curtain = document.createElement('div');
    curtain.id = '__mint_exit_curtain__';
    Object.assign(curtain.style, {
      position:   'fixed',
      inset:      '0',
      zIndex:     '10300',
      background: 'linear-gradient(160deg,#080814 0%,#1a0a3a 60%,#3b1060 100%)',
      opacity:    '0',
      transition: 'opacity 0.38s cubic-bezier(0.4,0,0.2,1)',
      pointerEvents: 'all',
    });
    document.body.appendChild(curtain);
    // Trigger fade-in on the very next paint
    requestAnimationFrame(() => requestAnimationFrame(() => { curtain.style.opacity = '1'; }));

    // ── Step 3: While curtain is fading in, restore underlying DOM state ──
    setTimeout(() => {
      if (cardSectionRef.current) {
        cardSectionRef.current.style.transition = 'transform 0.45s cubic-bezier(0.4,0,0.2,1)';
        cardSectionRef.current.style.transform  = '';
        cardSectionRef.current = null;
      }
      hiddenSiblingsRef.current.forEach(el => {
        el.style.transition  = '';
        el.style.maxHeight   = '';
        el.style.overflow    = '';
        el.style.visibility  = '';
        el.style.opacity     = '';
        el.style.pointerEvents = '';
      });
      hiddenSiblingsRef.current = [];
      const cardList2 = document.querySelector('[data-coach-overflow]');
      if (cardList2) {
        cardList2.style.overflow = cardList2.dataset.coachOverflow || '';
        delete cardList2.dataset.coachOverflow;
      }
      if (pendingStickyElRef.current) {
        const p = pendingStickyElRef.current;
        if (p.clone) {
          p.clone.remove();
          p.original.style.visibility = '';
        } else {
          p.style.position = '';
          p.style.top      = '';
          p.style.marginTop = '';
        }
        pendingStickyElRef.current = null;
      }
    }, 160);

    // ── Step 4: Once curtain is fully opaque (≈420ms) — navigate + unmount ──
    setTimeout(() => {
      setVisible(false);
      onDone?.();
      onNavigateToInvest?.();

      // ── Step 5: After navigation renders beneath the curtain, fade it out ──
      setTimeout(() => {
        curtain.style.transition = 'opacity 0.42s cubic-bezier(0.4,0,0.2,1)';
        curtain.style.opacity    = '0';
        setTimeout(() => curtain.remove(), 480);
      }, 80);
    }, 500);
  }, [onDone, onNavigateToInvest]);

  if (!visible) return null;

  const content = (
    <>
      {/* Persistent full-screen interaction blocker — active for the entire coach.
          Sits at z-index 10000, ABOVE the strategy sheet (9999) and backdrop (9998)
          but BELOW the overlay panels and callout boxes (10001+).
          This prevents any tap on underlying UI during ALL phases, including the
          gap phase (1.5) when the strategy sheet is opening but no overlay renders.
          Being first in the DOM at the same z-index as the panels, the panels render
          on top of it; but in the hole areas where panels are absent it wins. */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "transparent", pointerEvents: "auto",
      }} />

      {/* Phase 6 — self-contained mock balance card aligned to real card's position */}
      {showMockCard && <MockBalanceCard cardRef={mockCardRef} hBounds={mockCardHBounds} />}

      {/* PaymentSuccessPage overlay — portal so it shows above everything */}
      {showSuccessOverlay && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10002,
            background: "#f8f8fb", overflowY: "auto",
          }}
        >
          <PaymentSuccessPage
            strategyName="Famous Brands"
            onDone={() => setShowSuccessOverlay(false)}
            isCoachMode={true}
          />
        </div>
      )}

      {/* ── Phone case frame — floating mockup with DEMO ribbon ─────────────── */}
      <motion.div
        className="pointer-events-none fixed inset-0 z-[10020]"
        initial={{ opacity: 0, scale: 0.93 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 260, damping: 22, duration: 0.5 }}
        style={{
          /* Layered inset shadows build up the case:
             1. Innermost — screen-edge inner glow (subtle purple)
             2. Middle     — the main case body (deep purple-black)
             3. Outer      — the case lip / edge highlight
             4. Drop shadow — floating depth */
          boxShadow: [
            "inset 0 0 0 2px rgba(167,139,250,0.2)",
            "inset 0 0 0 13px #130b2e",
            "inset 0 0 0 15px rgba(139,92,246,0.65)",
            "0 0 0 2px #0d0720",
            "0 24px 80px rgba(109,40,217,0.55)",
            "0 8px 32px rgba(0,0,0,0.7)",
          ].join(", "),
          borderRadius: 44,
          overflow: "hidden",
        }}
      >
        {/* Case surface gradient — gives it a subtle material feel */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, transparent 50%, rgba(0,0,0,0.12) 100%)",
          borderRadius: "inherit",
          pointerEvents: "none",
        }} />

        {/* Dynamic Island */}
        <div style={{
          position: "absolute", top: 16, left: "50%",
          transform: "translateX(-50%)",
          width: 116, height: 34,
          background: "#0a0618",
          borderRadius: 99,
          boxShadow: "0 0 0 2px rgba(139,92,246,0.4), inset 0 1px 3px rgba(0,0,0,0.6)",
          zIndex: 1,
        }} />

        {/* Left buttons — mute + volume */}
        {[96, 138, 194].map((top, i) => (
          <div key={i} style={{
            position: "absolute", left: -6, top,
            width: 6, height: i === 0 ? 28 : 46,
            background: "linear-gradient(180deg, #2a1760 0%, #1a0f45 100%)",
            borderRadius: "4px 0 0 4px",
            boxShadow: "-1px 0 3px rgba(0,0,0,0.5)",
          }} />
        ))}

        {/* Right button — power */}
        <div style={{
          position: "absolute", right: -6, top: 158,
          width: 6, height: 68,
          background: "linear-gradient(180deg, #2a1760 0%, #1a0f45 100%)",
          borderRadius: "0 4px 4px 0",
          boxShadow: "1px 0 3px rgba(0,0,0,0.5)",
        }} />

        {/* Home indicator */}
        <div style={{
          position: "absolute", bottom: 10, left: "50%",
          transform: "translateX(-50%)",
          width: 128, height: 5,
          background: "linear-gradient(90deg, rgba(139,92,246,0.3), rgba(167,139,250,0.7), rgba(139,92,246,0.3))",
          borderRadius: 99,
        }} />

        {/* ── DEMO ribbon — top-left corner ───────────────────────────────── */}
        <div style={{
          position: "absolute", top: 0, left: 0,
          width: 110, height: 110,
          overflow: "hidden",
          zIndex: 2,
          borderRadius: "48px 0 0 0",
        }}>
          <div style={{
            position: "absolute",
            top: 28, left: -32,
            width: 130,
            padding: "6px 0",
            background: "linear-gradient(135deg, #5b21b6, #7c3aed)",
            transform: "rotate(-45deg)",
            textAlign: "center",
            boxShadow: "0 2px 12px rgba(109,40,217,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          }}>
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
              <polygon points="5,1 6.2,3.8 9.5,4.1 7.1,6.2 7.9,9.5 5,7.8 2.1,9.5 2.9,6.2 0.5,4.1 3.8,3.8"
                fill="rgba(255,255,255,0.9)" />
            </svg>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: "0.14em",
              textTransform: "uppercase", color: "#fff",
            }}>Demo</span>
          </div>
        </div>

        {/* Corner camera dots (top-left, subtle) */}
        <div style={{
          position: "absolute", top: 20, left: 22,
          width: 8, height: 8, borderRadius: "50%",
          background: "#1e1040",
          boxShadow: "0 0 0 1.5px rgba(139,92,246,0.3)",
          zIndex: 3,
        }} />
      </motion.div>

      <AnimatePresence>
        {phase === 0 && (
          <motion.div key="phase0" exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <TabSpotlight rect={tabRect} onLottieLoad={() => setLottieReady(true)} />
          </motion.div>
        )}
        {phase === 1 && cardRect && (
          <motion.div
            key="phase1"
            initial={{ opacity: 0 }}
            animate={{ opacity: panelExiting ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: panelExiting ? 0.16 : 0.3 }}
          >
            <CardSpotlight
              cardRect={cardRect}
              cardRadius={cardRadius}
              tabRect={tabRect}
              cardName={cardName}
              cardDesc={cardDesc}
              onDone={handleDone}
              onNext={handleNext}
              onSkip={handleDone}
            />
          </motion.div>
        )}
        {phase === 2 && phase2BtnRect && (
          <motion.div
            key="phase2"
            initial={{ opacity: 0 }}
            animate={{ opacity: panelExiting ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: panelExiting ? 0.16 : 0.3 }}
          >
            <FactsheetBtnSpotlight
              btnRect={phase2BtnRect}
              onNext={handleGoToPhase3}
              onSkip={handleDone}
            />
          </motion.div>
        )}
        {phase === 3 && phase3BtnRect && (
          <motion.div
            key="phase3"
            initial={{ opacity: 0 }}
            animate={{ opacity: panelExiting ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: panelExiting ? 0.16 : 0.3 }}
          >
            <InvestBtnSpotlight
              btnRect={phase3BtnRect}
              onNext={handleGoToPhase4}
              onSkip={handleDone}
            />
          </motion.div>
        )}
        {phase === 4 && phase4CardRect && (
          <motion.div
            key="phase4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <SuccessCardSpotlight
              cardRect={phase4CardRect}
              onSkip={handleDone}
              onNext={() => {
                // 1. Immediately remove the coach overlay so strategy modal hole disappears
                setPhase4CardRect(null);
                // 2. Close the strategy bottom-sheet portal (it renders on body even when hidden)
                onCloseStrategyForCoach?.();
                // 3. Signal HomePage to show a simulated pending order
                sessionStorage.setItem('mint_coach_pending_sim', 'MINT Famous Brands');
                window.dispatchEvent(new CustomEvent('mint-coach-sim-update'));
                // 4. Hide the success page overlay
                setShowSuccessOverlay(false);
                // 5. Switch to Home tab
                onNavigateToHome?.();
                // 6. Poll for the pending orders section, scroll it into view first.
                //    The scroll lock (overflow:hidden on .app-content) blocks scrollIntoView,
                //    so we temporarily release it, snap-scroll, re-lock, then capture the rect.
                let attempts = 0;
                const pollPending = () => {
                  const el = document.querySelector('[data-coach-pending-orders="true"]');
                  if (el) {
                    // ── Clone-and-lift approach ─────────────────────────────────
                    // Clone the pending section and render it at a fixed, known Y
                    // so we never fight sticky/scroll positioning.
                    const targetTop = 130; // px from top of viewport

                    const clone = el.cloneNode(true);
                    // Override only the layout-critical props; class styles are preserved.
                    clone.style.position = 'fixed';
                    clone.style.top = `${targetTop}px`;
                    clone.style.left = '0';
                    clone.style.right = '0';
                    clone.style.margin = '0';
                    clone.style.paddingTop = '0';
                    clone.style.zIndex = '10003';
                    document.body.appendChild(clone);

                    // Hide the original and any siblings below it
                    el.style.visibility = 'hidden';
                    let sibling = el.nextElementSibling;
                    while (sibling) {
                      sibling.style.visibility = 'hidden';
                      hiddenSiblingsRef.current.push(sibling);
                      sibling = sibling.nextElementSibling;
                    }

                    // Store clone + original for cleanup
                    pendingStickyElRef.current = { clone, original: el };

                    setTimeout(() => {
                      const cloneRect = clone.getBoundingClientRect();
                      console.log('[coach-phase5] cloneRect:', { top: cloneRect.top, bottom: cloneRect.bottom, height: cloneRect.height });
                      setPhase5PendingRect(cloneRect);
                      setPhase(5);
                    }, 80);
                    return;
                  }
                  if (++attempts < 100) setTimeout(pollPending, 50);
                };
                setTimeout(pollPending, 500);
              }}
            />
          </motion.div>
        )}
        {phase === 5 && phase5PendingRect && (
          <motion.div
            key="phase5"
            initial={{ opacity: 0 }}
            animate={{ opacity: panelExiting ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: panelExiting ? 0.16 : 0.3 }}
          >
            <PendingOrdersSpotlight
              pendingRect={phase5PendingRect}
              onDone={handleDone}
              onNext={handleGoToPhase6}
              onSkip={handleDone}
            />
          </motion.div>
        )}
        {phase === 6 && phase6BalanceRect && (
          <motion.div
            key="phase6"
            initial={{ opacity: 0 }}
            animate={{ opacity: panelExiting ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: panelExiting ? 0.16 : 0.3 }}
          >
            <Phase6BalanceCardSpotlight
              cardRect={phase6BalanceRect}
              onDone={handleDone}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return createPortal(content, document.body);
}
