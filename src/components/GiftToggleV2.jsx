import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Gift, Copy, Check, AlertCircle, X, Search, Hash, User, ChevronLeft, ChevronRight, Plus, Trash2, CreditCard } from "lucide-react";
import { motion, AnimatePresence, useMotionValue, animate } from "framer-motion";
import { supabase } from "../lib/supabase";
import { isAdminPreview } from "../lib/adminPreview";

const CONFETTI_COLORS = ["#7c3aed","#a78bfa","#f59e0b","#10b981","#ef4444","#3b82f6","#ec4899","#f97316"];
async function fetchBeneficiaries() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return [];
    const { data, error } = await supabase
      .from("Beneficiary")
      .select("id, first_name, last_name, email, mint_number, used_at")
      .eq("user_id", session.user.id)
      .order("used_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return (data || []).map(r => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      mintNumber: r.mint_number,
      usedAt: r.used_at,
    }));
  } catch { return []; }
}

async function saveBeneficiary({ firstName, lastName, email, mintNumber }) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    await supabase.from("Beneficiary").upsert({
      user_id: session.user.id,
      first_name: firstName,
      last_name: lastName,
      email: email.toLowerCase(),
      mint_number: mintNumber || null,
      used_at: new Date().toISOString(),
    }, { onConflict: "user_id,email" });
  } catch {}
}

async function removeBeneficiary(email) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    await supabase.from("Beneficiary")
      .delete()
      .eq("user_id", session.user.id)
      .eq("email", email.toLowerCase());
  } catch {}
}

function maskEmail(email) {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local[0]}***@${domain}`;
}

const AVATAR_GRADIENTS = [
  "from-violet-500 to-purple-600",
  "from-emerald-400 to-teal-600",
  "from-sky-400 to-blue-600",
  "from-amber-400 to-orange-500",
  "from-rose-400 to-pink-600",
  "from-fuchsia-500 to-violet-600",
  "from-indigo-400 to-blue-600",
  "from-cyan-400 to-sky-600",
];
const AVATAR_ACCENTS = [
  "#7c3aed",
  "#10b981",
  "#38bdf8",
  "#f59e0b",
  "#fb7185",
  "#d946ef",
  "#818cf8",
  "#22d3ee",
];

function avatarGradient(name) {
  return AVATAR_GRADIENTS[(name?.charCodeAt(0) || 0) % AVATAR_GRADIENTS.length];
}
function avatarAccent(name) {
  return AVATAR_ACCENTS[(name?.charCodeAt(0) || 0) % AVATAR_ACCENTS.length];
}

function ConfettiBurst({ active }) {
  const particles = useRef(
    Array.from({ length: 48 }, (_, i) => ({
      id: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      x: (Math.random() - 0.5) * 320,
      y: -(80 + Math.random() * 220),
      rotate: Math.random() * 720,
      scale: 0.6 + Math.random() * 0.8,
      delay: Math.random() * 0.3,
      shape: Math.random() > 0.5 ? "rect" : "circle",
    }))
  ).current;
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" style={{ zIndex: 50 }}>
      {particles.map(p => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            width: p.shape === "circle" ? 10 : 8,
            height: p.shape === "circle" ? 10 : 14,
            borderRadius: p.shape === "circle" ? "50%" : 2,
            background: p.color,
            animation: `confetti-fly 1.1s ease-out ${p.delay}s forwards`,
            "--tx": `${p.x}px`,
            "--ty": `${p.y}px`,
            "--rot": `${p.rotate}deg`,
            transform: "scale(0)",
            opacity: 1,
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-fly {
          0%   { transform: scale(0) translate(0,0) rotate(0deg); opacity:1; }
          60%  { opacity:1; }
          100% { transform: scale(var(--s,1)) translate(var(--tx),var(--ty)) rotate(var(--rot)); opacity:0; }
        }
      `}</style>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] text-slate-400 shrink-0">{label}</span>
      <span className={`text-[11px] text-right ${bold ? "font-bold text-slate-800" : "text-slate-700"}`}>{value}</span>
    </div>
  );
}

