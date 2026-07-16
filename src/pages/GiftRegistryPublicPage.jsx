import React, { useState, useCallback, useEffect } from "react";
import { ChevronLeft, Share2, Calendar, Clock, Users, Gift } from "lucide-react";
import { usePublicRegistry } from "../lib/useGiftRegistry.js";
import { useGiftRegistryRealtime } from "../lib/useGiftRegistryRealtime.js";
import {
  OCCASION_LABELS,
  centsToRand,
} from "../lib/giftRegistryUtils.js";
import GiftRegistryItemCard from "../components/GiftRegistryItemCard.jsx";
import GiftRegistryItemCheckoutSheet from "../components/GiftRegistryItemCheckoutSheet.jsx";
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
  context,
  user,
  isKycComplete,
  isAuthLoading = false,
  onAuthPrompt,
  onBack,
}) {
  const { registry, loading, error, reload } = usePublicRegistry(token);
  const [checkoutItem, setCheckoutItem] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [myGiftedItemIds, setMyGiftedItemIds] = useState(new Set());
  const [shareToast, setShareToast] = useState(false);
  const [activeTab, setActiveTab] = useState("items"); // "items" | "history"

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
  const canGift = !!user && isKycComplete;
  const isOwner = !!(user?.id && registry?.creator_user_id && user.id === registry.creator_user_id);

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
          <div className="flex items-center gap-2">
            {/* Auth buttons — compact, top-right, only when not logged in */}
            {!user && !isClosed && (
              isAuthLoading ? (
                <div className="w-4 h-4 border-2 border-slate-300 border-t-violet-600 rounded-full animate-spin" />
              ) : (
                <>
                  <button
                    onClick={() => onAuthPrompt(undefined, "login")}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg active:opacity-70 bg-white"
                  >
                    Log in
                  </button>
                  <button
                    onClick={() => onAuthPrompt(undefined, "signup")}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg active:opacity-70"
                  >
                    Sign up
                  </button>
                </>
              )
            )}
            <button
              onClick={handleShare}
              className="flex items-center gap-1 text-sm font-semibold text-slate-600 active:opacity-60"
              aria-label="Share wishlist"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {shareToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm rounded-full px-5 py-2.5 shadow-lg">
          Link copied!
        </div>
      )}

      {/* ── Context banner — tells you immediately what you're looking at ── */}
      {context === "gift_received" && (
        <div className="mx-5 mt-4 rounded-2xl bg-[#6B21A8] px-5 py-4 shadow-md">
          <p className="text-[11px] font-bold text-purple-200 uppercase tracking-widest mb-1">🎁 You received a gift</p>
          <p className="text-[15px] font-bold text-white leading-snug">
            Someone gifted you from this wishlist
          </p>
          <p className="text-[13px] text-purple-200 mt-1">
            Scroll down to see the gift history and what was sent to you.
          </p>
        </div>
      )}
      {context === "shared_wishlist" && (
        <div className="mx-5 mt-4 rounded-2xl bg-violet-50 border-2 border-violet-200 px-5 py-4">
          <p className="text-[11px] font-bold text-violet-400 uppercase tracking-widest mb-1">🛍️ You're invited to gift</p>
          <p className="text-[15px] font-bold text-violet-900 leading-snug">
            Browsing {registry?.beneficiary_display_name || "their"}'s wishlist
          </p>
          <p className="text-[13px] text-violet-500 mt-1">
            Browse the items below and gift shares they actually want.
          </p>
        </div>
      )}

      <div className="px-5 pt-5 space-y-3">

        {/* Registry identity card — owner only; non-owners already see who/what
            it's for in the "shared_wishlist" / "gift_received" banner above. */}
        {isOwner && (
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
        )}

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


        {/* Tabs — owner only. Non-owners (people browsing someone else's shared
            wishlist) only ever get the Items view; gift history is private to
            the wishlist owner. */}
        {isOwner && (
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {[
              { key: "items", label: `Items (${items.length})` },
              { key: "history", label: `Gift history${allContributions.length > 0 ? ` (${allContributions.length})` : ""}` },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === tab.key
                    ? "bg-white text-violet-700 shadow-sm"
                    : "text-slate-500"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Items view ── */}
        {(!isOwner || activeTab === "items") && (
          <div className="space-y-4">
            {items.map((item) => (
              <GiftRegistryItemCard
                key={item.id}
                item={item}
                onGift={handleGiftTap}
                isOwner={false}
                canGift={canGift && !isClosed}
                needsKyc={!!user && !isKycComplete}
                onAuthPrompt={onAuthPrompt}
                alreadyGifted={myGiftedItemIds.has(item.id)}
                startDate={eventDate}
                endDate={expiryDate}
              />
            ))}
          </div>
        )}

        {/* ── Gift history tab (owner only) ── */}
        {isOwner && activeTab === "history" && (
          <div>
            {allContributions.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-10 text-center">
                <p className="text-2xl mb-2">🎁</p>
                <p className="text-sm font-semibold text-slate-700">No gifts yet</p>
                <p className="text-xs text-slate-400 mt-1">Be the first to contribute!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {allContributions.map((c) => {
                  const displayName = c.gifter_name || c.gifter_email || "Anonymous";
                  const mintPart = c.gifter_mint_number ? ` · ${c.gifter_mint_number}` : "";
                  const amountCents = c.executed_amount_cents || c.quoted_amount_cents || 0;
                  const itemLabel = items.find((i) => i.id === c.registry_item_id)?.name;
                  const initials = displayName
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  return (
                    <div
                      key={c.id}
                      className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                          <span className="text-violet-700 font-bold text-xs">{initials}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{displayName}</p>
                          {(c.gifter_email || mintPart) && (
                            <p className="text-xs text-slate-400 truncate">
                              {c.gifter_email}{mintPart}
                            </p>
                          )}
                          {itemLabel && (
                            <p className="text-xs text-violet-600 font-medium truncate mt-0.5">{itemLabel}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          {amountCents > 0 && (
                            <p className="text-sm font-bold text-slate-800">{centsToRand(amountCents)}</p>
                          )}
                          <span className="inline-block text-[10px] px-2 py-0.5 rounded-full font-medium mt-1 bg-amber-100 text-amber-700">
                            Gifted
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
