import { useEffect, useRef, useState } from "react";

/**
 * Full-screen branded transition overlay shown when a user moves from the
 * public world (gift registry, welcome) into the authenticated Mint app.
 *
 * Props:
 *   show      — boolean, controlled by App
 *   label     — "welcome" | "returning" | "back"
 *   onDone    — called once the exit animation finishes so App can unmount us
 */
export default function LoginTransitionOverlay({ show, label = "welcome", onDone }) {
  const [opacity, setOpacity] = useState(0);
  const [logoReady, setLogoReady] = useState(false);
  const timers = useRef([]);

  const killTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    if (!show) return;

    killTimers();
    setOpacity(0);
    setLogoReady(false);

    // Tiny defer so the initial opacity:0 is painted before we transition in
    timers.current.push(
      setTimeout(() => {
        setOpacity(1);
        // Logo spring in slightly after background
        timers.current.push(setTimeout(() => setLogoReady(true), 80));

        // Begin fade-out after holding
        timers.current.push(
          setTimeout(() => {
            setOpacity(0);
            // Let the exit transition finish, then signal done
            timers.current.push(setTimeout(() => onDone?.(), 450));
          }, 820)
        );
      }, 20)
    );

    return killTimers;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Keep the element in the DOM while fading out so the exit transition plays
  if (!show && opacity === 0) return null;

  const messages = {
    welcome:   "Welcome to Mint",
    returning: "Back to your wishlist",
    back:      "Welcome back",
  };
  const message = messages[label] ?? messages.welcome;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "linear-gradient(145deg, #0d0d0d 0%, #1e0533 55%, #3b0764 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "22px",
        opacity,
        transition: "opacity 0.38s ease",
        pointerEvents: "none",           // never intercept clicks
        userSelect: "none",
      }}
    >
      {/* Mint icon — mirrors the favicon gradient but inverted for dark bg */}
      <div
        style={{
          transform: logoReady ? "scale(1) translateY(0px)" : "scale(0.72) translateY(12px)",
          opacity: logoReady ? 1 : 0,
          transition: "transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease",
        }}
      >
        <svg
          width="72"
          height="72"
          viewBox="0 0 64 64"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="ltGlass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.06)" />
            </linearGradient>
          </defs>
          {/* frosted-glass tile */}
          <rect
            width="64"
            height="64"
            rx="18"
            fill="url(#ltGlass)"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
          />
          {/* M letter */}
          <text
            x="50%"
            y="53%"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="'Arial', sans-serif"
            fontSize="30"
            fontWeight="700"
            fill="white"
          >
            M
          </text>
        </svg>
      </div>

      {/* Message */}
      <p
        style={{
          margin: 0,
          color: "rgba(255,255,255,0.92)",
          fontSize: "16px",
          fontWeight: 600,
          letterSpacing: "-0.01em",
          transform: logoReady ? "translateY(0px)" : "translateY(8px)",
          opacity: logoReady ? 1 : 0,
          transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.07s, opacity 0.35s ease 0.07s",
        }}
      >
        {message}
      </p>

      {/* Subtle dot-row indicator — feels app-native */}
      <div
        style={{
          display: "flex",
          gap: "6px",
          marginTop: "4px",
          opacity: logoReady ? 0.45 : 0,
          transition: "opacity 0.4s ease 0.15s",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: "5px",
              height: "5px",
              borderRadius: "50%",
              background: "white",
              animation: `ltPulse 1.1s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes ltPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.85); }
          50%       { opacity: 1;   transform: scale(1);    }
        }
      `}</style>
    </div>
  );
}
