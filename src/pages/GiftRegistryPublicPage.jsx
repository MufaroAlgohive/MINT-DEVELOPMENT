import React, { useState, useCallback, useEffect } from "react";
import { ChevronLeft, Share2, Calendar, Clock, Users, Gift } from "lucide-react";
import { usePublicRegistry } from "../lib/useGiftRegistry.js";
import { useGiftRegistryRealtime } from "../lib/useGiftRegistryRealtime.js";
import {
  OCCASION_LABELS,
  getRegistryProgress,
} from "../lib/giftRegistryUtils.js";
import GiftRegistryItemCard from "../components/GiftRegistryItemCard.jsx";
import GiftRegistryItemCheckoutSheet from "../components/GiftRegistryItemCheckoutSheet.jsx";
import GiftRegistryProgressBar from "../components/GiftRegistryProgressBar.jsx";
import { supabaseReady } from "../lib/supabase.js";

const OCCASION_EMOJI = {
  BIRTHDAY: "🎂",
  WEDDING: "💍",
  BABY: "👶",
  GRADUATION: "🎓",
  ANNIVERSARY: "❤️",
  CHRISTMAS: "🎄",
  OTHER: "🎁",
};

/**
 * Public shareable registry page — professional fintech look matching the app.
 * Entry: navigateTo("giftRegistryPublic", { token }) or via /gift/:token deep link
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
    const url = `${window.location.origin}/gift/${token}`;
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
    if (checkoutItem?.id) {
      setMyGiftedItemIds(prev => new Set([...prev, checkoutItem.id]));
    }
    reload();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !registry) {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Gift className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="font-bold text-slate-800 text-lg mb-2">Wishlist not found</h2>
        <p className="text-sm text-slate-500 mb-6">
          This wishlist may have been removed or the link has expired.
        </p>
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-slate-600 font-semibold"
          >
            <ChevronLeft className="w-4 h-4" />
            Go back
          </button>
        )}
      </div>
    );
  }

  const eventDate = registry.event_date
    ? new Date(registry.event_date).toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;
  const expiryDate = registry.expiry_at
    ? new Date(registry.expiry_at).toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "short",
      })
    : null;
  const isClosed = ["EXPIRED", "COMPLETED", "CANCELLED"].includes(registry.status);
  const occasionEmoji = OCCASION_EMOJI[registry.occasion] || "🎁";
  const occasionLabel = OCCASION_LABELS[registry.occasion] || registry.occasion;

  return (
    <div className="min-h-screen bg-[#f8f9fc] pb-24">

      {/* iOS-style navigation header */}
      <div className="sticky top-0 z-20 bg-[#f8f9fc]/95 backdrop-blur border-b border-slate-100">
        <div className="flex items-center justify-between px-4 h-14">
          {onBack ? (
            <button
              onClick={onBack}
              className="flex items-center gap-1 text-slate-600 font-medium text-sm active:opacity-60"
            >
              <ChevronLeft className="w-5 h-5" />
              Back
            </button>
          ) : (
            <div className="w-16" />
          )}
          <span className="text-sm font-semibold text-slate-800">Wishlist</span>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 active:opacity-60"
            aria-label="Share wishlist"
          >
            <Share2 className="w-4 h-4" />
            Share
          </button>
        </div>
      </div>

      {shareToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm rounded-full px-5 py-2.5 shadow-lg">
          Link copied!
        </div>
      )}

      <div className="px-5 pt-5 space-y-3">

        {/* Registry identity card */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl shrink-0">
              {occasionEmoji}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 mb-0.5">
                {occasionLabel}
              </p>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">
                {registry.title}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                For {registry.beneficiary_display_name}
              </p>
            </div>
          </div>

          {registry.message && (
            <p className="mt-4 text-sm text-slate-600 italic bg-slate-50 rounded-xl px-4 py-3 leading-relaxed border-l-2 border-slate-200">
              "{registry.message}"
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            {eventDate && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                {eventDate}
              </div>
            )}
            {expiryDate && !isClosed && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Closes {expiryDate}
              </div>
            )}
            {allContributions.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                {allContributions.length} gifter{allContributions.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>

        {/* Progress card */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
          <div className="flex justify-between items-baseline mb-2">
            <p className="text-xs font-semibold text-slate-600">Funding progress</p>
            <p className="text-xs font-bold text-slate-800">{progress.percent}%</p>
          </div>
          <GiftRegistryProgressBar
            percent={progress.percent}
            filledQty={progress.funded}
            targetQty={progress.total}
            showLabel={false}
            height="h-2"
          />
          <p className="text-[11px] text-slate-400 mt-2">
            {progress.funded} of {progress.total} share{progress.total !== 1 ? "s" : ""} funded
          </p>
        </div>

        {/* Status banners */}
        {isClosed && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 text-center">
            <p className="text-sm text-slate-700 font-medium">
              {registry.status === "COMPLETED"
                ? "🎉 This wishlist is fully funded!"
                : "This wishlist is no longer accepting gifts."}
            </p>
          </div>
        )}

        {successMsg && (
          <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 text-center">
            <p className="text-sm text-green-700 font-medium">{successMsg}</p>
          </div>
        )}

        {!user && !isClosed && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4 text-center">
            <p className="text-sm text-slate-700 font-semibold mb-1">
              Sign up to gift from this wishlist
            </p>
            <p className="text-xs text-slate-400 mb-3">
              Join MINT to contribute shares — the gift that grows.
            </p>
            <button
              onClick={onAuthPrompt}
              className="px-6 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-xl active:opacity-80"
            >
              Create a free MINT account
            </button>
          </div>
        )}

        {user && !isKycComplete && !isClosed && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 text-center">
            <p className="text-sm text-amber-800 font-semibold mb-1">
              Complete your verification to gift
            </p>
            <button
              onClick={() => onAuthPrompt && onAuthPrompt("kyc")}
              className="mt-1 px-5 py-2 bg-amber-600 text-white text-xs font-semibold rounded-xl active:opacity-80"
            >
              Finish verification
            </button>
          </div>
        )}

        {/* Wishlist items */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 mb-3 px-0.5">
            {items.length} item{items.length !== 1 ? "s" : ""} on this wishlist
          </p>
          <div className="space-y-4">
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
        </div>

        {/* Who's gifted section */}
        {allContributions.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 mb-3 px-0.5">
              Who's gifted ({allContributions.length})
            </p>
            <div className="space-y-2">
              {allContributions.map((c) => {
                const displayName = c.gifter_name || c.gifter_email || "Anonymous";
                const subLine =
                  c.gifter_name &&
                  c.gifter_email &&
                  c.gifter_name !== c.gifter_email
                    ? c.gifter_email
                    : null;
                const itemName = items.find((i) => i.id === c.registry_item_id)?.name;
                const initials = c.gifter_name
                  ? c.gifter_name
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()
                  : c.gifter_email?.[0]?.toUpperCase() || "?";
                return (
                  <div
                    key={c.id}
                    className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                      <span className="text-slate-600 font-bold text-xs">{initials}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {displayName}
                      </p>
                      {subLine && (
                        <p className="text-xs text-slate-400 truncate">{subLine}</p>
                      )}
                      <p className="text-xs text-slate-400">
                        {c.quantity} share{c.quantity !== 1 ? "s" : ""}
                        {itemName ? ` of ${itemName}` : ""}
                      </p>
                    </div>
                    <Gift className="w-4 h-4 text-slate-300 shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

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
