import React, { useState } from "react";
import { useRegistryDetail, useRegistryContributions } from "../lib/useGiftRegistry.js";
import { useGiftRegistryRealtime } from "../lib/useGiftRegistryRealtime.js";
import { supabaseReady } from "../lib/supabase.js";
import {
  getRegistryProgress,
  getItemFillPercent,
  OCCASION_LABELS,
  REGISTRY_STATUS_META,
  centsToRand,
} from "../lib/giftRegistryUtils.js";
import GiftRegistryProgressBar from "../components/GiftRegistryProgressBar.jsx";
import GiftRegistryShareSheet from "../components/GiftRegistryShareSheet.jsx";

/**
 * Owner's detailed view of a single registry — per-item progress + contribution list.
 * Entry: navigateTo("giftRegistryDetail", { registryId })
 */
export default function GiftRegistryDetailPage({ registryId, onNavigate, onBack }) {
  const { registry, loading, reload } = useRegistryDetail(registryId);
  const { contributions } = useRegistryContributions(registryId);
  const [showShare, setShowShare] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Live realtime updates — when anyone gifts, progress bars update instantly
  useGiftRegistryRealtime(registryId, (updatedItem) => {
    reload();
  });

  const items = registry?.items || [];
  const progress = getRegistryProgress(items);
  const meta = REGISTRY_STATUS_META[registry?.status] || REGISTRY_STATUS_META.DRAFT;

  async function performAction(action) {
    setActionLoading(true);
    setActionError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch(`/api/gift-registry/${registryId}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Could not ${action} registry`);
      reload();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setActionLoading(false);
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
    <div className="min-h-screen bg-[#f8f9fc] pb-24">
      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 rounded-xl text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-800 truncate">{registry?.title}</h1>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${meta.color}`}>
                {meta.label}
              </span>
              <span className="text-xs text-gray-400">
                {OCCASION_LABELS[registry?.occasion] || registry?.occasion}
              </span>
            </div>
          </div>
          {registry?.share_token && registry?.status === "ACTIVE" && (
            <button
              onClick={() => setShowShare(true)}
              className="p-2 rounded-xl bg-purple-50 text-[#6B21A8]"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pt-5 space-y-5">
        {/* Overall progress */}
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm font-semibold text-gray-700">Overall progress</p>
            <p className="text-sm font-bold text-[#6B21A8]">{progress.percent}%</p>
          </div>
          <GiftRegistryProgressBar
            percent={progress.percent}
            filledQty={progress.funded}
            targetQty={progress.total}
            height="h-2.5"
          />
        </div>

        {/* Registry actions */}
        {(registry?.status === "ACTIVE" || registry?.status === "PAUSED") && (
          <div>
            {actionError && <p className="text-sm text-red-600 mb-2">{actionError}</p>}
            <div className="flex gap-2">
              {registry.status === "ACTIVE" && (
                <button
                  onClick={() => performAction("pause")}
                  disabled={actionLoading}
                  className="flex-1 py-2.5 rounded-2xl border border-gray-200 text-sm text-gray-600 font-medium disabled:opacity-40"
                >
                  Pause
                </button>
              )}
              {registry.status === "PAUSED" && (
                <button
                  onClick={() => performAction("resume")}
                  disabled={actionLoading}
                  className="flex-1 py-2.5 rounded-2xl bg-green-50 border border-green-200 text-sm text-green-700 font-medium disabled:opacity-40"
                >
                  Resume
                </button>
              )}
              <button
                onClick={() => performAction("cancel")}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded-2xl border border-red-200 text-sm text-red-500 font-medium disabled:opacity-40"
              >
                Cancel registry
              </button>
            </div>
          </div>
        )}

        {/* Per-item progress */}
        <div>
          <p className="text-xs text-gray-500 font-medium mb-3">Wishlist items</p>
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex items-center gap-3 mb-2.5">
                  {item.logo_url ? (
                    <img src={item.logo_url} className="w-9 h-9 rounded-xl border border-gray-100" alt={item.name} />
                  ) : (
                    <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
                      <span className="text-purple-700 font-bold text-sm">{(item.name || "?")[0]}</span>
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{item.name || item.isin}</p>
                    <p className="text-xs text-gray-400">
                      {item.filled_quantity} / {item.target_quantity} shares ·{" "}
                      {item.reserved_quantity > 0 && (
                        <span className="text-amber-600">{item.reserved_quantity} reserved</span>
                      )}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#6B21A8]">
                    {getItemFillPercent(item)}%
                  </span>
                </div>
                <GiftRegistryProgressBar
                  percent={getItemFillPercent(item)}
                  showLabel={false}
                  height="h-1.5"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Contributions */}
        {contributions.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 font-medium mb-3">Gifts received ({contributions.length})</p>
            <div className="space-y-2">
              {contributions.map((c) => (
                <div key={c.id} className="bg-white rounded-2xl p-4 flex items-center gap-3 border border-gray-100">
                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                    <span className="text-sm">🎁</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {c.gifter_email}
                    </p>
                    <p className="text-xs text-gray-400">
                      {c.quantity} share{c.quantity !== 1 ? "s" : ""} · {centsToRand(c.executed_amount_cents || c.quoted_amount_cents)}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    c.status === "SETTLED" ? "bg-green-100 text-green-700" :
                    c.status === "FAILED" ? "bg-red-100 text-red-600" :
                    "bg-yellow-100 text-yellow-700"
                  }`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

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
