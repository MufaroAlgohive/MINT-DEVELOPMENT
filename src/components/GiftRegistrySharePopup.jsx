import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { registryShareUrl } from "../lib/giftRegistryUtils.js";
import { supabase } from "../lib/supabase.js";
import { supabaseReady } from "../lib/supabase.js";

const GRADIENTS = [
  "from-violet-500 to-purple-600",
  "from-emerald-400 to-teal-600",
  "from-sky-400 to-blue-600",
  "from-amber-400 to-orange-500",
  "from-rose-400 to-pink-600",
  "from-fuchsia-500 to-violet-600",
];
function grad(name) {
  return GRADIENTS[(name?.charCodeAt(0) || 0) % GRADIENTS.length];
}

function sentStorageKey(registryId) {
  return `wishlist_notif_${registryId}`;
}
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

async function upsertBeneficiary({ firstName, lastName, email }) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    await supabase.from("Beneficiary").upsert(
      { user_id: session.user.id, first_name: firstName, last_name: lastName,
        email: email.toLowerCase(), used_at: new Date().toISOString() },
      { onConflict: "user_id,email" }
    );
  } catch {}
}

function getBeneficiaryState(email, registryId) {
  const entry = getSentMap(registryId)[email?.toLowerCase()];
  if (!entry) return "none";
  const diffH = (Date.now() - new Date(entry.sentAt).getTime()) / 3_600_000;
  if (diffH < 24) return "sent";
  if (diffH >= 48 && !entry.read) return "nudge";
  return "sent";
}

