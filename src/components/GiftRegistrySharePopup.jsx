import React, { useState, useEffect, useCallback, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { registryShareUrl } from "../lib/giftRegistryUtils.js";
import { supabase, supabaseReady } from "../lib/supabase.js";

// ── Avatar helpers matching GiftToggleV2 ──────────────────────────────────────
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
  "#7c3aed","#10b981","#38bdf8","#f59e0b","#fb7185","#d946ef","#818cf8","#22d3ee",
];
function avatarGradient(name) {
  return AVATAR_GRADIENTS[(name?.charCodeAt(0) || 0) % AVATAR_GRADIENTS.length];
}
function avatarAccent(name) {
  return AVATAR_ACCENTS[(name?.charCodeAt(0) || 0) % AVATAR_ACCENTS.length];
}

// ── Privacy helper: mask an email address for display (e.g. jo***@gmail.com)
function maskEmail(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) return email || "";
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
}

// ── Beneficiary localStorage helpers ─────────────────────────────────────────
function sentStorageKey(registryId) { return `wishlist_notif_${registryId}`; }
function getSentMap(registryId) {
  try { return JSON.parse(localStorage.getItem(sentStorageKey(registryId)) || "{}"); }
  catch { return {}; }
}
function writeSentMap(registryId, map) {
  localStorage.setItem(sentStorageKey(registryId), JSON.stringify(map));
}

async function loadBeneficiaries() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return [];
    const { data } = await supabase
      .from("Beneficiary")
      .select("id, first_name, last_name, email, mint_number, used_at")
      .eq("user_id", session.user.id)
      .order("used_at", { ascending: false })
      .limit(20);
    return (data || []).map(r => ({
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      mintNumber: r.mint_number,
    }));
  } catch { return []; }
}

async function upsertBeneficiary({ firstName, lastName, email, mintNumber }) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    await supabase.from("Beneficiary").upsert(
      { user_id: session.user.id, first_name: firstName, last_name: lastName,
        email: email.toLowerCase(), mint_number: mintNumber || null,
        used_at: new Date().toISOString() },
      { onConflict: "user_id,email" }
    );
  } catch {}
}

function getBeneficiaryState(email, registryId) {
  const entry = getSentMap(registryId)[email?.toLowerCase()];
  if (!entry) return "none";
  if (entry.state === "nudge") return "nudge";
  if (entry.invite) return "sent";
  if (entry.sentAt) {
    const diffH = (Date.now() - new Date(entry.sentAt).getTime()) / 3_600_000;
    if (diffH >= 48) return "nudge";
  }
  if (entry.state) return entry.state;
  return "sent";
}

