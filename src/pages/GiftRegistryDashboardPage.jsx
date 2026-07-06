import React from "react";
import { useMyRegistries } from "../lib/useGiftRegistry.js";
import {
  getRegistryProgress,
  OCCASION_LABELS,
  REGISTRY_STATUS_META,
} from "../lib/giftRegistryUtils.js";
import GiftRegistryProgressBar from "../components/GiftRegistryProgressBar.jsx";

/**
 * My Registries dashboard — lists all registries owned by the current user.
 * Entry: navigateTo("giftRegistryDashboard")
 */
export default function GiftRegistryDashboardPage({ onNavigate, onBack }) {
  const { registries, loading, error, reload } = useMyRegistries();

  function handleCreate() {
    if (typeof onNavigate === "function") onNavigate("giftRegistryCreate");
  }

  function handleOpen(registry) {
    if (typeof onNavigate === "function") onNavigate("giftRegistryDetail", registry);
  }

  return (
    <div className="min-h-screen bg-[#f8f9fc] pb-24">
      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={onBack} className="p-2 -ml-2 rounded-xl text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-800">My Wishlist</h1>
        </div>
        <p className="text-sm text-gray-400 pl-9">Wishlists you've created for others to fund</p>
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
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">🎁</span>
            </div>
            <h3 className="font-semibold text-gray-700 mb-1">No wishlists yet</h3>
            <p className="text-sm text-gray-400 mb-6">
              Create a wishlist of shares for family and friends to fund.
            </p>
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
              className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-left"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{reg.title}</p>
                  <p className="text-xs text-gray-400">
                    {OCCASION_LABELS[reg.occasion] || reg.occasion}
                    {eventDate ? ` · ${eventDate}` : ""}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${meta.color}`}>
                  {meta.label}
                </span>
              </div>

              <GiftRegistryProgressBar
                percent={progress.percent}
                filledQty={progress.funded}
                targetQty={progress.total}
                height="h-1.5"
              />

              <div className="flex justify-between mt-2">
                <span className="text-[10px] text-gray-400">
                  {reg.items?.length || 0} item{(reg.items?.length || 0) !== 1 ? "s" : ""}
                </span>
                <span className="text-[10px] text-purple-600 font-medium">
                  {progress.percent}% funded
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* FAB */}
      <button
        onClick={handleCreate}
        className="fixed bottom-24 right-5 bg-[#6B21A8] text-white rounded-full px-5 py-3.5 shadow-lg text-sm font-semibold flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
        New wishlist
      </button>
    </div>
  );
}
