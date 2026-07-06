import React, { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Heart,
  ChevronLeft, ChevronRight, User, Users, UserPlus,
} from "lucide-react";
import { supabaseReady } from "../lib/supabase.js";
import { getWishlists, saveWishlists } from "./WishlistModal.jsx";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const DAY_HEADERS = ["Mo","Tu","We","Th","Fr","Sa","Su"];

function MiniCalendar({ value, onChange, minDate }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const floor = minDate ? new Date(minDate) : today;

  const parsed = value ? new Date(value) : null;
  const [yr, setYr] = useState(parsed ? parsed.getFullYear() : today.getFullYear());
  const [mo, setMo] = useState(parsed ? parsed.getMonth() : today.getMonth());

  const firstDay = new Date(yr, mo, 1);
  const lastDay  = new Date(yr, mo + 1, 0);
  let offset = firstDay.getDay() - 1;
  if (offset < 0) offset = 6;

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(d);

  function prev() {
    if (mo === 0) { setMo(11); setYr(y => y - 1); }
    else setMo(m => m - 1);
  }
  function next() {
    if (mo === 11) { setMo(0); setYr(y => y + 1); }
    else setMo(m => m + 1);
  }
  function canGoPrev() {
    return new Date(yr, mo, 1) > floor;
  }

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={prev}
          disabled={!canGoPrev()}
          className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 disabled:opacity-20 hover:bg-slate-100 transition"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-slate-800">
          {MONTHS[mo]} {yr}
        </span>
        <button
          type="button"
          onClick={next}
          className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map(d => (
          <div key={d} className="text-center text-[10px] font-medium text-slate-400 py-0.5">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const date = new Date(yr, mo, d);
          const isPast     = date < floor;
          const isSelected = value === `${yr}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const isToday    = date.getTime() === today.getTime();

          return (
            <button
              key={d}
              type="button"
              disabled={isPast}
              onClick={() =>
                onChange(`${yr}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`)
              }
              className={[
                "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-all",
                isPast      ? "text-slate-300 cursor-not-allowed"
                : isSelected ? "bg-[#6B21A8] text-white font-semibold shadow-sm"
                : isToday   ? "ring-2 ring-violet-300 text-slate-800 font-medium"
                :              "text-slate-700 hover:bg-violet-50",
              ].join(" ")}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const DURATIONS = [
  { label: "+7 days",  days: 7 },
  { label: "+14 days", days: 14 },
  { label: "+1 month", days: 30 },
  { label: "+2 months",days: 60 },
  { label: "Custom",   days: null },
];

function addDays(isoDate, n) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

export default function GiftRegistryCreateSheet({ open, onClose, onSaved, pendingItemKey, initialTitle, initialStep }) {
  const year = new Date().getFullYear();
  const [step, setStep]   = useState(initialStep || 1);
  const [form, setForm]   = useState({
    title: initialTitle?.trim() || `My Wishlist ${year}`,
    beneficiaryType: "SELF", beneficiaryDisplayName: "",
    eventDate: "", expiryAt: "", closeDuration: null,
    message: "",
  });
  const [showCustomClose, setShowCustomClose] = useState(false);
  const [saving, setSaving]                   = useState(false);
  const [error, setError]                     = useState(null);

  // Re-sync when the sheet is opened fresh with a pre-filled name (e.g. from the
  // wishlist Step-1 form), so it lands directly on the beneficiary step.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setStep(initialStep || 1);
      setForm(f => ({ ...f, title: initialTitle?.trim() || f.title || `My Wishlist ${year}` }));
    }
    prevOpen.current = open;
  }, [open, initialTitle, initialStep, year]);

  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), []);

  function handleDuration(days) {
    set("closeDuration", days);
    if (days !== null && form.eventDate) {
      set("expiryAt", addDays(form.eventDate, days));
      setShowCustomClose(false);
    } else if (days === null) {
      setShowCustomClose(true);
    }
  }

  const canStep1 = form.title.trim().length >= 2;
  const canStep2 = form.beneficiaryDisplayName.trim().length >= 2;
  const canStep3 =
    !!form.eventDate &&
    !!form.expiryAt &&
    new Date(form.expiryAt) > new Date(form.eventDate);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token   = session?.data?.session?.access_token;
      const res     = await fetch("/api/gift-registry/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          occasion:                "CUSTOM",
          customOccasion:          "",
          beneficiaryType:         form.beneficiaryType,
          beneficiaryDisplayName:  form.beneficiaryDisplayName.trim(),
          title:                   form.title.trim(),
          eventDate:               form.eventDate,
          expiryAt:                form.expiryAt,
          message:                 form.message.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not create wishlist");

      // Mirror the new registry into mint_wishlists so the heart-button picker
      // shows it immediately without needing a full cloud re-sync.
      try {
        const trimmed = form.title.trim();
        const lists = getWishlists();
        const registryId = json.registry?.id;
        if (registryId && !lists.find((l) => String(l.id) === String(registryId))) {
          lists.push({ id: registryId, name: trimmed, items: [] });
          await saveWishlists(lists);
        }
      } catch {
        // non-fatal — picker will fall back to cloud sync
      }

      onClose?.();
      onSaved?.(json.registry, form.title.trim());
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (step === 1) onClose?.();
    else setStep(s => s - 1);
  }

  function handleClose() {
    setStep(initialStep || 1);
    setForm({ title: initialTitle?.trim() || `My Wishlist ${year}`, beneficiaryType: "SELF", beneficiaryDisplayName: "", eventDate: "", expiryAt: "", closeDuration: null, message: "" });
    setError(null);
    onClose?.();
  }

  const portalTarget = document.getElementById("modal-root") || document.body;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="registry-sheet-backdrop"
            className="fixed inset-0"
            style={{ zIndex: 9998, background: "rgba(15,10,30,0.65)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
          />

          <motion.div
            key="registry-sheet"
            className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md flex-col rounded-t-[28px] bg-white shadow-2xl overflow-hidden"
            style={{ zIndex: 9999, maxHeight: "92dvh", paddingBottom: "env(safe-area-inset-bottom)" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <div className="h-1 w-full flex-shrink-0" style={{ background: "linear-gradient(90deg,#7c3aed,#6366f1,#8b5cf6)" }} />

            <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
              <div className="h-[3px] w-9 rounded-full bg-slate-200" />
            </div>

            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
              <div>
                <h2 className="text-[15px] font-bold text-slate-900 leading-tight">New Wishlist</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Step {step} of 3</p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-1.5 px-5 pb-3 flex-shrink-0">
              {[1, 2, 3].map(n => (
                <div
                  key={n}
                  className="h-1 flex-1 rounded-full transition-all duration-300"
                  style={{ background: n <= step ? "#6B21A8" : "#e2e8f0" }}
                />
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-6" style={{ WebkitOverflowScrolling: "touch" }}>

              {/* ── Step 1: Name your wishlist ── */}
              {step === 1 && (
                <div className="space-y-4 pt-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 flex-shrink-0">
                      <Heart size={22} className="fill-red-500 text-red-500" />
                    </div>
                    <div>
                      <p className="text-[15px] font-bold text-slate-900 leading-tight">Name your wishlist</p>
                      <p className="text-xs text-slate-400 mt-0.5">You can rename it anytime</p>
                    </div>
                  </div>

                  <input
                    type="text"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-[15px] font-medium text-slate-900 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 transition placeholder:text-slate-400"
                    placeholder={`My Wishlist ${year}`}
                    value={form.title}
                    onChange={e => set("title", e.target.value)}
                    autoFocus
                    onKeyDown={e => e.key === "Enter" && canStep1 && setStep(2)}
                  />

                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    disabled={!canStep1}
                    className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white font-semibold text-sm disabled:opacity-40 transition"
                  >
                    Continue
                  </button>
                </div>
              )}

              {/* ── Step 2: Beneficiary ── */}
              {step === 2 && (
                <div className="space-y-4 pt-1">
                  <p className="text-[13px] font-semibold text-slate-700">Who is this wishlist for?</p>

                  <div className="flex gap-2">
                    {[
                      { k: "SELF",  label: "Myself",       Icon: User },
                      { k: "CHILD", label: "My child",     Icon: Users },
                      { k: "OTHER", label: "Someone else", Icon: UserPlus },
                    ].map(({ k, label, Icon }) => {
                      const active = form.beneficiaryType === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => set("beneficiaryType", k)}
                          className={[
                            "flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 transition-all",
                            active
                              ? "border-[#6B21A8] bg-violet-50"
                              : "border-slate-200 bg-white hover:border-violet-200",
                          ].join(" ")}
                        >
                          <Icon size={16} className={active ? "text-[#6B21A8]" : "text-slate-400"} />
                          <span className={[
                            "text-[11px] font-medium",
                            active ? "text-[#6B21A8]" : "text-slate-600",
                          ].join(" ")}>
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-500 block mb-1.5">
                      {form.beneficiaryType === "SELF" ? "Your first name" : "Their first name"}
                      <span className="text-slate-400 font-normal ml-1">— shown on the public wishlist</span>
                    </label>
                    <input
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent"
                      placeholder="First name only"
                      value={form.beneficiaryDisplayName}
                      onChange={e => set("beneficiaryDisplayName", e.target.value)}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    disabled={!canStep2}
                    className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white font-semibold text-sm disabled:opacity-40 transition"
                  >
                    Continue
                  </button>
                </div>
              )}

              {/* ── Step 3: Dates ── */}
              {step === 3 && (
                <div className="space-y-5 pt-1">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-700 mb-3">When is the occasion?</p>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <MiniCalendar
                        value={form.eventDate}
                        onChange={v => {
                          set("eventDate", v);
                          if (form.closeDuration !== null && form.closeDuration !== undefined) {
                            set("expiryAt", addDays(v, form.closeDuration));
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wide">Wishlist closes</p>
                    <div className="flex flex-wrap gap-2">
                      {DURATIONS.map(({ label, days }) => {
                        const active = days === null
                          ? showCustomClose
                          : form.closeDuration === days;
                        return (
                          <button
                            key={label}
                            type="button"
                            disabled={!form.eventDate && days !== null}
                            onClick={() => handleDuration(days)}
                            className={[
                              "px-3.5 py-2 rounded-xl border text-xs font-medium transition-all disabled:opacity-30",
                              active
                                ? "border-[#6B21A8] bg-violet-50 text-[#6B21A8]"
                                : "border-slate-200 bg-white text-slate-600 hover:border-violet-300",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    {!form.eventDate && (
                      <p className="text-[10px] text-slate-400 mt-1.5">Select an event date first</p>
                    )}

                    {showCustomClose && (
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <MiniCalendar
                          value={form.expiryAt}
                          minDate={form.eventDate || undefined}
                          onChange={v => set("expiryAt", v)}
                        />
                      </div>
                    )}

                    {form.expiryAt && !showCustomClose && (
                      <p className="text-[11px] text-slate-500 mt-2">
                        Closes on{" "}
                        <span className="font-semibold text-slate-700">
                          {new Date(form.expiryAt).toLocaleDateString("en-ZA", {
                            day: "numeric", month: "long", year: "numeric",
                          })}
                        </span>
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-500 block mb-1.5">
                      Note for your guests <span className="font-normal text-slate-400">— optional</span>
                    </label>
                    <textarea
                      rows={2}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-transparent resize-none"
                      placeholder="Add a personal note"
                      value={form.message}
                      onChange={e => set("message", e.target.value)}
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>
                  )}

                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!canStep3 || saving}
                    className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white font-semibold text-sm disabled:opacity-40 transition"
                  >
                    {saving ? "Saving…" : "Save Wishlist"}
                  </button>
                </div>
              )}
            </div>

            <div className="flex-shrink-0 px-5 pt-1 pb-3">
              <button
                type="button"
                onClick={handleBack}
                className="text-[12px] text-slate-400 hover:text-slate-600 transition"
              >
                ← {step === 1 ? "Cancel" : "Back"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    portalTarget,
  );
}