// ── Sub-panel: new recipient options (matching screenshot) ────────────────────
function NewRecipientPanel({ onBack, onSelect }) {
  const options = [
    {
      id: "mint",
      icon: (
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
        </svg>
      ),
      iconBg: "#ede9fe",
      iconColor: "#7c3aed",
      title: "MINT Number",
      subtitle: "Share with a user via their MINT number",
    },
    {
      id: "id",
      icon: (
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      ),
      iconBg: "#ede9fe",
      iconColor: "#7c3aed",
      title: "ID Number",
      subtitle: "Share with a user via their SA ID number",
    },
    {
      id: "details",
      icon: (
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
      iconBg: "#ede9fe",
      iconColor: "#7c3aed",
      title: "Enter details",
      subtitle: "Manually enter their name and email",
    },
    {
      id: "email",
      icon: (
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      iconBg: "#d1fae5",
      iconColor: "#059669",
      title: "Share by Email",
      subtitle: "Share with someone using their email address",
    },
  ];

  return (
    <div className="w-full max-w-md bg-white rounded-t-[28px] shadow-2xl flex flex-col" style={{ maxHeight: "85vh" }}>
      <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
        <div className="h-1 w-10 rounded-full bg-slate-200" />
      </div>
      <div className="px-5 pt-3 pb-2 flex-shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 active:opacity-60">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h3 className="text-[17px] font-bold text-slate-900">New recipient</h3>
        </div>
        <p className="text-[13px] text-slate-400 ml-11">Please select an option</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2 space-y-3">
        {options.map(opt => (
          <button
            key={opt.id}
            onClick={() => onSelect(opt.id)}
            className="w-full flex items-center gap-4 bg-white border border-slate-100 rounded-2xl px-4 py-4 active:opacity-70 transition-opacity text-left shadow-sm"
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: opt.iconBg, color: opt.iconColor }}>
              {opt.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-slate-800">{opt.title}</p>
              <p className="text-[12px] text-slate-400 mt-0.5">{opt.subtitle}</p>
            </div>
            <svg width="7" height="12" viewBox="0 0 7 12" fill="none" className="shrink-0">
              <path d="M1 1l5 5-5 5" stroke="#cbd5e1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function GiftRegistrySharePopup({ token, title, registryId, onClose, onNavigate }) {
  const url = registryShareUrl(token);
  const [copied, setCopied] = useState(false);

  // panel: null | "beneficiary" | "newRecipient" | "mint" | "id" | "details" | "email"
  const [panel, setPanel] = useState(null);

  // beneficiary list state
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [bSearch, setBSearch] = useState("");
  const [sendingFor, setSendingFor] = useState(null);
  const [sentTick, setSentTick] = useState(0);
  const [sendError, setSendError] = useState(null);

  // MINT search
  const [mintInput, setMintInput] = useState("");
  const [mintSearching, setMintSearching] = useState(false);
  const [mintResult, setMintResult] = useState(null);
  const [mintError, setMintError] = useState(null);
  const mintDebounceRef = useRef(null);

  // ID search
  const [idInput, setIdInput] = useState("");
  const [idSearching, setIdSearching] = useState(false);
  const [idResult, setIdResult] = useState(null);
  const [idError, setIdError] = useState(null);
  const idDebounceRef = useRef(null);

  // Enter details
  const [detFirst, setDetFirst] = useState("");
  const [detLast, setDetLast] = useState("");
  const [detEmail, setDetEmail] = useState("");

  // Email search / invite
  const [emailInput, setEmailInput] = useState("");
  const [emailSearching, setEmailSearching] = useState(false);
  const [emailResult, setEmailResult] = useState(null);
  const [emailError, setEmailError] = useState(null);
  const [inviteFirst, setInviteFirst] = useState("");
  const [inviteLast, setInviteLast] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const emailDebounceRef = useRef(null);
  const emailReqRef = useRef(0);

  useEffect(() => {
    if (panel === "beneficiary") loadBeneficiaries().then(setBeneficiaries);
  }, [panel, sentTick]);

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  async function getAuthToken() {
    try {
      const supabase = await supabaseReady;
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    } catch { return null; }
  }

  async function sendToMint(b) {
    if (sendingFor) return;
    setSendingFor(b.email);
    setSendError(null);
    const emailKey = b.email.toLowerCase();
    try {
      const tok = await getAuthToken();
      const bState = getBeneficiaryState(b.email, registryId);

      const res = await fetch(`/api/gift-registry/${registryId}/notify-beneficiary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ email: b.email, firstName: b.firstName, isNudge: bState === "nudge" }),
      });
      const json = await res.json();

      if (json.has_account === false) {
        try {
          await fetch("/api/user/invite-beneficiary", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
            body: JSON.stringify({ email: b.email, first_name: b.firstName, last_name: b.lastName, registry_url: url }),
          });
        } catch {}
        const map = getSentMap(registryId);
        map[emailKey] = { sentAt: new Date().toISOString(), state: "sent", invite: true };
        writeSentMap(registryId, map);
        await upsertBeneficiary(b);
        setSentTick(t => t + 1);
        return;
      }

      if (!res.ok) { setSendError(json.error || "Could not send notification"); return; }

      if (json.reason === "already_sent") {
        const map = getSentMap(registryId);
        map[emailKey] = { ...map[emailKey], state: "sent" };
        writeSentMap(registryId, map);
        setSentTick(t => t + 1);
        return;
      }
      if (json.reason === "eligible_nudge") {
        const map = getSentMap(registryId);
        map[emailKey] = { ...map[emailKey], state: "nudge" };
        writeSentMap(registryId, map);
        setSentTick(t => t + 1);
        return;
      }

      const map = getSentMap(registryId);
      map[emailKey] = { sentAt: json.sentAt || new Date().toISOString(), state: "sent" };
      writeSentMap(registryId, map);
      await upsertBeneficiary(b);
      setSentTick(t => t + 1);
    } catch {
      setSendError("Network error. Please try again.");
    } finally {
      setSendingFor(null);
    }
  }

  // MINT number search
  const searchByMint = useCallback(async (val) => {
    if (!val || val.trim().length < 3) { setMintResult(null); setMintError(null); return; }
    setMintSearching(true); setMintError(null); setMintResult(null);
    try {
      const tok = await getAuthToken();
      const res = await fetch(`/api/user/lookup-by-mint?mint_number=${encodeURIComponent(val.trim())}`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      const data = await res.json();
      if (!res.ok || data.error) { setMintError(data.error || "User not found"); }
      else if (data.user) { setMintResult(data.user); }
      else { setMintError("No user found with that MINT number"); }
    } catch { setMintError("Search failed. Please try again."); }
    finally { setMintSearching(false); }
  }, []);

  function handleMintInput(val) {
    setMintInput(val); setMintResult(null); setMintError(null);
    clearTimeout(mintDebounceRef.current);
    mintDebounceRef.current = setTimeout(() => searchByMint(val), 600);
  }

  // ID number search
  const searchById = useCallback(async (val) => {
    if (!val || val.length !== 13) { setIdResult(null); setIdError(null); return; }
    setIdSearching(true); setIdError(null); setIdResult(null);
    try {
      const tok = await getAuthToken();
      const res = await fetch(`/api/user/lookup-by-id?id_number=${encodeURIComponent(val.trim())}`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      const data = await res.json();
      if (!res.ok || data.error) { setIdError(data.error || "User not found"); }
      else if (data.user) { setIdResult(data.user); }
      else { setIdError("No user found with that ID number"); }
    } catch { setIdError("Search failed. Please try again."); }
    finally { setIdSearching(false); }
  }, []);

  function handleIdInput(val) {
    const digits = val.replace(/\D/g, "").slice(0, 13);
    setIdInput(digits); setIdResult(null); setIdError(null);
    clearTimeout(idDebounceRef.current);
    if (digits.length === 13) idDebounceRef.current = setTimeout(() => searchById(digits), 500);
  }

  // Email lookup
  const searchByEmail = useCallback(async (email) => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setEmailResult(null); setEmailError(null); return; }
    const reqId = ++emailReqRef.current;
    setEmailSearching(true); setEmailError(null); setEmailResult(null);
    try {
      const tok = await getAuthToken();
      const res = await fetch(`/api/user/lookup-by-email?email=${encodeURIComponent(email.trim())}`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      if (reqId !== emailReqRef.current) return;
      const data = await res.json();
      if (!res.ok) { setEmailError(data.error || "Lookup failed"); }
      else { setEmailResult(data); }
    } catch {
      if (reqId !== emailReqRef.current) return;
      setEmailError("Search failed. Please try again.");
    } finally {
      if (reqId === emailReqRef.current) setEmailSearching(false);
    }
  }, []);

  function handleEmailInput(val) {
    setEmailInput(val); setEmailResult(null); setEmailError(null); setInviteSent(false);
    clearTimeout(emailDebounceRef.current);
    emailDebounceRef.current = setTimeout(() => searchByEmail(val), 700);
  }

  async function handleSendViaFoundUser(user, extraName) {
    const b = {
      firstName: extraName?.firstName || user.first_name || user.email?.split("@")[0] || "",
      lastName: extraName?.lastName || user.last_name || "",
      email: user.email,
      mintNumber: user.mint_number || null,
    };
    await upsertBeneficiary(b);
    await sendToMint(b);
    setPanel("beneficiary");
  }

  async function handleInviteEmail() {
    setInviteSending(true);
    try {
      const tok = await getAuthToken();
      await fetch("/api/user/invite-beneficiary", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({
          email: emailInput.trim().toLowerCase(),
          first_name: inviteFirst.trim() || undefined,
          last_name: inviteLast.trim() || undefined,
          registry_url: url,
        }),
      });
      const b = { firstName: inviteFirst.trim() || emailInput.split("@")[0], lastName: inviteLast.trim(), email: emailInput.trim().toLowerCase() };
      await upsertBeneficiary(b);
      const map = getSentMap(registryId);
      map[emailInput.trim().toLowerCase()] = { sentAt: new Date().toISOString(), state: "sent", invite: true };
      writeSentMap(registryId, map);
      setInviteSent(true);
    } catch {}
    finally { setInviteSending(false); }
  }

  async function handleAddDetails() {
    if (!detFirst.trim() || !detEmail.trim()) return;
    const b = { firstName: detFirst.trim(), lastName: detLast.trim(), email: detEmail.trim(), mintNumber: null };
    await upsertBeneficiary(b);
    await sendToMint(b);
    setPanel("beneficiary");
  }

  function resetAndBack() {
    setMintInput(""); setMintResult(null); setMintError(null);
    setIdInput(""); setIdResult(null); setIdError(null);
    setDetFirst(""); setDetLast(""); setDetEmail("");
    setEmailInput(""); setEmailResult(null); setEmailError(null);
    setInviteFirst(""); setInviteLast(""); setInviteSent(false);
    setPanel("newRecipient");
  }

  const filtered = beneficiaries.filter(b => {
    const q = bSearch.toLowerCase();
    return !q || `${b.firstName} ${b.lastName}`.toLowerCase().includes(q) || b.email.toLowerCase().includes(q);
  });

  // ── Beneficiary list panel ────────────────────────────────────────────────
  if (panel === "beneficiary") {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(15,10,30,0.72)", backdropFilter: "blur(6px)" }}>
        <div className="w-full max-w-md bg-white rounded-t-[28px] shadow-2xl flex flex-col" style={{ maxHeight: "85vh" }}>
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="h-1 w-10 rounded-full bg-slate-200" />
          </div>

          {/* Header row: title + close */}
          <div className="relative flex items-center justify-center px-5 pt-2 pb-3 flex-shrink-0">
            <h3 className="text-[17px] font-bold text-slate-900">Send to someone</h3>
            <button
              onClick={onClose}
              className="absolute right-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 active:opacity-70"
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search + plus button */}
          <div className="px-4 pb-3 flex gap-2 flex-shrink-0">
            <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="text-slate-400 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                value={bSearch}
                onChange={e => setBSearch(e.target.value)}
                placeholder="Search for beneficiary"
                className="flex-1 bg-transparent text-[14px] outline-none placeholder-slate-400 text-slate-800"
              />
            </div>
            <button
              onClick={() => setPanel("newRecipient")}
              className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 active:opacity-70"
              style={{ background: "linear-gradient(135deg,#e11d48,#f43f5e)" }}
            >
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* Contacts list */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {sendError && (
              <p className="text-sm text-red-500 bg-red-50 mx-4 rounded-xl px-3 py-2 text-center mb-2">{sendError}</p>
            )}

            {/* Section header */}
            {filtered.length > 0 && (
              <div className="flex items-center justify-between px-5 py-2">
                <span className="text-[11px] font-bold tracking-widest text-slate-400 uppercase">Saved Recipients</span>
                <span className="text-[11px] font-bold text-white bg-violet-600 rounded-full px-2 py-0.5">{filtered.length}</span>
              </div>
            )}

            {filtered.length === 0 && (
              <p className="text-[13px] text-slate-400 text-center py-10 px-6">
                No saved contacts yet.<br />Tap <strong>+</strong> to add one.
              </p>
            )}

            {filtered.map((b, index) => {
              const bState = getBeneficiaryState(b.email, registryId);
              const isSending = sendingFor === b.email;
              const accent = avatarAccent(b.firstName);
              const isLast = index === filtered.length - 1;
              return (
                <div
                  key={b.email}
                  className="relative overflow-hidden"
                  style={{ borderBottom: isLast ? "none" : "1px solid #ede9fe" }}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-3.5 relative z-10 cursor-pointer select-none active:opacity-70"
                    style={{ background: index % 2 === 0 ? "#ffffff" : "#faf8ff" }}
                    onClick={() => !isSending && bState !== "sent" && sendToMint(b)}
                  >
                    {/* Left accent bar */}
                    <div style={{ position:"absolute",left:0,top:"18%",bottom:"18%",width:3,borderRadius:2,background:accent }} />

                    {/* Avatar */}
                    <div
                      className={`w-11 h-11 rounded-full bg-gradient-to-br ${avatarGradient(b.firstName)} flex items-center justify-center shrink-0`}
                      style={{ boxShadow: `0 0 0 2px ${accent}28, 0 2px 8px rgba(0,0,0,0.13)` }}
                    >
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

                    {/* Right: status or chevron */}
                    {isSending ? (
                      <div className="w-5 h-5 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin shrink-0" />
                    ) : bState === "sent" ? (
                      <span className="text-[11px] font-bold text-emerald-600 shrink-0">✓ Sent</span>
                    ) : bState === "nudge" ? (
                      <span className="text-[11px] font-bold text-amber-600 shrink-0">Nudge?</span>
                    ) : (
                      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                           style={{ background: `${accent}18` }}>
                        <svg width="6" height="10" viewBox="0 0 6 10" fill="none">
                          <path d="M1 1l4 4-4 4" stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* CANCEL button */}
          <div className="px-4 pb-8 pt-3 flex-shrink-0">
            <button
              onClick={onClose}
              className="w-full py-4 rounded-2xl border-2 border-rose-200 text-rose-500 text-sm font-bold tracking-widest uppercase active:opacity-70"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── New recipient options panel ──────────────────────────────────────────
  if (panel === "newRecipient") {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(15,10,30,0.72)", backdropFilter: "blur(6px)" }}>
        <NewRecipientPanel
          onBack={() => setPanel("beneficiary")}
          onSelect={(id) => setPanel(id)}
        />
      </div>
    );
  }

  // ── MINT Number search panel ─────────────────────────────────────────────
  if (panel === "mint") {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(15,10,30,0.72)", backdropFilter: "blur(6px)" }}>
        <div className="w-full max-w-md bg-white rounded-t-[28px] shadow-2xl flex flex-col" style={{ maxHeight: "85vh" }}>
          <div className="flex justify-center pt-3 pb-1"><div className="h-1 w-10 rounded-full bg-slate-200" /></div>
          <div className="px-5 pt-3 pb-4 flex-shrink-0">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={resetAndBack} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 active:opacity-60">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <h3 className="text-[17px] font-bold text-slate-900">MINT Number</h3>
            </div>
            <input
              type="text"
              value={mintInput}
              onChange={e => handleMintInput(e.target.value.toUpperCase())}
              placeholder="e.g. TS1234567890"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-[15px] text-slate-800 outline-none focus:ring-2 focus:ring-violet-300 font-mono"
              autoFocus
            />
            {mintSearching && <p className="text-xs text-slate-400 mt-2 text-center">Searching…</p>}
            {mintError && <p className="text-sm text-red-500 mt-2 text-center">{mintError}</p>}
          </div>
          {mintResult && (
            <div className="mx-4 mb-4 bg-violet-50 border border-violet-200 rounded-2xl px-4 py-4">
              <p className="text-[13px] font-semibold text-slate-800 mb-0.5">
                {mintResult.first_name} {mintResult.last_name}
              </p>
              <p className="text-[11px] text-slate-400 mb-3">{mintResult.mint_number}</p>
              <button
                onClick={() => handleSendViaFoundUser(mintResult)}
                disabled={!!sendingFor}
                className="w-full py-3 rounded-xl bg-[#6B21A8] text-white text-sm font-bold active:opacity-70 disabled:opacity-50"
              >
                {sendingFor ? "Sharing…" : `Share with ${mintResult.first_name || "them"}`}
              </button>
            </div>
          )}
          <div className="px-4 pb-8 mt-auto flex-shrink-0">
            <button onClick={() => setPanel("beneficiary")} className="w-full py-4 rounded-2xl border-2 border-rose-200 text-rose-500 text-sm font-bold tracking-widest uppercase">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── ID Number search panel ───────────────────────────────────────────────
  if (panel === "id") {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(15,10,30,0.72)", backdropFilter: "blur(6px)" }}>
        <div className="w-full max-w-md bg-white rounded-t-[28px] shadow-2xl flex flex-col" style={{ maxHeight: "85vh" }}>
          <div className="flex justify-center pt-3 pb-1"><div className="h-1 w-10 rounded-full bg-slate-200" /></div>
          <div className="px-5 pt-3 pb-4 flex-shrink-0">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={resetAndBack} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 active:opacity-60">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <h3 className="text-[17px] font-bold text-slate-900">ID Number</h3>
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={idInput}
              onChange={e => handleIdInput(e.target.value)}
              placeholder="13-digit SA ID number"
              maxLength={13}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-[15px] text-slate-800 outline-none focus:ring-2 focus:ring-violet-300 font-mono"
              autoFocus
            />
            {idSearching && <p className="text-xs text-slate-400 mt-2 text-center">Searching…</p>}
            {idError && <p className="text-sm text-red-500 mt-2 text-center">{idError}</p>}
          </div>
          {idResult && (
            <div className="mx-4 mb-4 bg-violet-50 border border-violet-200 rounded-2xl px-4 py-4">
              <p className="text-[13px] font-semibold text-slate-800 mb-0.5">
                {maskEmail(idResult.email)}
              </p>
              {idResult.mint_number && <p className="text-[11px] text-slate-400 mb-3">{idResult.mint_number}</p>}
              <button
                onClick={() => handleSendViaFoundUser(idResult)}
                disabled={!!sendingFor}
                className="w-full py-3 rounded-xl bg-[#6B21A8] text-white text-sm font-bold active:opacity-70 disabled:opacity-50"
              >
                {sendingFor ? "Sharing…" : "Share wishlist"}
              </button>
            </div>
          )}
          <div className="px-4 pb-8 mt-auto flex-shrink-0">
            <button onClick={() => setPanel("beneficiary")} className="w-full py-4 rounded-2xl border-2 border-rose-200 text-rose-500 text-sm font-bold tracking-widest uppercase">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Enter details panel ──────────────────────────────────────────────────
  if (panel === "details") {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(15,10,30,0.72)", backdropFilter: "blur(6px)" }}>
        <div className="w-full max-w-md bg-white rounded-t-[28px] shadow-2xl flex flex-col" style={{ maxHeight: "85vh" }}>
          <div className="flex justify-center pt-3 pb-1"><div className="h-1 w-10 rounded-full bg-slate-200" /></div>
          <div className="px-5 pt-3 pb-4 flex-shrink-0">
            <div className="flex items-center gap-3 mb-5">
              <button onClick={resetAndBack} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 active:opacity-60">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <h3 className="text-[17px] font-bold text-slate-900">Enter details</h3>
            </div>
            <div className="space-y-3">
              <input value={detFirst} onChange={e => setDetFirst(e.target.value)} placeholder="First name *"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-[14px] text-slate-800 outline-none focus:ring-2 focus:ring-violet-300" />
              <input value={detLast} onChange={e => setDetLast(e.target.value)} placeholder="Last name"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-[14px] text-slate-800 outline-none focus:ring-2 focus:ring-violet-300" />
              <input value={detEmail} onChange={e => setDetEmail(e.target.value)} placeholder="Email address *" type="email"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-[14px] text-slate-800 outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
          </div>
          <div className="px-4 pb-8 flex-shrink-0 space-y-3">
            <button
              onClick={handleAddDetails}
              disabled={!detFirst.trim() || !detEmail.trim() || !!sendingFor}
              className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white text-sm font-bold active:opacity-70 disabled:opacity-40"
            >
              {sendingFor ? "Sending…" : "Add & Send"}
            </button>
            <button onClick={() => setPanel("beneficiary")} className="w-full py-4 rounded-2xl border-2 border-rose-200 text-rose-500 text-sm font-bold tracking-widest uppercase">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Invite by Email panel ────────────────────────────────────────────────
  if (panel === "email") {
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim());
    const foundUser = emailResult?.found ? emailResult.user : null;
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(15,10,30,0.72)", backdropFilter: "blur(6px)" }}>
        <div className="w-full max-w-md bg-white rounded-t-[28px] shadow-2xl flex flex-col" style={{ maxHeight: "85vh" }}>
          <div className="flex justify-center pt-3 pb-1"><div className="h-1 w-10 rounded-full bg-slate-200" /></div>
          <div className="px-5 pt-3 pb-3 flex-shrink-0">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={resetAndBack} className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 active:opacity-60">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <h3 className="text-[17px] font-bold text-slate-900">Share by Email</h3>
            </div>
            <input
              type="email"
              value={emailInput}
              onChange={e => handleEmailInput(e.target.value)}
              placeholder="Email address"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-[14px] text-slate-800 outline-none focus:ring-2 focus:ring-violet-300"
              autoFocus
            />
            {emailSearching && <p className="text-xs text-slate-400 mt-2 text-center">Looking up…</p>}
            {emailError && <p className="text-sm text-red-500 mt-2 text-center">{emailError}</p>}
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-3">
            {foundUser && !inviteSent && (
              <div className="bg-violet-50 border border-violet-200 rounded-2xl px-4 py-4 mb-3">
                <p className="text-[14px] font-semibold text-slate-800">{foundUser.first_name} {foundUser.last_name}</p>
                <p className="text-[12px] text-slate-400 mb-3">{foundUser.mint_number}</p>
                <button
                  onClick={() => handleSendViaFoundUser(foundUser)}
                  disabled={!!sendingFor}
                  className="w-full py-3 rounded-xl bg-[#6B21A8] text-white text-sm font-bold active:opacity-70 disabled:opacity-50"
                >
                  {sendingFor ? "Sharing…" : `Share with ${foundUser.first_name || "them"}`}
                </button>
              </div>
            )}

            {emailResult?.found === false && !inviteSent && emailValid && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-4 mb-3 space-y-3">
                <p className="text-[12px] text-emerald-600 font-semibold">Not on MINT yet — invite them!</p>
                <input value={inviteFirst} onChange={e => setInviteFirst(e.target.value)} placeholder="First name (optional)"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
                <input value={inviteLast} onChange={e => setInviteLast(e.target.value)} placeholder="Last name (optional)"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
                <button
                  onClick={handleInviteEmail}
                  disabled={inviteSending}
                  className="w-full py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold active:opacity-70 disabled:opacity-50"
                >
                  {inviteSending ? "Sending invite…" : "Send invite"}
                </button>
              </div>
            )}

            {inviteSent && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-4 text-center">
                <p className="text-2xl mb-1">🎉</p>
                <p className="text-[14px] font-semibold text-emerald-700">Invite sent!</p>
                <p className="text-[12px] text-slate-400 mt-1">They'll receive an email with your wishlist link.</p>
              </div>
            )}
          </div>

          <div className="px-4 pb-8 flex-shrink-0">
            <button onClick={() => setPanel("beneficiary")} className="w-full py-4 rounded-2xl border-2 border-rose-200 text-rose-500 text-sm font-bold tracking-widest uppercase">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main share popup ──────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-t-3xl px-6 pt-6 pb-10 shadow-2xl">
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
        <h3 className="text-base font-bold text-gray-800 mb-1">Share your wishlist</h3>
        <p className="text-xs text-gray-400 mb-5">Choose how you'd like to share</p>

        <div className="space-y-3 mb-5">
          {/* Copy link */}
          <button onClick={handleCopy}
            className="w-full flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 active:opacity-70 transition-opacity text-left">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
              {copied
                ? <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                : <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              }
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">{copied ? "Copied!" : "Copy link"}</p>
              <p className="text-xs text-gray-400">Paste anywhere to share</p>
            </div>
          </button>

          {/* Share to MINT client */}
          <button onClick={() => setPanel("beneficiary")}
            className="w-full flex items-center gap-4 bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3.5 active:opacity-70 transition-opacity text-left">
            <div className="w-10 h-10 rounded-xl bg-[#6B21A8] flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#6B21A8]">Share to MINT client</p>
              <p className="text-xs text-purple-400">Send a wishlist notification in-app</p>
            </div>
            <svg className="w-4 h-4 text-purple-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* QR code — always visible */}
        <div className="flex flex-col items-center bg-white border border-gray-200 rounded-2xl py-5 gap-3 mb-5">
          <QRCodeSVG value={url} size={148} bgColor="#ffffff" fgColor="#1a1a2e" level="M" />
          <p className="text-xs text-gray-400">Screenshot to share in person</p>
        </div>

        <button onClick={onClose}
          className="w-full py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium">
          Done
        </button>
      </div>
    </div>
  );
}
