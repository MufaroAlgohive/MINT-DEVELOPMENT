"use client";
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Plus, X, TrendingUp, TrendingDown, Heart, Users,
  ShieldCheck, Shield, Crown, Baby, UserPlus, Mail, Upload, Check, FileText,
  ChevronDown, Clock, AlertCircle, Trash2, Loader2, Settings, Eye, Pencil, Link as LinkIcon
} from "lucide-react";
import { useProfile } from "../lib/useProfile";
import { supabase } from "../lib/supabase";
import { isAdminPreview } from "../lib/adminPreview";
import ChildResponsibilityAgreement from "../components/ChildResponsibilityAgreement";
import MinorProofOfAddressDeclaration from "../components/MinorProofOfAddressDeclaration";

// ─── helpers ────────────────────────────────────────────────────────────────

function getAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function fmt(cents) {
  const val = (cents || 0) / 100;
  return `R\u202F${val.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── animation variants ──────────────────────────────────────────────────────

function getChildKycState(child) {
  const kycStatus = String(child?.kyc_status || "pending").toLowerCase();
  const certificateStatus = String(child?.certificate_verification_status || "pending_review").toLowerCase();
  const verified = certificateStatus === "verified" || kycStatus === "completed";
  const rejected = kycStatus === "rejected" || certificateStatus === "rejected";

  if (verified) {
    return { label: "Verified", className: "bg-emerald-50 text-emerald-700 border-emerald-200", pulse: false };
  }

  if (rejected) {
    return { label: "KYC Rejected", className: "bg-red-50 text-red-700 border-red-200", pulse: false };
  }

  return { label: "KYC Pending", className: "bg-amber-50 text-amber-700 border-amber-200", pulse: true };
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 340, damping: 28 } },
};

// ─── Design tokens ────────────────────────────────────────────────────────────
const P = "#5B21B6";
const P2 = "#7C3AED";
const P_BG = "#F5F3FF";
const P_CARD = "#EDE9FE";

// Feature flags
const INSURE_ENABLED = import.meta.env.VITE_ENABLE_INSURE === "true";


// ─── Avatar ──────────────────────────────────────────────────────────────────

function Avatar({ name, gradient, size = "h-12 w-12", text = "text-lg" }) {
  const initial = (name || "?")[0].toUpperCase();
  return (
    <div
      className={`${size} rounded-full flex items-center justify-center font-bold text-white flex-shrink-0`}
      style={{ background: gradient }}
    >
      <span className={text}>{initial}</span>
    </div>
  );
}

// ─── Step progress bar ────────────────────────────────────────────────────────
function StepBar({ current, total }) {
  return (
    <div className="flex gap-1.5 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="h-1 flex-1 rounded-full transition-all duration-300"
          style={{ background: i < current ? P : "#E5E7EB" }}
        />
      ))}
    </div>
  );
}

// ─── Input style ──────────────────────────────────────────────────────────────
const INPUT = "w-full rounded-2xl border-0 bg-[#F5F3FF] px-4 py-3.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-200 transition";

// ─── AddMemberModal (bottom-sheet) ───────────────────────────────────────────

const slideVariants = {
  enter: (dir) => ({ x: dir * 200, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir * -200, opacity: 0 }),
};

function AddMemberModal({ type, userId, profile, coGuardians = [], onSave, onClose, onDuplicate }) {
  /* ── Spouse state ── */
  const [spouseMode, setSpouseMode] = useState(null); // null | 'link' | 'invite'
  // Link mode
  const [spouseLinkEmail, setSpouseLinkEmail] = useState("");
  const [spouseLinkId, setSpouseLinkId] = useState("");
  const [spousePending, setSpousePending] = useState(null); // { member_id, masked_email } after code sent
  const [spousePairingCode, setSpousePairingCode] = useState("");
  // Invite mode
  const [spouseFirstName, setSpouseFirstName] = useState("");
  const [spouseLastName, setSpouseLastName] = useState("");
  const [spouseEmail, setSpouseEmail] = useState("");
  // Shared result
  const [spouseResult, setSpouseResult] = useState(null); // null | { linked, kyc_pending, member } | { invited, … }

  /* ── Child state ── */
  const [childForm, setChildForm] = useState({ first_name: "", last_name: "", date_of_birth: "", id_number: "" });
  const [childStep, setChildStep] = useState(0); // 0 = details, 1 = certificate
  const [slideDir, setSlideDir] = useState(1);
  const [certFile, setCertFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [newChildMember, setNewChildMember] = useState(null);
  const [childComplete, setChildComplete] = useState(null); // null | { member }

  /* ── Shared ── */
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isSpouse = type === "spouse";

  /* ── Spouse: send pairing code (link existing Mint member) ── */
  async function handleSpouseLinkSubmit() {
    if (!spouseLinkEmail.trim() || !spouseLinkEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/family-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_user_id: userId,
          relationship: "spouse",
          mode: "link",
          email: spouseLinkEmail.trim(),
          id_number: spouseLinkId.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Could not send pairing request."); return; }
      setSpousePending({
        member_id: json.member_id,
        masked_email: json.masked_email,
        email_sent: json.email_sent !== false, // treat missing as true (legacy)
        fallback_code: json.fallback_code || null,
      });
      // Auto-fill the code input when email wasn't sent so the user can share it manually
      if (json.fallback_code) setSpousePairingCode(json.fallback_code);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /* ── Spouse: confirm pairing code ── */
  async function handleSpouseConfirmCode() {
    const code = spousePairingCode.trim();
    if (!code || code.length < 6) { setError("Please enter the 6-digit code."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/family-members/confirm-pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: spousePending.member_id, code }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Invalid or expired code."); return; }
      setSpouseResult({ linked: true, kyc_pending: json.kyc_pending, member: json.member });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /* ── Spouse: invite (not yet on Mint) ── */
  async function handleSpouseInviteSubmit() {
    if (!spouseEmail.trim() || !spouseEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/family-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_user_id: userId,
          relationship: "spouse",
          mode: "invite",
          first_name: spouseFirstName.trim() || undefined,
          last_name: spouseLastName.trim() || undefined,
          email: spouseEmail.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Could not send invite."); return; }
      setSpouseResult({ invited: true, ...json });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  /* ── SA ID DOB cross-check ── */
  function verifyIdVsDob(idNumber, dob) {
    const clean = String(idNumber || "").replace(/\D/g, "");
    if (clean.length !== 13 || !dob) return { checked: false };
    const yy = clean.substring(0, 2);
    const mm = clean.substring(2, 4);
    const dd = clean.substring(4, 6);
    const yearNum = parseInt(yy, 10);
    const fullYear = yearNum <= new Date().getFullYear() % 100 ? `20${yy}` : `19${yy}`;
    const idDob = `${fullYear}-${mm}-${dd}`;
    const match = idDob === dob;
    return { checked: true, match, idDob };
  }

  /* ── Child: advance to cert step ── */
  function handleChildNext() {
    if (!childForm.first_name.trim()) { setError("First name is required."); return; }
    if (!childForm.date_of_birth) { setError("Date of birth is required."); return; }

    const idClean = childForm.id_number.replace(/\D/g, "");
    if (!idClean || idClean.length !== 13) {
      setError("Child's SA ID number is required and must be exactly 13 digits.");
      return;
    }
    const { checked, match } = verifyIdVsDob(idClean, childForm.date_of_birth);
    if (checked && !match) {
      setError("The date of birth extracted from the ID number does not match the date of birth entered. Please check both fields.");
      return;
    }

    setError("");
    setSlideDir(1);
    setChildStep(1);
  }

  function handleChildBack() {
    setError("");
    setSlideDir(-1);
    if (childStep === 3) {
      setRetryPayload(null);
      setChildStep(2);
    } else {
      setChildStep(0);
    }
  }

  /* ── Child: POA complete → upload signed PDF, then proceed to agreement ── */
  async function handlePoaComplete({ livesWithParent, pdfBuffer, childAddress, signedAt }) {
    if (!newChildMember) return;
    setSaving(true);
    setError("");
    try {
      let poaUrl = null;

      if (pdfBuffer) {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error("Session expired.");

        const uint8 = new Uint8Array(pdfBuffer);
        const CHUNK = 0x8000;
        let binary = "";
        for (let i = 0; i < uint8.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
        }
        const pdfBase64 = btoa(binary);

        const uploadRes = await fetch("/api/onboarding/upload-agreement", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ pdfBase64, subjectId: newChildMember.id }),
        });
        const uploadJson = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          throw new Error(uploadJson?.error || `Proof of address upload failed (${uploadRes.status}).`);
        }
        if (!uploadJson?.publicUrl) {
          throw new Error("Proof of address upload failed: no file URL returned.");
        }
        poaUrl = uploadJson.publicUrl;
      }

      // Build address string to store — child's own address or parent's registered address
      let resolvedAddress = null;
      if (livesWithParent) {
        resolvedAddress = profile?.address || null;
      } else if (childAddress) {
        resolvedAddress = [
          childAddress.line1,
          childAddress.suburb,
          childAddress.city,
          childAddress.province,
          childAddress.postalCode,
        ].filter(Boolean).join(", ");
      }

      const patchBody = {
        lives_with_parent: livesWithParent,
      };
      if (poaUrl) patchBody.poa_declaration_url = poaUrl;
      if (resolvedAddress) patchBody.address = resolvedAddress;

      const patchRes = await fetch(`/api/family-members/${newChildMember.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!patchRes.ok) {
        const patchJson = await patchRes.json().catch(() => ({}));
        throw new Error(patchJson?.error || `Failed to save child address details (${patchRes.status}).`);
      }

      setNewChildMember(prev => ({
        ...prev,
        ...(poaUrl ? { poa_declaration_url: poaUrl } : {}),
        lives_with_parent: livesWithParent,
        ...(resolvedAddress ? { address: resolvedAddress } : {}),
      }));

      setSlideDir(1);
      setChildStep(3);
    } catch (e) {
      console.error("[poa]", e);
      throw new Error(e?.message || "POA upload failed.");
    } finally {
      setSaving(false);
    }
  }

  /* ── Compress image before upload ── */
  async function compressImage(file) {
    const isImage = file.type.startsWith("image/") && !file.name.toLowerCase().endsWith(".heic");
    if (!isImage) return file;
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1600;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round((height / width) * MAX); width = MAX; }
          else { width = Math.round((width / height) * MAX); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob || blob.size >= file.size) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        }, "image/jpeg", 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  /* ── Child: file pick ── */
  function handleCertSelect(e) {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        setError("File must be under 20 MB.");
        return;
      }
      setError("");
      setCertFile(file);
    }
  }

  /* ── Determine certificate verification status ── */
  function getCertVerificationStatus() {
    const idClean = childForm.id_number.replace(/\D/g, "");
    if (idClean.length === 13) {
      const { checked, match } = verifyIdVsDob(idClean, childForm.date_of_birth);
      if (checked && match) return "id_matched_pending_review";
    }
    return "pending_review";
  }

  /* ── Child: upload cert + save ── */
  async function handleChildSubmit() {
    if (!certFile) { setError("Please upload the birth certificate."); return; }
    setSaving(true);
    setUploading(true);
    setError("");
    try {
      // Compress image files before upload
      const fileToUpload = await compressImage(certFile);

      const safeFileName = fileToUpload.name.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
      const filePath = `${userId}/${Date.now()}-${safeFileName}`;

      let certificateUrl = null;
      if (supabase) {
        const { error: uploadError } = await supabase.storage
          .from("birth-certificates")
          .upload(filePath, fileToUpload, { upsert: true });

        if (uploadError) {
          console.warn("[family] Certificate upload failed:", uploadError.message);
          certificateUrl = `pending://${safeFileName}`;
        } else {
          certificateUrl = `storage://birth-certificates/${filePath}`;
        }
      } else {
        certificateUrl = `pending://${safeFileName}`;
      }

      setUploading(false);

      const idClean = childForm.id_number.replace(/\D/g, "");
      const certVerificationStatus = getCertVerificationStatus();

      // POST to API
      const res = await fetch("/api/family-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_user_id: userId,
          relationship: "child",
          first_name: childForm.first_name,
          last_name: childForm.last_name,
          date_of_birth: childForm.date_of_birth,
          id_number: idClean || undefined,
          certificate_url: certificateUrl,
          certificate_verification_status: certVerificationStatus,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === "child_already_added" && typeof onDuplicate === "function") {
          onDuplicate({ message: json.error });
          onClose?.();
          return;
        }
        setError(json.error || "Could not add child.");
        return;
      }

      // Merge form id_number in case API fallback path didn't persist it
      const idCleanFinal = childForm.id_number.replace(/\D/g, "");
      setNewChildMember({
        ...json.member,
        id_number: json.member.id_number || idCleanFinal || undefined,
      });
      setSlideDir(1);
      setChildStep(2);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  async function handleAgreementComplete(payload) {
    const { pdfBuffer, signedAt } = payload;
    if (!newChildMember) return;
    setSaving(true);
    setError("");
    setRetryPayload(payload); // keep for retry on failure

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Session expired.");

      // 1. Upload PDF
      const uint8 = new Uint8Array(pdfBuffer);
      const CHUNK = 0x8000;
      let binary = "";
      for (let i = 0; i < uint8.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
      }
      const pdfBase64 = btoa(binary);

      const uploadRes = await fetch("/api/onboarding/upload-agreement", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pdfBase64, subjectId: newChildMember.id }),
      });
      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok || !uploadJson.publicUrl) {
        throw new Error(uploadJson.error || "Failed to upload agreement.");
      }

      // 2. Patch family member record
      // address_completed:true marks onboarding as finished — ChildDashboardPage
      // reads this (along with the individual fields) to hide the "Complete
      // profile" banner. Without it, every revisit re-prompts to sign.
      const updateRes = await fetch(`/api/family-members/${newChildMember.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signed_agreement_url: uploadJson.publicUrl,
          signed_at: signedAt,
          address_completed: true,
        }),
      });

      if (!updateRes.ok) {
        // Fallback for older API versions or missing endpoint
        console.warn("[family] PATCH failed, trying metadata update via Supabase directly");
        await supabase
          .from("family_members")
          .update({
            signed_agreement_url: uploadJson.publicUrl,
            signed_at: signedAt,
            address_completed: true,
          })
          .eq("id", newChildMember.id);
      }

      const finalMember = {
        ...newChildMember,
        signed_agreement_url: uploadJson.publicUrl,
        signed_at: signedAt,
        address_completed: true,
      };
      setChildComplete({ member: finalMember });
      return true;
    } catch (err) {
      console.error("[agreement]", err);
      setError(err.message || "Finalization failed. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /* ── Retry the agreement upload after a failure ── */
  const [retryPayload, setRetryPayload] = useState(null);
  async function handleAgreementRetry() {
    if (!retryPayload) return;
    await handleAgreementComplete(retryPayload);
  }

  /* ── input classes (shared) ── */
  const inputCls = INPUT;

  /* ── render ── */
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Backdrop */}
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={saving ? undefined : onClose} />

      {/* Sheet */}
      <motion.div
        className="relative w-full max-w-md bg-white rounded-t-[32px] shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3.5 pb-2">
          <div className="h-1 w-9 rounded-full bg-slate-200" />
        </div>

        <div className="px-6 pt-2 pb-10">

          {/* ═══════════════ SPOUSE: selection screen ═══════════════ */}
          {isSpouse && !spouseResult && spouseMode === null && (
            <div className="pt-2 pb-2">
              <button onClick={onClose} className="absolute top-5 right-5 h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition">
                <X className="h-4 w-4" />
              </button>
              <div className="flex flex-col items-center text-center mb-8 mt-4">
                <div className="h-16 w-16 rounded-full flex items-center justify-center mb-5" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>
                  <Heart className="h-7 w-7 text-white" />
                </div>
                <p className="text-[22px] font-bold text-slate-900 leading-tight">Add your partner</p>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed max-w-[260px]">
                  Link or invite your spouse to manage wealth together.
                </p>
              </div>
              <div className="space-y-3">
                <button
                  onClick={() => { setSpouseMode("link"); setError(""); }}
                  className="w-full flex items-center gap-4 rounded-2xl bg-[#F5F3FF] px-5 py-4 text-left transition active:scale-[0.98] hover:bg-[#EDE9FE]"
                >
                  <div className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-white shadow-sm">
                    <ShieldCheck className="h-5 w-5" style={{ color: P }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-bold text-slate-900">Link existing member</p>
                    <p className="text-xs text-slate-500 mt-0.5">Your partner already has a Mint account</p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-400 -rotate-90 flex-shrink-0" />
                </button>
                <button
                  onClick={() => { setSpouseMode("invite"); setError(""); }}
                  className="w-full flex items-center gap-4 rounded-2xl bg-[#F5F3FF] px-5 py-4 text-left transition active:scale-[0.98] hover:bg-[#EDE9FE]"
                >
                  <div className="h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-white shadow-sm">
                    <Mail className="h-5 w-5" style={{ color: P }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-bold text-slate-900">Invite to Mint</p>
                    <p className="text-xs text-slate-500 mt-0.5">Your partner isn't on Mint yet</p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-400 -rotate-90 flex-shrink-0" />
                </button>
              </div>
              <button onClick={onClose} className="w-full mt-5 text-[11px] font-bold tracking-widest uppercase text-slate-400 hover:text-slate-600 py-2 transition">
                Maybe Later
              </button>
            </div>
          )}

          {/* ═══════════════ SPOUSE: back button when in sub-view ═══════════════ */}
          {isSpouse && !spouseResult && spouseMode !== null && (
            <div className="flex items-center gap-3 mb-6">
              {!spousePending && (
                <button onClick={() => { setSpouseMode(null); setError(""); }} className="h-9 w-9 flex items-center justify-center rounded-full bg-[#F5F3FF] text-slate-600 hover:bg-[#EDE9FE] transition active:scale-95">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <div>
                <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: P }}>
                  {spouseMode === "link" ? "Secure Connection" : "Partnership"}
                </p>
                <p className="text-[20px] font-bold text-slate-900 leading-tight">
                  {spouseMode === "link" && !spousePending ? "Link Mint Member" :
                   spouseMode === "link" && spousePending ? "Enter Pairing Code" :
                   "Invite to Mint"}
                </p>
              </div>
              <button onClick={onClose} className="ml-auto h-9 w-9 flex items-center justify-center rounded-full bg-[#F5F3FF] text-slate-400 hover:bg-[#EDE9FE] transition">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── Link mode: step 1 — enter email + ID ── */}
          {isSpouse && !spouseResult && spouseMode === "link" && !spousePending && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 leading-relaxed mb-4">
                We'll send your partner a <strong className="text-slate-800">6-digit pairing code</strong> by email. They share it with you to confirm the link.
              </p>
              <div className="rounded-3xl bg-[#F5F3FF] p-4 space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Partner's Email Address <span className="text-red-400">*</span></p>
                  <input type="email" value={spouseLinkEmail} onChange={(e) => { setSpouseLinkEmail(e.target.value); setError(""); }} placeholder="partner@example.com" autoComplete="off" className={inputCls} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Partner's SA ID Number <span className="normal-case font-normal">(optional)</span></p>
                  <input type="text" inputMode="numeric" maxLength={13} value={spouseLinkId} onChange={(e) => { setSpouseLinkId(e.target.value.replace(/\D/g, "")); setError(""); }} placeholder="13-digit ID number" autoComplete="off" className={inputCls} />
                </div>
              </div>
              {error && <div className="flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3"><X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" /><p className="text-xs text-red-500">{error}</p></div>}
              <button onClick={handleSpouseLinkSubmit} disabled={saving || !spouseLinkEmail.trim()} className="w-full rounded-2xl py-4 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>
                {saving ? "Sending…" : "Send Pairing Code"}
              </button>
            </div>
          )}

          {/* ── Link mode: step 2 — enter code ── */}
          {isSpouse && !spouseResult && spouseMode === "link" && spousePending && (
            <div className="space-y-4">
              {/* Email sent vs fallback warning */}
              {spousePending.email_sent !== false ? (
                <div className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-4">
                  <p className="text-sm font-semibold text-emerald-800 mb-1">Pairing code sent!</p>
                  <p className="text-xs text-emerald-700 leading-relaxed">A 6-digit code was emailed to <strong>{spousePending.masked_email}</strong>. Ask your partner to share the code with you.</p>
                </div>
              ) : (
                <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-4">
                  <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ Email not sent — share the code manually</p>
                  <p className="text-xs text-amber-700 leading-relaxed mb-3">Email delivery is not configured. Share the code below directly with <strong>{spousePending.masked_email}</strong> so they can confirm the link.</p>
                  {spousePending.fallback_code && (
                    <div className="flex items-center justify-center rounded-xl bg-white border border-amber-200 py-3">
                      <p className="text-2xl font-bold tracking-[0.5em] text-amber-800 select-all">{spousePending.fallback_code}</p>
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-3xl bg-[#F5F3FF] p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Enter 6-digit code</p>
                <input type="text" inputMode="numeric" maxLength={6} value={spousePairingCode} onChange={(e) => { setSpousePairingCode(e.target.value.replace(/\D/g, "")); setError(""); }} placeholder="000 000" autoComplete="off" className={`${inputCls} text-center text-2xl tracking-[0.5em] font-bold`} />
              </div>
              {error && <div className="flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3"><X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" /><p className="text-xs text-red-500">{error}</p></div>}
              <button onClick={handleSpouseConfirmCode} disabled={saving || spousePairingCode.length < 6} className="w-full rounded-2xl py-4 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>
                {saving ? "Confirming…" : "Confirm & Link"}
              </button>
              <button onClick={() => { setSpousePending(null); setSpousePairingCode(""); setError(""); }} className="w-full text-[11px] font-bold tracking-widest uppercase text-slate-400 hover:text-slate-600 py-1 transition">
                Didn't receive it? Try a different email
              </button>
            </div>
          )}

          {/* ── Invite mode: form ── */}
          {isSpouse && !spouseResult && spouseMode === "invite" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 leading-relaxed mb-4">Fill in your partner's details and we'll send them an invitation to join Mint.</p>
              <div className="rounded-3xl bg-[#F5F3FF] p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">First Name</p>
                    <input type="text" value={spouseFirstName} onChange={(e) => { setSpouseFirstName(e.target.value); setError(""); }} placeholder="e.g. Sarah" autoComplete="off" className={inputCls} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Surname</p>
                    <input type="text" value={spouseLastName} onChange={(e) => { setSpouseLastName(e.target.value); setError(""); }} placeholder="e.g. Smith" autoComplete="off" className={inputCls} />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Email Address <span className="text-red-400">*</span></p>
                  <input type="email" value={spouseEmail} onChange={(e) => { setSpouseEmail(e.target.value); setError(""); }} placeholder="partner@example.com" autoComplete="off" className={inputCls} />
                </div>
              </div>
              {error && <div className="flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3"><X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" /><p className="text-xs text-red-500">{error}</p></div>}
              <button onClick={handleSpouseInviteSubmit} disabled={saving || !spouseEmail.trim()} className="w-full rounded-2xl py-4 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>
                {saving ? "Sending…" : "Send Invitation"}
              </button>
            </div>
          )}

          {/* ═══════════════ SPOUSE: linked success ═══════════════ */}
          {isSpouse && spouseResult?.linked && !spouseResult?.kyc_pending && (
            <motion.div className="text-center py-6" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 25 }}>
              <div className="h-16 w-16 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>
                <ShieldCheck className="h-8 w-8 text-white" />
              </div>
              <p className="text-xl font-bold text-slate-900">Spouse Linked!</p>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">{[spouseResult.member?.first_name, spouseResult.member?.last_name].filter(Boolean).join(" ")} has been linked to your family account.</p>
              {spouseResult.member?.mint_number && <p className="text-xs text-slate-400 mt-1">Mint # {spouseResult.member.mint_number}</p>}
              <button onClick={() => { onSave(spouseResult.member); }} className="mt-7 w-full rounded-2xl py-4 text-sm font-bold text-white active:scale-[0.98]" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>Done</button>
            </motion.div>
          )}

          {/* ═══════════════ SPOUSE: linked but KYC pending ═══════════════ */}
          {isSpouse && spouseResult?.linked && spouseResult?.kyc_pending && (
            <motion.div className="text-center py-6" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 25 }}>
              <div className="h-16 w-16 rounded-full mx-auto mb-5 flex items-center justify-center bg-amber-100">
                <Clock className="h-8 w-8 text-amber-500" />
              </div>
              <p className="text-xl font-bold text-slate-900">Spouse Added — KYC Pending</p>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">{[spouseResult.member?.first_name, spouseResult.member?.last_name].filter(Boolean).join(" ") || "Your spouse"} has been linked, but identity verification is not yet complete.</p>
              <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 text-left">
                <p className="text-xs text-amber-700 leading-relaxed">Their account will show a <strong>Pending KYC</strong> badge until they complete verification on the Mint app.</p>
              </div>
              <button onClick={() => { onSave({ ...spouseResult.member, kyc_pending: true }); }} className="mt-7 w-full rounded-2xl py-4 text-sm font-bold text-white active:scale-[0.98]" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>Got it</button>
            </motion.div>
          )}

          {/* ═══════════════ SPOUSE: invite sent ═══════════════ */}
          {isSpouse && spouseResult?.invited && (
            <motion.div className="text-center py-6" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 25 }}>
              <div className="h-16 w-16 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>
                <Mail className="h-8 w-8 text-white" />
              </div>
              <p className="text-xl font-bold text-slate-900">Invitation Sent</p>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">{spouseResult.message}</p>
              <button onClick={onClose} className="mt-7 w-full rounded-2xl py-4 text-sm font-bold text-white active:scale-[0.98]" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>Got it</button>
            </motion.div>
          )}

          {/* ═══════════════ CHILD: multi-step ═══════════════ */}
          {!isSpouse && !childComplete && (
            <>
              {/* Header */}
              <div className="flex items-center gap-3 mb-1">
                {childStep >= 1 && childStep <= 2 && !saving && (
                  <button onClick={handleChildBack} className="h-9 w-9 flex items-center justify-center rounded-full bg-[#F5F3FF] text-slate-600 hover:bg-[#EDE9FE] transition active:scale-95">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <div className="flex-1">
                  <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: P }}>
                    Step {childStep + 1} of 4 &mdash; {childStep === 0 ? "Child Details" : childStep === 1 ? "Upload Document" : childStep === 2 ? "Address Declaration" : "Sign Agreement"}
                  </p>
                  <p className="text-[20px] font-bold text-slate-900 leading-tight">
                    {childStep === 0 ? "Add Child" : childStep === 1 ? "Birth Certificate" : childStep === 2 ? "Proof of Address" : "Responsibility Agreement"}
                  </p>
                </div>
                <button onClick={saving ? undefined : onClose} className={`h-9 w-9 flex items-center justify-center rounded-full bg-[#F5F3FF] text-slate-400 hover:bg-[#EDE9FE] transition ${saving ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  <X className="h-4 w-4" />
                </button>
              </div>

              <StepBar current={childStep + 1} total={4} />

              {/* Animated step container */}
              <div className="overflow-hidden">
                <AnimatePresence mode="wait" custom={slideDir} initial={false}>
                  {/* Step 0 — details */}
                  {childStep === 0 && (
                    <motion.div
                      key="child-details"
                      custom={slideDir}
                      variants={slideVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    >
                      <div className="space-y-3">
                        <div className="rounded-3xl bg-[#F5F3FF] p-4 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">First Name <span className="text-red-400">*</span></p>
                              <input type="text" value={childForm.first_name} onChange={(e) => setChildForm(f => ({ ...f, first_name: e.target.value }))} placeholder="e.g. Amara" autoComplete="off" className={inputCls} />
                            </div>
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Last Name</p>
                              <input type="text" value={childForm.last_name} onChange={(e) => setChildForm(f => ({ ...f, last_name: e.target.value }))} placeholder="e.g. Smith" autoComplete="off" className={inputCls} />
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Date of Birth <span className="text-red-400">*</span></p>
                            <input type="date" value={childForm.date_of_birth} onChange={(e) => setChildForm(f => ({ ...f, date_of_birth: e.target.value }))} className={inputCls} />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">SA ID Number <span className="text-red-400">*</span></p>
                            <input type="text" inputMode="numeric" maxLength={13} value={childForm.id_number} onChange={(e) => { const val = e.target.value.replace(/\D/g, ""); setChildForm(f => ({ ...f, id_number: val })); setError(""); }} placeholder="13-digit ID number" autoComplete="off" className={inputCls} />
                            {childForm.id_number.replace(/\D/g,"").length === 13 && childForm.date_of_birth && (() => {
                              const { checked, match } = verifyIdVsDob(childForm.id_number, childForm.date_of_birth);
                              if (!checked) return null;
                              return match ? (
                                <p className="text-[10px] text-emerald-600 mt-1.5 ml-0.5 flex items-center gap-1"><Check className="h-3 w-3" /> ID matches date of birth</p>
                              ) : (
                                <p className="text-[10px] text-amber-600 mt-1.5 ml-0.5 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Date of birth does not match ID</p>
                              );
                            })()}
                          </div>
                        </div>

                        {error && <div className="flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3"><X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" /><p className="text-xs text-red-500">{error}</p></div>}

                        <button onClick={handleChildNext} className="w-full rounded-2xl py-4 text-sm font-bold text-white transition active:scale-[0.98]" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>
                          Next &rarr;
                        </button>
                        <p className="text-center text-[10px] text-slate-400">Your data is encrypted and protected by POPIA.</p>
                      </div>
                    </motion.div>
                  )}

                  {/* Step 1 — certificate upload */}
                  {childStep === 1 && (
                    <motion.div
                      key="child-cert"
                      custom={slideDir}
                      variants={slideVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    >
                      <div className="space-y-4">
                        <p className="text-sm text-slate-500 leading-relaxed">
                          Upload <strong className="text-slate-800">{childForm.first_name || "your child"}'s</strong> unabridged birth certificate to verify their identity.
                        </p>

                        {/* Upload drop-zone */}
                        <label
                          className={`block w-full cursor-pointer rounded-3xl border-2 border-dashed p-8 text-center transition ${
                            certFile
                              ? "border-purple-400 bg-[#F5F3FF]"
                              : "border-slate-200 bg-[#F8F8F8] hover:border-purple-300 hover:bg-[#F5F3FF]"
                          }`}
                        >
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.heic"
                            className="hidden"
                            onChange={handleCertSelect}
                          />
                          {certFile ? (
                            <div className="flex flex-col items-center gap-2">
                              <div className="h-12 w-12 rounded-full flex items-center justify-center mb-1" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>
                                <Check className="h-6 w-6 text-white" />
                              </div>
                              <span className="text-sm font-bold text-slate-800 truncate max-w-[240px]">{certFile.name}</span>
                              <span className="text-[11px] text-slate-400">
                                {certFile.size > 1024 * 1024
                                  ? `${(certFile.size / (1024 * 1024)).toFixed(1)} MB`
                                  : `${Math.round(certFile.size / 1024)} KB`}
                                {certFile.type.startsWith("image/") && " · will be compressed"}
                              </span>
                            </div>
                          ) : (
                            <>
                              <div className="h-14 w-14 rounded-full bg-[#EDE9FE] flex items-center justify-center mx-auto mb-3">
                                <Upload className="h-6 w-6" style={{ color: P }} />
                              </div>
                              <p className="text-[15px] font-bold text-slate-800">Tap to upload</p>
                              <p className="text-[12px] text-slate-400 mt-1">PDF, JPG or PNG · Max 20 MB</p>
                            </>
                          )}
                        </label>

                        {certFile && (
                          <button onClick={() => setCertFile(null)} className="text-xs text-slate-400 hover:text-red-500 transition">
                            Remove file
                          </button>
                        )}

                        {error && <div className="flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3"><X className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" /><p className="text-xs text-red-500">{error}</p></div>}

                        <button
                          onClick={handleChildSubmit}
                          disabled={saving || !certFile}
                          className="w-full rounded-2xl py-4 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
                          style={{ background: certFile ? `linear-gradient(135deg, ${P2}, ${P})` : undefined, backgroundColor: certFile ? undefined : "#E5E7EB" }}
                        >
                          {uploading ? "Uploading document…" : saving ? "Saving…" : certFile ? "Add Child" : "Please upload document to continue"}
                        </button>
                        <div className="flex items-center justify-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5 text-slate-300" />
                          <p className="text-[10px] text-slate-400">Encrypted & POPIA compliant</p>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Step 2 — Proof of Address Declaration */}
                  {childStep === 2 && (
                    <motion.div
                      key="child-poa"
                      custom={slideDir}
                      variants={slideVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    >
                      <MinorProofOfAddressDeclaration
                        childData={newChildMember}
                        parentProfile={profile}
                        coGuardians={coGuardians}
                        saving={saving}
                        onComplete={handlePoaComplete}
                        onBack={handleChildBack}
                      />
                    </motion.div>
                  )}

                  {/* Step 3 — Responsibility Agreement */}
                  {childStep === 3 && (
                    <motion.div
                      key="child-agreement"
                      custom={slideDir}
                      variants={slideVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    >
                      {/* Uploading state — shown while agreement is being saved */}
                      {saving && retryPayload && (
                        <div className="py-12 text-center">
                          <div className="h-14 w-14 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>
                            <Loader2 className="h-7 w-7 text-white animate-spin" />
                          </div>
                          <p className="text-lg font-bold text-slate-900">Setting up account…</p>
                          <p className="text-sm text-slate-500 mt-2 leading-relaxed">Uploading agreement and finalising details.</p>
                        </div>
                      )}

                      {/* Error state — retry without re-signing */}
                      {!saving && error && retryPayload && (
                        <div className="py-8 text-center">
                          <div className="h-14 w-14 rounded-full mx-auto mb-5 flex items-center justify-center bg-red-100">
                            <AlertCircle className="h-7 w-7 text-red-500" />
                          </div>
                          <p className="text-lg font-bold text-slate-900">Upload Failed</p>
                          <p className="text-sm text-red-500 mt-2 leading-relaxed max-w-[260px] mx-auto">{error}</p>
                          <button
                            onClick={handleAgreementRetry}
                            className="mt-6 w-full rounded-2xl py-4 text-sm font-bold text-white transition active:scale-[0.98]"
                            style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}
                          >
                            Retry
                          </button>
                          <button
                            onClick={onClose}
                            className="mt-3 w-full py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 transition"
                          >
                            Close
                          </button>
                        </div>
                      )}

                      {/* Normal agreement UI — first-time signing */}
                      {!retryPayload && (
                        <ChildResponsibilityAgreement
                          parentProfile={profile}
                          childData={newChildMember}
                          saving={saving}
                          onBack={handleChildBack}
                          onComplete={handleAgreementComplete}
                        />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}

          {/* ═══════════════ CHILD: success screen ═══════════════ */}
          {!isSpouse && childComplete && (
            <motion.div
              className="text-center py-6"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            >
              <div className="h-16 w-16 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}>
                <Check className="h-8 w-8 text-white" />
              </div>
              <p className="text-xl font-bold text-slate-900">Account Created!</p>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed max-w-[260px] mx-auto">
                {childComplete.member?.first_name
                  ? `${childComplete.member.first_name}'s`
                  : "Your child's"}{" "}
                investment account has been set up successfully.
              </p>
              {childComplete.member?.mint_number && (
                <p className="text-xs text-slate-400 mt-1">Mint # {childComplete.member.mint_number}</p>
              )}
              <button
                onClick={() => onSave(childComplete.member)}
                className="mt-7 w-full rounded-2xl py-4 text-sm font-bold text-white active:scale-[0.98]"
                style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}
              >
                Continue
              </button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── MemberRow ───────────────────────────────────────────────────────────────

function MemberRow({ gradient, name, role, roleIcon, detail, amount, onClick }) {
  return (
    <motion.div variants={item}>
      <button
        className="w-full flex items-center gap-4 rounded-2xl bg-white px-5 py-4 text-left transition active:scale-[0.99] hover:bg-[#FAFAFF]"
        style={{ boxShadow: "0 1px 8px rgba(91,33,182,0.07)" }}
        onClick={onClick}
      >
        <Avatar name={name} gradient={gradient} size="h-12 w-12" text="text-lg" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-slate-900 leading-tight truncate">{name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-widest uppercase" style={{ background: P_CARD, color: P }}>
              {roleIcon}{role}
            </span>
            {detail && <span className="text-[11px] text-slate-400 truncate">{detail}</span>}
          </div>
        </div>
        <ChevronDown className="h-4 w-4 text-slate-300 -rotate-90 flex-shrink-0" />
      </button>
    </motion.div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FamilyDashboardPage({ onBack, userId, onOpenChildDashboard, onGetInsured }) {
  const { profile } = useProfile();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [portfolioChange, setPortfolioChange] = useState(0);
  const [addingType, setAddingType] = useState(null);
  const [walletBalanceCents, setWalletBalanceCents] = useState(0);
  const [headBalance, setHeadBalance] = useState(0);
  const [memberBalances, setMemberBalances] = useState({});
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [removePassword, setRemovePassword] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [strategyBlock, setStrategyBlock] = useState(null);
  const [childSettingsFor, setChildSettingsFor] = useState(null);
  const [duplicateBanner, setDuplicateBanner] = useState(null);

  async function updateChildPermission(child, field, value) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/family-members/${child.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        console.error("[family] permission update failed:", json.error);
        return;
      }
      // Optimistically update local state
      setMembers(prev => prev.map(m => m.id === child.id ? { ...m, [field]: value } : m));
    } catch (e) {
      console.error("[family] permission update error:", e);
    }
  }

  const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || "My Account";
  const familyLastName = profile?.lastName || "";
  const spouse = members.find(m => m.relationship === "spouse");
  const children = members.filter(m => m.relationship === "child");
  const totalMembers = 1 + members.length;

  useEffect(() => {
    if (userId) { fetchMembers(); }
  }, [userId]);

  async function fetchMembers() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/family-members?user_id=${userId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const json = await res.json();
      const loadedMembers = json.members || [];
      setMembers(loadedMembers);
      fetchPortfolio(loadedMembers);
    } catch (e) { console.error("[family]", e); }
    finally { setLoading(false); }
  }

  async function fetchPortfolio(membersList = members) {
    if (!userId) return;
    const spouseUserIds = membersList.filter(m => m.relationship === "spouse" && m.linked_user_id).map(m => m.linked_user_id);
    const childLinkedUserIds = membersList.filter(m => m.relationship === "child" && m.linked_user_id).map(m => m.linked_user_id);
    const childMemberIds = membersList.filter(m => m.relationship === "child").map(m => m.id);
    const holdingsUserIds = [userId, ...spouseUserIds, ...childLinkedUserIds];
    const walletUserIds = [userId, ...spouseUserIds];
    
    try {
      const [holdingsRes, childHoldingsRes, walletRes, childWalletRes] = await Promise.all([
        supabase.from("stock_holdings_c").select("user_id, family_member_id, security_id, quantity, avg_fill, Expected_fill").in("user_id", holdingsUserIds).is("family_member_id", null).eq("Status", "active"),
        supabase.from("stock_holdings_c").select("family_member_id, security_id, quantity, avg_fill, Expected_fill").in("family_member_id", childMemberIds).eq("Status", "active"),
        supabase.from("wallets").select("user_id, balance").in("user_id", walletUserIds),
        childMemberIds.length
          ? supabase.from("family_members").select("id, available_balance").in("id", childMemberIds)
          : Promise.resolve({ data: [] }),
      ]);

      const holdings = holdingsRes.data || [];
      const childHoldings = childHoldingsRes.data || [];
      const wallets = walletRes.data || [];
      const childWallets = childWalletRes.data || [];
      // family_members.available_balance is stored in cents
      const childBalanceCentsMap = Object.fromEntries(
        childWallets.map(c => [c.id, Number(c.available_balance || 0)])
      );
      const totalChildWalletCents = childWallets.reduce((s, c) => s + Number(c.available_balance || 0), 0);

      // Fetch live prices for all security_ids — prefer intraday current_price (cents), fall back to EOD last_price (rands→cents)
      const securityIds = Array.from(new Set(
        [...holdings, ...childHoldings].map(h => h.security_id).filter(Boolean)
      ));
      const livePriceCentsMap = {};
      if (securityIds.length > 0) {
        const { data: intradayData } = await supabase
          .from("stock_intraday_c")
          .select("security_id, current_price, timestamp")
          .in("security_id", securityIds)
          .order("timestamp", { ascending: false });
        // Use intraday current_price only (already in cents)
        (intradayData || []).forEach(p => {
          if (!livePriceCentsMap[p.security_id] && Number(p.current_price) > 0) {
            livePriceCentsMap[p.security_id] = Number(p.current_price);
          }
        });
      }

      // Cost basis per share in cents: prefers Expected_fill (rands → cents)
      // over avg_fill (already cents) so client PnL ignores the company spread.
      const costBasisCentsPerShare = (h) => {
        const expected = Number(h.Expected_fill || 0);
        if (expected > 0) return Math.round(expected * 100);
        const avg = Number(h.avg_fill || 0);
        return avg > 0 ? avg : 0;
      };
      const marketValueCents = (h) => {
        const qty = Number(h.quantity || 0);
        const livePrice = livePriceCentsMap[h.security_id] ?? costBasisCentsPerShare(h);
        return Math.round(livePrice * qty);
      };
      const pnlCents = (h) => {
        const qty = Number(h.quantity || 0);
        const cost = costBasisCentsPerShare(h);
        const livePrice = livePriceCentsMap[h.security_id] ?? cost;
        return Math.round((livePrice - cost) * qty);
      };

      const totalHoldingsValue = holdings.reduce((s, h) => s + marketValueCents(h), 0)
        + childHoldings.reduce((s, h) => s + marketValueCents(h), 0);
      const totalHoldingsChange = holdings.reduce((s, h) => s + pnlCents(h), 0)
        + childHoldings.reduce((s, h) => s + pnlCents(h), 0);

      // Total wallet (converted to cents)
      const totalWalletRands = wallets.reduce((s, w) => s + (w.balance || 0), 0);

      setPortfolioValue(totalHoldingsValue);
      setPortfolioChange(totalHoldingsChange);

      // Map individual member balances
      const balances = {};

      // Head of family balance
      const mainHoldings = holdings.filter(h => h.user_id === userId);
      const mainWallet = wallets.find(w => w.user_id === userId);
      const headTotal = mainHoldings.reduce((s, h) => s + marketValueCents(h), 0) + Math.round((mainWallet?.balance || 0) * 100);
      setWalletBalanceCents(Math.round((mainWallet?.balance || 0) * 100));
      setHeadBalance(headTotal);

      // Calculate other member balances
      membersList.forEach(m => {
        if (m.relationship === "spouse" && m.linked_user_id) {
          const sHoldings = holdings.filter(h => h.user_id === m.linked_user_id);
          const sWallet = wallets.find(w => w.user_id === m.linked_user_id);
          balances[m.id] = sHoldings.reduce((s, h) => s + marketValueCents(h), 0) + Math.round((sWallet?.balance || 0) * 100);
        } else if (m.relationship === "child") {
          const cHoldings = [
            ...childHoldings.filter(h => h.family_member_id === m.id),
            ...(m.linked_user_id ? holdings.filter(h => h.user_id === m.linked_user_id) : []),
          ];
          balances[m.id] = cHoldings.reduce((s, h) => s + marketValueCents(h), 0);
        }
      });
      setMemberBalances(balances);
    } catch (e) { console.error("[family] portfolio", e); }
  }

  async function verifyCurrentUserPassword(password) {
    if (!password?.trim()) {
      throw new Error("Please enter your password to confirm deletion.");
    }

    const { data: authUserData, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      throw new Error(userErr.message || "Could not verify your account session.");
    }

    const userEmail = authUserData?.user?.email;
    if (!userEmail) {
      throw new Error("Password confirmation is only available for email sign-in accounts.");
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password,
    });

    if (signInErr) {
      throw new Error(signInErr.message || "Incorrect password.");
    }
  }

  async function removeMember(member, password = "") {
    setRemovingId(member.id);
    setRemoveError("");
    try {
      if (member.relationship === "child") {
        await verifyCurrentUserPassword(password);
      }

      const res = await fetch("/api/family-members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: member.id, primary_user_id: userId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        if (json.code === "child_holds_strategy") {
          setStrategyBlock({ name: member.first_name || "This child", message: json.error });
          setConfirmRemove(null);
          setRemovePassword("");
          setRemoveError("");
          return;
        }
        throw new Error(json.error || "Failed to remove member");
      }
      const remaining = members.filter(m => m.id !== member.id);
      setMembers(remaining);
      setConfirmRemove(null);
      setRemovePassword("");
      setRemoveError("");
      // Refresh portfolio so the parent's wallet reflects any refunded child funds
      fetchPortfolio(remaining);
    } catch (e) {
      console.error("[family] remove", e.message);
      setRemoveError(e?.message || "Failed to remove member.");
    } finally {
      setRemovingId(null);
    }
  }

  function handleMemberSaved(member) {
    setMembers(prev => [...prev, member]);
    setAddingType(null);
  }

  const changePct = portfolioValue > 0
    ? ((portfolioChange / Math.max(portfolioValue - portfolioChange, 1)) * 100) : 0;
  const isPositive = portfolioChange >= 0;

  const childAvatarGradients = [
    "linear-gradient(135deg,#7c3aed,#5b21b6)",
    "linear-gradient(135deg,#a855f7,#7c3aed)",
    "linear-gradient(135deg,#8b5cf6,#6366f1)",
    "linear-gradient(135deg,#a78bfa,#7c3aed)",
    "linear-gradient(135deg,#9333ea,#7c3aed)",
  ];

  return (
    <div className="min-h-screen pb-[env(safe-area-inset-bottom)]" style={{ background: P_BG }}>

      {/* ── Header ── */}
      <div className="px-4 pt-12 pb-4">
        <div className="mx-auto w-full max-w-sm md:max-w-md">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-600 transition hover:bg-[#EDE9FE] active:scale-95 flex-shrink-0"
              style={{ boxShadow: "0 1px 6px rgba(91,33,182,0.1)" }}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1">
              <h1 className="text-[22px] font-bold text-slate-900 leading-tight">
                {familyLastName ? `${familyLastName} Family` : "My Family"}
              </h1>
              <p className="text-xs text-slate-500">{totalMembers} member{totalMembers !== 1 ? "s" : ""}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mx-auto w-full max-w-sm px-4 pb-14 md:max-w-md">
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">

          {/* ── Portfolio card ── */}
          <motion.div
            variants={item}
            className="rounded-3xl relative overflow-hidden"
            style={{
              background: `linear-gradient(145deg, ${P} 0%, ${P2} 60%, #9333EA 100%)`,
              boxShadow: "0 20px 40px -10px rgba(91,33,182,0.45)",
            }}
          >
            <div className="pointer-events-none absolute -top-12 -right-12 h-56 w-56 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.08), transparent 70%)" }} />
            <div className="pointer-events-none absolute -bottom-8 -left-8 h-40 w-40 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.05), transparent 70%)" }} />

            <div className="relative px-6 pt-6 pb-6">
              <p className="text-[10px] font-bold tracking-[0.2em] text-white/50 uppercase mb-2">Family Portfolio</p>
              <p className="text-[2.6rem] font-bold text-white tracking-tight leading-none mb-2">{fmt(portfolioValue)}</p>
              <div className="flex items-center gap-2 mb-5">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: isPositive ? "#86efac" : "#fca5a5" }}>
                  {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  {isPositive ? "+" : ""}{fmt(portfolioChange)}
                </span>
                <span className="text-[11px] text-white/40 font-medium">
                  {changePct >= 0 ? "+" : ""}{changePct.toFixed(1)}% all time
                </span>
              </div>
              <div className="h-px w-full mb-4" style={{ background: "rgba(255,255,255,0.12)" }} />
              <div className="flex items-center gap-2">
                {[...Array(Math.min(totalMembers, 5))].map((_, i) => (
                  <div key={i} className="h-6 w-6 rounded-full border-2 border-white/20 bg-white/10" style={{ marginLeft: i > 0 ? -8 : 0 }} />
                ))}
                <p className="text-[11px] text-white/40 ml-2 font-medium">{totalMembers} member{totalMembers !== 1 ? "s" : ""}</p>
              </div>
            </div>
          </motion.div>

          {/* ── Parents section ── */}
          <motion.div variants={item}>
            <div className="flex items-center justify-between mb-2.5 px-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Parents</p>
              <p className="text-[10px] font-bold" style={{ color: P }}>
                {1 + (spouse ? 1 : 0)} of 2
              </p>
            </div>
            <div className="space-y-2">

              {/* Main user row */}
              <MemberRow
                gradient={`linear-gradient(135deg, ${P2}, ${P})`}
                name={displayName}
                role="Head"
                roleIcon={<Crown className="h-2.5 w-2.5 mr-0.5" />}
                detail="Main Account"
                amount={headBalance}
                onClick={() => {}}
              />

              {/* Spouse or add spouse */}
              {spouse ? (
                <motion.div variants={item} className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 8px rgba(91,33,182,0.07)" }}>
                  <div className="flex items-center gap-4 px-5 py-4">
                    <Avatar name={[spouse.first_name, spouse.last_name].filter(Boolean).join(" ")} gradient="linear-gradient(135deg,#a855f7,#7c3aed)" size="h-12 w-12" text="text-lg" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-bold text-slate-900 leading-tight line-clamp-2 break-words">{[spouse.first_name, spouse.last_name].filter(Boolean).join(" ")}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-widest uppercase" style={{ background: P_CARD, color: P }}>
                          <Heart className="h-2.5 w-2.5" />Spouse
                        </span>
                        {spouse.kyc_pending && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-600">
                            <Clock className="h-2.5 w-2.5" />KYC Pending
                          </span>
                        )}
                        {spouse.mint_number && !spouse.kyc_pending && (
                          <span className="text-[11px] text-slate-400">{spouse.mint_number}</span>
                        )}
                      </div>
                    </div>
                    {memberBalances[spouse.id] !== undefined && (
                      <p className="text-[14px] font-bold text-slate-800 tabular-nums flex-shrink-0 mr-1">{fmt(memberBalances[spouse.id])}</p>
                    )}
                    <button
                      onClick={() => {
                        setConfirmRemove(confirmRemove?.id === spouse.id ? null : spouse);
                        setRemovePassword("");
                        setRemoveError("");
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-red-50 hover:text-red-400 transition flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <AnimatePresence>
                    {confirmRemove?.id === spouse.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden border-t border-red-100 bg-red-50">
                        <div className="flex items-center justify-between px-5 py-3 gap-3">
                          <p className="text-[12px] font-semibold text-red-700 flex-1">Remove {spouse.first_name} as spouse?</p>
                          <button onClick={() => { setConfirmRemove(null); setRemovePassword(""); setRemoveError(""); }} className="text-[12px] font-semibold text-slate-500 px-3 py-1.5 rounded-xl hover:bg-white transition">Cancel</button>
                          <button onClick={() => removeMember(spouse)} disabled={removingId === spouse.id} className="text-[12px] font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-xl transition disabled:opacity-60">{removingId === spouse.id ? "Removing…" : "Remove"}</button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { if (!isAdminPreview()) setAddingType("spouse"); }}
                  disabled={isAdminPreview()}
                  className={`w-full flex items-center gap-4 rounded-2xl border-2 border-dashed border-[#DDD6FE] bg-white px-5 py-4 text-left hover:border-purple-400 hover:bg-[#F5F3FF] transition-all group${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
                  style={{ boxShadow: "0 1px 8px rgba(91,33,182,0.05)" }}
                >
                  <div className="h-12 w-12 rounded-full border-2 border-dashed border-[#DDD6FE] group-hover:border-purple-400 flex items-center justify-center flex-shrink-0 transition-all">
                    <UserPlus className="h-5 w-5 text-[#C4B5FD] group-hover:text-purple-500 transition" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[15px] font-bold text-slate-700 group-hover:text-slate-900 transition">Add Spouse Account</p>
                    <p className="text-xs text-slate-400 mt-0.5">Invite your partner to manage wealth together</p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-slate-300 -rotate-90 flex-shrink-0 group-hover:text-purple-400 transition" />
                </motion.button>
              )}
            </div>
          </motion.div>

          {/* ── Children section ── */}
          {children.length > 0 && (
            <motion.div variants={item}>
              <div className="flex items-center justify-between mb-2.5 px-1 mt-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Children</p>
                <p className="text-[10px] font-bold" style={{ color: P }}>{children.length}</p>
              </div>
              <div className="space-y-2">
                {children.map((child, i) => {
                  const age = getAge(child.date_of_birth);
                  const childName = [child.first_name, child.last_name].filter(Boolean).join(" ");
                  const certStatus = child.certificate_verification_status;
                  const certVerified = certStatus === "verified";
                  const certIdMatched = certStatus === "id_matched_pending_review";
                  const certPending = !certVerified && !!child.certificate_url;
                  const childKyc = getChildKycState(child);
                  const isOwner = !child.is_shared;
                  const isSharedReadOnly = child.is_shared && !child.can_manage;
                  return (
                    <motion.div key={child.id} variants={item} className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: "0 1px 8px rgba(91,33,182,0.07)" }}>
                      <div className="flex items-center gap-4 px-5 py-4">
                        <button
                          className="flex items-center gap-4 flex-1 min-w-0 text-left"
                          onClick={() => isSharedReadOnly ? null : onOpenChildDashboard?.(child)}
                        >
                          <Avatar name={childName} gradient={childAvatarGradients[i % childAvatarGradients.length]} size="h-12 w-12" text="text-lg" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[15px] font-bold text-slate-900 leading-tight line-clamp-2 break-words">{childName}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-widest uppercase" style={{ background: P_CARD, color: P }}>
                                <Baby className="h-3 w-3" />Child
                              </span>
                              {child.is_shared && (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-violet-50 text-violet-600 border border-violet-100">
                                  <LinkIcon className="h-2.5 w-2.5" />
                                  {child.can_manage ? "Co-managed" : "Shared"}
                                </span>
                              )}
                              {age !== null && <span className="text-[11px] text-slate-400">{age} yr{age !== 1 ? "s" : ""}</span>}
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide border ${childKyc.className}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${childKyc.pulse ? "animate-pulse" : ""}`} style={{ backgroundColor: "currentColor" }} />
                                {childKyc.label}
                              </span>
                              {certIdMatched && !certVerified && (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-600">
                                  <Clock className="h-2.5 w-2.5" />ID Matched
                                </span>
                              )}
                              {certPending && !certIdMatched && !certVerified && (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-600">
                                  <Clock className="h-2.5 w-2.5" />Cert Pending
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-[14px] font-bold text-slate-800 tabular-nums flex-shrink-0">{fmt(memberBalances[child.id] || 0)}</p>
                        </button>
                        {isOwner && spouse && (
                          <button
                            onClick={() => setChildSettingsFor(child)}
                            title="Permissions"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-violet-50 hover:text-violet-600 transition flex-shrink-0"
                          >
                            <Settings className="h-4 w-4" />
                          </button>
                        )}
                        {isOwner && !isAdminPreview() && (
                          <button onClick={() => {
                            setConfirmRemove(confirmRemove?.id === child.id ? null : child);
                            setRemovePassword("");
                            setRemoveError("");
                          }} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-red-50 hover:text-red-400 transition flex-shrink-0">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <AnimatePresence>
                        {confirmRemove?.id === child.id && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden border-t border-red-100 bg-red-50">
                            <div className="px-5 py-3 space-y-2.5">
                              <p className="text-[12px] font-semibold text-red-700">Remove {child.first_name}'s account?</p>
                              <p className="text-[11px] text-slate-600">Enter your password to confirm this action.</p>
                              <input
                                type="password"
                                value={removePassword}
                                onChange={(e) => { setRemovePassword(e.target.value); setRemoveError(""); }}
                                placeholder="Your password"
                                className="w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-[12px] text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-100"
                              />
                              {removeError && <p className="text-[11px] font-medium text-red-600">{removeError}</p>}
                              <div className="flex items-center justify-end gap-2">
                                <button onClick={() => { setConfirmRemove(null); setRemovePassword(""); setRemoveError(""); }} className="text-[12px] font-semibold text-slate-500 px-3 py-1.5 rounded-xl hover:bg-white transition">Cancel</button>
                                <button onClick={() => removeMember(child, removePassword)} disabled={removingId === child.id || !removePassword.trim()} className="text-[12px] font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-xl transition disabled:opacity-60">{removingId === child.id ? "Removing…" : "Remove"}</button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}

                {/* Add another child */}
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { if (!isAdminPreview()) setAddingType("child"); }}
                  disabled={isAdminPreview()}
                  className={`w-full flex items-center gap-4 rounded-2xl border-2 border-dashed border-[#DDD6FE] bg-white px-5 py-4 text-left hover:border-purple-400 hover:bg-[#F5F3FF] transition-all group${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
                  style={{ boxShadow: "0 1px 8px rgba(91,33,182,0.05)" }}
                >
                  <div className="h-12 w-12 rounded-full border-2 border-dashed border-[#DDD6FE] group-hover:border-purple-400 flex items-center justify-center flex-shrink-0 transition-all">
                    <Plus className="h-5 w-5 text-[#C4B5FD] group-hover:text-purple-500 transition" />
                  </div>
                  <div>
                    <p className="text-[15px] font-bold text-slate-700 group-hover:text-slate-900 transition">Add Child Account</p>
                    <p className="text-xs text-slate-400 mt-0.5">Add another child to your family</p>
                  </div>
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── Empty children state ── */}
          {children.length === 0 && !loading && (
            <motion.div variants={item} className="rounded-3xl bg-white p-8 text-center" style={{ boxShadow: "0 1px 16px rgba(91,33,182,0.08)" }}>
              <div className="h-16 w-16 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl" style={{ background: P_CARD }}>
                😊
              </div>
              <p className="text-[17px] font-bold text-slate-900">No children added yet</p>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed max-w-[220px] mx-auto">Add your children's accounts and manage the whole family from one place.</p>
              <button
                onClick={() => { if (!isAdminPreview()) setAddingType("child"); }}
                disabled={isAdminPreview()}
                className={`mt-6 inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white transition active:scale-[0.98]${isAdminPreview() ? " opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
                style={{ background: `linear-gradient(135deg, ${P2}, ${P})` }}
              >
                <Plus className="h-4 w-4" /> Add Child
              </button>
            </motion.div>
          )}

          {/* ── Get Insured Section ── */}
          {INSURE_ENABLED && (spouse || children.length > 0) && (
            <motion.div
              variants={item}
              className="rounded-3xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 p-6 text-center"
            >
              <div className="h-14 w-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}>
                <Shield className="h-7 w-7 text-white" />
              </div>
              <p className="text-[17px] font-bold text-slate-900">Protect Your Family</p>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed max-w-[260px] mx-auto">
                Get funeral cover for you and your family members from just R{spouse || children.length > 2 ? "192" : "122"}/month.
              </p>
              <button
                onClick={() => onGetInsured?.(members)}
                className="mt-6 inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white transition active:scale-[0.98] shadow-lg hover:shadow-xl"
                style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
              >
                <ShieldCheck className="h-4 w-4" /> Get Insured
              </button>
            </motion.div>
          )}


        </motion.div>
      </div>

      {/* ── Add member modal ── */}
      <AnimatePresence>
        {addingType && (
          <AddMemberModal
            type={addingType}
            userId={userId}
            profile={profile}
            coGuardians={members.filter(m => m.relationship === "spouse")}
            onSave={handleMemberSaved}
            onClose={() => setAddingType(null)}
            onDuplicate={(info) => setDuplicateBanner(info)}
          />
        )}
      </AnimatePresence>

      {/* ── Child permissions modal ── */}
      <AnimatePresence>
        {childSettingsFor && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4"
          >
            <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setChildSettingsFor(null)} />
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl p-6"
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Permissions</p>
                <button onClick={() => setChildSettingsFor(null)} className="h-7 w-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[15px] font-bold text-slate-900 mb-1">
                {[childSettingsFor.first_name, childSettingsFor.last_name].filter(Boolean).join(" ")}
              </p>
              <p className="text-[12px] text-slate-500 mb-5">Control what your spouse can do with this child's account.</p>

              {/* Toggle: view */}
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center bg-violet-100 text-violet-600">
                    <Eye className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-slate-900">Allow spouse to view</p>
                    <p className="text-[11px] text-slate-500">They'll see {childSettingsFor.first_name || "this child"} on their family dashboard.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !childSettingsFor.spouse_can_view;
                    updateChildPermission(childSettingsFor, "spouse_can_view", next);
                    setChildSettingsFor({ ...childSettingsFor, spouse_can_view: next, ...(next ? {} : { spouse_can_manage: false }) });
                    if (!next) updateChildPermission(childSettingsFor, "spouse_can_manage", false);
                  }}
                  className={`relative h-6 w-11 rounded-full transition ${childSettingsFor.spouse_can_view ? "bg-violet-500" : "bg-slate-300"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${childSettingsFor.spouse_can_view ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>

              {/* Toggle: manage */}
              <div className={`flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 ${!childSettingsFor.spouse_can_view ? "opacity-50 pointer-events-none" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center bg-violet-100 text-violet-600">
                    <Pencil className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-slate-900">Allow spouse to manage</p>
                    <p className="text-[11px] text-slate-500">They can edit details and invest on behalf.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !childSettingsFor.spouse_can_manage;
                    updateChildPermission(childSettingsFor, "spouse_can_manage", next);
                    setChildSettingsFor({ ...childSettingsFor, spouse_can_manage: next });
                  }}
                  className={`relative h-6 w-11 rounded-full transition ${childSettingsFor.spouse_can_manage ? "bg-violet-500" : "bg-slate-300"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${childSettingsFor.spouse_can_manage ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Duplicate-child banner ── */}
      <AnimatePresence>
        {duplicateBanner && (
          <motion.div
            initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -60, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 280 }}
            className="fixed top-4 inset-x-4 z-[60] rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 shadow-lg flex items-start gap-3"
          >
            <div className="h-8 w-8 rounded-xl flex items-center justify-center bg-amber-100 text-amber-700 flex-shrink-0">
              <AlertCircle className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-amber-900">Child already added</p>
              <p className="text-[12px] text-amber-700 mt-0.5">{duplicateBanner.message || "This child has already been added by the main guardian."}</p>
            </div>
            <button onClick={() => setDuplicateBanner(null)} className="h-7 w-7 flex items-center justify-center rounded-full text-amber-600 hover:bg-amber-100 transition flex-shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {strategyBlock && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-6"
          >
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setStrategyBlock(null)}
            />
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 10 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="relative z-10 w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
            >
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
                  <AlertCircle className="h-7 w-7 text-amber-500" />
                </div>
                <h3 className="text-[16px] font-bold text-slate-900">Child holds a strategy</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
                  {strategyBlock.message || `${strategyBlock.name} still holds an active strategy. Please sell their investments before removing the account.`}
                </p>
                <button
                  onClick={() => setStrategyBlock(null)}
                  className="mt-5 w-full rounded-2xl bg-slate-900 px-4 py-3 text-[13px] font-bold text-white transition active:scale-[0.98]"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
