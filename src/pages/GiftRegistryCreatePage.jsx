import React, { useState } from "react";
import { OCCASION_LABELS } from "../lib/giftRegistryUtils.js";
import { supabaseReady } from "../lib/supabase.js";

const OCCASIONS = Object.entries(OCCASION_LABELS);

/**
 * Step 1 of registry creation: occasion, beneficiary, dates, message.
 * Entry: navigateTo("giftRegistryCreate")
 * On save → navigateTo("giftRegistryDashboard")
 */
export default function GiftRegistryCreatePage({ onNavigate, onBack, pendingItemKey }) {
  const [step, setStep] = useState(1); // 1 = occasion, 2 = beneficiary, 3 = dates
  const [form, setForm] = useState({
    occasion: "",
    customOccasion: "",
    beneficiaryType: "SELF",
    beneficiaryDisplayName: "",
    title: "",
    eventDate: "",
    expiryAt: "",
    message: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  // Auto-generate title from display name + occasion
  function autoTitle() {
    const name = form.beneficiaryDisplayName.trim();
    if (!name || !form.occasion) return "";
    if (form.occasion === "BIRTHDAY") return `${name}'s Birthday`;
    if (form.occasion === "WEDDING") return `${name}'s Wedding`;
    if (form.occasion === "BABY") return `Baby ${name}`;
    if (form.occasion === "GRADUATION") return `${name}'s Graduation`;
    if (form.occasion === "FESTIVE") return `${name}'s Festive Wishlist`;
    return `${name} – ${form.customOccasion || form.occasion}`;
  }

  // Default expiry = event date + 7 days
  function defaultExpiry(eventDate) {
    if (!eventDate) return "";
    const d = new Date(eventDate);
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch("/api/gift-registry/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          occasion: form.occasion,
          customOccasion: form.customOccasion,
          beneficiaryType: form.beneficiaryType,
          beneficiaryDisplayName: form.beneficiaryDisplayName.trim(),
          title: form.title || autoTitle(),
          eventDate: form.eventDate,
          expiryAt: form.expiryAt,
          message: form.message.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not create wishlist");
      if (typeof onNavigate === "function") {
        onNavigate("giftRegistryDashboard", { registryId: json.registry.id, registry: json.registry, pendingItemKey: pendingItemKey || null });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const canProceedStep1 = !!form.occasion && (form.occasion !== "CUSTOM" || form.customOccasion.trim());
  const canProceedStep2 = form.beneficiaryDisplayName.trim().length >= 2;
  const canProceedStep3 =
    !!form.eventDate &&
    !!form.expiryAt &&
    new Date(form.expiryAt) > new Date(form.eventDate);

  return (
    <div className="min-h-screen bg-[#f8f9fc] pb-24">
      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button
            onClick={step === 1 ? onBack : () => setStep((s) => s - 1)}
            className="p-2 -ml-2 rounded-xl text-gray-500"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-800">Create Wishlist</h1>
            <p className="text-xs text-gray-400">Step {step} of 3</p>
          </div>
        </div>
        {/* Step dots */}
        <div className="flex gap-1.5 mt-3 pl-9">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1 flex-1 rounded-full transition-all ${
                n <= step ? "bg-[#6B21A8]" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="px-5 pt-6 space-y-5">
        {/* Step 1: Occasion */}
        {step === 1 && (
          <>
            <h2 className="text-base font-semibold text-gray-700">What's the occasion?</h2>
            <div className="grid grid-cols-2 gap-3">
              {OCCASIONS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => set("occasion", key)}
                  className={`p-4 rounded-2xl border-2 text-left transition-all ${
                    form.occasion === key
                      ? "border-[#6B21A8] bg-purple-50"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  <span className="text-2xl block mb-1">{label.split(" ").pop()}</span>
                  <span className="text-sm font-medium text-gray-700">
                    {label.replace(/\s[\S]*$/, "")}
                  </span>
                </button>
              ))}
            </div>

            {form.occasion === "CUSTOM" && (
              <input
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                placeholder="Describe the occasion…"
                value={form.customOccasion}
                onChange={(e) => set("customOccasion", e.target.value)}
              />
            )}

            <button
              onClick={() => setStep(2)}
              disabled={!canProceedStep1}
              className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white font-semibold text-sm disabled:opacity-40"
            >
              Continue
            </button>
          </>
        )}

        {/* Step 2: Beneficiary */}
        {step === 2 && (
          <>
            <h2 className="text-base font-semibold text-gray-700">Who is this for?</h2>

            <div className="grid grid-cols-3 gap-2">
              {[
                { k: "SELF", label: "Myself" },
                { k: "CHILD", label: "My child" },
                { k: "OTHER", label: "Someone else" },
              ].map(({ k, label }) => (
                <button
                  key={k}
                  onClick={() => set("beneficiaryType", k)}
                  className={`py-3 rounded-2xl border-2 text-sm font-medium transition-all ${
                    form.beneficiaryType === k
                      ? "border-[#6B21A8] bg-purple-50 text-[#6B21A8]"
                      : "border-gray-200 bg-white text-gray-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">
                {form.beneficiaryType === "SELF" ? "Your first name" : "Their first name"} (shown on the public wishlist)
              </label>
              <input
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                placeholder="e.g. Ncumolwethu"
                value={form.beneficiaryDisplayName}
                onChange={(e) => set("beneficiaryDisplayName", e.target.value)}
              />
              <p className="text-[10px] text-gray-400 mt-1 ml-1">First name only — full name is never shown publicly.</p>
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">Wishlist title (optional)</label>
              <input
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                placeholder={autoTitle() || "e.g. Ncumolwethu's 4th Birthday"}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </div>

            <button
              onClick={() => setStep(3)}
              disabled={!canProceedStep2}
              className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white font-semibold text-sm disabled:opacity-40"
            >
              Continue
            </button>
          </>
        )}

        {/* Step 3: Dates & message */}
        {step === 3 && (
          <>
            <h2 className="text-base font-semibold text-gray-700">Set the dates</h2>

            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">Event date</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                value={form.eventDate}
                onChange={(e) => {
                  set("eventDate", e.target.value);
                  if (!form.expiryAt) set("expiryAt", defaultExpiry(e.target.value));
                }}
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">
                Wishlist closes on
              </label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                value={form.expiryAt}
                min={form.eventDate}
                onChange={(e) => set("expiryAt", e.target.value)}
              />
              <p className="text-[10px] text-gray-400 mt-1 ml-1">Gifters can still complete in-progress payments after this date.</p>
            </div>

            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1.5">Personal message (optional)</label>
              <textarea
                rows={3}
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none"
                placeholder="Add a note for your gifters…"
                value={form.message}
                onChange={(e) => set("message", e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={handleSave}
              disabled={!canProceedStep3 || saving}
              className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white font-semibold text-sm disabled:opacity-40"
            >
              {saving ? "Creating…" : "Create & add shares →"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
