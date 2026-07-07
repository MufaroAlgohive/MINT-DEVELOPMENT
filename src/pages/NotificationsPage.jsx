import React, { useState, useRef, useEffect } from "react";
import { ChevronLeft, Settings, Mailbox, CheckCheck, Trash2 } from "lucide-react";
import { useNotificationsContext, groupNotificationsByDate } from "../lib/NotificationsContext";
import NotificationsSkeleton from "../components/NotificationsSkeleton";

/* ── colour palette per notification type ───────────────────────────────── */
const getAccent = (notification) => {
  const action = notification.payload?.action;
  const isGiftReceived = action === "OPEN_GIFT_REGISTRY" && !!notification.payload?.gifter_user_id;
  const isSharedWishlist = action === "OPEN_GIFT_REGISTRY" && !notification.payload?.gifter_user_id;

  if (isGiftReceived) return {
    avatarBg:   "bg-gradient-to-br from-amber-400 to-orange-500",
    avatarText: "text-white",
    border:     "border-l-amber-400",
    dot:        "bg-amber-400",
    bubble:     "border-l-4 border-amber-200 bg-amber-50",
    ctaGrad:    "from-amber-500 to-orange-600",
    headerBar:  "from-amber-400/20 to-transparent",
    label:      "text-amber-600",
  };
  if (isSharedWishlist) return {
    avatarBg:   "bg-gradient-to-br from-violet-500 to-purple-700",
    avatarText: "text-white",
    border:     "border-l-violet-400",
    dot:        "bg-violet-500",
    bubble:     "border-l-4 border-violet-200 bg-violet-50",
    ctaGrad:    "from-violet-600 to-purple-800",
    headerBar:  "from-violet-400/20 to-transparent",
    label:      "text-violet-600",
  };
  return {
    avatarBg:   "bg-gradient-to-br from-slate-600 to-slate-800",
    avatarText: "text-white",
    border:     "border-l-slate-400",
    dot:        "bg-slate-500",
    bubble:     "border-l-4 border-slate-200 bg-slate-50",
    ctaGrad:    "from-slate-700 to-slate-900",
    headerBar:  "from-slate-400/10 to-transparent",
    label:      "text-slate-500",
  };
};

/* ── helpers ────────────────────────────────────────────────────────────── */
const formatTime = (d) =>
  new Date(d).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });

const formatBubbleDate = (d) => {
  const date = new Date(d);
  const now  = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString())  return `Today at ${formatTime(d)}`;
  if (date.toDateString() === yest.toDateString()) return `Yesterday at ${formatTime(d)}`;
  return date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const formatListDate = (d) => {
  const date = new Date(d);
  const now  = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(d);
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
};

const getSender = (n) => {
  const t = n.title || "";
  if (n.payload?.action === "OPEN_GIFT_REGISTRY") {
    const m = t.match(/^(.+?) gifted you/) || t.match(/^(.+?) shared/) || t.match(/^(.+?) is nudging/);
    if (m) return m[1].trim();
  }
  return "Mint";
};

const initials = (name) =>
  name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

