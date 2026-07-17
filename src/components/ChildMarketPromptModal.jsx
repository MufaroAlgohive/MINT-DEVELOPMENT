import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Baby, ChevronRight, ArrowLeft, Star } from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * ChildMarketPromptModal
 *
 * Step 1 — Explains that child wishlists need child strategies + asks "yes / no"
 * Step 2 — Child picker (which child to browse for)
 *
 * Props:
 *   open           boolean
 *   onClose        () => void
 *   onSelectChild  (child) => void   — called with the chosen child; modal closes itself
 *   initialStep    1 | 2            — skip straight to child picker (default 1)
 */
export default function ChildMarketPromptModal({ open, onClose, onSelectChild, initialStep = 1 }) {
  const [step, setStep] = useState(initialStep);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setTimeout(() => { setStep(initialStep); setChildren([]); }, 300);
    }
  }, [open, initialStep]);

  // Fetch children when moving to step 2
  useEffect(() => {
    if (!open || step !== 2 || children.length > 0) return;
    setLoading(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { setLoading(false); return; }
        const { data } = await supabase
          .from("family_members")
          .select("id, first_name, last_name, date_of_birth")
          .eq("primary_user_id", session.user.id)
          .eq("relationship", "child");
        setChildren(data || []);
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, step, children.length]);

  const portalTarget =
    typeof document !== "undefined"
      ? document.getElementById("modal-root") || document.body
      : null;

  if (!portalTarget) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0"
            style={{ zIndex: 99998, background: "rgba(15,10,30,0.68)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-[28px] bg-white shadow-2xl overflow-hidden flex flex-col"
            style={{
              zIndex: 99999,
              maxHeight: "82dvh",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            {/* Accent bar */}
            <div
              className="h-1 w-full flex-shrink-0"
              style={{ background: "linear-gradient(90deg,#8b5cf6,#6366f1,#06b6d4)" }}
            />

            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
              <div className="h-[3px] w-9 rounded-full bg-slate-200" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
              <div className="flex items-center gap-3">
                {step === 2 && (
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-50 flex-shrink-0">
                  <Baby size={20} className="text-violet-600" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900 leading-tight">
                    {step === 1 ? "Browse Child Market?" : "Select a child"}
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {step === 1
                      ? "Strategies made for young investors"
                      : "You will browse as their parent"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-6">
              {step === 1 ? (
                <div className="pt-2 space-y-4">
                  {/* Info card */}
                  <div className="rounded-2xl bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-100 p-4 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <Star size={14} className="text-violet-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-slate-700 leading-relaxed">
                        <span className="font-semibold text-slate-900">Child wishlists require child strategies.</span>{" "}
                        Only baskets marked as child-friendly (like My Growth Fund) can be added to your child's wishlist.
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <Baby size={14} className="text-violet-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-slate-600 leading-relaxed">
                        Browsing the Child Market keeps you logged in as the parent — your account stays active throughout.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white font-semibold text-[14px] transition active:scale-[0.98] shadow-sm"
                  >
                    Yes, show me Child Strategies
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full py-3.5 rounded-2xl border border-slate-200 bg-white text-slate-700 font-semibold text-[14px] transition active:scale-[0.98]"
                  >
                    No, keep browsing
                  </button>
                </div>
              ) : loading ? (
                <div className="flex justify-center py-12">
                  <div className="h-6 w-6 rounded-full border-2 border-violet-200 border-t-violet-600 animate-spin" />
                </div>
              ) : children.length === 0 ? (
                <div className="pt-4 text-center py-10">
                  <div className="w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-3">
                    <Baby size={26} className="text-violet-300" />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">No children linked yet</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Add a child account from the Family section first.
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-5 px-6 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <div className="pt-2 space-y-2">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Your children
                  </p>
                  {children.map((child) => {
                    const initials = [child.first_name?.[0], child.last_name?.[0]]
                      .filter(Boolean)
                      .join("")
                      .toUpperCase() || "?";
                    const age = child.date_of_birth
                      ? new Date().getFullYear() - new Date(child.date_of_birth).getFullYear()
                      : null;
                    return (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => {
                          onSelectChild(child);
                          onClose();
                        }}
                        className="w-full flex items-center gap-3 p-4 rounded-2xl border border-slate-100 bg-white shadow-sm text-left hover:border-violet-200 hover:shadow-md transition active:scale-[0.98]"
                      >
                        <div
                          className="h-12 w-12 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                          style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)" }}
                        >
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900">
                            {[child.first_name, child.last_name].filter(Boolean).join(" ")}
                          </p>
                          {age != null && (
                            <p className="text-xs text-slate-400">{age} years old</p>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    portalTarget
  );
}
