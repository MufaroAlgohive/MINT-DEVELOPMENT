import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft, MoreHorizontal, TrendingUp, TrendingDown, PieChart, Wallet,
  ArrowUpRight, ShieldAlert, X, Check, Loader2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { getCachedSession } from "../lib/sessionCache.js";
import { fetchRealizedCentsByStrategy, fetchStrategyCashCents } from "../lib/strategyValuation.js";

/* Sell / withdraw flow — reached by tapping the balance card on Home.
   Cosmic deep-purple particle header fading to white, real holdings as cards,
   and a formal one-tap sell flow → POST /api/user/request-sell. */

const fmtR = (r, dec = 2) =>
  "R" + Number(r || 0).toLocaleString("en-ZA", { minimumFractionDigits: dec, maximumFractionDigits: dec });

const PALETTE = ["#7F77DD", "#5DCAA5", "#D4537E", "#D85A30", "#4AA3D8", "#B569C9"];
const colorFor = (s) => PALETTE[[...String(s || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

async function getSession() {
  const cached = await getCachedSession();
  if (cached?.access_token) return cached;
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

// Count-up animation for the hero numbers (eased, runs when target lands).
function useCountUp(target, dur = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

export default function WithdrawPage({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [strategies, setStrategies] = useState([]);
  const [singles, setSingles] = useState([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [invested, setInvested] = useState(0);
  const [cash, setCash] = useState(0);
  const [sinceDate, setSinceDate] = useState(null);
  const [justSold, setJustSold] = useState(() => new Set()); // ids sold this session

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const session = await getSession();
        const token = session?.access_token || null;
        const uid = session?.user?.id || null;

        const res = token
          ? await fetch("/api/user/holdings", { headers: { Authorization: `Bearer ${token}` } })
          : null;
        const json = res && res.ok ? await res.json() : { holdings: [] };
        if (cancelled) return;

        // Only filled holdings (avg_fill > 0) are sellable.
        const holdings = (json.holdings || []).filter((h) => Number(h.avg_fill || 0) > 0);

        // Per-holding value + cost basis.
        // Mirror SwipeableBalanceCard lines 522-527 exactly:
        //   costBasisPerShare = max(Expected_fill_rands, avg_fill/100) when Expected_fill > 0
        //   invested = Math.round(costBasisPerShare * 100 * qty)
        // Using DB invested_amount would differ when Expected_fill > avg_fill/100, causing
        // a mismatch vs the balance card.
        const enrich = (h) => {
          const qty = Number(h.quantity || 0);
          const value = Number(h.market_value || 0) / 100;
          const avgFillRands = Number(h.avg_fill || 0) / 100;
          const expectedFillRands = Number(h.Expected_fill || 0); // already in rands from API
          const costBasisPerShare = expectedFillRands > 0
            ? expectedFillRands
            : avgFillRands;
          const cost = Math.round(costBasisPerShare * 100 * qty) / 100;
          const pnl = value - cost;
          return { qty, value, cost, change: cost > 0 ? (pnl / cost) * 100 : 0, up: pnl >= 0 };
        };

        const isSellHolding = (h) => String(h.trade_side || "").toUpperCase() === "SELL" || String(h.side || "").toLowerCase() === "sell";

        // Which securities have a live intraday price right now. If one doesn't,
        // we can't capture an "expected exit" at sell time, so we warn the client
        // their proceeds will be set by the broker's execution price instead.
        const singleSecIds = [...new Set(holdings.filter((h) => !h.strategy_id).map((h) => h.security_id).filter(Boolean))];
        const livePricedSecIds = new Set();
        await Promise.all(singleSecIds.map(async (sid) => {
          const { data } = await supabase
            .from("stock_intraday_c").select("current_price")
            .eq("security_id", sid).order("timestamp", { ascending: false }).limit(1).maybeSingle();
          if (data?.current_price != null) livePricedSecIds.add(String(sid));
        }));

        const singleAssets = holdings.filter((h) => !h.strategy_id).map((h) => {
          const e = enrich(h);
          return {
            id: `sec:${h.id}`,
            kind: "security",
            holdingId: h.id,
            securityId: h.security_id,
            strategyId: h.strategy_id || null,
            symbol: h.symbol || "Asset",
            name: h.name || "Security",
            logo: h.logo_url || null,
            qty: e.qty,
            value: e.value,
            cost: e.cost,
            change: e.change,
            up: e.up,
            pendingSell: isSellHolding(h),
            hasLivePrice: livePricedSecIds.has(String(h.security_id)),
            // Breakdown inputs: a single asset's proceeds = its value; any unused
            // reserve is computed/returned at settlement (not pre-estimated here).
            positionsValue: e.value,
            reserveRefundCents: 0,
          };
        });

        // Strategy groupings — sell the strategy = liquidate its underlying.
        const stratMap = {};
        holdings.forEach((h) => {
          const sid = h.strategy_id;
          if (!sid) return;
          const e = enrich(h);
          if (!stratMap[sid]) stratMap[sid] = { value: 0, cost: 0, count: 0, name: null, logo: null, assets: [], pendingSell: false };
          stratMap[sid].value += e.value;
          stratMap[sid].cost += e.cost;
          stratMap[sid].count += 1;
          stratMap[sid].assets.push({ logo: h.logo_url || null, symbol: h.symbol || "" });
          if (isSellHolding(h)) stratMap[sid].pendingSell = true;
        });
        const stratIds = Object.keys(stratMap);
        if (stratIds.length) {
          const { data: meta } = await supabase
            .from("strategies_c")
            .select("id, name, short_name, icon_url")
            .in("id", stratIds);
          (meta || []).forEach((m) => {
            if (stratMap[m.id]) {
              stratMap[m.id].name = m.short_name || m.name || "Strategy";
              stratMap[m.id].logo = m.icon_url || null;
            }
          });
        }
        // Match balance card cost formula exactly:
        //   cost = Σ(invested_amount/100) + bufferCash + residualCash − realizedCents/100
        let realizedCentsByStrategy = {};
        let bufferCentsByStrategy = {};
        let residualCentsByStrategy = {};
        if (stratIds.length && uid) {
          [realizedCentsByStrategy, { bufferCentsByStrategy, residualCentsByStrategy }] = await Promise.all([
            fetchRealizedCentsByStrategy({ userId: uid, strategyIds: stratIds }),
            fetchStrategyCashCents({ userId: uid, strategyIds: stratIds }),
          ]);
        }

        const stratItems = stratIds.map((sid) => {
          const s = stratMap[sid];
          const bufResRands = ((bufferCentsByStrategy[sid] || 0) + (residualCentsByStrategy[sid] || 0)) / 100;
          const realizedRands = (realizedCentsByStrategy[sid] || 0) / 100;
          const adjustedCost = Math.max(0, s.cost + bufResRands - realizedRands);
          const adjustedValue = s.value + bufResRands;
          const pnl = adjustedValue - adjustedCost;
          return {
            id: `strat:${sid}`,
            kind: "strategy",
            strategyId: sid,
            symbol: s.name || "Strategy",
            name: `${s.count} asset${s.count === 1 ? "" : "s"}`,
            logo: s.logo,
            assets: s.assets.slice(0, 3),
            value: adjustedValue,
            cost: adjustedCost,
            change: adjustedCost > 0 ? (pnl / adjustedCost) * 100 : 0,
            up: pnl >= 0,
            pendingSell: s.pendingSell,
            // Breakdown inputs: proceeds = the holdings' market value; the unused
            // 8% execution reserve (held buffer) is returned on top at full exit.
            positionsValue: s.value,
            reserveRefundCents: Math.max(0, bufferCentsByStrategy[sid] || 0),
          };
        });

        // Totals + journey start.
        const totalCost = [...singleAssets, ...stratItems].reduce((a, x) => a + x.cost, 0);
        let earliest = null;
        holdings.forEach((h) => {
          const t = h.created_at ? new Date(h.created_at) : null;
          if (t && (!earliest || t < earliest)) earliest = t;
        });

        // Available cash (wallet balance, in rands).
        let walletCash = 0;
        if (uid) {
          const { data: wallet } = await supabase
            .from("wallets")
            .select("balance")
            .eq("user_id", uid)
            .maybeSingle();
          walletCash = Number(wallet?.balance || 0);
        }

        if (cancelled) return;
        setStrategies(stratItems.sort((a, b) => b.value - a.value));
        setSingles(singleAssets.sort((a, b) => b.value - a.value));
        setInvested(totalCost);
        setCash(walletCash);
        setSinceDate(earliest);
      } catch (e) {
        if (!cancelled) setError("Could not load your holdings. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // An item is pending-sell if the server says so OR we just sold it this session.
  const isItemSelling = (item) => item.pendingSell || justSold.has(item.id);

  const totalValue = useMemo(
    () => [...strategies, ...singles].reduce((s, x) => s + x.value, 0),
    [strategies, singles]
  );
  const totalPnl = totalValue - invested;
  const totalPct = invested > 0 ? (totalPnl / invested) * 100 : 0;

  // Total value tied up in pending sells — shown as the amount the portfolio
  // will drop by once the broker fills, and a projected "after" value.
  const pendingSellTotal = useMemo(
    () => [...strategies, ...singles].filter(isItemSelling).reduce((s, x) => s + x.value, 0),
    [strategies, singles, justSold]
  );

  const totalAnim = useCountUp(totalValue);
  const investedAnim = useCountUp(invested);
  const cashAnim = useCountUp(cash);

  // ── WebGL2 shader header (purple & black) ─────────────────────────────────
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false });
    if (!gl) return; // no WebGL2 → leave the header blank (CSS bg shows through)

    const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;
    // Recoloured to purple/black: accumulate a single intensity, then ramp it
    // through purple with a lilac highlight; black where there's no energy.
    const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec3 iResolution;
uniform float iTime;
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 r = iResolution.xy;
  float t = iTime;
  vec2 p = fragCoord - r * 0.5;
  vec4 o = vec4(0.0);
  for (float i = 0.0, a; i++ < 9.0; ) {
    a = (i * i) / 80.0 - length(p) / r.y;
    float denom = max(a, -a * 3.0) + 2.0 / r.y;
    a = cos(i - t);
    float edge0 = a;
    a = atan(p.y, p.x) + a + i * i;
    float sm = smoothstep(edge0, 2.0, cos(a));
    o += 0.03 / denom * sm * 1.2;
  }
  float v = tanh(o.r);
  vec3 base   = vec3(0.10, 0.03, 0.20);   // dark purple background
  vec3 purple = vec3(0.45, 0.16, 0.85);
  vec3 lilac  = vec3(0.80, 0.60, 1.0);
  vec3 col = base + purple * v + lilac * pow(v, 4.0) * 0.7;
  fragColor = vec4(col, 1.0);
}
void main(){ mainImage(fragColor, gl_FragCoord.xy); }`;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return; }
    gl.deleteShader(vs); gl.deleteShader(fs);

    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "iResolution");
    const uTime = gl.getUniformLocation(prog, "iTime");
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const rct = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rct.width * dpr));
      const h = Math.max(1, Math.floor(rct.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    };
    resize();
    window.addEventListener("resize", resize);

    let raf, disposed = false;
    const start = performance.now();
    const tick = (now) => {
      if (disposed) return;
      if (gl.isContextLost()) { raf = requestAnimationFrame(tick); return; }
      resize();
      gl.useProgram(prog);
      gl.uniform3f(uRes, canvas.width, canvas.height, dpr);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      try { gl.deleteBuffer(vbo); gl.deleteVertexArray(vao); gl.deleteProgram(prog); } catch {}
    };
  }, []);

  const Avatar = ({ item, size = 42 }) => (
    <div
      className="wd-avatar"
      style={{ height: size, width: size, background: item.logo ? "#fff" : colorFor(item.symbol) }}
    >
      {item.logo
        ? <img src={item.logo} alt="" style={{ height: "100%", width: "100%", objectFit: "cover", borderRadius: 13 }} />
        : String(item.symbol).slice(0, 2).toUpperCase()}
    </div>
  );

  // Strategy/basket: show its underlying asset icons, stacked (up to 3).
  const StackedAvatar = ({ assets, size = 42 }) => {
    const list = (assets || []).slice(0, 3);
    const overlap = Math.round(size * 0.34);
    return (
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
        {list.map((a, i) => (
          <div
            key={i}
            className="wd-avatar"
            style={{
              height: size, width: size,
              marginLeft: i === 0 ? 0 : -overlap,
              zIndex: list.length - i,
              border: "2px solid #fff",
              boxShadow: "0 1px 5px rgba(60,52,137,0.18)",
              background: a.logo ? "#fff" : colorFor(a.symbol),
              fontSize: 11,
            }}
          >
            {a.logo
              ? <img src={a.logo} alt="" style={{ height: "100%", width: "100%", objectFit: "cover", borderRadius: 13 }} />
              : String(a.symbol || "?").slice(0, 2).toUpperCase()}
          </div>
        ))}
      </div>
    );
  };

  const Card = ({ item, delay }) => {
    const sub = item.name + (item.kind === "security" && item.qty ? ` · ${item.qty} sh` : "");
    const chCol = item.up ? "#1D9E75" : "#D4537E";
    const selling = isItemSelling(item);
    return (
      <div
        className="wd-hcard"
        onClick={selling ? undefined : () => setSelected(item)}
        style={{
          animation: `wd-floatIn 0.5s cubic-bezier(0.34,1.4,0.64,1) ${delay}s forwards`,
          ...(selling ? { opacity: 0.55, cursor: "default", filter: "grayscale(0.6)" } : {}),
        }}
      >
        {item.kind === "strategy" && item.assets?.length
          ? <StackedAvatar assets={item.assets} />
          : <Avatar item={item} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="wd-name">{item.symbol}</div>
          {selling ? (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 2, fontSize: 11, fontWeight: 600, color: "#D4537E" }}>
              <span style={{ height: 6, width: 6, borderRadius: "50%", background: "#D4537E", display: "inline-block" }} />
              Selling · pending
            </div>
          ) : (
            <div className="wd-sub">{sub}</div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 74 }}>
          <div className="wd-cardval">{fmtR(item.value)}</div>
          {selling ? (
            <div style={{ fontSize: 11.5, fontWeight: 500, color: "#D4537E" }}>−{fmtR(item.value)}</div>
          ) : (
            <div style={{ fontSize: 11.5, fontWeight: 500, color: chCol }}>
              {item.up ? "↑" : "↓"} {Math.abs(item.change).toFixed(1)}%
            </div>
          )}
        </div>
      </div>
    );
  };

  const hasHoldings = strategies.length > 0 || singles.length > 0;

  return (
    <div className="wd-root">
      <style>{WD_CSS}</style>

      <canvas ref={canvasRef} className="wd-canvas" />
      <div className="wd-fade" />

      <div style={{ position: "relative", zIndex: 2 }}>
        <div className="wd-topbar">
          <div className="wd-iconbtn" onClick={onBack}><ChevronLeft size={20} /></div>
          <div className="wd-iconbtn"><MoreHorizontal size={20} /></div>
        </div>

        {/* Hero */}
        <div style={{ textAlign: "center", padding: "18px 24px 0" }}>
          <div className="wd-hero-label">Your Portfolio</div>
          <div className="wd-hero-val">
            {"R" + totalAnim.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          {invested > 0 && (
            <div className="wd-pill" style={{
              background: totalPnl >= 0 ? "rgba(94,202,165,0.16)" : "rgba(212,83,126,0.16)",
              borderColor: totalPnl >= 0 ? "rgba(94,202,165,0.35)" : "rgba(212,83,126,0.35)",
              color: totalPnl >= 0 ? "#9FE1CB" : "#F2A6BE",
            }}>
              {totalPnl >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
              <span>{(totalPnl >= 0 ? "+" : "−") + fmtR(Math.abs(totalPnl)) + " · " + Math.abs(totalPct).toFixed(1) + "%"}</span>
            </div>
          )}
          {pendingSellTotal > 0 && (
            <div style={{ marginTop: 12, display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div className="wd-pill" style={{
                background: "rgba(212,83,126,0.18)", borderColor: "rgba(212,83,126,0.4)", color: "#F2A6BE",
              }}>
                <TrendingDown size={15} />
                <span>−{fmtR(pendingSellTotal)} selling</span>
              </div>
              <div style={{ fontSize: 11, color: "rgba(207,188,255,0.65)" }}>
                After fills ≈ <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{fmtR(Math.max(0, totalValue - pendingSellTotal))}</span>
              </div>
            </div>
          )}
          {sinceDate && (
            <div className="wd-since">
              On this journey since{" "}
              <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>
                {sinceDate.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
          )}
        </div>

        {/* Split cards */}
        <div style={{ display: "flex", gap: 10, padding: "26px 16px 0" }}>
          <div className="wd-splitcard" style={{ animation: "wd-floatIn 0.6s cubic-bezier(0.34,1.4,0.64,1) 0.3s forwards" }}>
            <div className="wd-split-ico" style={{ background: "rgba(127,119,221,0.18)" }}><PieChart size={17} color="#AFA9EC" /></div>
            <div>
              <div className="wd-split-label">Invested</div>
              <div className="wd-split-val">{"R" + Math.round(investedAnim).toLocaleString("en-ZA")}</div>
            </div>
          </div>
          <div className="wd-splitcard" style={{ animation: "wd-floatIn 0.6s cubic-bezier(0.34,1.4,0.64,1) 0.4s forwards" }}>
            <div className="wd-split-ico" style={{ background: "rgba(94,202,165,0.16)" }}><Wallet size={17} color="#5DCAA5" /></div>
            <div>
              <div className="wd-split-label">Available cash</div>
              <div className="wd-split-val">{"R" + Math.round(cashAnim).toLocaleString("en-ZA")}</div>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ margin: "20px 16px 0" }} className="wd-error">{error}</div>
        )}

        {loading ? (
          <div className="wd-loading"><Loader2 size={16} className="wd-spin" /> Loading your holdings…</div>
        ) : (
          <>
            {/* Strategies */}
            {strategies.length > 0 && (
              <div style={{ padding: "30px 16px 22px" }}>
                <div className="wd-sec-head">
                  <span>Your strategies</span>
                  <span className="wd-sec-sub">{strategies.length} active</span>
                </div>
                <div className="wd-list">
                  {strategies.map((s, i) => <Card key={s.id} item={s} delay={0.5 + i * 0.1} />)}
                </div>
              </div>
            )}

            {/* Single assets */}
            {singles.length > 0 && (
              <div style={{ padding: strategies.length > 0 ? "0 16px 22px" : "30px 16px 22px" }}>
                <div className="wd-sec-head">
                  <span>Single assets</span>
                  <span className="wd-sec-sub">{singles.length} held</span>
                </div>
                <div className="wd-list">
                  {singles.map((s, i) => <Card key={s.id} item={s} delay={0.7 + i * 0.1} />)}
                </div>
              </div>
            )}

            {!hasHoldings && (
              <div className="wd-empty">You have no holdings to sell yet.</div>
            )}

            {/* Withdraw helper */}
            {hasHoldings && (
              <div style={{ padding: "6px 16px 30px" }}>
                <div className="wd-footer-card">
                  <div className="wd-footer-ico"><ArrowUpRight size={20} color="#534AB7" /></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#26215C" }}>Need to withdraw?</div>
                    <div style={{ fontSize: 12, color: "#7d72a8", marginTop: 2, lineHeight: 1.4 }}>
                      Sell any holding above — tap it to begin.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ height: 96 }} />
      </div>

      {selected && (
        <SellSheet
          item={selected}
          onSold={() => setJustSold((prev) => new Set(prev).add(selected.id))}
          onClose={() => setSelected(null)}
          onSubmit={async (quantity) => {
            const session = await getSession();
            const token = session?.access_token || null;
            const body = selected.kind === "strategy"
              ? { kind: "strategy", strategyId: selected.strategyId }
              : { kind: "security", holdingId: selected.holdingId, ...(Number(quantity) > 0 ? { quantity: Number(quantity) } : {}) };
            const res = await fetch("/api/user/request-sell", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify(body),
            });
            // Read as text first so we can surface the real reason even when the
            // response isn't JSON (e.g. a 404 HTML page from an older server build).
            let json = {};
            const rawText = await res.text().catch(() => "");
            try { json = rawText ? JSON.parse(rawText) : {}; } catch { json = {}; }
            if (!res.ok || !json.success) {
              const detail = json.error
                || (res.status === 404
                  ? "Sell service not found (404) — the server may be running an older build. Try again after it redeploys/restarts."
                  : `Could not submit your sell (server returned ${res.status}). Please try again.`);
              throw new Error(detail);
            }
            return json.reference;
          }}
        />
      )}
    </div>
  );
}

/* ── Confirmation bottom-sheet ──────────────────────────────────────────────
   Real-money action: the client must tick an acknowledgement before "Confirm
   sell" unlocks; on confirm we POST and show the server-issued reference. */
function SellSheet({ item, onClose, onSubmit, onSold }) {
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [ref, setRef] = useState("");
  const [err, setErr] = useState("");
  const isStrategy = item.kind === "strategy";
  // Partial-quantity selling: single securities only. Baskets always sell whole.
  const maxQty = item.kind === "security" ? Math.max(0, Math.floor(Number(item.qty || 0))) : 0;
  const canPartial = item.kind === "security" && maxQty > 1;
  const [sellQty, setSellQty] = useState(maxQty || 1);
  const isPartial = canPartial && sellQty < maxQty;
  const frac = maxQty > 0 ? sellQty / maxQty : 1; // slice of the position being sold

  // Ref lock: setState is async, so two fast taps can both pass a `submitting`
  // check before it flips. A ref guard blocks the second synchronously — no
  // duplicate sell request.
  const submitLock = useRef(false);
  const confirm = async () => {
    if (!ack || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setErr("");
    try {
      const reference = await onSubmit(item.kind === "security" ? sellQty : undefined);
      setRef(reference || "—");
      setDone(true);
      onSold?.(); // grey out the sold card + reflect the pending drop immediately
    } catch (e) {
      setErr(e.message || "Could not submit your sell. Please try again.");
      submitLock.current = false; // allow a retry only on failure
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="wd-sheet-wrap">
      <div className="wd-backdrop" onClick={submitting ? undefined : onClose} />
      <div className="wd-sheet">
        <div className="wd-grab" />
        <div className="wd-closex" onClick={submitting ? undefined : onClose}><X size={16} /></div>

        {done ? (
          <div className="wd-sheet-scroll" style={{ padding: "24px 0", textAlign: "center" }}>
            <div className="wd-success-ico" style={{ animation: "wd-countPop 0.4s ease" }}><Check size={26} /></div>
            <div style={{ fontSize: 17, fontWeight: 500, color: "#26215C" }}>Instruction submitted</div>
            <p style={{ fontSize: 13.5, color: "#7d72a8", margin: "12px auto", maxWidth: 300, lineHeight: 1.5 }}>
              Your instruction to sell <span style={{ color: "#26215C", fontWeight: 500 }}>{item.symbol}</span> is
              queued for the next market window.
            </p>
            <div className="wd-refchip">
              Reference <span style={{ fontFamily: "var(--font-mono, monospace)", color: "#534AB7", fontWeight: 500 }}>{ref}</span>
            </div>
            <button className="wd-btn-done" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="wd-sheet-scroll">
            <div style={{ fontSize: 19, fontWeight: 500, color: "#26215C", paddingRight: 32 }}>Confirm sell instruction</div>
            <div style={{ fontSize: 13.5, color: "#7d72a8", marginTop: 4, lineHeight: 1.4 }}>
              {isStrategy
                ? "You are instructing us to sell every asset held in this strategy."
                : isPartial
                  ? `You are instructing us to sell ${sellQty} of your ${maxQty} shares.`
                  : "You are instructing us to sell this asset in full."}
            </div>

            <div className="wd-asset-row">
              <div className="wd-avatar" style={{ height: 42, width: 42, background: item.logo ? "#fff" : colorFor(item.symbol) }}>
                {item.logo
                  ? <img src={item.logo} alt="" style={{ height: "100%", width: "100%", objectFit: "cover", borderRadius: 13 }} />
                  : String(item.symbol).slice(0, 2).toUpperCase()}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "#26215C" }}>{item.symbol}</div>
                <div style={{ fontSize: 12, color: "#9a8fc0" }}>
                  {item.name}{item.kind === "security" && item.qty ? ` · ${item.qty} sh held` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 10, color: "#b3a9d4", textTransform: "uppercase", letterSpacing: "0.06em" }}>Est. value</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "#26215C", fontVariantNumeric: "tabular-nums" }}>{fmtR(item.value * frac)}</div>
              </div>
            </div>

            {/* Quantity picker — single securities with more than one share. */}
            {canPartial && (
              <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 16, background: "#faf8ff", border: "0.5px solid rgba(127,119,221,0.16)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, color: "#7d72a8" }}>Shares to sell</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <button type="button" onClick={() => setSellQty((q) => Math.max(1, q - 1))} disabled={sellQty <= 1}
                      style={{ height: 30, width: 30, borderRadius: 9, border: "0.5px solid rgba(127,119,221,0.3)", background: "#fff", color: "#534AB7", fontSize: 18, lineHeight: "1", cursor: sellQty <= 1 ? "not-allowed" : "pointer", opacity: sellQty <= 1 ? 0.4 : 1 }}>−</button>
                    <span style={{ minWidth: 44, textAlign: "center", fontSize: 18, fontWeight: 600, color: "#26215C", fontVariantNumeric: "tabular-nums" }}>{sellQty}</span>
                    <button type="button" onClick={() => setSellQty((q) => Math.min(maxQty, q + 1))} disabled={sellQty >= maxQty}
                      style={{ height: 30, width: 30, borderRadius: 9, border: "0.5px solid rgba(127,119,221,0.3)", background: "#fff", color: "#534AB7", fontSize: 18, lineHeight: "1", cursor: sellQty >= maxQty ? "not-allowed" : "pointer", opacity: sellQty >= maxQty ? 0.4 : 1 }}>+</button>
                  </div>
                </div>
                <input type="range" min={1} max={maxQty} step={1} value={sellQty}
                  onChange={(e) => setSellQty(Number(e.target.value))}
                  style={{ marginTop: 12, width: "100%", accentColor: "#534AB7" }} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <button type="button" onClick={() => setSellQty(maxQty)} style={{ fontSize: 11, fontWeight: 600, color: "#534AB7", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Sell all {maxQty}</button>
                  <span style={{ fontSize: 11, color: "#9a8fc0" }}>{sellQty} of {maxQty} shares</span>
                </div>
              </div>
            )}

            {(() => {
              const proceeds = Number(item.positionsValue ?? item.value ?? 0) * frac;
              // Reserve is only returned on a FULL exit — a partial sell keeps the position open.
              const reserve = isPartial ? 0 : Math.max(0, Number(item.reserveRefundCents || 0)) / 100;
              const net = proceeds + reserve;
              const row = (label, val, opts = {}) => (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: opts.last ? "none" : "0.5px solid rgba(127,119,221,0.14)" }}>
                  <span style={{ fontSize: opts.strong ? 13 : 12.5, color: opts.strong ? "#26215C" : "#7d72a8", fontWeight: opts.strong ? 500 : 400 }}>{label}</span>
                  <span style={{ fontSize: opts.strong ? 15 : 13, fontWeight: 500, color: opts.green ? "#0F6E56" : "#26215C", fontVariantNumeric: "tabular-nums" }}>{opts.green && val > 0 ? "+ " : ""}{fmtR(val)}</span>
                </div>
              );
              return (
                <div style={{ marginTop: 16, padding: "4px 16px", borderRadius: 16, background: "#faf8ff", border: "0.5px solid rgba(127,119,221,0.16)" }}>
                  {row("Estimated proceeds", proceeds)}
                  {row("Sell fee", 0)}
                  {reserve > 0 && row("Unused 8% reserve returned", reserve, { green: true })}
                  {row("Estimated to your wallet", net, { strong: true, last: true })}
                </div>
              );
            })()}

            {/* No live price → warn (non-blocking): proceeds set by broker fill. */}
            {item.kind === "security" && item.hasLivePrice === false && (
              <div style={{ marginTop: 14, display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, background: "rgba(245,197,24,0.08)", border: "0.5px solid rgba(245,197,24,0.3)" }}>
                <ShieldAlert size={16} color="#BA7517" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12, color: "#7d6a3a", lineHeight: 1.55 }}>
                  We couldn't get a live price for <span style={{ fontWeight: 500, color: "#5a4d1a" }}>{item.symbol}</span> right now, so the estimate above may be off. Your proceeds will be set by the broker's execution price at the next market window.
                </div>
              </div>
            )}

            <div className="wd-warn">
              <ShieldAlert size={16} color="#BA7517" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12, color: "#7d6a3a", lineHeight: 1.6 }}>
                <p style={{ margin: "0 0 6px" }}>Processed at the next market window and <span style={{ color: "#5a4d1a", fontWeight: 500 }}>cannot be cancelled</span> once submitted.</p>
                <p style={{ margin: "0 0 6px" }}>Final amount is set by the actual execution price and may differ from the estimate.</p>
                <p style={{ margin: 0 }}>No sell fee is charged. {Number(item.reserveRefundCents || 0) > 0 ? "Any unused 8% execution reserve from your purchase is returned to your wallet on this full exit." : "Any unused execution reserve from your purchase is returned to your wallet at settlement."}</p>
              </div>
            </div>

            <div className="wd-ack" onClick={() => setAck((v) => !v)}>
              <span className={"wd-ack-box" + (ack ? " on" : "")}>{ack && <Check size={14} color="#fff" />}</span>
              <span style={{ fontSize: 12, color: "#7d72a8", lineHeight: 1.6 }}>
                I understand this is an instruction to sell at the prevailing market price and that it cannot be reversed once submitted.
              </span>
            </div>

            {err && <div className="wd-error" style={{ marginTop: 14 }}>{err}</div>}
            </div>

            <div className="wd-sheet-footer">
              <button className="wd-btn-cancel" onClick={onClose} disabled={submitting}>Cancel</button>
              <button
                className="wd-btn-confirm"
                onClick={confirm}
                disabled={!ack || submitting}
                style={{
                  background: ack && !submitting ? "#534AB7" : "rgba(83,74,183,0.35)",
                  color: ack && !submitting ? "#fff" : "rgba(255,255,255,0.7)",
                  cursor: ack && !submitting ? "pointer" : "not-allowed",
                }}
              >
                {submitting && <Loader2 size={16} className="wd-spin" />}
                {submitting ? "Submitting…" : "Confirm sell"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

const WD_CSS = `
.wd-root { position:relative; min-height:100vh; background:#fff; font-family:var(--font-sans, system-ui, sans-serif); overflow:hidden; }
.wd-canvas { position:absolute; top:0; left:0; width:100%; height:340px; z-index:0; background:#1a0833; }
.wd-fade { position:absolute; top:0; left:0; right:0; height:340px; z-index:1; pointer-events:none;
  background:linear-gradient(180deg, rgba(26,10,58,0) 0%, rgba(26,10,58,0) 55%, rgba(255,255,255,0.4) 82%, #fff 100%); }
.wd-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px; }
.wd-iconbtn { height:38px; width:38px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; cursor:pointer; background:rgba(255,255,255,0.08); border:0.5px solid rgba(255,255,255,0.14); transition:background 0.2s; }
.wd-iconbtn:active { background:rgba(255,255,255,0.18); }
.wd-hero-label { font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:rgba(207,188,255,0.75); font-weight:500; }
.wd-hero-val { font-size:42px; font-weight:500; color:#fff; margin-top:10px; font-variant-numeric:tabular-nums; letter-spacing:-0.01em; }
.wd-pill { display:inline-flex; align-items:center; gap:5px; margin-top:10px; padding:5px 12px; border-radius:100px; border:0.5px solid; font-size:13px; font-weight:500; }
.wd-since { font-size:12px; color:rgba(207,188,255,0.55); margin-top:14px; }
.wd-splitcard { flex:1; border-radius:18px; background:rgba(255,255,255,0.92); border:0.5px solid rgba(127,119,221,0.16); padding:14px; display:flex; align-items:center; gap:11px; box-shadow:0 4px 24px rgba(60,52,137,0.08); opacity:0; transform:translateY(12px); }
.wd-split-ico { height:36px; width:36px; border-radius:11px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.wd-split-label { font-size:11px; color:#8c81b3; font-weight:400; }
.wd-split-val { font-size:18px; font-weight:500; color:#26215C; font-variant-numeric:tabular-nums; margin-top:1px; }
.wd-sec-head { display:flex; align-items:baseline; justify-content:space-between; padding:0 2px; }
.wd-sec-head > span:first-child { font-size:16px; font-weight:500; color:#26215C; }
.wd-sec-sub { font-size:12px; color:#9a8fc0; font-weight:400; }
.wd-list { display:flex; flex-direction:column; gap:12px; margin-top:14px; }
.wd-hcard { border-radius:18px; background:#fff; border:0.5px solid rgba(127,119,221,0.16); padding:14px 16px; display:flex; align-items:center; gap:13px; cursor:pointer; box-shadow:0 2px 16px rgba(60,52,137,0.06); transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s, border-color 0.2s; opacity:0; transform:translateY(16px); }
.wd-hcard:active { transform:scale(0.985); }
.wd-hcard:hover { box-shadow:0 6px 24px rgba(60,52,137,0.12); border-color:rgba(127,119,221,0.3); }
.wd-name { font-size:14.5px; font-weight:500; color:#26215C; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wd-sub { font-size:12px; color:#9a8fc0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wd-cardval { font-size:14px; font-weight:500; color:#26215C; font-variant-numeric:tabular-nums; }
.wd-avatar { border-radius:13px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:13px; font-weight:500; color:#fff; overflow:hidden; }
.wd-footer-card { border-radius:18px; background:#faf8ff; border:0.5px solid rgba(127,119,221,0.18); padding:16px 18px; display:flex; align-items:center; gap:14px; }
.wd-footer-ico { height:42px; width:42px; border-radius:12px; background:rgba(127,119,221,0.12); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.wd-loading { display:flex; align-items:center; justify-content:center; gap:8px; padding:48px 0; color:#9a8fc0; font-size:13px; }
.wd-empty { text-align:center; color:#9a8fc0; font-size:13px; padding:48px 16px; }
.wd-error { border-radius:14px; background:rgba(212,83,126,0.08); border:0.5px solid rgba(212,83,126,0.3); color:#B23A63; font-size:12.5px; padding:11px 14px; }
.wd-spin { animation:wd-spin 0.9s linear infinite; }
.wd-sheet-wrap { position:fixed; inset:0; z-index:2000; display:flex; align-items:flex-end; justify-content:center; }
.wd-backdrop { position:absolute; inset:0; background:rgba(26,10,58,0.55); backdrop-filter:blur(3px); }
.wd-sheet { position:relative; display:flex; flex-direction:column; width:100%; max-width:480px; max-height:90vh; max-height:90dvh; border-radius:26px 26px 0 0; background:#fff; padding:20px 20px 0; animation:wd-slideUp 0.26s cubic-bezier(0.34,1.3,0.64,1); box-shadow:0 -8px 40px rgba(26,10,58,0.2); }
.wd-sheet-scroll { flex:1 1 auto; min-height:0; max-height:60vh; overflow-y:auto; overflow-y:overlay; -webkit-overflow-scrolling:touch; }
.wd-sheet-footer { flex-shrink:0; display:flex; gap:12px; margin:0 -20px; padding:14px 20px calc(16px + env(safe-area-inset-bottom, 0px)); background:#fff; border-top:0.5px solid rgba(127,119,221,0.14); box-shadow:0 -6px 16px rgba(26,10,58,0.06); }
.wd-grab { margin:0 auto 16px; height:4px; width:42px; border-radius:100px; background:rgba(127,119,221,0.25); }
.wd-closex { position:absolute; right:16px; top:16px; height:32px; width:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#9a8fc0; cursor:pointer; background:#f5f2ff; }
.wd-asset-row { margin-top:16px; display:flex; align-items:center; gap:12px; padding:14px 16px; border-radius:16px; background:#faf8ff; border:0.5px solid rgba(127,119,221,0.16); }
.wd-warn { margin-top:16px; border-radius:16px; background:rgba(245,197,24,0.08); border:0.5px solid rgba(245,197,24,0.3); padding:14px; display:flex; gap:12px; }
.wd-ack { margin-top:16px; width:100%; display:flex; align-items:flex-start; gap:12px; cursor:pointer; }
.wd-ack-box { margin-top:2px; height:20px; width:20px; border-radius:6px; border:0.5px solid rgba(127,119,221,0.4); background:#faf8ff; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.15s; }
.wd-ack-box.on { background:#534AB7; border-color:#534AB7; }
.wd-btn-cancel { flex:1; border-radius:16px; background:#f5f2ff; border:0.5px solid rgba(127,119,221,0.18); padding:13px; font-size:14px; font-weight:500; color:#534AB7; cursor:pointer; }
.wd-btn-cancel:disabled { opacity:0.5; }
.wd-btn-confirm { flex:1; border-radius:16px; padding:13px; font-size:14px; font-weight:500; border:none; display:inline-flex; align-items:center; justify-content:center; gap:8px; transition:background 0.2s; }
.wd-btn-done { margin-top:18px; width:100%; border-radius:16px; background:#534AB7; border:none; padding:13px; font-size:14px; font-weight:500; color:#fff; cursor:pointer; }
.wd-success-ico { margin:0 auto 12px; height:52px; width:52px; border-radius:50%; background:rgba(94,202,165,0.18); border:0.5px solid rgba(94,202,165,0.4); display:flex; align-items:center; justify-content:center; color:#0F6E56; }
.wd-refchip { margin:0 auto; display:inline-flex; align-items:center; gap:8px; border-radius:100px; background:#faf8ff; border:0.5px solid rgba(127,119,221,0.18); padding:7px 15px; font-size:12px; color:#9a8fc0; }
@keyframes wd-floatIn { to { opacity:1; transform:translateY(0); } }
@keyframes wd-slideUp { from { transform:translateY(100%); } to { transform:translateY(0); } }
@keyframes wd-countPop { 0% { transform:scale(0.94); opacity:0.6; } 100% { transform:scale(1); opacity:1; } }
@keyframes wd-spin { to { transform:rotate(360deg); } }
`;