/* ── Thread (detail) view ───────────────────────────────────────────────── */
const NotificationThreadView = ({ notification, onBack, onDelete, onNavigate }) => {
  const isWishlist    = notification.payload?.action === "OPEN_GIFT_REGISTRY";
  const isGiftReceived = isWishlist && !!notification.payload?.gifter_user_id;
  const shareToken    = notification.payload?.share_token;
  const sender        = getSender(notification);
  const ini           = initials(sender);
  const accent        = getAccent(notification);
  const endRef        = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, []);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">

      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-100 shadow-sm shrink-0 overflow-hidden">
        {/* Colour bar at the very top */}
        <div className={`h-1 w-full bg-gradient-to-r ${accent.ctaGrad}`} />

        <div className="flex items-center px-4 pt-3 pb-3 gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2} />
            <span className="text-[15px] font-medium">Back</span>
          </button>

          <div className="flex-1 flex flex-col items-center gap-1.5">
            <div className={`w-11 h-11 rounded-full ${accent.avatarBg} flex items-center justify-center shadow-md`}>
              <span className={`text-[14px] font-bold tracking-wide ${accent.avatarText}`}>{ini}</span>
            </div>
            <p className="text-[13px] font-semibold text-slate-800 leading-none">{sender}</p>
          </div>

          <button
            type="button"
            onClick={() => { onDelete(notification.id); onBack(); }}
            aria-label="Delete notification"
            className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-5 py-7 space-y-3">
        <p className="text-center text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-5">
          {formatBubbleDate(notification.created_at)}
        </p>

        {/* Title bubble */}
        <div className="flex items-end gap-3">
          <div className={`w-8 h-8 rounded-full ${accent.avatarBg} flex items-center justify-center shrink-0 mb-0.5 shadow-sm`}>
            <span className={`text-[11px] font-bold ${accent.avatarText}`}>{ini}</span>
          </div>
          <div className={`bg-white border border-slate-100 shadow-sm rounded-2xl rounded-bl-sm px-5 py-4 max-w-[76%] ${accent.bubble}`}>
            <p className="text-[15px] font-semibold text-slate-800 leading-snug">{notification.title}</p>
          </div>
        </div>

        {/* Body bubble */}
        <div className="flex items-end gap-3">
          <div className="w-8 shrink-0" />
          <div className="bg-white border border-slate-100 shadow-sm rounded-2xl rounded-bl-sm px-5 py-4 max-w-[82%]">
            <p className="text-[15px] text-slate-600 leading-relaxed">{notification.body}</p>
          </div>
        </div>

        {/* Wishlist / gift card — tappable */}
        {isWishlist && shareToken && (
          <div className="flex items-end gap-3">
            <div className="w-8 shrink-0" />
            <button
              type="button"
              onClick={() => onNavigate?.("giftRegistryPublic", { token: shareToken })}
              className={`bg-gradient-to-br ${accent.ctaGrad} rounded-2xl rounded-bl-sm px-5 py-4 text-left active:scale-95 transition-transform shadow-lg max-w-[76%]`}
            >
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-1.5 text-white/60`}>
                {isGiftReceived ? "Gift received" : "Wishlist"}
              </p>
              <p className="text-[15px] font-bold text-white leading-snug">
                {notification.payload?.registry_title ||
                  notification.title?.match(/"([^"]+)"/)?.[1] ||
                  "View Wishlist"}
              </p>
              {notification.payload?.item_count > 0 && (
                <p className="text-[12px] text-white/60 mt-1">
                  {notification.payload.item_count} item{notification.payload.item_count !== 1 ? "s" : ""}
                </p>
              )}
            </button>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* ── Bottom CTA ── */}
      <div className="bg-white border-t border-slate-100 px-5 py-4 pb-[max(env(safe-area-inset-bottom),16px)] shrink-0">
        {isWishlist && shareToken ? (
          <button
            type="button"
            onClick={() => onNavigate?.("giftRegistryPublic", { token: shareToken })}
            className={`w-full bg-gradient-to-r ${accent.ctaGrad} text-white text-[15px] font-semibold py-4 rounded-full shadow-md active:opacity-80 transition-opacity`}
          >
            View Wishlist
          </button>
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="w-full bg-slate-900 text-white text-[15px] font-semibold py-4 rounded-full shadow-sm active:opacity-80 transition-opacity"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
};

/* ── Notification list item ─────────────────────────────────────────────── */
const NotificationItem = ({ notification, onMarkRead, onDelete, onOpen }) => {
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd,   setTouchEnd]   = useState(null);
  const [swiped,     setSwiped]     = useState(false);

  const onTouchStart = (e) => { setTouchEnd(null); setTouchStart(e.targetTouches[0].clientX); };
  const onTouchMove  = (e) => { setTouchEnd(e.targetTouches[0].clientX); };
  const onTouchEnd   = () => {
    if (!touchStart || !touchEnd) return;
    const d = touchStart - touchEnd;
    if (d > 50) setSwiped(true);
    else if (d < -50) setSwiped(false);
  };

  const sender  = getSender(notification);
  const ini     = initials(sender);
  const unread  = !notification.read_at;
  const accent  = getAccent(notification);
  const isWishlist = notification.payload?.action === "OPEN_GIFT_REGISTRY";

  const handleClick = () => {
    if (swiped) return;
    if (unread) onMarkRead(notification.id);
    onOpen(notification);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl shadow-sm">
      {/* Delete reveal */}
      <div className={`absolute inset-y-0 right-0 flex items-center justify-center bg-red-500 transition-all duration-200 ${swiped ? "w-20" : "w-0"}`}>
        <button type="button" onClick={() => onDelete(notification.id)} className="text-white px-4" aria-label="Delete">
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleClick}
        className={`relative flex items-center gap-4 bg-white px-4 py-4 cursor-pointer transition-transform duration-200 ${swiped ? "-translate-x-20" : "translate-x-0"} ${unread && isWishlist ? `border-l-4 ${accent.border}` : ""}`}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-sm ${unread ? accent.avatarBg : "bg-slate-100"}`}>
            <span className={`text-[14px] font-bold tracking-wide ${unread ? accent.avatarText : "text-slate-500"}`}>{ini}</span>
          </div>
          {unread && (
            <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${accent.dot}`} />
          )}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className={`text-[15px] truncate ${unread ? "font-bold text-slate-900" : "font-semibold text-slate-700"}`}>
              {sender}
            </p>
            <span className={`text-[12px] shrink-0 ${unread ? `font-semibold ${accent.label}` : "text-slate-400"}`}>
              {formatListDate(notification.created_at)}
            </span>
          </div>
          <p className={`text-[13px] truncate leading-snug ${unread ? "font-medium text-slate-700" : "text-slate-400"}`}>
            {notification.title}
          </p>
          <p className="text-[13px] text-slate-400 truncate leading-snug mt-0.5">
            {notification.body}
          </p>
        </div>

        <ChevronLeft className="h-4 w-4 text-slate-300 rotate-180 shrink-0" strokeWidth={2} />
      </div>
    </div>
  );
};

/* ── Group ──────────────────────────────────────────────────────────────── */
const NotificationGroup = ({ title, notifications, onMarkRead, onDelete, onOpen }) => {
  if (!notifications.length) return null;
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-3 px-1">{title}</p>
      <div className="space-y-2">
        {notifications.map((n) => (
          <NotificationItem key={n.id} notification={n} onMarkRead={onMarkRead} onDelete={onDelete} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
};

/* ── Main page ──────────────────────────────────────────────────────────── */
const PAGE_SIZE = 10;

const NotificationsPage = ({ onBack, onOpenSettings, onNavigate }) => {
  const [selected,     setSelected]     = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, deleteNotification, refetch } = useNotificationsContext();

  useEffect(() => { if (typeof refetch === "function") refetch(); }, []);

  if (loading) return <NotificationsSkeleton />;

  if (selected) {
    return (
      <NotificationThreadView
        notification={selected}
        onBack={() => setSelected(null)}
        onDelete={(id) => { deleteNotification(id); setSelected(null); }}
        onNavigate={onNavigate}
      />
    );
  }

  const visible = notifications.slice(0, visibleCount);
  const hasMore = visibleCount < notifications.length;
  const grouped = groupNotificationsByDate(visible);

  return (
    <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm px-4 pb-12 pt-12 md:max-w-md md:px-6">

        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2} />
          </button>

          <h1 className="text-[18px] font-bold text-slate-900 tracking-tight">Notifications</h1>

          <button
            type="button"
            aria-label="Settings"
            onClick={onOpenSettings}
            className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors"
          >
            <Settings className="h-5 w-5" />
          </button>
        </header>

        {/* Mark all read */}
        {unreadCount > 0 && (
          <div className="flex justify-end mb-5">
            <button
              type="button"
              onClick={markAllAsRead}
              className="flex items-center gap-2 bg-white border border-slate-200 shadow-sm rounded-full px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <CheckCheck className="h-4 w-4 text-violet-500" />
              Mark all as read
            </button>
          </div>
        )}

        {notifications.length > 0 ? (
          <div className="space-y-7">
            <NotificationGroup title="Today"     notifications={grouped.today}     onMarkRead={markAsRead} onDelete={deleteNotification} onOpen={setSelected} />
            <NotificationGroup title="Yesterday" notifications={grouped.yesterday} onMarkRead={markAsRead} onDelete={deleteNotification} onOpen={setSelected} />
            <NotificationGroup title="This Week" notifications={grouped.thisWeek}  onMarkRead={markAsRead} onDelete={deleteNotification} onOpen={setSelected} />
            <NotificationGroup title="Older"     notifications={grouped.older}     onMarkRead={markAsRead} onDelete={deleteNotification} onOpen={setSelected} />

            {hasMore && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="w-full bg-white border border-slate-200 shadow-sm rounded-2xl py-4 text-[14px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Show more ({notifications.length - visibleCount} remaining)
              </button>
            )}

            <p className="text-center text-[11px] text-slate-300 pt-2">
              Swipe left on a notification to delete it
            </p>
          </div>
        ) : (
          <div className="mt-24 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-3xl bg-white shadow-sm flex items-center justify-center mb-5">
              <Mailbox className="h-9 w-9 text-slate-300" />
            </div>
            <h2 className="text-[18px] font-bold text-slate-800">No notifications yet</h2>
            <p className="mt-2 text-[14px] text-slate-400 max-w-[210px] leading-relaxed">
              Your notifications will appear here once received.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
