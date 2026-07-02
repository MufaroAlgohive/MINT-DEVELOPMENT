import React, { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ShieldCheck, IdCard, MapPin, Search, CheckCircle2, Loader2, Store, ChevronRight, Plus, Check, Upload, Download, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import ExperianVerification from "../../components/ExperianVerification";

// AlgoLend marketplace endpoint + key — set on Vercel (preview + prod), no
// hardcoded fallback. It's a VITE_ key (client-exposed by design).
const ALGOLEND_URL = import.meta.env.VITE_ALGOLEND_URL || "https://admin.algolend.co.za";
const ALGOLEND_KEY = import.meta.env.VITE_ALGOLEND_API_KEY;

// Income verification (bank-statement AI). Hardcoded true for now — testing on
// the PR preview, no Vercel env var access yet. TODO: switch back to
// `import.meta.env.VITE_INCOME_AI === "true"` once VITE_INCOME_AI is set on
// Vercel (preview + prod).
const INCOME_AI_ENABLED = true;

/**
 * CreditFlow — the unsecured-credit journey per the MINT Credit Journey spec (§3).
 * This is the SPINE: tap Credit → branch on KYC status → (consent → real-time KYC →
 * single bureau pull) → marketplace. The branch + consent are real; KYC, bureau and
 * marketplace are labelled placeholders wired in later (KYC reuses onboarding KYC;
 * bureau reuses the single Experian pull; marketplace = AlgoLend, deferred).
 *
 * IMPORTANT: the "verified?" branch is KYC-ONLY, not full onboarding — a credit
 * applicant must NOT be required to sign an investment mandate (spec §3.1).
 */
// Experian SA score scale (Delphi-style). Adjust once we see real returns.
const SCORE_MIN = 0;
const SCORE_MAX = 999;
const bandFor = (s) => {
  if (!Number.isFinite(s)) return "No score on file";
  if (s >= 767) return "Excellent";
  if (s >= 681) return "Good";
  if (s >= 614) return "Fair";
  if (s >= 583) return "Average";
  return "Below average";
};

// Lender marketplace — stub providers until AlgoLend's marketplace is wired in
// (per spec, AlgoLend supplies the real lender list + live terms; this gets the
// comparison/select/submit UX working end-to-end today).
// Small deterministic avatar colour for a lender (no logos from AlgoLend yet).
const lenderColor = (key) => {
  const palette = ["#4C3AA3", "#15457A", "#0072CE", "#009677", "#B02020", "#6C3FE0", "#7a4aa7"];
  let h = 0;
  for (const c of String(key || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
};

const APP_STATUS = {
  in_review: { label: "In review", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-600", dot: "bg-red-500" },
  complete: { label: "Complete", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
};

// Count-up animation for a number (used on the score card).
const CountUp = ({ value, className, duration = 1200 }) => {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!Number.isFinite(value)) { el.textContent = "—"; return; }
    let raf, start;
    const tick = (t) => {
      if (start == null) start = t;
      const p = Math.min((t - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(value * ease));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => raf && cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span ref={ref} className={className}>—</span>;
};

// Score-band tone for the dark gradient hero card (light text on dark).
const bandTone = (band) => {
  const b = String(band || "").toLowerCase();
  if (/excellent|good|low risk/.test(b)) return { dot: "bg-emerald-400", chip: "bg-emerald-400/20 text-emerald-200" };
  if (/fair|average|medium/.test(b)) return { dot: "bg-amber-300", chip: "bg-amber-300/20 text-amber-100" };
  if (/below|high risk|very high/.test(b)) return { dot: "bg-rose-400", chip: "bg-rose-400/20 text-rose-100" };
  return { dot: "bg-white/50", chip: "bg-white/15 text-white/70" };
};

// Segmented semicircle gauge — canvas port of the reference design: 4 thick
// rounded segments with 8° gaps, purple fill flows continuously up to the score
// fraction, with a count-up of the number.
const ScoreGauge = ({ value }) => {
  const canvasRef = useRef(null);
  const numRef = useRef(null);
  const rafRef = useRef(null);
  const has = Number.isFinite(value);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const CW = canvas.width, CH = canvas.height;       // 520 x 300 (hi-res)
    const cx = CW / 2, cy = CH - 20, R = 205;
    const SEGS = 4, SEG_W = 22, GAP_DEG = 8, TOTAL_DEG = 180;
    const SEG_DEG = (TOTAL_DEG - GAP_DEG * (SEGS - 1)) / SEGS;
    const PURPLE = "#6C3FE0", TRACK = "#EDE9FB";
    const toRad = (deg) => ((180 + deg) * Math.PI) / 180; // 0° = left
    const targetFrac = has ? Math.max(0, Math.min(1, (value - SCORE_MIN) / (SCORE_MAX - SCORE_MIN))) : 0;

    const draw = (progress) => {
      ctx.clearRect(0, 0, CW, CH);
      const filledDeg = targetFrac * progress * TOTAL_DEG;
      let cursor = 0;
      for (let i = 0; i < SEGS; i++) {
        const segStart = cursor, segEnd = cursor + SEG_DEG;
        ctx.beginPath(); ctx.arc(cx, cy, R, toRad(segStart), toRad(segEnd));
        ctx.strokeStyle = TRACK; ctx.lineWidth = SEG_W; ctx.lineCap = "round"; ctx.stroke();
        const fillEnd = Math.min(segEnd, filledDeg);
        if (fillEnd > segStart) {
          ctx.beginPath(); ctx.arc(cx, cy, R, toRad(segStart), toRad(fillEnd));
          ctx.strokeStyle = PURPLE; ctx.lineWidth = SEG_W; ctx.lineCap = "round"; ctx.stroke();
        }
        cursor += SEG_DEG + GAP_DEG;
      }
    };

    let startT = null; const dur = 1300;
    const tick = (t) => {
      if (startT == null) startT = t;
      const p = Math.min((t - startT) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      draw(ease);
      if (numRef.current) numRef.current.textContent = has ? String(Math.round(value * ease)) : "—";
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, has]);

  return (
    <div className="relative mx-auto" style={{ width: 260, height: 150 }}>
      <canvas ref={canvasRef} width={520} height={300} style={{ width: 260, height: 150, position: "absolute", top: 0, left: 0 }} />
      <div className="absolute inset-x-0 text-center" style={{ bottom: 4 }}>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{has ? bandFor(value) : "Credit score"}</div>
        <div ref={numRef} className="text-[44px] font-extrabold leading-none text-slate-900" style={{ letterSpacing: "-2px" }}>—</div>
      </div>
    </div>
  );
};

const CreditFlow = ({ profile, onBack, onTabChange }) => {
  // steps: checking | overview | consent | kyc | bureau | income | marketplace | newApplication | marketplaceOffers
  const [step, setStep] = useState("checking");
  const [kycVerified, setKycVerified] = useState(false);
  const [consentDone, setConsentDone] = useState(false);
  const [resumeTarget, setResumeTarget] = useState("consent"); // where Continue takes you

  // Bureau step
  const [bureauRunning, setBureauRunning] = useState(false);
  const [score, setScore] = useState(null);
  const [scoreBand, setScoreBand] = useState("");
  const [scoreReasons, setScoreReasons] = useState([]);
  const [scoreError, setScoreError] = useState("");
  const [creditDone, setCreditDone] = useState(false);
  const [creditAt, setCreditAt] = useState(null); // when the bureau check last ran
  // Official Experian report PDF (base64) returned by the last run — powers the
  // download button so the client can verify the score straight from the bureau.
  const [reportPdf, setReportPdf] = useState(null); // { base64, filename }
  const [idOnFile, setIdOnFile] = useState("");
  const [loanAmount, setLoanAmount] = useState(50000);
  const [loanTermMonths, setLoanTermMonths] = useState(3);
  // Monthly income — captured once as the last onboarding step, reused by AlgoLend.
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [statementMonths, setStatementMonths] = useState(6); // 3 or 6 (AI path) — default 6 for detection accuracy
  const [statementName, setStatementName] = useState("");
  const [statementUploading, setStatementUploading] = useState(false);
  const [statementDetecting, setStatementDetecting] = useState(false);
  const [statementError, setStatementError] = useState("");
  // Gemini's salary-detection draft — the user confirms/edits before it becomes monthlyIncome.
  const [incomeDetection, setIncomeDetection] = useState(null);
  const [incomeSaving, setIncomeSaving] = useState(false);
  // Address (Experian requires street + suburb + postal). Prompted if missing/rejected.
  const [addrPrompt, setAddrPrompt] = useState(false);
  const [addr1, setAddr1] = useState("");   // street / line 1
  const [addr2, setAddr2] = useState("");   // suburb / line 2
  const [addr3, setAddr3] = useState("");   // city / line 3 (optional)
  const [addrPostal, setAddrPostal] = useState("");
  const [addrLookupLoading, setAddrLookupLoading] = useState(false);

  // Proof of address (CEO-required KYC artefact) — uploaded on the bureau step.
  const [poaUploading, setPoaUploading] = useState(false);
  const [poaPath, setPoaPath] = useState(null);
  const [poaFileName, setPoaFileName] = useState("");
  const [poaError, setPoaError] = useState("");

  // Marketplace: "My applications" list → tap one → provider comparison.
  const [applications, setApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [activeApplication, setActiveApplication] = useState(null);
  const [creatingApplication, setCreatingApplication] = useState(false);
  const [deletingAppId, setDeletingAppId] = useState(null); // app being deleted (un-sent only)
  const [adjustAmount, setAdjustAmount] = useState(0);      // lower-amount control on the offers page
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [providerSel, setProviderSel] = useState(new Set());
  const [providerSubmitting, setProviderSubmitting] = useState(false);
  const [providerSubmitted, setProviderSubmitted] = useState(false);
  // Live lender offers from the AlgoLend marketplace.
  const [algolendOffers, setAlgolendOffers] = useState(null);
  const [algolendDeclines, setAlgolendDeclines] = useState([]); // lenders that didn't match
  const [algolendRequestId, setAlgolendRequestId] = useState(null);
  const [algolendLoading, setAlgolendLoading] = useState(false);
  const [algolendError, setAlgolendError] = useState("");
  const [algolendInfo, setAlgolendInfo] = useState(null); // { message, totalLenders, evaluatedAt }
  const [showScoreBack, setShowScoreBack] = useState(false); // flip the score card
  const [customAmount, setCustomAmount] = useState(false);   // chips ↔ manual input
  const [portalTarget, setPortalTarget] = useState(null);    // for the fixed selection tray
  useEffect(() => { setPortalTarget(typeof document !== "undefined" ? document.body : null); }, []);

  // KYC step: ID-number capture (reuses /api/onboarding/check-id-number — which also
  // creates the Sumsub applicant + saves profiles.id_number) → ExperianVerification.
  const [idNumber, setIdNumber] = useState("");
  const [idChecking, setIdChecking] = useState(false);
  const [idError, setIdError] = useState("");
  const [idConfirmed, setIdConfirmed] = useState(false);

  const handleIdCheck = useCallback(async () => {
    setIdError("");
    const clean = idNumber.replace(/\D/g, "");
    if (!/^\d{13}$/.test(clean)) { setIdError("Please enter a valid 13-digit ID number."); return; }
    setIdChecking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setIdError("You must be signed in to continue."); return; }
      const res = await fetch("/api/onboarding/check-id-number", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id_number: clean }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || "Failed to verify ID number.");
      if (result.exists) { setIdError("An account with this ID number already exists."); return; }

      // Persist the ID into user_onboarding.sumsub_raw so the Experian step can
      // read it (idmn/start looks for raw.identity_details.identity_number).
      const userId = session.user?.id;
      if (userId) {
        const { data: rows } = await supabase
          .from("user_onboarding").select("id, sumsub_raw").eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(1);
        const row = rows?.[0];
        let raw = {};
        try { raw = typeof row?.sumsub_raw === "string" ? JSON.parse(row.sumsub_raw) : (row?.sumsub_raw || {}); } catch {}
        raw.identity_details = { ...(raw.identity_details || {}), identity_number: clean, applicantId: result.applicantId || raw.identity_details?.applicantId || null, savedAt: new Date().toISOString() };
        raw.identity_details_saved = true;
        if (row?.id) await supabase.from("user_onboarding").update({ sumsub_raw: raw }).eq("id", row.id);
        else await supabase.from("user_onboarding").insert({ user_id: userId, sumsub_raw: raw });
      }
      setIdConfirmed(true);
    } catch (e) {
      setIdError(e?.message || "Failed to verify ID number.");
    } finally {
      setIdChecking(false);
    }
  }, [idNumber]);

  // Persist a credit-flow flag into user_onboarding.sumsub_raw so the journey is
  // resumable — leave mid-flow, come back, continue where you left off (spec MC-04).
  const saveCreditFlag = useCallback(async (patch) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id; if (!uid) return;
      const { data: rows } = await supabase.from("user_onboarding").select("id, sumsub_raw").eq("user_id", uid).order("created_at", { ascending: false }).limit(1);
      const row = rows?.[0];
      let raw = {};
      try { raw = typeof row?.sumsub_raw === "string" ? JSON.parse(row.sumsub_raw) : (row?.sumsub_raw || {}); } catch {}
      Object.assign(raw, patch);
      if (row?.id) await supabase.from("user_onboarding").update({ sumsub_raw: raw }).eq("id", row.id);
      else await supabase.from("user_onboarding").insert({ user_id: uid, sumsub_raw: raw });
    } catch (e) { console.warn("[CreditFlow] saveCreditFlag failed:", e?.message || e); }
  }, []);

  // ── Branch + resume. KYC-only (ignore investment mandate, spec §3.1). ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let kycDone = false, raw = {};
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (uid) {
          const { data: rows } = await supabase.from("user_onboarding").select("sumsub_raw, kyc_status").eq("user_id", uid).order("created_at", { ascending: false }).limit(1);
          const row = rows?.[0];
          kycDone = ["approved", "onboarding_complete", "verified"].includes(row?.kyc_status);
          try { raw = typeof row?.sumsub_raw === "string" ? JSON.parse(row.sumsub_raw) : (row?.sumsub_raw || {}); } catch {}
        }
      } catch (e) {
        console.warn("[CreditFlow] status check failed:", e?.message || e);
      }
      if (cancelled) return;
      const creditKycDone = !!raw.credit_kyc_verified_at;
      const idDone = !!raw.identity_details?.identity_number;
      const consented = !!raw.credit_consent_at;
      const verified = kycDone || creditKycDone;
      const scored = !!raw.credit_score_at;
      setCreditAt(raw.credit_score_at || null);
      setKycVerified(verified);
      setIdConfirmed(idDone);
      setConsentDone(consented);
      setCreditDone(scored);
      setIdOnFile(raw.identity_details?.identity_number || "");
      // Address sources (best-effort): a previously-entered credit address →
      // onboarding manual address → bureau KYC address → profile.
      const ca = raw.credit_address || {};
      const ad = raw.address_details || {};
      const kyc0 = (Array.isArray(raw.experian_kyc_addresses) && raw.experian_kyc_addresses[0]) || {};
      setAddr1(ca.address1 || ad.street || (kyc0.lines && kyc0.lines[0]) || profile?.address || "");
      setAddr2(ca.address2 || ad.city || ad.suburb || (kyc0.lines && kyc0.lines[1]) || "");
      setAddr3(ca.address3 || (kyc0.lines && kyc0.lines[2]) || "");
      setAddrPostal(ca.postal_code || ad.postal_code || kyc0.postalCode || profile?.postalCode || profile?.postal_code || "");
      if (Number.isFinite(Number(raw.credit_score))) { setScore(Number(raw.credit_score)); setScoreBand(raw.credit_score_band || bandFor(Number(raw.credit_score))); }
      if (Array.isArray(raw.credit_score_reasons)) setScoreReasons(raw.credit_score_reasons);
      // Proof of address — reuse one already uploaded during invest onboarding if present.
      const poa = raw.credit_poa_path || raw.address_details?.proof_of_address_path || null;
      if (poa) { setPoaPath(poa); setPoaFileName(raw.credit_poa_name || raw.address_details?.proof_of_address_name || "Proof of address"); }
      // Monthly income (last onboarding step). Reuse a real TruID figure if one exists.
      const savedIncome = Number(raw.credit_monthly_income) || 0;
      if (savedIncome > 0) setMonthlyIncome(savedIncome);
      const incomeDone = savedIncome > 0;
      // Resume to the FIRST INCOMPLETE step in order (consent → kyc → bureau →
      // income → marketplace), NOT the furthest-reachable one. The old logic
      // checked the furthest gate first, so if a later step was satisfied (e.g.
      // KYC marked done by INVESTMENT onboarding) it would skip an earlier
      // incomplete step — notably credit consent, which must always be given.
      setResumeTarget(
        !consented ? "consent"
        : !verified ? "kyc"
        : !scored ? "bureau"
        : !incomeDone ? "income"
        : "marketplace"
      );
      // Fully onboarded (scored + income) → straight to My applications (no
      // checklist). Anyone mid-setup → the overview checklist first (ticks on
      // what's done), and Continue resumes to resumeTarget.
      if (scored && incomeDone) { setStep("marketplace"); loadApplications(); }
      else setStep("overview");
    })();
    return () => { cancelled = true; };
  }, []);

  // Skip-completed: if the user is routed to the KYC step but identity is already
  // verified (e.g. it was done during INVESTMENT onboarding), don't force them to
  // re-verify — advance straight to the bureau step. This pairs with the
  // first-incomplete resume so consent is still collected first, then KYC is
  // skipped because it's genuinely done.
  useEffect(() => {
    if (step === "kyc" && kycVerified) setStep("bureau");
  }, [step, kycVerified]);

  const loadApplications = useCallback(async () => {
    setApplicationsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) { setApplications([]); return; }
      const { data } = await supabase
        .from("credit_marketplace_applications")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false });
      setApplications(data || []);
    } catch (e) {
      console.warn("[CreditFlow] loadApplications failed:", e?.message || e);
      setApplications([]);
    } finally {
      setApplicationsLoading(false);
    }
  }, []);

  // Delete an application that hasn't been sent to any provider yet. Owner-RLS
  // protects it server-side; the button only renders when selected_providers is
  // empty, so a submitted application can never be deleted from here.
  const deleteApplication = useCallback(async (appId) => {
    setDeletingAppId(appId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) return;
      const { error } = await supabase
        .from("credit_marketplace_applications")
        .delete()
        .eq("id", appId)
        .eq("user_id", uid);
      if (error) throw error;
      setApplications((prev) => prev.filter((a) => a.id !== appId));
    } catch (e) {
      console.warn("[CreditFlow] deleteApplication failed:", e?.message || e);
    } finally {
      setDeletingAppId(null);
    }
  }, []);

  const goMarketplace = useCallback(() => { setStep("marketplace"); loadApplications(); }, [loadApplications]);

  // Ask AlgoLend to evaluate every active lender policy and return ranked
  // offers for this application (real lender names, rates, installments).
  const evaluateWithAlgoLend = useCallback(async (app) => {
    setAlgolendLoading(true);
    setAlgolendError("");
    setAlgolendOffers(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email || "";
      const res = await fetch(`${ALGOLEND_URL}/api/marketplace/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ALGOLEND_KEY}`,
        },
        body: JSON.stringify({
          creditScore: score,
          monthlyIncome: monthlyIncome || profile?.monthlyIncome || profile?.monthly_income || 0,
          existingMonthlyObligations: 0,
          openDefaults: 0,
          idVerified: true,
          requestedAmount: Number(app.requested_amount),
          termMonths: Number(app.requested_term_months),
          mintUserId: email,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not fetch offers.");
      setAlgolendRequestId(data.requestId);
      setAlgolendOffers(data.offers || []);
      setAlgolendDeclines(Array.isArray(data.declines) ? data.declines : []);
      setAlgolendInfo({ message: data.message || "", totalLenders: Number(data.totalLenders) || 0, evaluatedAt: data.evaluatedAt || new Date().toISOString() });
    } catch (e) {
      setAlgolendError(e?.message || "Failed to load lender offers.");
      setAlgolendOffers([]);
      setAlgolendDeclines([]);
      setAlgolendInfo(null);
    } finally {
      setAlgolendLoading(false);
    }
  }, [score, profile, monthlyIncome]);

  const openApplication = useCallback((app) => {
    setActiveApplication(app);
    setAdjustAmount(Number(app.requested_amount) || 0); // seed the lower-amount control
    const existing = Array.isArray(app.selected_providers) ? app.selected_providers : [];
    setProviderSel(new Set(existing.map((p) => p.provider_id)));
    setProviderSubmitted(existing.length > 0);
    setStep("marketplaceOffers");
    evaluateWithAlgoLend(app);
  }, [evaluateWithAlgoLend]);

  // Lower the active application's requested amount when no lender made an offer.
  // The new (lower) amount becomes the OFFICIAL requested_amount, then we
  // re-evaluate AlgoLend against it. Declared AFTER evaluateWithAlgoLend so its
  // dependency reference is initialised (avoids a TDZ crash on render).
  const applyAdjustedAmount = useCallback(async () => {
    const amt = Number(adjustAmount) || 0;
    const current = Number(activeApplication?.requested_amount) || 0;
    if (!activeApplication || amt < 100 || amt >= current) return;
    setAdjustSaving(true);
    try {
      const { error } = await supabase
        .from("credit_marketplace_applications")
        .update({ requested_amount: amt, updated_at: new Date().toISOString() })
        .eq("id", activeApplication.id);
      if (error) throw error;
      const updated = { ...activeApplication, requested_amount: amt };
      setActiveApplication(updated);
      setApplications((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      await evaluateWithAlgoLend(updated);
    } catch (e) {
      console.warn("[CreditFlow] applyAdjustedAmount failed:", e?.message || e);
    } finally {
      setAdjustSaving(false);
    }
  }, [adjustAmount, activeApplication, evaluateWithAlgoLend]);

  // Multi-select — the CEO's model lets a borrower apply to several lenders.
  const toggleProviderSel = useCallback((id) => {
    setProviderSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setProviderSubmitted(false);
  }, []);

  // Submit the chosen lender(s) to AlgoLend — one accept call per selected
  // lender (same requestId); each pushes a loan_application into that lender's
  // own dashboard. We record every lender that accepted successfully.
  const submitProviderSelections = useCallback(async () => {
    if (!activeApplication || providerSel.size === 0 || !algolendRequestId) return;
    setProviderSubmitting(true);
    setAlgolendError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email || "";
      const lenderIds = [...providerSel];

      // AlgoLend's offers endpoint can transiently 404 (cold start) or 5xx — the
      // user saw it fail on the first tap and succeed on the second. Retry each
      // submission up to 5 times with a short backoff before giving up, so a
      // transient blip doesn't surface as "couldn't be submitted".
      const TRANSIENT = [404, 408, 425, 429, 500, 502, 503, 504];
      const submitOne = async (lenderId, attempts = 5) => {
        let lastErr;
        for (let i = 0; i < attempts; i++) {
          try {
            const res = await fetch(`${ALGOLEND_URL}/api/marketplace/offers`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${ALGOLEND_KEY}` },
              body: JSON.stringify({ requestId: algolendRequestId, lenderId, mintUserId: email }),
            });
            if (res.ok) return lenderId;
            const e = await res.json().catch(() => ({}));
            lastErr = new Error(e.error || `HTTP ${res.status}`);
            // Permanent error (auth/validation) → stop retrying immediately.
            if (!TRANSIENT.includes(res.status)) throw lastErr;
          } catch (err) {
            lastErr = err; // network error → also retryable
          }
          if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        }
        throw lastErr || new Error("rejected");
      };

      const results = await Promise.allSettled(lenderIds.map((lenderId) => submitOne(lenderId)));
      const accepted = lenderIds.filter((_, i) => results[i].status === "fulfilled");
      if (accepted.length === 0) throw new Error("None of your selected lenders could be submitted. Please try again.");
      const selected = accepted.map((lenderId) => {
        const offer = (algolendOffers || []).find((o) => o.lenderId === lenderId);
        return { provider_id: lenderId, provider_name: offer?.lenderName || lenderId };
      });
      await supabase
        .from("credit_marketplace_applications")
        .update({ selected_providers: selected, updated_at: new Date().toISOString() })
        .eq("id", activeApplication.id);
      setProviderSel(new Set(accepted));
      setProviderSubmitted(true);
    } catch (e) {
      console.warn("[CreditFlow] submit failed:", e?.message || e);
      setAlgolendError(e?.message || "Could not submit your application.");
    } finally {
      setProviderSubmitting(false);
    }
  }, [activeApplication, providerSel, algolendRequestId, algolendOffers]);

  // Auto-fetch the applicant's address from Experian's KYC lookup (reuses the
  // bureau record), so the credit check has a valid address without typing.
  // Returns { address1, address2, address3, postal_code } or null.
  const fetchKycAddress = useCallback(async (idNum, forename, surname) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return null;
      const res = await fetch("/api/experian/kyc-addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ identity_number: idNum, forename, surname }),
      });
      const data = await res.json();
      const a = (data?.addresses || []).find((x) => Array.isArray(x.lines) && x.lines.length) || (data?.addresses || [])[0];
      if (!a || !Array.isArray(a.lines) || !a.lines.length) return null;
      return { address1: a.lines[0] || "", address2: a.lines[1] || "", address3: a.lines[2] || "", postal_code: a.postalCode || "" };
    } catch (e) {
      console.warn("[CreditFlow] KYC address lookup failed:", e?.message || e);
      return null;
    }
  }, []);

  // Proof-of-address upload (CEO-required KYC artefact). Reuses the onboarding
  // signed-URL flow: private "proof-of-address" bucket, file goes straight to
  // storage, only the path is persisted (in sumsub_raw.credit_poa_path).
  const handlePoaUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPoaError("");
    if (file.size > 10 * 1024 * 1024) { setPoaError("File too large — max 10MB."); return; }
    const okType = /(pdf|jpe?g|png)$/i.test(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!okType) { setPoaError("Please upload a PDF, JPG or PNG (bank statement / utility bill)."); return; }
    setPoaUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("You need to be signed in.");
      const res = await fetch("/api/onboarding/poa-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
      });
      const info = await res.json().catch(() => ({}));
      if (!res.ok || !info.success) throw new Error(info.error || "Upload failed. Please try again.");
      const { error: upErr } = await supabase.storage
        .from(info.bucket)
        .uploadToSignedUrl(info.path, info.token, file, { contentType: file.type || undefined, upsert: true });
      if (upErr) throw upErr;
      setPoaPath(info.path);
      setPoaFileName(file.name);
      await saveCreditFlag({ credit_poa_path: info.path, credit_poa_name: file.name, credit_poa_at: new Date().toISOString() });
    } catch (err) {
      console.error("[CreditFlow] POA upload failed:", err);
      setPoaError(err?.message || "Upload failed. Please try again.");
    } finally {
      setPoaUploading(false);
    }
  }, [saveCreditFlag]);

  // Bank-statement upload for the income step (AI path): upload PDF to the
  // private income-statements bucket, then ask Gemini to detect the salary.
  const handleStatementUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const okType = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
    if (!okType) { setStatementError("Please upload a PDF bank statement."); return; }
    setStatementError("");
    setIncomeDetection(null);
    setStatementUploading(true);
    let info;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in required");
      const res = await fetch("/api/credit/statement-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: file.name }),
      });
      info = await res.json().catch(() => ({}));
      if (!res.ok || !info.success) throw new Error(info.error || "Upload failed");
      const { error: upErr } = await supabase.storage.from(info.bucket).uploadToSignedUrl(info.path, info.token, file, { contentType: "application/pdf", upsert: true });
      if (upErr) throw upErr;
      setStatementName(file.name);
      await saveCreditFlag({ credit_bank_statement_path: info.path, credit_bank_statement_months: statementMonths });
    } catch (err) {
      console.warn("[CreditFlow] statement upload failed:", err?.message || err);
      setStatementError(err?.message || "Upload failed. Please try again.");
      setStatementUploading(false);
      return;
    }
    setStatementUploading(false);

    setStatementDetecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/credit/detect-income", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path: info.path, months: statementMonths }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Could not analyse statement");
      setIncomeDetection(data.result);
      if (data.result?.is_salary_detected && data.result.estimated_monthly_income > 0) {
        setMonthlyIncome(Math.round(Number(data.result.estimated_monthly_income)));
      }
      await saveCreditFlag({ credit_income_ai_result: data.result, credit_income_ai_at: new Date().toISOString() });
    } catch (err) {
      console.warn("[CreditFlow] income detection failed:", err?.message || err);
      setStatementError(err?.message || "Couldn't detect your salary automatically — please confirm it manually below.");
    } finally {
      setStatementDetecting(false);
    }
  }, [saveCreditFlag, statementMonths]);

  // Save monthly income (last onboarding step) and move on to My applications.
  const saveIncome = useCallback(async () => {
    if (!(monthlyIncome > 0)) return;
    setIncomeSaving(true);
    try {
      await saveCreditFlag({ credit_monthly_income: monthlyIncome, credit_income_at: new Date().toISOString() });
      setStep("marketplace");
      loadApplications();
    } finally {
      setIncomeSaving(false);
    }
  }, [monthlyIncome, saveCreditFlag, loadApplications]);

  // Explicitly create a new application from the My-applications page (amount +
  // term live here now, not on the bureau step — the single score is reused).
  const createApplication = useCallback(async () => {
    setCreatingApplication(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("You must be signed in.");
      const { data, error } = await supabase
        .from("credit_marketplace_applications")
        .insert({ user_id: uid, requested_amount: loanAmount, requested_term_months: loanTermMonths, status: "in_review", selected_providers: [] })
        .select()
        .single();
      if (error) throw error;
      setApplications((prev) => [data, ...prev]);
      openApplication(data);
    } catch (e) {
      console.warn("[CreditFlow] createApplication failed:", e?.message || e);
    } finally {
      setCreatingApplication(false);
    }
  }, [loanAmount, loanTermMonths]);

  // The single credit bureau enquiry — real Experian pull via /api/credit-check.
  // ID is mandatory (fetched first). Address (street+suburb+postal) is required by
  // Experian; we auto-fetch it from the KYC lookup, and only prompt if the bureau
  // has none on file. ClientRef is sanitized server-side (≤20).
  const runBureau = useCallback(async () => {
    setScoreError("");
    const idNum = (idOnFile || profile?.idNumber || profile?.id_number || "").replace(/\D/g, "");
    const forename = profile?.firstName || profile?.first_name || "";
    const surname = profile?.lastName || profile?.last_name || "";
    // ID is the one thing we can't proceed without — it's fetched at the very start.
    if (!/^\d{13}$/.test(idNum) || !forename || !surname) {
      setScoreError("We couldn't find your verified ID — please complete the identity step first.");
      return;
    }
    // CEO-required: proof of address must be on file before the bureau check.
    if (!poaPath) {
      setScoreError("Please upload your proof of address before running the check.");
      return;
    }

    // Resolve the address: use what we have, else auto-fetch from Experian KYC,
    // else prompt. Experian rejects the enquiry without address1+address2+postal.
    let street = (addr1 || "").trim(), suburb = (addr2 || "").trim(), line3 = (addr3 || "").trim(), postal = (addrPostal || "").trim();
    if (!street || !suburb || !postal) {
      setAddrLookupLoading(true);
      const got = await fetchKycAddress(idNum, forename, surname);
      setAddrLookupLoading(false);
      if (got && got.address1 && got.address2 && got.postal_code) {
        street = got.address1; suburb = got.address2; line3 = got.address3 || ""; postal = got.postal_code;
        setAddr1(street); setAddr2(suburb); setAddr3(line3); setAddrPostal(postal);
      } else {
        setAddrPrompt(true);
        setScoreError("We couldn't find your address on file — please enter it to continue.");
        return;
      }
    }

    setBureauRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("You must be signed in to continue.");
      const res = await fetch("/api/credit-check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userData: {
            identity_number: idNum, forename, surname,
            gender: profile?.gender || undefined,
            date_of_birth: profile?.dateOfBirth || profile?.date_of_birth || undefined,
            address1: street, address2: suburb, address3: line3 || undefined, postal_code: postal,
          },
        }),
      });
      const data = await res.json();
      // Surface the exact Experian error so the user can see it (per request).
      const experianError = data?.raw?.error || data?.error;
      if (!res.ok || data?.success !== true) {
        setScoreError(experianError || "Credit check could not be completed.");
        if (/address/i.test(String(experianError || ""))) setAddrPrompt(true);
        return;
      }
      const s = Number(data.creditScore);
      const hasScore = Number.isFinite(s) && s > 0;
      const band = data?.raw?.creditScore?.riskType || data.score_band || bandFor(s);
      const reasons = Array.isArray(data.scoreReasons) ? data.scoreReasons : [];
      const nowIso = new Date().toISOString();
      setScore(hasScore ? s : null);
      setScoreBand(band);
      setScoreReasons(reasons);
      setCreditDone(true);
      setCreditAt(nowIso);
      // Stash the official Experian PDF (if the bureau returned one) for download.
      if (data.reportPdfBase64) {
        setReportPdf({ base64: data.reportPdfBase64, filename: data.reportPdfFilename || "experian-credit-report.pdf" });
      }
      await saveCreditFlag({
        credit_score: hasScore ? s : null,
        credit_score_band: band,
        credit_score_reasons: reasons,
        credit_score_at: nowIso,
        credit_address: { address1: street, address2: suburb, address3: line3, postal_code: postal },
      });
      // Note: applications (amount + term) are created explicitly on the
      // My-applications page now — the single bureau score is reused across them.
    } catch (e) {
      setScoreError(e?.message || "Credit check could not be completed.");
    } finally {
      setBureauRunning(false);
    }
  }, [idOnFile, profile, addr1, addr2, addr3, addrPostal, poaPath, saveCreditFlag, fetchKycAddress]);

  // Download the official Experian report PDF (base64 → blob) so the client has
  // proof of the exact bureau result, straight from Experian.
  const downloadReportPdf = useCallback(() => {
    if (!reportPdf?.base64) return;
    try {
      const chars = atob(reportPdf.base64);
      const bytes = new Uint8Array(chars.length);
      for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = reportPdf.filename || "experian-credit-report.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[CreditFlow] PDF download failed:", e?.message || e);
    }
  }, [reportPdf]);

  // Bouncy purple coin carried over from the old unsecured-credit first page.
  const BouncyCoin = () => (
    <div className="relative mx-auto mb-6 mt-1 flex h-24 w-24 items-start justify-center">
      <div style={{ animation: "subtleBounce 3s ease-in-out infinite" }}>
        <img src="/assets/images/coinAlgoMoney.png" alt="MINT" className="h-20 w-20 object-contain drop-shadow-2xl" />
      </div>
      <div
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-1 w-12 rounded-[100%] bg-black/10 blur-md"
        style={{ animation: "shadowScale 3s ease-in-out infinite" }}
      />
      <style>{`
        @keyframes subtleBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes shadowScale { 0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.2; } 50% { transform: translateX(-50%) scale(0.8); opacity: 0.1; } }
      `}</style>
    </div>
  );

  const Header = ({ title }) => (
    <header className="flex items-center gap-3 mb-6 relative">
      <button type="button" onClick={onBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm flex-shrink-0">
        <ArrowLeft className="h-5 w-5" />
      </button>
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
    </header>
  );


  return (
    <div className="min-h-screen bg-slate-50 pb-10 text-slate-900">
      <div className="mx-auto flex w-full max-w-sm flex-col px-3 pt-12 md:max-w-md md:px-6">

        {step === "checking" && (
          <>
            <Header title="Credit" />
            <div className="flex flex-col items-center justify-center py-20">
              <BouncyCoin />
              <div className="mt-2 flex items-center gap-2 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                <p className="text-sm font-medium">Loading your credit hub…</p>
              </div>
            </div>
          </>
        )}

        {/* ── Overview / resume checklist (always shown first) ── */}
        {step === "overview" && (
          <>
            <Header title="Unsecured credit" />
            <BouncyCoin />
            <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <h2 className="text-center text-base font-semibold text-slate-900">
                {resumeTarget === "consent" ? "Let's get you set up for credit" : "Welcome back — let's continue"}
              </h2>
              <p className="mt-1 text-center text-sm text-slate-500">
                {resumeTarget === "consent"
                  ? "A quick, one-time setup so we can show you offers from multiple lenders."
                  : "Here's where you are — pick up right where you left off."}
              </p>

              <ul className="mt-5 space-y-3">
                {[
                  { done: consentDone, label: "Consent", sub: "Permission to verify & check your credit" },
                  { done: kycVerified, label: "Identity verification", sub: "ID number, document & facial match" },
                  { done: creditDone, label: "Credit check", sub: "A single credit bureau enquiry" },
                  { done: monthlyIncome > 0, label: "Income", sub: INCOME_AI_ENABLED ? "Bank statement check" : "Your monthly income" },
                  { done: false, label: "Your offers", sub: "Compare lenders side by side" },
                ].map((s) => (
                  <li key={s.label} className="flex items-center gap-3">
                    {s.done ? (
                      <CheckCircle2 className="h-6 w-6 flex-shrink-0 text-emerald-500" />
                    ) : (
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-slate-200" />
                    )}
                    <div>
                      <p className={`text-sm font-semibold ${s.done ? "text-slate-400 line-through" : "text-slate-800"}`}>{s.label}</p>
                      <p className="text-xs text-slate-400">{s.sub}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <button type="button" onClick={() => setStep(resumeTarget)} className="mt-6 w-full rounded-2xl bg-violet-600 py-3.5 text-sm font-semibold text-white active:scale-[0.99]">
                {resumeTarget === "consent" ? "Get started" : "Continue"}
              </button>
            </section>
          </>
        )}

        {/* ── Consent (new/unverified users only) — credit-specific, NOT platform T&C ── */}
        {step === "consent" && (
          <>
            <Header title="Before we check your credit" />
            <BouncyCoin />
            <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-slate-900">We need your permission to continue</h2>
              <p className="mt-2 text-sm text-slate-500">To show you credit offers, MINT will:</p>

              <ul className="mt-4 space-y-3">
                {[
                  { icon: IdCard, t: "Verify your identity", d: "ID, proof of address, cellphone, and a facial match against Home Affairs records." },
                  { icon: Search, t: "Run ONE credit check", d: "A single credit bureau enquiry — done once." },
                  { icon: Store, t: "Show you multiple lenders", d: "That one check is shared with every lender — never repeated per lender, so your score is protected." },
                ].map(({ icon: Icon, t, d }) => (
                  <li key={t} className="flex gap-3">
                    <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{t}</p>
                      <p className="text-xs text-slate-500">{d}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="mt-5 rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
                If you decline, we can't show you credit offers — we can't make an offer without verifying who you are and checking your credit. You can come back any time.
              </p>

              <button type="button" onClick={() => { saveCreditFlag({ credit_consent_at: new Date().toISOString() }); setStep("kyc"); }} className="mt-5 w-full rounded-2xl bg-violet-600 py-3.5 text-sm font-semibold text-white active:scale-[0.99]">
                I agree — continue
              </button>
              <button type="button" onClick={onBack} className="mt-2 w-full rounded-2xl bg-white py-3 text-sm font-semibold text-slate-500">
                Not now
              </button>
            </section>
          </>
        )}

        {step === "kyc" && (
          <>
            <Header title="Verify your identity" />
            {!idConfirmed ? (
              <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                  <IdCard className="h-6 w-6" />
                </div>
                <h2 className="text-base font-semibold text-slate-900">Your ID number</h2>
                <p className="mt-2 text-sm text-slate-500">Enter your 13-digit South African ID number to begin verification.</p>
                <input
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, "").slice(0, 13))}
                  inputMode="numeric"
                  maxLength={13}
                  placeholder="0000000000000"
                  className="mt-4 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm tracking-widest text-slate-900 outline-none focus:border-violet-400"
                />
                {idError && <p className="mt-2 text-xs font-medium text-red-500">{idError}</p>}
                <button
                  type="button"
                  onClick={handleIdCheck}
                  disabled={idChecking}
                  className="mt-5 w-full rounded-2xl bg-violet-600 py-3.5 text-sm font-semibold text-white active:scale-[0.99] disabled:opacity-60"
                >
                  {idChecking ? "Checking…" : "Continue"}
                </button>
              </section>
            ) : (
              // Reuses the shared KYC infra (Experian IDMN — liveness + facial match
              // vs Home Affairs + ID-document OCR, which credit requires inline).
              <ExperianVerification
                requireOcr
                onVerified={() => { saveCreditFlag({ credit_kyc_verified_at: new Date().toISOString() }); setStep("bureau"); }}
              />
            )}
          </>
        )}

        {step === "bureau" && (
          <>
            <Header title="Credit check" />

            <section className="relative rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              {/* Download the official Experian report PDF — proof of the score,
                  straight from the bureau. Shown only once a run returns a PDF. */}
              {reportPdf?.base64 && (
                <button
                  type="button"
                  onClick={downloadReportPdf}
                  title="Download your Experian report (PDF)"
                  aria-label="Download your Experian report (PDF)"
                  className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-white shadow-md transition active:scale-95 hover:bg-violet-700"
                >
                  <Download className="h-4 w-4" />
                </button>
              )}
              <ScoreGauge value={score} />
              <p className="mt-1 text-center text-xs text-slate-400">
                {creditDone ? `${scoreBand} · one enquiry, reused across all lenders` : "We run a single credit bureau enquiry — reused across every lender, so your score is protected."}
              </p>
              {creditDone && scoreReasons.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">What's affecting your score</p>
                  <ul className="mt-1 space-y-1">
                    {scoreReasons.map((r, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-slate-400">
                        <span className="text-slate-300">•</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {scoreError && <p className="mt-3 text-center text-xs font-medium text-red-500">{scoreError}</p>}
              <button
                type="button"
                onClick={runBureau}
                disabled={bureauRunning || addrLookupLoading || !poaPath}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 py-3.5 text-sm font-semibold text-white active:scale-[0.99] disabled:opacity-60"
              >
                {(bureauRunning || addrLookupLoading) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {addrLookupLoading ? "Finding your address…" : bureauRunning ? "Checking your credit…" : creditDone ? "Run again" : "Run credit check"}
              </button>
              {!poaPath && <p className="mt-2 text-center text-[11px] text-slate-400">Upload your proof of address below to enable the check.</p>}
            </section>

            {/* Address prompt — appears when address is missing or Experian rejects it. */}
            {addrPrompt && (
              <section className="mt-4 rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-amber-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Confirm your address</h3>
                </div>
                <p className="mt-1 text-xs text-slate-500">The credit bureau needs your residential address to run the check.</p>
                <input value={addr1} onChange={(e) => setAddr1(e.target.value)} placeholder="Street address"
                  className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-violet-400" />
                <input value={addr2} onChange={(e) => setAddr2(e.target.value)} placeholder="Suburb / area"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-violet-400" />
                <input value={addrPostal} onChange={(e) => setAddrPostal(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="Postal code"
                  className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm tracking-widest text-slate-900 outline-none focus:border-violet-400" />
                <button
                  type="button"
                  onClick={() => {
                    if (!addr1.trim() || !addr2.trim() || !addrPostal.trim()) { setScoreError("Please fill in all address fields."); return; }
                    setScoreError(""); setAddrPrompt(false); runBureau();
                  }}
                  className="mt-4 w-full rounded-2xl bg-violet-600 py-3.5 text-sm font-semibold text-white active:scale-[0.99]"
                >
                  Save &amp; continue
                </button>
              </section>
            )}

            {/* Proof of address — required KYC artefact (bank statement / utility bill). */}
            <section className="mt-4 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><MapPin className="h-5 w-5" /></div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Proof of address</h3>
                  <p className="text-[11px] text-slate-400">Bank statement or utility bill — PDF, JPG or PNG</p>
                </div>
              </div>

              {poaPath ? (
                <div className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <span className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /><span className="truncate max-w-[180px]">{poaFileName || "Uploaded"}</span>
                  </span>
                  <label className="cursor-pointer text-[12px] font-semibold text-violet-600">
                    Replace
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" className="hidden" onChange={handlePoaUpload} />
                  </label>
                </div>
              ) : (
                <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 px-4 py-6 text-center transition hover:border-violet-300">
                  {poaUploading ? (
                    <span className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Uploading…</span>
                  ) : (
                    <>
                      <span className="text-sm font-semibold text-violet-600">Tap to upload</span>
                      <span className="mt-0.5 text-[11px] text-slate-400">Max 10MB</span>
                    </>
                  )}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" className="hidden" onChange={handlePoaUpload} disabled={poaUploading} />
                </label>
              )}
              {poaError && <p className="mt-2 text-xs font-medium text-red-500">{poaError}</p>}
            </section>

            {creditDone && (
              <button type="button" onClick={() => (monthlyIncome > 0 ? goMarketplace() : setStep("income"))} className="mt-4 w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-semibold text-white active:scale-[0.99]">
                {monthlyIncome > 0 ? "Continue to my applications" : "Continue"}
              </button>
            )}
          </>
        )}

        {/* ── Income — final onboarding step (bank statement → AI, or manual) ── */}
        {step === "income" && (() => {
          const CARD = "linear-gradient(135deg, #2a1a46 0%, #4c2e75 55%, #7a4aa7 100%)";
          return (
            <div className="-mx-3 -mt-12 md:-mx-6">
              <style>{`
                @keyframes cfFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
                .cf-fade { opacity: 0; animation: cfFadeUp .55s cubic-bezier(.22,1,.36,1) forwards; }
              `}</style>

              {/* HERO */}
              <div
                className="relative overflow-hidden rounded-b-[34px] px-5 pt-12 pb-24"
                style={{ background: "linear-gradient(170deg, #0d0d12 0%, #25173e 22%, #5b3486 55%, #9a64c4 80%, #e7d4f0 100%)" }}
              >
                <div className="pointer-events-none absolute -right-10 top-6 h-40 w-40 rounded-full bg-fuchsia-300/15 blur-3xl" />
                <div className="pointer-events-none absolute -left-12 top-24 h-36 w-36 rounded-full bg-violet-400/15 blur-3xl" />
                <div className="relative z-10 mb-7 flex items-center justify-between">
                  <button type="button" onClick={() => setStep("bureau")} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm active:scale-95">
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <p className="text-sm font-semibold text-white/90">Last step</p>
                  <div className="h-10 w-10" />
                </div>
                <p className="relative z-10 text-[22px] font-semibold leading-tight text-white">{INCOME_AI_ENABLED ? <>Verify your<br />income</> : <>What do you<br />earn each month?</>}</p>
                <p className="relative z-10 mt-1.5 text-xs text-white/55">{INCOME_AI_ENABLED ? "Upload your recent bank statement — we'll detect your salary automatically." : "This helps lenders show you offers you can afford."}</p>
              </div>

              {/* BODY */}
              <div className="-mt-14 px-5 pb-12">
                {INCOME_AI_ENABLED ? (
                  /* AI path — bank statement (3 or 6 months) for salary detection */
                  <>
                  <div className="cf-fade relative overflow-hidden rounded-[28px] border border-slate-100 bg-white p-6 shadow-xl">
                    <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-violet-100/60 blur-2xl" />
                    <div className="relative flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                        <Upload className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Upload bank statement</p>
                        <p className="mt-0.5 text-xs text-slate-400">PDF, last 3 or 6 months</p>
                      </div>
                    </div>
                    <div className="relative mt-4 flex gap-2">
                      {[3, 6].map((m) => (
                        <button key={m} type="button" onClick={() => setStatementMonths(m)}
                          className={`flex-1 rounded-2xl border py-3 text-sm font-semibold transition ${statementMonths === m ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
                          {m} months
                        </button>
                      ))}
                    </div>
                    {statementName ? (
                      <div className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                        <span className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" /><span className="max-w-[180px] truncate">{statementName}</span></span>
                        <label className="cursor-pointer text-[12px] font-semibold text-violet-600">Replace<input type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleStatementUpload} /></label>
                      </div>
                    ) : (
                      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 px-4 py-6 text-center hover:border-violet-300">
                        {statementUploading ? <span className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Uploading…</span> : <><span className="text-sm font-semibold text-violet-600">Tap to upload</span><span className="mt-0.5 text-[11px] text-slate-400">Last {statementMonths} months</span></>}
                        <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleStatementUpload} disabled={statementUploading} />
                      </label>
                    )}
                    {statementDetecting && (
                      <div className="mt-4 flex items-center gap-2 rounded-2xl bg-violet-50 px-4 py-3 text-sm font-medium text-violet-700">
                        <Loader2 className="h-4 w-4 animate-spin" />Analysing your statement…
                      </div>
                    )}
                    {statementError && !statementDetecting && (
                      <p className="mt-3 text-[11px] font-medium text-rose-500">{statementError}</p>
                    )}
                    {!statementName && (
                      <p className="mt-3 text-[11px] text-slate-400">We'll automatically detect your salary and pay date. You can confirm before continuing.</p>
                    )}
                  </div>

                  {statementName && !statementDetecting && (() => {
                    const det = incomeDetection;
                    const found = !!det?.is_salary_detected && Number(det?.estimated_monthly_income) > 0;
                    const score = Number(det?.confidence_score) || 0;
                    const confLabel = score >= 0.85 ? "High confidence" : score >= 0.5 ? "Medium confidence" : "Low confidence";
                    const confColor = score >= 0.85 ? "text-emerald-600" : score >= 0.5 ? "text-amber-600" : "text-slate-500";
                    const lastTxn = det?.salary_transactions?.[det.salary_transactions.length - 1];
                    return (
                      <div className="cf-fade mt-4 rounded-[28px] border border-slate-100 bg-white p-6 shadow-xl">
                        <p className="text-sm font-semibold text-slate-900">{found ? "Detected salary" : "Couldn't confidently detect a salary"}</p>
                        {det && (
                          <p className={`mt-0.5 text-xs font-medium ${confColor}`}>{confLabel} — {det.confidence_reason}</p>
                        )}
                        <div className="relative mt-3 flex items-end gap-1">
                          <span className="mb-1.5 text-xl font-light text-slate-400">R</span>
                          {found ? (
                            // AI-detected salary is authoritative — read-only, not user-editable.
                            <div className="w-full text-[36px] font-light leading-none text-slate-900">
                              {monthlyIncome.toLocaleString("en-ZA")}
                            </div>
                          ) : (
                            // Only when detection fails do we let the user type a figure in.
                            <input
                              type="text" inputMode="numeric"
                              value={monthlyIncome ? monthlyIncome.toLocaleString("en-ZA") : ""}
                              onChange={(e) => setMonthlyIncome(Number(e.target.value.replace(/\D/g, "")) || 0)}
                              placeholder="0"
                              className="w-full bg-transparent text-[36px] font-light leading-none text-slate-900 placeholder-slate-300 outline-none"
                            />
                          )}
                        </div>
                        {found && lastTxn?.salary_date && (
                          <p className="mt-1 text-[11px] text-slate-400">Last deposit detected on {lastTxn.salary_date}{lastTxn.employer_name ? ` from ${lastTxn.employer_name}` : ""}.</p>
                        )}
                        <p className="mt-2 text-[11px] text-slate-400">
                          {found
                            ? "This figure is taken from your bank statement and can't be edited. Upload a different statement if it's not right."
                            : "We couldn't detect a salary automatically — enter your monthly income to continue."}
                        </p>
                      </div>
                    );
                  })()}
                  </>
                ) : (
                  /* Manual fallback — income AI not wired yet */
                  <div className="cf-fade relative overflow-hidden rounded-[28px] px-5 pt-5 pb-6 shadow-xl" style={{ background: CARD }}>
                    <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
                    <p className="relative text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Monthly income</p>
                    <div className="relative mt-2 flex items-end gap-1">
                      <span className="mb-2 text-2xl font-light text-white/70">R</span>
                      <input
                        autoFocus type="text" inputMode="numeric"
                        value={monthlyIncome ? monthlyIncome.toLocaleString("en-ZA") : ""}
                        onChange={(e) => setMonthlyIncome(Number(e.target.value.replace(/\D/g, "")) || 0)}
                        placeholder="0"
                        className="w-full bg-transparent text-[44px] font-light leading-none text-white placeholder-white/30 outline-none"
                      />
                    </div>
                    <p className="relative mt-3 text-[11px] text-white/45">Your average take-home pay per month, after deductions.</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={saveIncome}
                  disabled={incomeSaving || !(monthlyIncome > 0)}
                  className="cf-fade mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
                  style={{ background: CARD, animationDelay: ".1s" }}
                >
                  {incomeSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {incomeSaving ? "Saving…" : "Continue"}
                </button>
                {INCOME_AI_ENABLED && !(monthlyIncome > 0) && (
                  <p className="mt-2 text-center text-[11px] text-slate-400">Upload a statement, then confirm the detected amount.</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── My applications — immersive hero (flip score card), metrics, list, CTA ── */}
        {step === "marketplace" && (() => {
          const tone = bandTone(scoreBand || bandFor(score));
          const pct = Number.isFinite(score) ? Math.min(100, Math.max(0, ((score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 100)) : 0;
          const lastChecked = creditAt ? new Date(creditAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "—";
          const CARD = "linear-gradient(135deg, #2a1a46 0%, #4c2e75 55%, #7a4aa7 100%)";
          return (
            <div className="-mx-3 -mt-12 md:-mx-6">
              <style>{`
                @keyframes cfFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes cfSheen { 0% { transform: translateX(-120%); } 60%,100% { transform: translateX(220%); } }
                @keyframes cfFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
                @keyframes cfPulse { 0%,100% { box-shadow: 0 10px 30px -8px rgba(108,63,224,.55); } 50% { box-shadow: 0 14px 42px -6px rgba(108,63,224,.85); } }
                .cf-fade { opacity: 0; animation: cfFadeUp .6s cubic-bezier(.22,1,.36,1) forwards; }
              `}</style>

              {/* HERO */}
              <div
                className="relative overflow-hidden rounded-b-[34px] px-5 pt-12 pb-9"
                style={{ background: "linear-gradient(170deg, #0d0d12 0%, #25173e 22%, #5b3486 55%, #9a64c4 80%, #e7d4f0 100%)" }}
              >
                <div className="pointer-events-none absolute -right-10 top-6 h-40 w-40 rounded-full bg-fuchsia-300/15 blur-3xl" />
                <div className="pointer-events-none absolute -left-12 top-24 h-36 w-36 rounded-full bg-violet-400/15 blur-3xl" />

                {/* Header */}
                <div className="relative z-10 mb-6 flex items-center justify-between">
                  <button type="button" onClick={onBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm active:scale-95">
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <p className="text-sm font-semibold text-white/90">My credit</p>
                  <div className="h-10 w-10" />
                </div>

                {/* Flip score card */}
                <div className="relative" style={{ perspective: "1400px" }}>
                  <div
                    className="relative w-full"
                    style={{
                      transformStyle: "preserve-3d",
                      transition: "transform .65s cubic-bezier(.4,.2,.2,1), min-height .4s ease",
                      transform: showScoreBack ? "rotateY(180deg)" : "rotateY(0deg)",
                      minHeight: showScoreBack ? "230px" : "210px",
                    }}
                  >
                    {/* FRONT */}
                    <div className="w-full" style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
                      <button
                        type="button"
                        onClick={() => Number.isFinite(score) && setShowScoreBack(true)}
                        className="relative w-full overflow-hidden rounded-[28px] px-5 pt-5 pb-6 text-left shadow-xl"
                        style={{ background: CARD }}
                      >
                        <div className="pointer-events-none absolute inset-0 overflow-hidden">
                          <div className="absolute top-0 h-full w-1/3 -skew-x-12 bg-white/10" style={{ animation: "cfSheen 4.5s ease-in-out infinite" }} />
                        </div>
                        <div className="relative flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">Your credit score</span>
                          {Number.isFinite(score) && (
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${tone.chip}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />{scoreBand || bandFor(score)}
                            </span>
                          )}
                        </div>
                        <div className="relative mt-3 flex items-end gap-2">
                          <CountUp value={score} className="text-[60px] font-light leading-none text-white" />
                          <span className="mb-2 text-[12px] text-white/40">/ {SCORE_MAX}</span>
                        </div>
                        <div className="relative mt-4 h-[6px] w-full overflow-hidden rounded-full bg-white/15">
                          <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-300 to-white/85 transition-all duration-1000" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="relative mt-1.5 flex items-center justify-between text-[9px] text-white/35">
                          <span>{SCORE_MIN}</span>
                          <span className="text-white/40">Tap for details ↻</span>
                          <span>{SCORE_MAX}</span>
                        </div>
                      </button>
                    </div>

                    {/* BACK — score reasons + NCA */}
                    <div className="absolute inset-0 w-full" style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                      <button
                        type="button"
                        onClick={() => setShowScoreBack(false)}
                        className="h-full w-full overflow-hidden rounded-[28px] px-5 pt-5 pb-6 text-left shadow-xl"
                        style={{ background: CARD }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">What's affecting your score</span>
                          <span className="text-[10px] text-white/40">↻ Flip back</span>
                        </div>
                        {scoreReasons.length > 0 ? (
                          <ul className="mt-3 space-y-1.5">
                            {scoreReasons.slice(0, 4).map((r, i) => (
                              <li key={i} className="flex gap-2 text-[11px] leading-snug text-white/75"><span className="text-fuchsia-300">•</span>{r}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-3 text-[11px] text-white/55">No detailed reasons returned for this enquiry.</p>
                        )}
                        <div className="mt-3 border-t border-white/10 pt-2.5">
                          <p className="text-[10px] leading-relaxed text-white/45">One bureau enquiry, reused across every lender — your score is protected. Credit provided under the National Credit Act 34 of 2005 by NCR-registered lenders.</p>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Metrics 2×2 */}
                <div className="relative z-10 mt-4 grid grid-cols-2 gap-2.5">
                  {[
                    { k: "Applications", v: String(applications.length), s: applications.length === 1 ? "active request" : "active requests" },
                    { k: "Score band", v: Number.isFinite(score) ? (scoreBand || bandFor(score)) : "—", s: "bureau rating", small: true },
                    { k: "Last checked", v: lastChecked, s: "single enquiry" },
                    { k: "Available up to", v: "R 50k", s: "unsecured" },
                  ].map((m, i) => (
                    <div key={m.k} className="cf-fade rounded-[20px] border border-white/10 bg-white/10 p-3.5 backdrop-blur-md" style={{ animationDelay: `${0.15 + i * 0.07}s` }}>
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-white/45">{m.k}</p>
                      <p className={`mt-1 font-semibold text-white ${m.small ? "text-[13px]" : "text-[18px]"}`}>{m.v}</p>
                      <p className="text-[10px] text-white/40">{m.s}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* BODY */}
              <div className="px-5 pb-12 pt-6">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[15px] font-semibold text-slate-900">Your applications</p>
                  {applications.length > 0 && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-600">{applications.length}</span>}
                </div>

                {applicationsLoading ? (
                  <div className="flex justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : applications.length === 0 ? (
                  <div className="cf-fade rounded-3xl border border-dashed border-violet-200 bg-violet-50/40 p-8 text-center" style={{ animationDelay: ".2s" }}>
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-600" style={{ animation: "cfFloat 3s ease-in-out infinite" }}><Store className="h-7 w-7" /></div>
                    <p className="text-sm font-semibold text-slate-800">No applications yet</p>
                    <p className="mt-1 text-xs text-slate-500">Your score's ready — start your first application below and compare lenders side by side.</p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {applications.map((app, idx) => {
                      const st = APP_STATUS[app.status] || APP_STATUS.in_review;
                      const sel = Array.isArray(app.selected_providers) ? app.selected_providers : [];
                      const isComplete = app.status === "complete";
                      return (
                        <li key={app.id} className="cf-fade" style={{ animationDelay: `${0.1 + idx * 0.08}s` }}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => openApplication(app)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openApplication(app); } }}
                            className="block w-full cursor-pointer rounded-3xl border border-slate-100 bg-white p-5 text-left shadow-sm transition hover:border-violet-200 hover:shadow-md active:scale-[0.99]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[20px] font-semibold leading-none text-slate-900">R {Number(app.requested_amount || 0).toLocaleString("en-ZA")}</p>
                                <p className="mt-1.5 text-xs text-slate-400">{app.requested_term_months} month{app.requested_term_months > 1 ? "s" : ""} · {new Date(app.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}</p>
                              </div>
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${st.cls}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}
                              </span>
                            </div>

                            {sel.length > 0 && (
                              <div className="mt-4 border-t border-slate-100 pt-3">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{isComplete ? "Accepted by" : "Submitted to"}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  {sel.map((s) => {
                                    const name = s.provider_name || s.provider_id;
                                    return (
                                      <span key={s.provider_id} className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[11px] font-medium ${isComplete ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600"}`}>
                                        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold uppercase text-white" style={{ background: lenderColor(s.provider_id) }}>{String(name).slice(0, 2)}</span>
                                        {name}
                                        {isComplete && <Check className="h-3 w-3" />}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <div className="mt-3 flex items-center justify-between">
                              <span className="text-[12px] font-semibold text-violet-600">{sel.length > 0 ? (isComplete ? "View offers" : "Edit lenders") : "Choose lenders"}</span>
                              <ChevronRight className="h-4 w-4 text-slate-300" />
                            </div>

                            {/* Delete — only while the application hasn't been sent to any
                                provider (no selected_providers). Disappears once submitted. */}
                            {sel.length === 0 && (
                              <div className="mt-3 border-t border-slate-100 pt-3">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); deleteApplication(app.id); }}
                                  disabled={deletingAppId === app.id}
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-slate-700 active:scale-95 disabled:opacity-50"
                                >
                                  {deletingAppId === app.id
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <Trash2 className="h-3.5 w-3.5" />}
                                  {deletingAppId === app.id ? "Deleting…" : "Delete"}
                                </button>
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Create a new application — purple CTA card */}
                <button
                  type="button"
                  onClick={() => { setLoanAmount(50000); setLoanTermMonths(3); setCustomAmount(false); setStep("newApplication"); }}
                  className="cf-fade mt-4 flex w-full items-center gap-4 overflow-hidden rounded-3xl px-5 py-5 text-left active:scale-[0.99]"
                  style={{ background: CARD, animationDelay: ".35s", animation: "cfFadeUp .6s cubic-bezier(.22,1,.36,1) forwards, cfPulse 3.2s ease-in-out 1s infinite" }}
                >
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white"><Plus className="h-6 w-6" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white">Create a new application</p>
                    <p className="mt-0.5 text-xs text-white/60">Set your amount and term, then compare lenders</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-white/60" />
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── New application — beautiful amount + term picker ── */}
        {step === "newApplication" && (() => {
          const CARD = "linear-gradient(135deg, #2a1a46 0%, #4c2e75 55%, #7a4aa7 100%)";
          const quickAmounts = [5000, 10000, 25000, 50000];
          const terms = Array.from({ length: 24 }, (_, i) => i + 1);
          return (
            <div className="-mx-3 -mt-12 md:-mx-6">
              <style>{`
                @keyframes cfFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes cfPulse { 0%,100% { box-shadow: 0 10px 30px -8px rgba(108,63,224,.55); } 50% { box-shadow: 0 14px 42px -6px rgba(108,63,224,.85); } }
                @keyframes cfSwap { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }
                .cf-fade { opacity: 0; animation: cfFadeUp .55s cubic-bezier(.22,1,.36,1) forwards; }
                .cf-swap { animation: cfSwap .3s cubic-bezier(.22,1,.36,1); }
                .cf-noscroll::-webkit-scrollbar { display: none; }
              `}</style>

              {/* HERO */}
              <div
                className="relative overflow-hidden rounded-b-[34px] px-5 pt-12 pb-24"
                style={{ background: "linear-gradient(170deg, #0d0d12 0%, #25173e 22%, #5b3486 55%, #9a64c4 80%, #e7d4f0 100%)" }}
              >
                <div className="pointer-events-none absolute -right-10 top-6 h-40 w-40 rounded-full bg-fuchsia-300/15 blur-3xl" />
                <div className="pointer-events-none absolute -left-12 top-24 h-36 w-36 rounded-full bg-violet-400/15 blur-3xl" />
                <div className="relative z-10 mb-7 flex items-center justify-between">
                  <button type="button" onClick={() => setStep("marketplace")} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm active:scale-95">
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <p className="text-sm font-semibold text-white/90">New application</p>
                  <div className="h-10 w-10" />
                </div>
                <p className="relative z-10 text-[22px] font-semibold leading-tight text-white">How much do<br />you need?</p>
                <p className="relative z-10 mt-1.5 text-xs text-white/55">Your credit score is reused — no new check.</p>
              </div>

              {/* BODY — cards overlap the hero */}
              <div className="-mt-14 px-5 pb-12">
                {/* Amount card */}
                <div className="cf-fade relative overflow-hidden rounded-[28px] px-5 pt-5 pb-6 shadow-xl" style={{ background: CARD }}>
                  <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
                  <p className="relative text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">Loan amount</p>
                  <div className="relative mt-2 flex items-end gap-1">
                    <span className="mb-2 text-2xl font-light text-white/70">R</span>
                    <span className="text-[44px] font-light leading-none text-white">{loanAmount ? loanAmount.toLocaleString("en-ZA") : "0"}</span>
                  </div>
                  <div className="relative mt-3 h-[5px] w-full overflow-hidden rounded-full bg-white/15">
                    <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-300 to-white/85 transition-all duration-300" style={{ width: `${Math.min(100, (loanAmount / 50000) * 100)}%` }} />
                  </div>

                  {/* Preset chips ↔ manual input (animated switch) */}
                  <div className="relative mt-4">
                    {!customAmount ? (
                      <div key="chips" className="cf-swap flex flex-wrap items-center gap-2">
                        {quickAmounts.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => setLoanAmount(a)}
                            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${loanAmount === a ? "bg-white text-violet-700" : "bg-white/10 text-white/70"}`}
                          >
                            R {a.toLocaleString("en-ZA")}
                          </button>
                        ))}
                        <button type="button" onClick={() => setCustomAmount(true)} className="ml-0.5 text-[11px] font-semibold text-white/75 underline decoration-white/40 underline-offset-2">
                          I'll add my own
                        </button>
                      </div>
                    ) : (
                      <div key="input" className="cf-swap">
                        <div className="flex items-center rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15 transition focus-within:ring-2 focus-within:ring-white/40">
                          <span className="mr-1.5 text-base font-semibold text-white/60">R</span>
                          <input
                            autoFocus
                            type="text" inputMode="numeric"
                            value={loanAmount ? loanAmount.toLocaleString("en-ZA") : ""}
                            onChange={(e) => { const n = Math.min(50000, Number(e.target.value.replace(/\D/g, "")) || 0); setLoanAmount(n); }}
                            placeholder="Enter amount"
                            className="w-full bg-transparent text-lg font-semibold text-white placeholder-white/30 outline-none"
                          />
                          <button type="button" onClick={() => setCustomAmount(false)} className="ml-2 flex-shrink-0 text-[11px] font-semibold text-white/55">Presets</button>
                        </div>
                        <p className={`mt-1.5 text-[10px] ${loanAmount > 0 && loanAmount < 100 ? "text-rose-200" : "text-white/45"}`}>
                          {loanAmount > 0 && loanAmount < 100 ? "Minimum is R100" : "Enter between R100 and R50,000"}
                        </p>
                      </div>
                    )}
                  </div>

                  {!customAmount && <p className="relative mt-2.5 text-[10px] text-white/40">Up to R 50,000 unsecured</p>}
                </div>

                {/* Term card */}
                <div className="cf-fade mt-4 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm" style={{ animationDelay: ".08s" }}>
                  <p className="text-sm font-semibold text-slate-900">Repayment term</p>
                  <p className="mt-0.5 text-xs text-slate-400">How long to pay it back</p>
                  <div className="cf-noscroll mt-4 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                    {terms.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setLoanTermMonths(m)}
                        className={`flex h-16 w-14 flex-shrink-0 flex-col items-center justify-center rounded-2xl border text-center transition ${loanTermMonths === m ? "border-violet-600 bg-violet-600 text-white shadow-md" : "border-slate-200 bg-white text-slate-600"}`}
                      >
                        <span className="text-lg font-bold leading-none">{m}</span>
                        <span className={`mt-1 text-[9px] uppercase tracking-wide ${loanTermMonths === m ? "text-white/70" : "text-slate-400"}`}>{m === 1 ? "month" : "months"}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Summary + create */}
                <div className="cf-fade mt-4 flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm" style={{ animationDelay: ".16s" }}>
                  <span className="text-xs text-slate-400">You're requesting</span>
                  <span className="text-sm font-semibold text-slate-900">R {Number(loanAmount || 0).toLocaleString("en-ZA")} · {loanTermMonths} mo</span>
                </div>

                <button
                  type="button"
                  onClick={createApplication}
                  disabled={creatingApplication || loanAmount < 100}
                  className="cf-fade mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
                  style={{ background: CARD, animationDelay: ".22s" }}
                >
                  {creatingApplication ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
                  {creatingApplication ? "Creating…" : "Find my lenders"}
                </button>
              </div>
            </div>
          );
        })()}

        {/* ── Provider comparison for one application — immersive marketplace ── */}
        {step === "marketplaceOffers" && activeApplication && (() => {
          const tone = bandTone(scoreBand || bandFor(score));
          const count = (algolendOffers || []).length;
          return (
          <div className="-mx-3 -mt-12 md:-mx-6">
            <style>{`
              @keyframes cfFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
              .cf-fade { opacity: 0; animation: cfFadeUp .5s cubic-bezier(.22,1,.36,1) forwards; }
            `}</style>

            {/* HERO */}
            <div
              className="relative overflow-hidden rounded-b-[34px] px-5 pt-12 pb-16"
              style={{ background: "linear-gradient(170deg, #0d0d12 0%, #25173e 22%, #5b3486 55%, #9a64c4 80%, #e7d4f0 100%)" }}
            >
              <div className="pointer-events-none absolute -right-10 top-6 h-40 w-40 rounded-full bg-fuchsia-300/15 blur-3xl" />
              <div className="pointer-events-none absolute -left-12 top-24 h-36 w-36 rounded-full bg-violet-400/15 blur-3xl" />
              <div className="relative z-10 mb-6 flex items-center justify-between">
                <button type="button" onClick={() => setStep("marketplace")} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm active:scale-95">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <p className="text-sm font-semibold text-white/90">Credit marketplace</p>
                <div className="h-10 w-10" />
              </div>
              <p className="relative z-10 text-[22px] font-semibold leading-tight text-white">Compare lenders</p>
              <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">R {Number(activeApplication.requested_amount || 0).toLocaleString("en-ZA")} · {activeApplication.requested_term_months} mo</span>
                {Number.isFinite(score) && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${tone.chip}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />Score {score}
                  </span>
                )}
              </div>
            </div>

            {/* BODY */}
            <div className="px-5 pt-5 pb-12">
              {!algolendLoading && count > 0 && (
                <p className="mb-3 text-xs text-slate-400">Showing <b className="font-semibold text-slate-600">{count} offer{count !== 1 ? "s" : ""}</b> · ranked best first · tap to select</p>
              )}

              {algolendLoading && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                  <p className="mt-3 text-xs">Finding lenders for you…</p>
                </div>
              )}
              {algolendError && (
                <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-center">
                  <p className="text-sm font-medium text-red-600">{algolendError}</p>
                  <button type="button" onClick={() => evaluateWithAlgoLend(activeApplication)} className="mt-2 text-xs font-semibold text-violet-600">Try again</button>
                </div>
              )}
              {/* Empty: distinguish "no lenders on AlgoLend yet" from "none matched". */}
              {!algolendLoading && !algolendError && count === 0 && algolendDeclines.length === 0 && (
                <div className="rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-sm">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-500"><Store className="h-6 w-6" /></div>
                  <p className="text-sm font-semibold text-slate-700">
                    {algolendInfo?.totalLenders === 0 ? "No active lenders yet" : "No offers for this amount"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {algolendInfo?.message || "No lenders matched your profile for this amount."}
                  </p>
                  {algolendInfo?.evaluatedAt && (
                    <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" />Live from AlgoLend · {algolendInfo.totalLenders} lender{algolendInfo.totalLenders !== 1 ? "s" : ""} · checked {new Date(algolendInfo.evaluatedAt).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                  <button type="button" onClick={() => evaluateWithAlgoLend(activeApplication)} className="mt-4 block w-full rounded-2xl border border-slate-200 py-2.5 text-xs font-semibold text-violet-600">Refresh</button>
                </div>
              )}
              {!algolendLoading && !algolendError && count === 0 && algolendDeclines.length > 0 && (
                <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-center text-xs font-medium text-amber-700">No lender made an offer for R {Number(activeApplication.requested_amount || 0).toLocaleString("en-ZA")} yet — here's where each one stands.</p>
              )}

              {/* No offers → let the client LOWER their requested amount. The new,
                  lower figure becomes the official requested_amount, then we
                  re-evaluate against it. */}
              {!algolendLoading && !algolendError && count === 0 && Number(activeApplication.requested_amount) > 100 && (
                <div className="mb-3 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
                  <p className="text-sm font-semibold text-slate-800">Try a lower amount</p>
                  <p className="mt-1 text-xs text-slate-500">Lowering your request can unlock offers. This becomes your official requested amount.</p>
                  <div className="mt-4 flex items-end gap-1">
                    <span className="mb-1 text-lg font-light text-slate-400">R</span>
                    <input
                      type="text" inputMode="numeric"
                      value={adjustAmount ? adjustAmount.toLocaleString("en-ZA") : ""}
                      onChange={(e) => setAdjustAmount(Math.min(Number(activeApplication.requested_amount) || 0, Number(e.target.value.replace(/\D/g, "")) || 0))}
                      className="w-full bg-transparent text-3xl font-light leading-none text-slate-900 outline-none"
                    />
                  </div>
                  <input
                    type="range" min={100} max={Number(activeApplication.requested_amount)} step={100}
                    value={Math.max(100, Math.min(adjustAmount || 100, Number(activeApplication.requested_amount)))}
                    onChange={(e) => setAdjustAmount(Number(e.target.value))}
                    className="mt-3 w-full accent-violet-600"
                  />
                  <button
                    type="button"
                    onClick={applyAdjustedAmount}
                    disabled={adjustSaving || !(adjustAmount >= 100 && adjustAmount < Number(activeApplication.requested_amount))}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 py-3 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50"
                  >
                    {adjustSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {adjustSaving ? "Updating…" : "Update amount & recheck"}
                  </button>
                  <p className="mt-2 text-center text-[10px] text-slate-400">Current request: R {Number(activeApplication.requested_amount || 0).toLocaleString("en-ZA")} · minimum R100</p>
                </div>
              )}

              <div className="space-y-3">
                {(algolendOffers || []).map((o, idx) => {
                  const sel = providerSel.has(o.lenderId);
                  return (
                    <button
                      key={o.lenderId}
                      type="button"
                      onClick={() => toggleProviderSel(o.lenderId)}
                      className={`cf-fade block w-full rounded-2xl border bg-white text-left shadow-sm transition hover:shadow-md ${sel ? "border-violet-500 ring-1 ring-violet-500" : "border-slate-100"}`}
                      style={{ animationDelay: `${idx * 0.07}s` }}
                    >
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-[11px] font-bold uppercase text-white" style={{ background: lenderColor(o.lenderId) }}>{String(o.lenderName || "?").slice(0, 2)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-900">{o.lenderName}</p>
                            {o.tagline && <p className="text-xs text-slate-400">{o.tagline}</p>}
                          </div>
                          <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                            <div className="text-right">
                              <p className="text-lg font-bold leading-none text-slate-900">{o.offeredRatePct}%</p>
                              <p className="text-[10px] text-slate-400">p.a.</p>
                            </div>
                            <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${sel ? "border-violet-600 bg-violet-600" : "border-slate-200"}`}>
                              {sel && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 pt-3">
                          <div>
                            <p className="truncate text-xs font-semibold text-slate-900">R {Number(o.offeredAmount || 0).toLocaleString("en-ZA")}</p>
                            <p className="text-[10px] text-slate-400">Approved</p>
                          </div>
                          <div className="pl-3">
                            <p className="truncate text-xs font-semibold text-slate-900">R {Number(o.monthlyInstallment || 0).toLocaleString("en-ZA")}</p>
                            <p className="text-[10px] text-slate-400">Per month</p>
                          </div>
                          <div className="pl-3">
                            <p className="truncate text-xs font-semibold text-slate-900">{o.avgTurnaroundDays} day{o.avgTurnaroundDays !== 1 ? "s" : ""}</p>
                            <p className="text-[10px] text-slate-400">Turnaround</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between rounded-b-2xl border-t border-slate-100 bg-slate-50 px-4 py-2.5">
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Eligible</span>
                        <span className="text-[10px] text-slate-400">Total: R {Number(o.totalRepayment || 0).toLocaleString("en-ZA")}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Lenders that didn't make an offer for this amount (still listed). */}
              {algolendDeclines.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Not available for this amount</p>
                  <div className="space-y-2">
                    {algolendDeclines.map((d, i) => {
                      const name = d.lender || d.lenderName || "Lender";
                      return (
                        <div key={`${name}-${i}`} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3">
                          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-[10px] font-bold uppercase text-white opacity-60" style={{ background: lenderColor(name) }}>{String(name).slice(0, 2)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-600">{name}</p>
                            {d.reason && <p className="text-[11px] text-slate-400">{d.reason}</p>}
                          </div>
                          <span className="flex-shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-400">No offer</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {providerSubmitted && (
                <p className="mt-4 flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-50 py-3 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />Submitted to {providerSel.size} lender{providerSel.size !== 1 ? "s" : ""}
                </p>
              )}

              {/* Spacer so the floating tray + bottom nav never cover the last card. */}
              {providerSel.size > 0 && !providerSubmitted && <div className="h-44" />}
            </div>

            {/* Selection tray — portaled to <body> (escapes transformed ancestors)
                and floated ABOVE the app's bottom nav (z-[1000]) as an action bar. */}
            {providerSel.size > 0 && !providerSubmitted && portalTarget && createPortal(
              <div
                className="fixed inset-x-0 z-[1100] mx-auto w-full max-w-sm px-4 md:max-w-md"
                style={{ bottom: "calc(5.25rem + env(safe-area-inset-bottom, 0px))", animation: "cfTrayUp .28s cubic-bezier(.22,1,.36,1)" }}
              >
                <style>{`@keyframes cfTrayUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-900 px-5 py-3.5 shadow-2xl ring-1 ring-black/5">
                  <p className="text-xs text-white/50"><b className="font-semibold text-white">{providerSel.size}</b> lender{providerSel.size !== 1 ? "s" : ""} selected</p>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button type="button" onClick={() => setProviderSel(new Set())} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60">Clear</button>
                    <button
                      type="button"
                      onClick={submitProviderSelections}
                      disabled={providerSubmitting}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {providerSubmitting ? "Submitting…" : `Submit to ${providerSel.size} →`}
                    </button>
                  </div>
                </div>
              </div>,
              portalTarget
            )}
          </div>
          );
        })()}

      </div>
    </div>
  );
};

export default CreditFlow;