export default function GiftRegistrySharePopup({ token, title, registryId, onClose, onNavigate }) {
  const url = registryShareUrl(token);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [panel, setPanel] = useState(null);

  const [beneficiaries, setBeneficiaries] = useState([]);
  const [bSearch, setBSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addFirst, setAddFirst] = useState("");
  const [addLast, setAddLast] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [sendingFor, setSendingFor] = useState(null);
  const [sentTick, setSentTick] = useState(0);
  const [sendError, setSendError] = useState(null);

  useEffect(() => {
    if (panel === "beneficiary") loadBeneficiaries().then(setBeneficiaries);
  }, [panel, sentTick]);

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }

  async function sendToMint(b) {
    if (sendingFor) return;
    setSendingFor(b.email);
    setSendError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const tok = session?.data?.session?.access_token;
      const bState = getBeneficiaryState(b.email, registryId);

      const res = await fetch(`/api/gift-registry/${registryId}/notify-beneficiary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ email: b.email, firstName: b.firstName, isNudge: bState === "nudge" }),
      });
      const json = await res.json();

      if (!res.ok) {
        if (json.has_account === false) {
          await fetch("/api/user/invite-beneficiary", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
            body: JSON.stringify({
              email: b.email,
              first_name: b.firstName,
              last_name: b.lastName,
              registry_url: url,
            }),
          });
          const map = getSentMap(registryId);
          map[b.email.toLowerCase()] = { sentAt: new Date().toISOString(), read: false, invite: true };
          writeSentMap(registryId, map);
          await upsertBeneficiary(b);
          setSentTick(t => t + 1);
          return;
        }
        setSendError(json.error || "Could not send notification");
        return;
      }

      const map = getSentMap(registryId);
      map[b.email.toLowerCase()] = { sentAt: new Date().toISOString(), read: false };
      writeSentMap(registryId, map);
      await upsertBeneficiary(b);
      setSentTick(t => t + 1);
    } catch {
      setSendError("Network error. Please try again.");
    } finally {
      setSendingFor(null);
    }
  }

  async function handleAddAndSend() {
    if (!addFirst.trim() || !addEmail.trim()) return;
    const b = { firstName: addFirst.trim(), lastName: addLast.trim(), email: addEmail.trim() };
    await upsertBeneficiary(b);
    setShowAddForm(false);
    setAddFirst(""); setAddLast(""); setAddEmail("");
    await sendToMint(b);
  }

  const filtered = beneficiaries.filter(b => {
    const q = bSearch.toLowerCase();
    return !q || `${b.firstName} ${b.lastName}`.toLowerCase().includes(q) || b.email.toLowerCase().includes(q);
  });

  if (panel === "beneficiary") {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
        <div className="w-full max-w-md bg-white rounded-t-3xl shadow-2xl flex flex-col" style={{ maxHeight: "85vh" }}>
          <div className="px-5 pt-6 pb-3 border-b border-gray-100 shrink-0">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => { setPanel(null); setSendError(null); }}
                className="p-2 -ml-1 rounded-xl text-gray-400 active:opacity-60">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex-1">
                <h3 className="text-base font-bold text-gray-800">Share to Mint client</h3>
                <p className="text-xs text-gray-400">Send a wishlist notification to your contacts</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input value={bSearch} onChange={e => setBSearch(e.target.value)}
                placeholder="Search contacts…"
                className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400" />
            </div>
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-3 space-y-2">
            {sendError && (
              <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2 text-center">{sendError}</p>
            )}

            {filtered.length === 0 && !showAddForm && (
              <p className="text-sm text-gray-400 text-center py-8">
                No saved contacts yet.<br />Add one below to send a notification.
              </p>
            )}

            {filtered.map(b => {
              const bState = getBeneficiaryState(b.email, registryId);
              const isSending = sendingFor === b.email;
              return (
                <div key={b.email} className="flex items-center gap-3 bg-gray-50 rounded-2xl px-4 py-3">
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${grad(b.firstName)} flex items-center justify-center shrink-0`}>
                    <span className="text-white font-bold text-sm">{b.firstName?.[0]?.toUpperCase() || "?"}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{b.firstName} {b.lastName}</p>
                    <p className="text-xs text-gray-400 truncate">{b.email}</p>
                  </div>
                  <button
                    onClick={() => sendToMint(b)}
                    disabled={isSending || bState === "sent"}
                    className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-60 ${
                      bState === "sent"
                        ? "bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default"
                        : bState === "nudge"
                        ? "bg-amber-50 text-amber-700 border border-amber-200 active:opacity-70"
                        : "bg-[#6B21A8] text-white active:opacity-80"
                    }`}
                  >
                    {isSending
                      ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
                      : bState === "sent" ? "Sent ✓"
                      : bState === "nudge" ? "Nudge? 🎁"
                      : "Send"}
                  </button>
                </div>
              );
            })}

            {showAddForm ? (
              <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-bold text-purple-700 uppercase tracking-wide">New contact</p>
                <input value={addFirst} onChange={e => setAddFirst(e.target.value)}
                  placeholder="First name *"
                  className="w-full bg-white border border-purple-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
                <input value={addLast} onChange={e => setAddLast(e.target.value)}
                  placeholder="Last name"
                  className="w-full bg-white border border-purple-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
                <input value={addEmail} onChange={e => setAddEmail(e.target.value)}
                  placeholder="Email address *" type="email"
                  className="w-full bg-white border border-purple-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
                <div className="flex gap-2">
                  <button onClick={() => { setShowAddForm(false); setAddFirst(""); setAddLast(""); setAddEmail(""); }}
                    className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 font-medium">
                    Cancel
                  </button>
                  <button onClick={handleAddAndSend}
                    disabled={!addFirst.trim() || !addEmail.trim()}
                    className="flex-1 py-2.5 rounded-xl bg-[#6B21A8] text-white text-sm font-semibold disabled:opacity-40">
                    Add & Send
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddForm(true)}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add new contact
              </button>
            )}
          </div>

          <div className="px-5 pb-8 pt-3 shrink-0 border-t border-gray-100">
            <button onClick={onClose}
              className="w-full py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium">
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-t-3xl px-6 pt-6 pb-10 shadow-2xl">
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
        <h3 className="text-base font-bold text-gray-800 mb-1">Share your wishlist</h3>
        <p className="text-xs text-gray-400 mb-4">Choose how you'd like to share</p>

        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 mb-5">
          <span className="flex-1 text-xs text-gray-500 truncate">{url}</span>
        </div>

        <div className="space-y-3 mb-4">
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

          <button onClick={() => setPanel("beneficiary")}
            className="w-full flex items-center gap-4 bg-purple-50 border border-purple-200 rounded-2xl px-4 py-3.5 active:opacity-70 transition-opacity text-left">
            <div className="w-10 h-10 rounded-xl bg-[#6B21A8] flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#6B21A8]">Share to Mint client</p>
              <p className="text-xs text-purple-400">Send a wishlist notification in-app</p>
            </div>
            <svg className="w-4 h-4 text-purple-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button onClick={() => setShowQR(q => !q)}
            className="w-full flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 active:opacity-70 transition-opacity text-left">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-800">{showQR ? "Hide QR code" : "Show QR code"}</p>
              <p className="text-xs text-gray-400">Screenshot to share in person</p>
            </div>
          </button>

          {showQR && (
            <div className="flex flex-col items-center bg-white border border-gray-200 rounded-2xl py-6 gap-3">
              <QRCodeSVG value={url} size={160} bgColor="#ffffff" fgColor="#1a1a2e" level="M" />
              <p className="text-xs text-gray-400">Screenshot this to share anywhere</p>
            </div>
          )}
        </div>

        {onNavigate && token && (
          <button
            onClick={() => { onClose(); onNavigate("giftRegistryPublic", { token }); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-xs text-[#6B21A8] font-medium mb-3 active:opacity-70"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Preview as gifter
          </button>
        )}

        <button onClick={onClose}
          className="w-full py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium">
          Done
        </button>
      </div>
    </div>
  );
}
