import React, { useState } from "react";
import { useRegistryDetail } from "../lib/useGiftRegistry.js";
import { supabaseReady } from "../lib/supabase.js";
import {
  OCCASION_LABELS,
  getRegistryProgress,
  centsToRand,
  registryShareUrl,
} from "../lib/giftRegistryUtils.js";
import GiftRegistryProgressBar from "../components/GiftRegistryProgressBar.jsx";
import GiftRegistryShareSheet from "../components/GiftRegistryShareSheet.jsx";

/**
 * Preview a registry before publishing, or view a published one.
 * Entry: navigateTo("giftRegistryPreview", { registryId })
 */
export default function GiftRegistryPreviewPage({ registryId, registry: initialRegistry, onNavigate, onBack }) {
  const { registry: loaded, loading, reload } = useRegistryDetail(registryId);
  const registry = loaded || initialRegistry;

  const [publishing, setPublishing] = useState(false);
  const [pubError, setPubError] = useState(null);
  const [showShare, setShowShare] = useState(false);

  const items = registry?.items || [];
  const progress = getRegistryProgress(items);
  const eventDate = registry?.event_date
    ? new Date(registry.event_date).toLocaleDateString("en-ZA", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      })
    : null;
  const expiryDate = registry?.expiry_at
    ? new Date(registry.expiry_at).toLocaleDateString("en-ZA", {
        day: "numeric", month: "short", year: "numeric",
      })
    : null;

  const isPublished = ["ACTIVE", "PAUSED", "COMPLETED", "EXPIRED"].includes(registry?.status);

  async function handlePublish() {
    setPublishing(true);
    setPubError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch(`/api/gift-registry/${registryId}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not publish");
      reload();
      setShowShare(true);
    } catch (e) {
      setPubError(e.message);
    } finally {
      setPublishing(false);
    }
  }

  if (loading && !registry) {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fc] pb-28">
      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 rounded-xl text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-800">
              {isPublished ? "Wishlist" : "Preview"}
            </h1>
            <p className="text-xs text-gray-400">
              {isPublished ? "Active wishlist" : "Review before publishing"}
            </p>
          </div>
          {isPublished && registry?.share_token && (
            <button
              onClick={() => setShowShare(true)}
              className="ml-auto p-2 rounded-xl bg-purple-50 text-[#6B21A8]"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pt-5 space-y-4">
        {/* Wishlist hero card */}
        <div className="bg-gradient-to-br from-[#6B21A8] to-[#9333EA] rounded-3xl p-5 text-white shadow-lg">
          <p className="text-xs opacity-70 mb-1">{OCCASION_LABELS[registry?.occasion] || registry?.occasion}</p>
          <h2 className="text-xl font-bold mb-1">{registry?.title}</h2>
          {registry?.beneficiary_display_name && (
            <p className="text-sm opacity-80 mb-3">For {registry.beneficiary_display_name}</p>
          )}
          {registry?.message && (
            <p className="text-sm opacity-90 italic mb-3">"{registry.message}"</p>
          )}
          <div className="flex gap-4 text-xs opacity-75">
            {eventDate && <span>📅 {eventDate}</span>}
            {expiryDate && <span>⏳ Closes {expiryDate}</span>}
          </div>

          {/* Overall progress */}
          {isPublished && (
            <div className="mt-4">
              <div className="flex justify-between text-xs mb-1 opacity-80">
                <span>{progress.funded} / {progress.total} shares funded</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-500"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Items list */}
        <div>
          <p className="text-xs text-gray-500 font-medium mb-3">
            {items.length} item{items.length !== 1 ? "s" : ""} on this wishlist
          </p>
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  {item.logo_url ? (
                    <img src={item.logo_url} className="w-9 h-9 rounded-xl border border-gray-100" alt={item.name} />
                  ) : (
                    <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
                      <span className="text-purple-700 font-bold text-sm">{(item.name || item.isin || "?")[0]}</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{item.name || item.isin}</p>
                    <p className="text-xs text-gray-400">
                      {item.target_quantity} share{item.target_quantity !== 1 ? "s" : ""} · ~{centsToRand((item.price_snapshot_cents ?? 0) * item.target_quantity)} total
                    </p>
                  </div>
                </div>
                {isPublished && (
                  <GiftRegistryProgressBar
                    percent={Math.round((item.filled_quantity / item.target_quantity) * 100)}
                    filledQty={item.filled_quantity}
                    targetQty={item.target_quantity}
                    height="h-1.5"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {pubError && (
          <p className="text-sm text-red-600 text-center">{pubError}</p>
        )}
      </div>

      {/* Footer CTA */}
      {!isPublished && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-5 py-4 space-y-2.5 safe-bottom">
          <button
            onClick={handlePublish}
            disabled={publishing || items.length === 0}
            className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white font-semibold text-sm disabled:opacity-40"
          >
            {publishing ? "Publishing…" : "Publish & share 🚀"}
          </button>
          <button
            onClick={onBack}
            className="w-full py-3 rounded-2xl text-sm text-gray-500 font-medium"
          >
            Edit wishlist
          </button>
        </div>
      )}

      {isPublished && registry?.share_token && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-5 py-4 safe-bottom">
          <button
            onClick={() => setShowShare(true)}
            className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white font-semibold text-sm"
          >
            Share wishlist link
          </button>
        </div>
      )}

      {showShare && registry?.share_token && (
        <GiftRegistryShareSheet
          token={registry.share_token}
          title={registry.title}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
