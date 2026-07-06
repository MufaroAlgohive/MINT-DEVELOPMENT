import React, { useState, useCallback } from "react";
import { usePublicRegistry } from "../lib/useGiftRegistry.js";
import { useGiftRegistryRealtime } from "../lib/useGiftRegistryRealtime.js";
import {
  OCCASION_LABELS,
  getRegistryProgress,
  centsToRand,
} from "../lib/giftRegistryUtils.js";
import GiftRegistryItemCard from "../components/GiftRegistryItemCard.jsx";
import GiftRegistryItemCheckoutSheet from "../components/GiftRegistryItemCheckoutSheet.jsx";
import GiftRegistryProgressBar from "../components/GiftRegistryProgressBar.jsx";

/**
 * Public shareable registry page.
 * Decision 1 & 3: anyone can VIEW; only logged-in, KYC-complete users can GIFT.
 * Entry: navigateTo("giftRegistryPublic", { token }) or via /registry/:token deep link
 */
export default function GiftRegistryPublicPage({
  token,
  user,
  isKycComplete,
  onAuthPrompt,
  onBack,
}) {
  const { registry, loading, error, reload } = usePublicRegistry(token);
  const [checkoutItem, setCheckoutItem] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Live realtime updates — progress bars move when someone gifts
  const handleItemUpdate = useCallback(
    (updatedItem) => {
      reload();
    },
    [reload]
  );
  useGiftRegistryRealtime(registry?.id, handleItemUpdate);

  const items = registry?.items || [];
  const progress = getRegistryProgress(items);
  const canGift = !!user && isKycComplete;

  function handleGiftTap(item) {
    setCheckoutItem(item);
    setSuccessMsg(null);
  }

  function handleGiftSuccess(result) {
    setCheckoutItem(null);
    setSuccessMsg("Your gift is on its way! 🎁");
    reload();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !registry) {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex flex-col items-center justify-center px-6 text-center">
        <span className="text-5xl mb-4">🔍</span>
        <h2 className="font-bold text-gray-800 text-lg mb-2">Registry not found</h2>
        <p className="text-sm text-gray-500 mb-6">
          This registry may have been removed or the link has expired.
        </p>
        {onBack && (
          <button onClick={onBack} className="text-sm text-[#6B21A8] font-semibold">
            Go back
          </button>
        )}
      </div>
    );
  }

  const eventDate = registry.event_date
    ? new Date(registry.event_date).toLocaleDateString("en-ZA", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;
  const expiryDate = registry.expiry_at
    ? new Date(registry.expiry_at).toLocaleDateString("en-ZA", {
        day: "numeric", month: "short",
      })
    : null;
  const isClosed = ["EXPIRED", "COMPLETED", "CANCELLED"].includes(registry.status);

  return (
    <div className="min-h-screen bg-[#f8f9fc] pb-24">
      {/* Back nav */}
      {onBack && (
        <div className="absolute top-14 left-4 z-10">
          <button onClick={onBack} className="p-2 bg-white/80 backdrop-blur rounded-xl shadow-sm text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Hero */}
      <div className="bg-gradient-to-br from-[#6B21A8] to-[#9333EA] px-5 pt-20 pb-8 text-white shadow-lg">
        <p className="text-xs opacity-70 mb-1">{OCCASION_LABELS[registry.occasion] || registry.occasion}</p>
        <h1 className="text-2xl font-bold mb-1">{registry.title}</h1>
        <p className="text-sm opacity-80 mb-2">For {registry.beneficiary_display_name}</p>

        {registry.message && (
          <p className="text-sm opacity-90 italic mb-3 bg-white/10 rounded-xl px-3 py-2">
            "{registry.message}"
          </p>
        )}

        <div className="flex gap-4 text-xs opacity-75 mb-4">
          {eventDate && <span>📅 {eventDate}</span>}
          {expiryDate && !isClosed && <span>⏳ Closes {expiryDate}</span>}
        </div>

        {/* Progress */}
        <div className="mt-2">
          <div className="flex justify-between text-xs mb-1.5 opacity-80">
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
      </div>

      {/* Closed banner */}
      {isClosed && (
        <div className="mx-5 mt-4 bg-gray-100 rounded-2xl px-4 py-3 text-center">
          <p className="text-sm text-gray-600 font-medium">
            {registry.status === "COMPLETED" ? "🎉 This registry is fully funded!" : "This registry is no longer accepting gifts."}
          </p>
        </div>
      )}

      {/* Success banner */}
      {successMsg && (
        <div className="mx-5 mt-4 bg-green-50 border border-green-200 rounded-2xl px-4 py-3 text-center">
          <p className="text-sm text-green-700 font-medium">{successMsg}</p>
        </div>
      )}

      {/* Auth prompt for non-users */}
      {!user && !isClosed && (
        <div className="mx-5 mt-4 bg-purple-50 border border-purple-100 rounded-2xl px-4 py-3.5 text-center">
          <p className="text-sm text-[#6B21A8] font-medium">
            Sign up to gift from this registry
          </p>
          <button
            onClick={onAuthPrompt}
            className="mt-2 px-5 py-2 bg-[#6B21A8] text-white text-xs font-semibold rounded-xl"
          >
            Create a free MINT account
          </button>
        </div>
      )}

      {/* KYC incomplete prompt */}
      {user && !isKycComplete && !isClosed && (
        <div className="mx-5 mt-4 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3.5 text-center">
          <p className="text-sm text-amber-700 font-medium">
            Complete your verification to gift
          </p>
          <button
            onClick={() => onAuthPrompt && onAuthPrompt("kyc")}
            className="mt-2 px-5 py-2 bg-amber-600 text-white text-xs font-semibold rounded-xl"
          >
            Finish verification
          </button>
        </div>
      )}

      {/* Items */}
      <div className="px-5 mt-5 space-y-3">
        <p className="text-xs text-gray-500 font-medium">
          {items.length} item{items.length !== 1 ? "s" : ""} on this wishlist
        </p>
        {items.map((item) => (
          <GiftRegistryItemCard
            key={item.id}
            item={item}
            onGift={handleGiftTap}
            isOwner={false}
            canGift={canGift && !isClosed}
            onAuthPrompt={onAuthPrompt}
          />
        ))}
      </div>

      {/* Checkout sheet */}
      {checkoutItem && (
        <GiftRegistryItemCheckoutSheet
          item={checkoutItem}
          registryId={registry.id}
          onSuccess={handleGiftSuccess}
          onClose={() => setCheckoutItem(null)}
        />
      )}
    </div>
  );
}
