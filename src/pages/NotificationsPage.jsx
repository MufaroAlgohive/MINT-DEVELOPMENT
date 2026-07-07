import React, { useState, useRef, useEffect } from "react";
import {
  ChevronLeft,
  Settings,
  Mailbox,
  CheckCheck,
  Trash2,
  Info,
} from "lucide-react";
import { useNotificationsContext, groupNotificationsByDate } from "../lib/NotificationsContext";
import NotificationsSkeleton from "../components/NotificationsSkeleton";

const formatTime = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
};

const formatFullDate = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return `Today at ${formatTime(dateString)}`;
  if (isYesterday) return `Yesterday at ${formatTime(dateString)}`;
  return date.toLocaleDateString("en-ZA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getSenderName = (notification) => {
  const title = notification.title || "";
  if (notification.payload?.action === "OPEN_GIFT_REGISTRY") {
    if (notification.payload?.gifter_user_id) {
      const match = title.match(/^(.+?) gifted you/);
      if (match) return match[1].trim();
    }
    const match = title.match(/^(.+?) shared a wishlist/) || title.match(/^(.+?) is nudging/);
    if (match) return match[1].trim();
  }
  return "Mint";
};

const getInitials = (name) => {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
};

const NotificationThreadView = ({ notification, onBack, onDelete, onNavigate }) => {
  const isWishlistNotif = notification.payload?.action === "OPEN_GIFT_REGISTRY";
  const shareToken = notification.payload?.share_token;
  const senderName = getSenderName(notification);
  const initials = getInitials(senderName);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleAction = () => {
    if (isWishlistNotif && shareToken) {
      onNavigate?.("giftRegistryPublic", { token: shareToken });
    } else {
      onBack();
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#F2F2F7]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif" }}>
      {/* iMessage-style header */}
      <div className="bg-white border-b border-[#E5E5EA] pt-[env(safe-area-inset-top)] shrink-0">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-0.5 text-[#007AFF] text-[17px] font-normal"
          >
            <ChevronLeft className="h-5 w-5 -ml-1" strokeWidth={2.5} />
            <span className="text-sm">Back</span>
          </button>

          <div className="flex-1 flex flex-col items-center">
            <div className="w-9 h-9 rounded-full bg-[#E5E5EA] flex items-center justify-center mb-0.5">
              <span className="text-[13px] font-semibold text-[#3A3A3C]">{initials}</span>
            </div>
            <p className="text-[12px] font-semibold text-[#1C1C1E] leading-tight">{senderName}</p>
          </div>

          <button
            type="button"
            onClick={() => { onDelete(notification.id); onBack(); }}
            className="w-9 h-9 flex items-center justify-center text-[#8E8E93]"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
        {/* Timestamp */}
        <p className="text-center text-[11px] text-[#8E8E93] font-medium mb-4">
          {formatFullDate(notification.created_at)}
        </p>

        {/* Title as first message bubble */}
        <div className="flex items-end gap-2 max-w-[80%]">
          <div className="w-7 h-7 rounded-full bg-[#E5E5EA] flex items-center justify-center shrink-0 mb-0.5">
            <span className="text-[10px] font-semibold text-[#3A3A3C]">{initials}</span>
          </div>
          <div className="bg-[#E9E9EB] rounded-[18px] rounded-bl-[4px] px-4 py-2.5">
            <p className="text-[15px] text-[#1C1C1E] leading-snug font-medium">{notification.title}</p>
          </div>
        </div>

        {/* Body as second bubble (appears slightly after) */}
        <div className="flex items-end gap-2 max-w-[80%] pt-1">
          <div className="w-7 shrink-0" />
          <div className="bg-[#E9E9EB] rounded-[18px] rounded-bl-[4px] px-4 py-2.5">
            <p className="text-[15px] text-[#1C1C1E] leading-relaxed">{notification.body}</p>
          </div>
        </div>

        {/* Wishlist card bubble */}
        {isWishlistNotif && (
          <div className="flex items-end gap-2 max-w-[80%] pt-1">
            <div className="w-7 shrink-0" />
            <div className="bg-[#E9E9EB] rounded-[18px] rounded-bl-[4px] overflow-hidden">
              <div className="bg-[#1C1C1E] px-4 py-3">
                <p className="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-widest mb-0.5">
                  {notification.payload?.gifter_user_id ? "Gift" : "Wishlist"}
                </p>
                <p className="text-[15px] font-semibold text-white leading-snug">
                  {notification.payload?.registry_title ||
                    notification.title?.match(/"([^"]+)"/)?.[1] ||
                    "View Wishlist"}
                </p>
                {notification.payload?.item_count > 0 && (
                  <p className="text-[12px] text-[#8E8E93] mt-0.5">
                    {notification.payload.item_count} item{notification.payload.item_count !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom action bar */}
      <div className="bg-white border-t border-[#E5E5EA] px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)] shrink-0">
        {isWishlistNotif && shareToken ? (
          <button
            type="button"
            onClick={handleAction}
            className="w-full bg-[#1C1C1E] text-white text-[15px] font-semibold py-3.5 rounded-full active:opacity-70 transition-opacity"
          >
            View Wishlist
          </button>
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="w-full bg-[#1C1C1E] text-white text-[15px] font-semibold py-3.5 rounded-full active:opacity-70 transition-opacity"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
};

const iconComponents = { info: Info };

const formatDate = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return formatTime(dateString);
  return date.toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
};

const NotificationItem = ({ notification, onMarkRead, onDelete, onOpen }) => {
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [swiped, setSwiped] = useState(false);
  const itemRef = useRef(null);

  const onTouchStart = (e) => { setTouchEnd(null); setTouchStart(e.targetTouches[0].clientX); };
  const onTouchMove = (e) => { setTouchEnd(e.targetTouches[0].clientX); };
  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    if (distance > 50) setSwiped(true);
    else if (distance < -50) setSwiped(false);
  };

  const isWishlistNotif = notification.payload?.action === "OPEN_GIFT_REGISTRY";
  const senderName = getSenderName(notification);
  const initials = getInitials(senderName);

  const handleClick = () => {
    if (swiped) return;
    if (!notification.read_at) onMarkRead(notification.id);
    onOpen(notification);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div className={`absolute inset-y-0 right-0 flex items-center justify-end bg-red-500 px-4 transition-all ${swiped ? "w-20" : "w-0"}`}>
        <button type="button" onClick={() => onDelete(notification.id)} className="text-white" aria-label="Delete">
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      <div
        ref={itemRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleClick}
        className={`relative flex gap-3 bg-white px-4 py-3.5 cursor-pointer transition-transform ${swiped ? "-translate-x-20" : "translate-x-0"}`}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="w-11 h-11 rounded-full bg-[#E5E5EA] flex items-center justify-center">
            <span className="text-[13px] font-semibold text-[#3A3A3C]">{initials}</span>
          </div>
          {!notification.read_at && (
            <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#007AFF]" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-baseline justify-between gap-2 mb-0.5">
            <p className={`text-[15px] truncate ${!notification.read_at ? "font-semibold" : "font-medium"} text-[#1C1C1E]`}>
              {senderName}
            </p>
            <span className="text-[12px] text-[#8E8E93] shrink-0">{formatDate(notification.created_at)}</span>
          </div>
          <p className={`text-[13px] truncate ${!notification.read_at ? "font-medium text-[#1C1C1E]" : "text-[#8E8E93]"}`}>
            {notification.title}
          </p>
          <p className="text-[13px] text-[#8E8E93] truncate">{notification.body}</p>
        </div>

        {/* Chevron */}
        <div className="flex items-center shrink-0">
          <ChevronLeft className="h-4 w-4 text-[#C7C7CC] rotate-180" strokeWidth={2} />
        </div>
      </div>
    </div>
  );
};

const NotificationGroup = ({ title, notifications, onMarkRead, onDelete, onOpen }) => {
  if (!notifications.length) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93] px-1 mb-1.5">{title}</p>
      <div className="rounded-2xl overflow-hidden divide-y divide-[#F2F2F7]">
        {notifications.map((n) => (
          <NotificationItem key={n.id} notification={n} onMarkRead={onMarkRead} onDelete={onDelete} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
};

const PAGE_SIZE = 10;

const NotificationsPage = ({ onBack, onOpenSettings, onNavigate }) => {
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, deleteNotification, refetch } = useNotificationsContext();

  useEffect(() => { if (typeof refetch === "function") refetch(); }, []);

  if (loading) return <NotificationsSkeleton />;

  if (selectedNotification) {
    return (
      <NotificationThreadView
        notification={selectedNotification}
        onBack={() => setSelectedNotification(null)}
        onDelete={(id) => { deleteNotification(id); setSelectedNotification(null); }}
        onNavigate={onNavigate}
      />
    );
  }

  const visibleNotifications = notifications.slice(0, visibleCount);
  const hasMore = visibleCount < notifications.length;
  const grouped = groupNotificationsByDate(visibleNotifications);

  return (
    <div className="min-h-screen bg-[#F2F2F7] pb-[env(safe-area-inset-bottom)]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif" }}>
      <div className="mx-auto w-full max-w-sm px-4 pb-10 pt-14 md:max-w-md md:px-6">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <button type="button" aria-label="Back" onClick={onBack} className="flex items-center gap-0.5 text-[#007AFF] text-[17px]">
            <ChevronLeft className="h-5 w-5 -ml-1" strokeWidth={2.5} />
            <span className="text-[17px]">Back</span>
          </button>
          <h1 className="text-[17px] font-semibold text-[#1C1C1E]">Notifications</h1>
          <button type="button" aria-label="Settings" onClick={onOpenSettings} className="text-[#007AFF]">
            <Settings className="h-5 w-5" />
          </button>
        </header>

        {/* Mark all read */}
        {unreadCount > 0 && (
          <div className="flex justify-end mb-4">
            <button
              type="button"
              onClick={markAllAsRead}
              className="flex items-center gap-1.5 text-[13px] text-[#007AFF] font-medium"
            >
              <CheckCheck className="h-4 w-4" />
              Mark all as read
            </button>
          </div>
        )}

        {notifications.length > 0 ? (
          <div className="space-y-6">
            <NotificationGroup title="Today" notifications={grouped.today} onMarkRead={markAsRead} onDelete={deleteNotification} onOpen={setSelectedNotification} />
            <NotificationGroup title="Yesterday" notifications={grouped.yesterday} onMarkRead={markAsRead} onDelete={deleteNotification} onOpen={setSelectedNotification} />
            <NotificationGroup title="This Week" notifications={grouped.thisWeek} onMarkRead={markAsRead} onDelete={deleteNotification} onOpen={setSelectedNotification} />
            <NotificationGroup title="Older" notifications={grouped.older} onMarkRead={markAsRead} onDelete={deleteNotification} onOpen={setSelectedNotification} />
            {hasMore && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="w-full rounded-2xl bg-white py-3.5 text-[15px] font-medium text-[#007AFF] shadow-sm active:opacity-70 transition-opacity"
              >
                Show more ({notifications.length - visibleCount} remaining)
              </button>
            )}
            <p className="text-center text-[11px] text-[#C7C7CC] pt-2">Swipe left on a notification to delete it</p>
          </div>
        ) : (
          <div className="mt-20 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-3xl bg-white flex items-center justify-center mb-5 shadow-sm">
              <Mailbox className="h-9 w-9 text-[#8E8E93]" />
            </div>
            <h2 className="text-[17px] font-semibold text-[#1C1C1E]">No notifications</h2>
            <p className="mt-1.5 text-[13px] text-[#8E8E93] max-w-[220px] leading-relaxed">
              Your notifications will appear here once you've received them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
