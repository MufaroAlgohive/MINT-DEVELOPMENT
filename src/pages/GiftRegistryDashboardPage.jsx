import React from "react";
import { useMyRegistries } from "../lib/useGiftRegistry.js";
import {
  getRegistryProgress,
  OCCASION_LABELS,
  REGISTRY_STATUS_META,
} from "../lib/giftRegistryUtils.js";
import GiftRegistryProgressBar from "../components/GiftRegistryProgressBar.jsx";

export default function GiftRegistryDashboardPage({ onNavigate, onBack }) {
  const { registries, loading, error, reload } = useMyRegistries();

  function handleCreate() {
    if (typeof onNavigate === "function") onNavigate("giftRegistryCreate");
  }

  function handleOpen(registry) {
    if (typeof onNavigate === "function")
      onNavigate("giftRegistryDetail", { registryId: registry.id, registry });
  }

  return (
    <div className="min-h-screen bg-[#f8f9fc] pb-24">
      {/* Header — Markets-page style */}
      <div className="bg-white px-5 pt-14 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 rounded-xl text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-gray-900 leading-tight">My Wishlist</h1>
            <p className="text-xs text-gray-400 mt-0.5">Wishlists you've created for others to fund</p>
          </div>
        </div>
      </div>

      <div className="px-5 pt-5 space-y-3">
        {loading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-32 bg-white rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="bg-red-50 rounded-2xl p-4 text-center">
            <p className="text-sm text-red-600 mb-2">{error}</p>
            <button onClick={reload} className="text-sm text-red-700 font-semibold">Retry</button>
          </div>
        )}

        {!loading && !error && registries.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-20 px-6">
            <div className="w-20 h-20 bg-violet-50 rounded-full flex items-center justify-center mb-5">
              <span className="text-4xl">🎁</span>
            </div>
            <p className="text-[17px] font-bold text-gray-800 mb-1">No wishlists yet</p>
            <p className="text-sm text-gray-400 mb-8 max-w-xs leading-relaxed">
              Create a wishlist of shares for family and friends to fund as a gift.
            </p>
            <button
              onClick={handleCreate}
              className="bg-[#6B21A8] text-white rounded-2xl px-8 py-3.5 text-sm font-semibold shadow-sm active:scale-95 transition-transform"
            >
              + Create a wishlist
            </button>
          </div>
        )}

        {registries.map((reg) => {
          const progress = getRegistryProgress(reg.items || []);
          const meta = REGISTRY_STATUS_META[reg.status] || REGISTRY_STATUS_META.DRAFT;
          const eventDate = reg.event_date
            ? new Date(reg.event_date).toLocaleDateString("en-ZA", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : null;

          return (
            <button
              key={reg.id}
              onClick={() => handleOpen(reg)}
              className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-left active:scale-[0.98] transition-transform"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0 pr-2">
                  <p className="font-semibold text-gray-800 text-sm leading-snug">{reg.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {OCCASION_LABELS[reg.occasion] || reg.occasion}
                    {eventDate ? ` · ${eventDate}` : ""}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${meta.color}`}>
                  {meta.label}
                </span>
              </div>

              <GiftRegistryProgressBar
                percent={progress.percent}
                filledQty={progress.funded}
                targetQty={progress.total}
                height="h-1.5"
              />

              <div className="flex justify-between mt-2.5">
                <span className="text-[11px] text-gray-400">
                  {reg.items?.length || 0} item{(reg.items?.length || 0) !== 1 ? "s" : ""}
                </span>
                <span className="text-[11px] text-purple-600 font-semibold">
                  {progress.percent}% funded
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* FAB — only when registries exist */}
      {registries.length > 0 && (
        <button
          onClick={handleCreate}
          className="fixed bottom-24 right-5 bg-[#6B21A8] text-white rounded-full px-5 py-3.5 shadow-lg text-sm font-semibold flex items-center gap-2 active:scale-95 transition-transform"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          New wishlist
        </button>
      )}
    </div>
  );
}