function SwipeableRow({ b, onSelect, onDeleteRequest, index, isLast }) {
  const x = useMotionValue(0);
  const [revealed, setRevealed] = useState(false);
  const isEven = index % 2 === 0;
  const accent = avatarAccent(b.firstName);
  const rowBg = isEven ? "#ffffff" : "#faf8ff";

  const usedLabel = b.used_at
    ? new Date(b.used_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
    : null;

  function snapOpen() {
    setRevealed(true);
    animate(x, -76, { type: "spring", stiffness: 500, damping: 40 });
  }
  function snapClose() {
    setRevealed(false);
    animate(x, 0, { type: "spring", stiffness: 500, damping: 40 });
  }

  return (
    <div className="relative overflow-hidden" style={{ borderBottom: isLast ? "none" : "1px solid #ede9fe" }}>
      {/* Delete zone */}
      <div className="absolute right-0 top-0 bottom-0 w-[76px] flex items-center justify-center"
           style={{ background: "linear-gradient(135deg,#ff3b3b,#e00)" }}>
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); snapClose(); onDeleteRequest(b); }}
          className="flex flex-col items-center gap-0.5 w-full h-full justify-center"
        >
          <Trash2 size={15} className="text-white" />
          <span className="text-[9px] text-white font-bold tracking-wide uppercase">Remove</span>
        </button>
      </div>

      {/* Foreground row */}
      <motion.div
        style={{ x, backgroundColor: rowBg }}
        drag="x"
        dragConstraints={{ right: 0, left: -76 }}
        dragElastic={0.04}
        onDragEnd={(_, info) => {
          if (info.offset.x < -38) snapOpen();
          else snapClose();
        }}
        onClick={() => {
          if (revealed) { snapClose(); return; }
          onSelect(b);
        }}
        className="flex items-center gap-3 px-4 py-3.5 relative z-10 cursor-pointer select-none"
      >
        {/* Left accent bar */}
        <div style={{
          position: "absolute", left: 0, top: "18%", bottom: "18%",
          width: 3, borderRadius: 2, background: accent,
        }} />

        {/* Avatar */}
        <div className={`w-11 h-11 rounded-full bg-gradient-to-br ${avatarGradient(b.firstName)} flex items-center justify-center shrink-0`}
             style={{ boxShadow: `0 0 0 2px ${accent}28, 0 2px 8px rgba(0,0,0,0.13)` }}>
          <span className="text-[15px] font-bold text-white">
            {b.firstName?.[0]?.toUpperCase() || "?"}
          </span>
        </div>

        {/* Name + detail */}
        <div className="flex-1 min-w-0 pl-0.5">
          <p className="text-[13.5px] font-semibold text-slate-800 leading-snug truncate">
            {b.firstName} {b.lastName}
          </p>
          <div className="flex items-center gap-1.5 mt-[3px]">
            {b.mintNumber ? (
              <>
                <span className="inline-flex items-center px-1.5 py-[1.5px] rounded bg-violet-100 text-[8.5px] font-bold text-violet-600 uppercase tracking-wider">MINT</span>
                <span className="text-[11px] text-slate-400 font-mono truncate">{b.mintNumber}</span>
              </>
            ) : (
              <span className="text-[11px] text-slate-400 truncate">{b.email}</span>
            )}
          </div>
        </div>

        {/* Right */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {usedLabel && (
            <span className="text-[9px] font-medium text-slate-300 leading-none">{usedLabel}</span>
          )}
          <div className="w-6 h-6 rounded-full flex items-center justify-center"
               style={{ background: `${accent}18` }}>
            <svg width="6" height="10" viewBox="0 0 6 10" fill="none">
              <path d="M1 1l4 4-4 4" stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function GiftToggleV2({
  enabled,
  onToggle,
  onDone,
  security,
  totalCostCents,
  amountDisplay,
  assetType = "stock",
}) {
  const [step, setStep] = useState("picker");
  const [inputMode, setInputMode] = useState("mint");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [giftCode, setGiftCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [celebrate, setCelebrate] = useState(false);

  const [mintSearch, setMintSearch] = useState("");
  const [mintSearching, setMintSearching] = useState(false);
  const [mintSearchResult, setMintSearchResult] = useState(null);
  const [mintSearchError, setMintSearchError] = useState(null);
  const mintDebounceRef = useRef(null);

  const [idSearch, setIdSearch] = useState("");
  const [idSearching, setIdSearching] = useState(false);
  const [idSearchResult, setIdSearchResult] = useState(null);
  const [idSearchError, setIdSearchError] = useState(null);
  const idDebounceRef = useRef(null);

  const [beneficiaries, setBeneficiaries] = useState([]);
  const [beneficiarySearch, setBeneficiarySearch] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [showAddBeneficiaryPrompt, setShowAddBeneficiaryPrompt] = useState(false);
  const [beneficiarySaved, setBeneficiarySaved] = useState(false);
  const [askSaveBeneficiary, setAskSaveBeneficiary] = useState(false);
  const [pendingBeneficiary, setPendingBeneficiary] = useState(null);
  const [confirmBackStep, setConfirmBackStep] = useState("form");

  useEffect(() => {
    if (enabled) fetchBeneficiaries().then(setBeneficiaries);
  }, [enabled]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim());
  const canProceed = firstName.trim() && lastName.trim() && emailValid;

  function resetForm() {
    setStep("picker");
    setInputMode("mint");
    setFirstName("");
    setLastName("");
    setRecipientEmail("");
    setMessage("");
    setGiftCode(null);
    setError(null);
    setMintSearch("");
    setMintSearchResult(null);
    setMintSearchError(null);
    setIdSearch("");
    setIdSearchResult(null);
    setIdSearchError(null);
    setBeneficiarySearch("");
    setDeleteCandidate(null);
    setShowAddBeneficiaryPrompt(false);
    setBeneficiarySaved(false);
    setAskSaveBeneficiary(false);
    setPendingBeneficiary(null);
    setConfirmBackStep("form");
  }

  function handleToggle(val) {
    if (!val) resetForm();
    onToggle?.(val);
  }

  function handleClose() {
    resetForm();
    onToggle?.(false);
  }

  function handleSelectBeneficiary(b) {
    setFirstName(b.firstName || "");
    setLastName(b.lastName || "");
    setRecipientEmail(b.email || "");
    setConfirmBackStep("picker");
    setStep("confirming");
  }

  async function handleConfirmDelete() {
    if (!deleteCandidate) return;
    await removeBeneficiary(deleteCandidate.email);
    fetchBeneficiaries().then(setBeneficiaries);
    setDeleteCandidate(null);
  }

  const searchByMintNumber = useCallback(async (mintNum) => {
    if (!mintNum || mintNum.trim().length < 3) {
      setMintSearchResult(null);
      setMintSearchError(null);
      return;
    }
    setMintSearching(true);
    setMintSearchError(null);
    setMintSearchResult(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const res = await fetch(`/api/user/lookup-by-mint?mint_number=${encodeURIComponent(mintNum.trim())}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setMintSearchError(data.error || "User not found");
      } else if (data.user) {
        setMintSearchResult(data.user);
      } else {
        setMintSearchError("No user found with that Mint number");
      }
    } catch {
      setMintSearchError("Search failed. Please try again.");
    } finally {
      setMintSearching(false);
    }
  }, []);

  function handleMintSearchChange(val) {
    setMintSearch(val);
    setMintSearchResult(null);
    setMintSearchError(null);
    clearTimeout(mintDebounceRef.current);
    mintDebounceRef.current = setTimeout(() => searchByMintNumber(val), 600);
  }

  const searchByIdNumber = useCallback(async (idNum) => {
    if (!idNum || idNum.length !== 13) {
      setIdSearchResult(null);
      setIdSearchError(null);
      return;
    }
    setIdSearching(true);
    setIdSearchError(null);
    setIdSearchResult(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const res = await fetch(`/api/user/lookup-by-id?id_number=${encodeURIComponent(idNum.trim())}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setIdSearchError(data.error || "User not found");
      } else if (data.user) {
        setIdSearchResult(data.user);
      } else {
        setIdSearchError("No user found with that ID number");
      }
    } catch {
      setIdSearchError("Search failed. Please try again.");
    } finally {
      setIdSearching(false);
    }
  }, []);

  function handleIdSearchChange(val) {
    const digits = val.replace(/\D/g, "").slice(0, 13);
    setIdSearch(digits);
    setIdSearchResult(null);
    setIdSearchError(null);
    clearTimeout(idDebounceRef.current);
    if (digits.length === 13) {
      idDebounceRef.current = setTimeout(() => searchByIdNumber(digits), 500);
    }
  }

  async function handleConfirm() {
    setStep("loading");
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const senderEmail = sessionData?.session?.user?.email?.toLowerCase() || "";
      if (senderEmail && recipientEmail.trim().toLowerCase() === senderEmail) {
        setError("You cannot gift to yourself.");
        setStep("confirming");
        return;
      }
      const res = await fetch("/api/gift/create-v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          asset_type: assetType,
          ...(assetType === "strategy" ? { strategy_id: security?.id } : { security_id: security?.id }),
          security_symbol: security?.symbol,
          asset_name: security?.name || security?.symbol,
          amount: totalCostCents,
          recipient_identifier: recipientEmail.trim().toLowerCase(),
          recipient_first_name: firstName.trim(),
          recipient_last_name: lastName.trim(),
          message: message.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Failed to send gift.");
        setStep("confirming");
        return;
      }
      const mintNum = mintSearchResult?.mint_number || null;
      setPendingBeneficiary({ firstName: firstName.trim(), lastName: lastName.trim(), email: recipientEmail.trim().toLowerCase(), mintNumber: mintNum });
      setAskSaveBeneficiary(true);
      setGiftCode(data.token);
      setExpiresAt(data.expires_at);
      setStep("success");
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 1600);
      try {
        window.dispatchEvent(new Event("wallet-updated"));
        window.dispatchEvent(new Event("profile-updated"));
        window.dispatchEvent(new Event("financial-data-updated"));
      } catch {}
    } catch {
      setError("Something went wrong. Please try again.");
      setStep("confirming");
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(giftCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function formatExpiry(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) +
      " on " + d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  }

  const filteredBeneficiaries = beneficiaries.filter(b => {
    if (!beneficiarySearch.trim()) return true;
    const q = beneficiarySearch.toLowerCase();
    return (
      `${b.firstName} ${b.lastName}`.toLowerCase().includes(q) ||
      (b.mintNumber || "").toLowerCase().includes(q) ||
      (b.email || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="mt-4">
      {/* Toggle row */}
      <button
        type="button"
        onClick={() => handleToggle(!enabled)}
        className="w-full flex items-center justify-between rounded-2xl px-4 py-3.5 bg-white border border-slate-200 shadow-sm active:scale-[0.99] transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100">
            <Gift size={16} className="text-violet-600" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-slate-800">Send as a gift</p>
            <p className="text-[11px] text-slate-400">Recipient claims with their SA ID + code</p>
          </div>
        </div>
        <div
          className={`relative w-[52px] h-[30px] rounded-full flex items-center transition-colors ${enabled ? "bg-violet-600" : "bg-slate-200"}`}
          style={{ padding: 3 }}
        >
          <motion.div
            animate={{ x: enabled ? 22 : 0 }}
            transition={{ type: "spring", stiffness: 700, damping: 35 }}
            className="w-6 h-6 rounded-full bg-white flex items-center justify-center"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}
          >
            <AnimatePresence mode="wait">
              {enabled ? (
                <motion.div key="check" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.15 }}>
                  <Check size={12} strokeWidth={3} className="text-violet-600" />
                </motion.div>
              ) : (
                <motion.div key="dot" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="w-1.5 h-1.5 rounded-full bg-slate-300" />
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </button>

      {/* ── BOTTOM SHEET ── rendered via portal so CSS transforms on parent containers
           (e.g. AdultInvestModal sliding off-screen) don't clip fixed-positioned overlays */}
      {createPortal(<AnimatePresence>
        {enabled && step !== "success" && (
          <>
            {/* Backdrop — above AdultInvestModal (z:9998/9999) */}
            <motion.div
              key="gift-backdrop"
              className="fixed inset-0 bg-black/60"
              style={{ zIndex: 10000 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={handleClose}
            />

            {/* Sheet */}
            <motion.div
              key="gift-sheet"
              className="fixed bottom-0 left-0 right-0 flex justify-center items-end"
              style={{ zIndex: 10001 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="w-full max-w-md bg-white rounded-t-3xl shadow-2xl overflow-hidden"
                style={{ maxHeight: "92vh" }}
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 400, damping: 40 }}
              >
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-10 h-1 rounded-full bg-slate-200" />
                </div>

                {/* ── PICKER ── */}
                {step === "picker" && (
                  <div className="flex flex-col" style={{ minHeight: "72vh", maxHeight: "calc(92vh - 20px)" }}>
                    {/* Header */}
                    <div className="px-5 pt-2 pb-4">
                      <div className="flex items-center mb-4">
                        <div className="w-8" />
                        <h2 className="flex-1 text-center text-[17px] font-bold text-slate-900">Beneficiary</h2>
                        <button type="button" onClick={handleClose} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                          <X size={16} />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          <input
                            type="text"
                            value={beneficiarySearch}
                            onChange={e => setBeneficiarySearch(e.target.value)}
                            placeholder="Search for beneficiary"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-violet-400 focus:bg-white transition-colors"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setStep("selectMethod")}
                          className="w-11 h-11 rounded-xl bg-[#e63946] flex items-center justify-center shrink-0 active:scale-95 transition-all shadow-sm"
                        >
                          <Plus size={20} className="text-white" strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>

                    {/* Delete confirmation banner */}
                    <AnimatePresence>
                      {deleteCandidate && (
                        <motion.div
                          key="delete-confirm"
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          className="mx-5 mb-3 rounded-2xl bg-red-50 border border-red-200 px-4 py-3.5"
                        >
                          <p className="text-sm font-semibold text-slate-800 mb-0.5">
                            Remove {deleteCandidate.firstName}?
                          </p>
                          <p className="text-[11px] text-slate-500 mb-3">
                            They'll be removed from your saved recipients.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setDeleteCandidate(null)}
                              className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-600 active:scale-95 transition-all"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleConfirmDelete}
                              className="flex-1 rounded-xl bg-red-500 py-2 text-xs font-semibold text-white active:scale-95 transition-all"
                            >
                              Yes, remove
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Beneficiary list */}
                    <div className="flex-1 overflow-y-auto">
                      {filteredBeneficiaries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
                          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                            <User size={26} className="text-slate-300" />
                          </div>
                          <p className="text-sm font-semibold text-slate-500">No saved recipients yet</p>
                          <p className="text-[12px] text-slate-400 mt-1.5 leading-relaxed">
                            Tap <span className="font-bold text-[#e63946]">+</span> to find someone by MINT number or enter their details manually
                          </p>
                        </div>
                      ) : (
                        <div className="mx-4 rounded-2xl overflow-hidden border border-violet-100 shadow-sm">
                          {/* Header strip */}
                          <div className="flex items-center justify-between px-4 py-2.5"
                               style={{ background: "linear-gradient(90deg,#f5f3ff,#faf9ff)", borderBottom: "1px solid #ede9fe" }}>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Saved recipients</span>
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold text-violet-600"
                                  style={{ background: "#ede9fe" }}>
                              {filteredBeneficiaries.length}
                            </span>
                          </div>
                          {filteredBeneficiaries.map((b, i) => (
                            <SwipeableRow
                              key={`${b.email}-${i}`}
                              b={b}
                              index={i}
                              isLast={i === filteredBeneficiaries.length - 1}
                              onSelect={handleSelectBeneficiary}
                              onDeleteRequest={setDeleteCandidate}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Cancel */}
                    <div className="px-5 pb-8 pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={handleClose}
                        className="w-full rounded-2xl border border-[#e63946] py-3.5 text-sm font-bold text-[#e63946] active:scale-[0.98] transition-all"
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                )}

                {/* ── SELECT METHOD ── */}
                {step === "selectMethod" && (
                  <div className="flex flex-col" style={{ maxHeight: "calc(92vh - 20px)" }}>
                    <div className="flex items-center px-4 pt-2 pb-3">
                      <button
                        type="button"
                        onClick={() => setStep("picker")}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors"
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <h2 className="flex-1 text-center text-[17px] font-bold text-slate-900">New recipient</h2>
                      <div className="w-8" />
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 pb-10">
                      <p className="text-[13px] font-semibold text-slate-500 mb-4">Please select an option</p>
                      <div className="space-y-3">
                        {/* MINT Number */}
                        <button
                          type="button"
                          onClick={() => { setInputMode("mint"); setMintSearch(""); setMintSearchResult(null); setMintSearchError(null); setStep("form"); }}
                          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm active:scale-[0.98] transition-all text-left"
                        >
                          <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                            <Hash size={20} className="text-violet-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-bold text-slate-800">MINT Number</p>
                            <p className="text-[12px] text-slate-400 mt-0.5">Find a user by their MINT number</p>
                          </div>
                          <ChevronRight size={16} className="text-slate-300 shrink-0" />
                        </button>

                        {/* ID Number */}
                        <button
                          type="button"
                          onClick={() => { setInputMode("id"); setIdSearch(""); setIdSearchResult(null); setIdSearchError(null); setStep("form"); }}
                          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm active:scale-[0.98] transition-all text-left"
                        >
                          <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                            <CreditCard size={20} className="text-violet-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-bold text-slate-800">ID Number</p>
                            <p className="text-[12px] text-slate-400 mt-0.5">Find a user by their SA ID number</p>
                          </div>
                          <ChevronRight size={16} className="text-slate-300 shrink-0" />
                        </button>

                        {/* Enter details */}
                        <button
                          type="button"
                          onClick={() => { setInputMode("manual"); setStep("form"); }}
                          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm active:scale-[0.98] transition-all text-left"
                        >
                          <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                            <User size={20} className="text-violet-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-bold text-slate-800">Enter details</p>
                            <p className="text-[12px] text-slate-400 mt-0.5">Manually enter name, email and a message</p>
                          </div>
                          <ChevronRight size={16} className="text-slate-300 shrink-0" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── FORM ── */}
                {step === "form" && (
                  <div className="flex flex-col" style={{ maxHeight: "calc(92vh - 20px)" }}>
                    <div className="flex items-center px-4 pt-2 pb-3">
                      <button
                        type="button"
                        onClick={() => { setMintSearchResult(null); setMintSearch(""); setMintSearchError(null); setIdSearchResult(null); setIdSearch(""); setIdSearchError(null); setStep("selectMethod"); }}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors"
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <h2 className="flex-1 text-center text-[17px] font-bold text-slate-900">
                        {inputMode === "mint" ? "Find by MINT" : inputMode === "id" ? "Find by ID" : "Enter details"}
                      </h2>
                      <div className="w-8" />
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-4">

                      {/* MINT tab */}
                      {inputMode === "mint" && (
                        <div className="space-y-3">
                          {!mintSearchResult && (
                            <div>
                              <label className="text-[11px] font-semibold text-slate-500 mb-1.5 block">Search by MINT number</label>
                              <div className="relative">
                                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                <input
                                  type="text"
                                  value={mintSearch}
                                  onChange={e => handleMintSearchChange(e.target.value)}
                                  placeholder="e.g. TSI5260100626"
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-violet-400 focus:bg-white transition-colors"
                                />
                                {mintSearching && (
                                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
                                )}
                              </div>
                              {mintSearchError && (
                                <p className="text-[11px] text-red-500 mt-1.5 flex items-center gap-1">
                                  <AlertCircle size={10} />{mintSearchError}
                                </p>
                              )}
                              <p className="text-[11px] text-slate-400 mt-2">Enter the recipient's MINT number to find them.</p>
                            </div>
                          )}

                          {mintSearchResult && (
                            <>
                              <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-50 border border-violet-100">
                                <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${avatarGradient(mintSearchResult.first_name)} flex items-center justify-center shrink-0 shadow-sm`}>
                                  <span className="text-base font-black text-white">{mintSearchResult.first_name?.[0]?.toUpperCase() || "?"}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-slate-800">{mintSearchResult.first_name} {mintSearchResult.last_name}</p>
                                  <p className="text-[11px] text-slate-400 font-mono">{mintSearchResult.mint_number}</p>
                                  <p className="text-[11px] text-slate-400 truncate">{maskEmail(mintSearchResult.email)}</p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {!beneficiarySaved ? (
                                    <button
                                      type="button"
                                      onClick={() => setShowAddBeneficiaryPrompt(p => !p)}
                                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-sm hover:shadow-md active:scale-95 transition-all"
                                    >
                                      <Plus size={11} strokeWidth={2.5} />
                                      <span className="text-[11px] font-semibold">Save</span>
                                    </button>
                                  ) : (
                                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                                      <Check size={12} className="text-emerald-600" strokeWidth={3} />
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => { setMintSearchResult(null); setMintSearch(""); setMintSearchError(null); setShowAddBeneficiaryPrompt(false); setBeneficiarySaved(false); }}
                                    className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-200 transition-colors"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                              </div>

                              {showAddBeneficiaryPrompt && !beneficiarySaved && (
                                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-violet-200">
                                  <p className="text-[11px] text-slate-700 font-medium flex-1">
                                    Save <span className="font-semibold text-violet-700">{mintSearchResult.first_name}</span> as a recipient?
                                  </p>
                                  <button type="button" onClick={async () => { await saveBeneficiary({ firstName: mintSearchResult.first_name, lastName: mintSearchResult.last_name, email: mintSearchResult.email, mintNumber: mintSearchResult.mint_number }); fetchBeneficiaries().then(setBeneficiaries); setShowAddBeneficiaryPrompt(false); setBeneficiarySaved(true); }} className="px-3 py-1 rounded-lg bg-violet-600 text-white text-[11px] font-semibold active:scale-95 transition-all">Yes</button>
                                  <button type="button" onClick={() => setShowAddBeneficiaryPrompt(false)} className="px-3 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-semibold active:scale-95 transition-all">No</button>
                                </div>
                              )}

                              <div>
                                <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
                                  Personal message <span className="text-slate-300 font-normal">(optional)</span>
                                </label>
                                <textarea
                                  value={message}
                                  onChange={e => setMessage(e.target.value)}
                                  placeholder="Add a personal note…"
                                  rows={3}
                                  maxLength={200}
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-violet-400 focus:bg-white transition-colors resize-none"
                                />
                              </div>

                              <p className="text-[11px] text-slate-400 leading-relaxed">
                                Your wallet is debited immediately. The recipient has 4 hours to claim.
                              </p>

                              <button
                                type="button"
                                onClick={() => { setFirstName(mintSearchResult.first_name || ""); setLastName(mintSearchResult.last_name || ""); setRecipientEmail(mintSearchResult.email || ""); setConfirmBackStep("form"); setStep("confirming"); }}
                                className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white bg-gradient-to-r from-[#1a1a2e] to-[#44296b] shadow-lg active:scale-[0.98] transition-all"
                              >
                                <Gift size={15} /> Continue
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {/* ID Number tab */}
                      {inputMode === "id" && (
                        <div className="space-y-3">
                          {!idSearchResult && (
                            <div>
                              <label className="text-[11px] font-semibold text-slate-500 mb-1.5 block">Search by SA ID number</label>
                              <div className="relative">
                                <CreditCard size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={idSearch}
                                  onChange={e => handleIdSearchChange(e.target.value)}
                                  placeholder="e.g. 9001015009087"
                                  maxLength={13}
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-violet-400 focus:bg-white transition-colors"
                                />
                                {idSearching && (
                                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
                                )}
                              </div>
                              {idSearchError && (
                                <p className="text-[11px] text-red-500 mt-1.5 flex items-center gap-1">
                                  <AlertCircle size={10} />{idSearchError}
                                </p>
                              )}
                              <p className="text-[11px] text-slate-400 mt-2">Enter the recipient's 13-digit SA ID number to find them.</p>
                            </div>
                          )}

                          {idSearchResult && (
                            <>
                              <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-50 border border-violet-100">
                                <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${avatarGradient(idSearchResult.first_name)} flex items-center justify-center shrink-0 shadow-sm`}>
                                  <span className="text-base font-black text-white">{idSearchResult.first_name?.[0]?.toUpperCase() || "?"}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-slate-800">{idSearchResult.first_name} {idSearchResult.last_name}</p>
                                  {idSearchResult.mint_number && <p className="text-[11px] text-slate-400 font-mono">{idSearchResult.mint_number}</p>}
                                  <p className="text-[11px] text-slate-400 truncate">{maskEmail(idSearchResult.email)}</p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {!beneficiarySaved ? (
                                    <button
                                      type="button"
                                      onClick={() => setShowAddBeneficiaryPrompt(p => !p)}
                                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-sm hover:shadow-md active:scale-95 transition-all"
                                    >
                                      <Plus size={11} strokeWidth={2.5} />
                                      <span className="text-[11px] font-semibold">Save</span>
                                    </button>
                                  ) : (
                                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                                      <Check size={12} className="text-emerald-600" strokeWidth={3} />
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => { setIdSearchResult(null); setIdSearch(""); setIdSearchError(null); setShowAddBeneficiaryPrompt(false); setBeneficiarySaved(false); }}
                                    className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-200 transition-colors"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                              </div>

                              {showAddBeneficiaryPrompt && !beneficiarySaved && (
                                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-violet-200">
                                  <p className="text-[11px] text-slate-700 font-medium flex-1">
                                    Save <span className="font-semibold text-violet-700">{idSearchResult.first_name}</span> as a recipient?
                                  </p>
                                  <button type="button" onClick={async () => { await saveBeneficiary({ firstName: idSearchResult.first_name, lastName: idSearchResult.last_name, email: idSearchResult.email, mintNumber: idSearchResult.mint_number }); fetchBeneficiaries().then(setBeneficiaries); setShowAddBeneficiaryPrompt(false); setBeneficiarySaved(true); }} className="px-3 py-1 rounded-lg bg-violet-600 text-white text-[11px] font-semibold active:scale-95 transition-all">Yes</button>
                                  <button type="button" onClick={() => setShowAddBeneficiaryPrompt(false)} className="px-3 py-1 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-semibold active:scale-95 transition-all">No</button>
                                </div>
                              )}

                              <div>
                                <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
                                  Personal message <span className="text-slate-300 font-normal">(optional)</span>
                                </label>
                                <textarea
                                  value={message}
                                  onChange={e => setMessage(e.target.value)}
                                  placeholder="Add a personal note…"
                                  rows={3}
                                  maxLength={200}
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-violet-400 focus:bg-white transition-colors resize-none"
                                />
                              </div>

                              <p className="text-[11px] text-slate-400 leading-relaxed">
                                Your wallet is debited immediately. The recipient has 4 hours to claim.
                              </p>

                              <button
                                type="button"
                                onClick={() => { setFirstName(idSearchResult.first_name || ""); setLastName(idSearchResult.last_name || ""); setRecipientEmail(idSearchResult.email || ""); setConfirmBackStep("form"); setStep("confirming"); }}
                                className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white bg-gradient-to-r from-[#1a1a2e] to-[#44296b] shadow-lg active:scale-[0.98] transition-all"
                              >
                                <Gift size={15} /> Continue
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {/* Manual tab */}
                      {inputMode === "manual" && (
                        <div className="space-y-3">
                          <div className="flex gap-3">
                            <div className="flex-1">
                              <label className="text-[11px] font-semibold text-slate-500 mb-1 block">First Name</label>
                              <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="John" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-violet-400 focus:bg-white transition-colors" />
                            </div>
                            <div className="flex-1">
                              <label className="text-[11px] font-semibold text-slate-500 mb-1 block">Last Name</label>
                              <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Doe" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-violet-400 focus:bg-white transition-colors" />
                            </div>
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">Recipient Email</label>
                            <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} placeholder="john@example.com" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-violet-400 focus:bg-white transition-colors" />
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-slate-500 mb-1 block">
                              Personal message <span className="text-slate-300 font-normal">(optional)</span>
                            </label>
                            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Add a personal note…" rows={2} maxLength={200} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-violet-400 focus:bg-white transition-colors resize-none" />
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            Your wallet is debited immediately. The recipient has 4 hours to claim.
                          </p>
                          <button
                            type="button"
                            onClick={() => setStep("confirming")}
                            disabled={!canProceed}
                            className={`w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-all active:scale-[0.98] ${canProceed ? "bg-gradient-to-r from-[#1a1a2e] to-[#44296b] shadow-lg" : "bg-slate-300 cursor-not-allowed"}`}
                          >
                            <Gift size={15} /> Continue
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── CONFIRMING ── */}
                {step === "confirming" && (
                  <div className="flex flex-col" style={{ maxHeight: "calc(92vh - 20px)" }}>
                    <div className="flex items-center px-4 pt-2 pb-3">
                      <button type="button" onClick={() => setStep(confirmBackStep)} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                        <ChevronLeft size={20} />
                      </button>
                      <h2 className="flex-1 text-center text-[17px] font-bold text-slate-900">Confirm gift</h2>
                      <button type="button" onClick={handleClose} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 pb-10 space-y-4">
                      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-100">
                        <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-700">Your wallet will be debited immediately once you confirm.</p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4 space-y-2.5">
                        <Row label="To" value={`${firstName} ${lastName}`} />
                        <Row label="Email" value={recipientEmail.trim().toLowerCase()} />
                        <Row label="Asset" value={security?.name || security?.symbol} />
                        {amountDisplay && <Row label="Amount" value={amountDisplay} bold />}
                        {message && (
                          <div className="pt-2 border-t border-slate-200">
                            <p className="text-[11px] text-slate-400 mb-0.5">Message</p>
                            <p className="text-xs text-slate-600 italic">"{message}"</p>
                          </div>
                        )}
                      </div>
                      {error && <p className="text-xs text-red-500 flex items-center gap-1.5"><AlertCircle size={11} />{error}</p>}
                      <div className="flex gap-2 pt-1">
                        <button type="button" onClick={() => setStep("form")} className="flex-1 rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-600 active:scale-[0.98] transition-all">Edit</button>
                        <button type="button" onClick={handleConfirm} disabled={isAdminPreview()} className={`flex-1 rounded-xl bg-gradient-to-r from-[#1a1a2e] to-[#44296b] py-3 text-sm font-semibold text-white active:scale-[0.98] transition-all shadow-lg${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}>Confirm & Send</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── LOADING ── */}
                {step === "loading" && (
                  <div className="flex flex-col items-center justify-center gap-4 py-20 px-5">
                    <div className="w-10 h-10 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
                    <p className="text-sm text-slate-500 font-medium">Creating your gift…</p>
                  </div>
                )}
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>, document.body)}

      {/* ── SUCCESS MODAL ── rendered via portal for same reason as the bottom sheet */}
      {createPortal(enabled && step === "success" && giftCode ? (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 10002, background: "rgba(10,10,20,0.6)", backdropFilter: "blur(12px)", animation: "gtv-fade 0.3s ease forwards" }}>
          <style>{`
            @keyframes gtv-fade { from { opacity:0 } to { opacity:1 } }
            @keyframes gtv-slide { 0% { opacity:0; transform:translateY(40px) } 100% { opacity:1; transform:translateY(0) } }
          `}</style>

          <ConfettiBurst active={celebrate} />

          <div className="w-full max-w-sm" style={{ animation: "gtv-slide 0.5s cubic-bezier(0.16,1,0.3,1) forwards" }}>
            <div className="bg-white rounded-[28px] overflow-hidden" style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04)" }}>
              <div className="h-1 bg-gradient-to-r from-violet-500 via-fuchsia-400 to-violet-500" />
              <div className="px-6 pt-5 pb-5 relative">
                <button type="button" onClick={() => { handleClose(); onDone?.(); }} className="absolute top-4 right-5 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                  <X size={14} className="text-slate-500" />
                </button>

                <div className="flex justify-center mb-3">
                  <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="12" y="38" width="56" height="34" rx="6" fill="url(#giftBox)" />
                    <rect x="8" y="30" width="64" height="14" rx="5" fill="url(#giftLid)" />
                    <rect x="36" y="30" width="8" height="42" rx="1" fill="#e9d5ff" opacity="0.6" />
                    <rect x="8" y="35" width="64" height="4" rx="1" fill="#e9d5ff" opacity="0.4" />
                    <path d="M40 30C40 30 32 14 24 18C16 22 28 30 40 30Z" fill="#f0abfc" opacity="0.8" />
                    <path d="M40 30C40 30 48 14 56 18C64 22 52 30 40 30Z" fill="#f0abfc" opacity="0.8" />
                    <defs>
                      <linearGradient id="giftBox" x1="12" y1="38" x2="68" y2="72" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#8b5cf6" /><stop offset="1" stopColor="#6d28d9" />
                      </linearGradient>
                      <linearGradient id="giftLid" x1="8" y1="30" x2="72" y2="44" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#a78bfa" /><stop offset="1" stopColor="#7c3aed" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>

                <div className="text-center mb-4">
                  <h3 className="text-lg font-bold text-slate-900 mb-1">Gift sent! 🎉</h3>
                  <p className="text-[13px] text-slate-500">
                    Share the code below with <span className="font-semibold text-slate-700">{firstName}</span>
                  </p>
                  {expiresAt && <p className="text-[11px] text-slate-400 mt-1">Expires {formatExpiry(expiresAt)}</p>}
                </div>

                {askSaveBeneficiary && pendingBeneficiary && (
                  <div className="mb-4 px-3 py-2.5 rounded-xl bg-violet-50 border border-violet-100">
                    <p className="text-[11px] font-semibold text-violet-800 mb-2">Save {pendingBeneficiary.firstName} as a recipient?</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={async () => { await saveBeneficiary(pendingBeneficiary); fetchBeneficiaries().then(setBeneficiaries); setAskSaveBeneficiary(false); setPendingBeneficiary(null); }} className="flex-1 rounded-lg bg-violet-600 py-1.5 text-[11px] font-semibold text-white active:scale-95 transition-all">Yes, save</button>
                      <button type="button" onClick={() => { setAskSaveBeneficiary(false); setPendingBeneficiary(null); }} className="flex-1 rounded-lg bg-white border border-violet-200 py-1.5 text-[11px] font-semibold text-violet-600 active:scale-95 transition-all">No thanks</button>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 mb-4">
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-[0.12em] mb-2.5 text-center">Claim code</p>
                  <div className="flex justify-center gap-1.5">
                    {giftCode.split("").map((char, i) => (
                      <div key={i} className="w-9 h-11 rounded-xl bg-white border-2 border-slate-200 flex items-center justify-center text-[18px] font-black text-violet-700 shadow-sm" style={{ fontFamily: "monospace" }}>
                        {char}
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopy}
                  className={`w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all active:scale-[0.98] mb-2 ${copied ? "bg-emerald-500 text-white" : "bg-gradient-to-r from-[#1a1a2e] to-[#44296b] text-white shadow-lg"}`}
                >
                  {copied ? <Check size={15} strokeWidth={3} /> : <Copy size={15} />}
                  {copied ? "Copied!" : "Copy code"}
                </button>

                <button type="button" onClick={() => { handleClose(); onDone?.(); }} className="w-full rounded-xl py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors">
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null, document.body)}
    </div>
  );
}
