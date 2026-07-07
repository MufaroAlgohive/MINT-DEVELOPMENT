import React, { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  Settings,
  Mailbox,
  CheckCheck,
  Trash2,
  Receipt,
  Shield,
  Info,
  Gift,
  UserCheck,
  CreditCard,
  TrendingUp,
  Landmark,
  X,
} from "lucide-react";
import { useNotificationsContext, groupNotificationsByDate, getNotificationIcon } from "../lib/NotificationsContext";
import NotificationsSkeleton from "../components/NotificationsSkeleton";

const OCCASION_EMOJI = { BIRTHDAY: "🎂", WEDDING: "💍", BABY: "👶", GRADUATION: "🎓", FESTIVE: "🎄", CUSTOM: "🎉" };

const NotificationDetailModal = ({ notification, onClose, onDelete, onNavigate }) => {
  if (!notification) return null;

  const formatFullDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-ZA", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isWishlistNotif = notification.payload?.action === "OPEN_GIFT_REGISTRY";
  const isGiftReceived = isWishlistNotif && !!notification.payload?.gifter_user_id;
  const isSharedWishlist = isWishlistNotif && !!notification.payload?.registry_title;
  const shareToken = notification.payload?.share_token;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden">
        {/* Header strip */}
        <div className={`px-6 pt-6 pb-5 ${isWishlistNotif ? "bg-gradient-to-br from-violet-600 to-purple-700" : "bg-slate-900"}`}>
          <div className="flex items-start justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
              {isGiftReceived ? (
                <span className="text-2xl">🎁</span>
              ) : isSharedWishlist ? (
                <span className="text-2xl">🎉</span>
              ) : (
                <Info className="h-6 w-6 text-white" />
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <h2 className="mt-3 text-lg font-bold text-white leading-snug">
            {notification.title}
          </h2>
          <p className="mt-1 text-xs text-white/60">
            {formatFullDate(notification.created_at)}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 pt-5 pb-2">
          <p className="text-sm leading-relaxed text-slate-600">
            {notification.body}
          </p>

          {/* Gift-received card */}
          {isGiftReceived && shareToken && (
            <div className="mt-4 rounded-2xl bg-violet-50 border border-violet-100 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-violet-200 flex items-center justify-center shrink-0">
                  <Gift className="w-5 h-5 text-violet-700" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Gift received</p>
                  <p className="text-sm font-semibold text-slate-800 mt-0.5">
                    {notification.payload?.registry_title || "Your Wishlist"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Shared-wishlist card */}
          {isSharedWishlist && (
            <div className="mt-4 rounded-2xl bg-violet-50 border border-violet-100 p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none shrink-0">
                  {OCCASION_EMOJI[notification.payload.occasion] || "🎉"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">
                    {notification.payload.registry_title}
                  </p>
                  {notification.payload.item_count > 0 && (
                    <p className="text-xs text-violet-600 mt-0.5">
                      {notification.payload.item_count} item{notification.payload.item_count !== 1 ? "s" : ""} on this wishlist
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Generic payload info */}
          {!isWishlistNotif && notification.payload?.amount && (
            <div className="mt-4 rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Amount: {notification.payload.amount}</p>
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="px-6 pt-4 pb-8 flex gap-3">
          <button
            type="button"
            onClick={() => { onDelete(notification.id); onClose(); }}
            className="flex-none rounded-full border border-red-200 bg-red-50 px-5 py-3 text-sm font-medium text-red-600 active:scale-95 transition-all"
          >
            Delete
          </button>
          {isWishlistNotif && shareToken ? (
            <button
              type="button"
              onClick={() => { onClose(); onNavigate?.("giftRegistryPublic", { token: shareToken }); }}
              className="flex-1 rounded-full bg-[#6B21A8] py-3 text-sm font-semibold text-white active:scale-95 transition-all"
            >
              View Wishlist →
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full bg-slate-900 py-3 text-sm font-semibold text-white active:scale-95 transition-all"
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const iconComponents = {
  receipt: Receipt,
  shield: Shield,
  info: Info,
  gift: Gift,
  "user-check": UserCheck,
  "credit-card": CreditCard,
  "trending-up": TrendingUp,
  landmark: Landmark,
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-ZA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const NotificationItem = ({ notification, onMarkRead, onDelete, onOpenDetail, onNavigate }) => {
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [swiped, setSwiped] = useState(false);
  const itemRef = useRef(null);

  const minSwipeDistance = 50;

  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    if (isLeftSwipe) {
      setSwiped(true);
    } else if (distance < -minSwipeDistance) {
      setSwiped(false);
    }
  };

  const isGiftNotification = notification.payload?.action === "gift_received";
  const isWishlistNotif = notification.payload?.action === "OPEN_GIFT_REGISTRY";
  const shareToken = notification.payload?.share_token;

  const handleClick = () => {
    if (swiped) return;
    if (!notification.read_at) {
      onMarkRead(notification.id);
    }
    onOpenDetail(notification);
  };

  const { icon, color } = getNotificationIcon(notification.type);
  const IconComponent = iconComponents[icon] || Info;

  return (
    <div className="relative overflow-hidden rounded-3xl">
      <div
        className={`absolute inset-y-0 right-0 flex items-center justify-end bg-red-500 px-4 transition-all ${
          swiped ? "w-20" : "w-0"
        }`}
      >
        <button
          type="button"
          onClick={() => onDelete(notification.id)}
          className="text-white"
          aria-label="Delete notification"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      <div
        ref={itemRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleClick}
        className={`relative flex gap-3 bg-white p-4 shadow-sm transition-transform cursor-pointer ${
          swiped ? "-translate-x-20" : "translate-x-0"
        } ${isGiftNotification || isWishlistNotif ? "border-l-4 border-violet-400" : ""}`}
      >
        <div className={`flex h-12 w-12 items-center justify-center rounded-full ${color}`}>
          <IconComponent className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className={`text-sm ${!notification.read_at ? "font-semibold" : "font-medium"} text-slate-800 truncate`}>
              {notification.title}
            </p>
            <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
              <span>{formatDate(notification.created_at)}</span>
              {!notification.read_at && (
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500 line-clamp-2">{notification.body}</p>
          {isWishlistNotif && (
            <p className="text-[10px] text-violet-500 font-medium mt-0.5">Tap for details →</p>
          )}
        </div>
      </div>
    </div>
  );
};

const NotificationGroup = ({ title, notifications, onMarkRead, onDelete, onOpenDetail, onNavigate }) => {
  if (notifications.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
        {title}
      </p>
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onMarkRead={onMarkRead}
          onDelete={onDelete}
          onOpenDetail={onOpenDetail}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
};

const PAGE_SIZE = 10;

const NotificationsPage = ({ onBack, onOpenSettings, onNavigate }) => {
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    refetch,
  } = useNotificationsContext();

  useEffect(() => {
    if (typeof refetch === "function") refetch();
  }, []);

  if (loading) {
    return <NotificationsSkeleton />;
  }

  const hasNotifications = notifications.length > 0;
  const visibleNotifications = notifications.slice(0, visibleCount);
  const hasMore = visibleCount < notifications.length;
  const groupedNotifications = groupNotificationsByDate(visibleNotifications);

  const handleOpenDetail = (notification) => {
    setSelectedNotification(notification);
  };

  const handleCloseDetail = () => {
    setSelectedNotification(null);
  };

  return (
    <>
      <NotificationDetailModal
        notification={selectedNotification}
        onClose={handleCloseDetail}
        onDelete={deleteNotification}
        onNavigate={(page, params) => {
          handleCloseDetail();
          onNavigate?.(page, params);
        }}
      />
    <div className="min-h-screen bg-slate-50 pb-[env(safe-area-inset-bottom)] text-slate-900">
      <div className="mx-auto flex w-full max-w-sm flex-col px-4 pb-10 pt-12 md:max-w-md md:px-8">
        <header className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">Notifications</h1>
          <button
            type="button"
            aria-label="Settings"
            onClick={onOpenSettings}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm"
          >
            <Settings className="h-5 w-5" />
          </button>
        </header>

        {hasNotifications && unreadCount > 0 && (
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={markAllAsRead}
              className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
            >
              <CheckCheck className="h-4 w-4" />
              Mark all as read
            </button>
          </div>
        )}

        {hasNotifications ? (
          <div className="mt-6 space-y-6">
            <NotificationGroup
              title="Today"
              notifications={groupedNotifications.today}
              onMarkRead={markAsRead}
              onDelete={deleteNotification}
              onOpenDetail={handleOpenDetail}
              onNavigate={onNavigate}
            />
            <NotificationGroup
              title="Yesterday"
              notifications={groupedNotifications.yesterday}
              onMarkRead={markAsRead}
              onDelete={deleteNotification}
              onOpenDetail={handleOpenDetail}
              onNavigate={onNavigate}
            />
            <NotificationGroup
              title="This Week"
              notifications={groupedNotifications.thisWeek}
              onMarkRead={markAsRead}
              onDelete={deleteNotification}
              onOpenDetail={handleOpenDetail}
              onNavigate={onNavigate}
            />
            <NotificationGroup
              title="Older"
              notifications={groupedNotifications.older}
              onMarkRead={markAsRead}
              onDelete={deleteNotification}
              onOpenDetail={handleOpenDetail}
              onNavigate={onNavigate}
            />
            {hasMore && (
              <button
                type="button"
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 text-sm font-semibold text-slate-600 shadow-sm active:scale-95 transition-all"
              >
                Show more ({notifications.length - visibleCount} remaining)
              </button>
            )}
          </div>
        ) : (
          <div className="mt-16 flex flex-col items-center text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-100 text-indigo-500">
              <Mailbox className="h-10 w-10" />
            </div>
            <h2 className="mt-6 text-lg font-semibold">No notifications yet</h2>
            <p className="mt-2 text-sm text-slate-500">
              Your notifications will appear here once you&apos;ve received them.
            </p>
          </div>
        )}

        <div className="mt-10 text-center text-xs text-slate-400">
          Swipe left on a notification to delete it
        </div>
      </div>
    </div>
    </>
  );
};

export default NotificationsPage;
