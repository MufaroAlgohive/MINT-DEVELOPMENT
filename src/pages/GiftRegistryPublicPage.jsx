import React, { useState, useCallback, useEffect } from "react";
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
import { supabaseReady } from "../lib/supabase.js";

function GifterAvatar({ name, email }) {
  const initials = name
    ? name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()
    : email
    ? email[0].toUpperCase()
    : "?";
  return (
    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
      <span className="text-white font-bold text-xs">{initials}</span>
    </div>
  );
}

/**
 * Public shareable registry page.
 * Decision 1 & 3: anyone can VIEW; only logged-in, KYC-complete users can GIFT.
 * Privacy note (confirmed by owner 2026-07-06): shows gifter full name + email publicly.
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
  const [myGiftedItemIds, setMyGiftedItemIds] = useState(new Set());
  const [shareToast, setShareToast] = useState(false);

  const handleItemUpdate = useCallback(() => reload(), [reload]);
  useGiftRegistryRealtime(registry?.id, handleItemUpdate);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const sb = await supabaseReady;
        const { data: { session } } = await sb.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const res = await fetch(`/api/gift-registry/public/${token}/my-contributions`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setMyGiftedItemIds(new Set(json.itemIds || []));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [token, user]);

  async function handleShare() {
    const url = `${window.location.origin}/registry/${token}`;
    const title = registry?.title || "MINT Wishlist";
    const text = `Check out "${title}" on MINT — gift the shares they actually want!`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2500);
      }
    } catch {}
  }

  const items = registry?.items || [];
  const allContributions = registry?.all_contributions || [];
  const progress = getRegistryProgress(items);
  const canGift = !!user && isKycComplete;

  function handleGiftTap(item) {
    setCheckoutItem(item);
    setSuccessMsg(null);
  }

  function handleGiftSuccess() {
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
        <h2 className="font-bold text-gray-800 text-lg mb-2">Wishlist not found</h2>
        <p className="text-sm text-gray-500 mb-6">
          This wishlist may have been removed or the link has expired.
        </p>
        {onBack && (
          <button onClick={onBack} className="text-sm text-[#6B21A8] font-semibold">Go back</button>
        )}
      </div>
    );
  }

  const eventDate = registry.event_date
    ? new Date(registry.event_date).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const expiryDate = registry.expiry_at
    ? new Date(registry.expiry_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
    : null;
  const isClosed = ["EXPIRED", "COMPLETED", "CANCELLED"].includes(registry.status);

  return (
    <div className="min-h-screen bg-[#f8f9fc] pb-24">
      {/* Back nav + share button */}
      <div className="absolute top-14 left-4 right-4 z-10 flex items-center justify-between">
        {onBack ? (
          <button onClick={onBack} className="p-2 bg-white/80 backdrop-blur rounded-xl shadow-sm text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : <div />}
        <button
          onClick={handleShare}
          className="p-2 bg-white/80 backdrop-blur rounded-xl shadow-sm text-[#6B21A8] flex items-center gap-1.5 px-3"
          aria-label="Share wishlist"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span className="text-xs font-semibold">Share</span>
        </button>
      </div>

      {shareToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm rounded-full px-5 py-2.5 shadow-lg">
          Link copied!
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

        {/* Gifters roll — avatars of people who've already gifted */}
        {allContributions.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <div className="flex -space-x-2">
              {allContributions.slice(0, 5).map((c, i) => (
                <GifterAvatar key={c.id || i} name={c.gifter_name} email={c.gifter_email} />
              ))}
            </div>
            <p className="text-xs text-white/70">
              {allContributions.length === 1
                ? "1 person has gifted"
                : `${allContributions.length} people have gifted`}
            </p>
          </div>
        )}
      </div>

      {/* Closed banner */}
      {isClosed && (
        <div className="mx-5 mt-4 bg-gray-100 rounded-2xl px-4 py-3 text-center">
          <p className="text-sm text-gray-600 font-medium">
            {registry.status === "COMPLETED"
              ? "🎉 This wishlist is fully funded!"
              : "This wishlist is no longer accepting gifts."}
          </p>
        </div>
      )}

      {/* Success banner */}
      {successMsg && (
        <div className="mx-5 mt-4 bg-green-50 border border-green-200 rounded-2xl px-4 py-3 text-center">
          <p className="text-sm text-green-700 font-medium">{successMsg}</p>
        </div>
      )}

      {/* Auth / KYC prompts */}
      {!user && !isClosed && (
        <div className="mx-5 mt-4 bg-purple-50 border border-purple-100 rounded-2xl px-4 py-3.5 text-center">
          <p className="text-sm text-[#6B21A8] font-medium">Sign up to gift from this wishlist</p>
          <button
            onClick={onAuthPrompt}
            className="mt-2 px-5 py-2 bg-[#6B21A8] text-white text-xs font-semibold rounded-xl"
          >
            Create a free MINT account
          </button>
        </div>
      )}
      {user && !isKycComplete && !isClosed && (
        <div className="mx-5 mt-4 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3.5 text-center">
          <p className="text-sm text-amber-700 font-medium">Complete your verification to gift</p>
          <button
            onClick={() => onAuthPrompt && onAuthPrompt("kyc")}
            className="mt-2 px-5 py-2 bg-amber-600 text-white text-xs font-semibold rounded-xl"
          >
            Finish verification
          </button>
        </div>
      )}

      {/* Wishlist items */}
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
            alreadyGifted={myGiftedItemIds.has(item.id)}
          />
        ))}
      </div>

      {/* Who's gifted section */}
      {allContributions.length > 0 && (
        <div className="px-5 mt-6">
          <p className="text-xs text-gray-500 font-medium mb-3">
            Who's gifted ({allContributions.length})
          </p>
          <div className="space-y-2">
            {allContributions.map((c) => {
              const displayName = c.gifter_name || c.gifter_email || "Anonymous";
              const subLine = c.gifter_name && c.gifter_email && c.gifter_name !== c.gifter_email
                ? c.gifter_email
                : null;
              const itemName = items.find(i => i.id === c.registry_item_id)?.name;
              return (
                <div key={c.id} className="bg-white rounded-2xl p-3.5 flex items-center gap-3 border border-gray-100">
                  <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                    <span className="text-violet-700 font-bold text-xs">
                      {c.gifter_name
                        ? c.gifter_name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()
                        : c.gifter_email?.[0]?.toUpperCase() || "?"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{displayName}</p>
                    {subLine && <p className="text-xs text-gray-400 truncate">{subLine}</p>}
                    <p className="text-xs text-gray-400">
                      {c.quantity} share{c.quantity !== 1 ? "s" : ""}
                      {itemName ? ` of ${itemName}` : ""}
                    </p>
                  </div>
                  <span className="text-lg">🎁</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
