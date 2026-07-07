import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";

const NotificationsContext = createContext(null);

const defaultState = {
  notifications: [],
  unreadCount: 0,
  loading: true,
  error: null,
  preferences: {},
};

const globalNotificationsSub = {
  channel: null,
  userId: null,
  listeners: new Set(),
  seenIds: new Set(),
  isSettingUp: false,
};

export const NotificationsProvider = ({ children }) => {
  const [state, setState] = useState(defaultState);

  const loadPreferences = useCallback(async (userId) => {
    if (!supabase || !userId) return {};
    
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, notifications_enabled")
        .eq("id", userId)
        .single();
      
      return {};
    } catch (err) {
      console.error("Error loading notification preferences:", err);
      return {};
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!supabase) {
      setState({ ...defaultState, loading: false, error: "Supabase not configured" });
      return;
    }

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        setState({ ...defaultState, loading: false });
        return;
      }

      const userId = userData.user.id;
      
      const [notificationsResult, preferences] = await Promise.all([
        supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        loadPreferences(userId)
      ]);

      if (notificationsResult.error) {
        setState({ ...defaultState, loading: false, error: notificationsResult.error.message });
        return;
      }

      const allNotifications = notificationsResult.data || [];

      const seen = new Map();
      const duplicateIds = [];
      for (const n of allNotifications) {
        const key = `${n.title}__${n.body}`;
        if (seen.has(key)) {
          duplicateIds.push(n.id);
        } else {
          seen.set(key, n.id);
        }
      }
      if (duplicateIds.length > 0) {
        supabase.from("notifications").delete().in("id", duplicateIds).then(() => {
          console.log(`Cleaned up ${duplicateIds.length} duplicate notifications`);
        });
      }

      const dedupedNotifications = allNotifications.filter((n) => !duplicateIds.includes(n.id));
      
      const filteredNotifications = dedupedNotifications.filter((n) => {
        if (Object.keys(preferences).length === 0) return true;
        return preferences[n.type] !== false;
      });

      const unreadCount = filteredNotifications.filter((n) => !n.read_at).length;

      setState({
        notifications: filteredNotifications,
        unreadCount,
        loading: false,
        error: null,
        preferences,
      });
    } catch (err) {
      setState({ ...defaultState, loading: false, error: err.message });
    }
  }, [loadPreferences]);

  const markAsRead = useCallback(async (notificationId) => {
    if (!supabase) return;

    setState((prev) => {
      const notification = prev.notifications.find((n) => n.id === notificationId);
      if (!notification || notification.read_at) return prev;
      
      return {
        ...prev,
        notifications: prev.notifications.map((n) =>
          n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n
        ),
        unreadCount: Math.max(0, prev.unreadCount - 1),
      };
    });

    try {
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", notificationId);
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!supabase) return;

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) return;

      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", userData.user.id)
        .is("read_at", null);

      if (!error) {
        setState((prev) => ({
          ...prev,
          notifications: prev.notifications.map((n) => ({
            ...n,
            read_at: n.read_at || new Date().toISOString(),
          })),
          unreadCount: 0,
        }));
      }
    } catch (err) {
      console.error("Error marking all as read:", err);
    }
  }, []);

  const deleteNotification = useCallback(async (notificationId) => {
    if (!supabase) return;

    try {
      const notification = state.notifications.find((n) => n.id === notificationId);
      const wasUnread = notification && !notification.read_at;

      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("id", notificationId);

      if (!error) {
        setState((prev) => ({
          ...prev,
          notifications: prev.notifications.filter((n) => n.id !== notificationId),
          unreadCount: wasUnread ? Math.max(0, prev.unreadCount - 1) : prev.unreadCount,
        }));
      }
    } catch (err) {
      console.error("Error deleting notification:", err);
    }
  }, [state.notifications]);

  const updatePreferences = useCallback((newPreferences) => {
    setState((prev) => {
      const filteredNotifications = prev.notifications.filter((n) => {
        if (Object.keys(newPreferences).length === 0) return true;
        return newPreferences[n.type] !== false;
      });
      const unreadCount = filteredNotifications.filter((n) => !n.read_at).length;
      
      return {
        ...prev,
        preferences: newPreferences,
        notifications: filteredNotifications,
        unreadCount,
      };
    });
  }, []);

  useEffect(() => {
    fetchNotifications();

    if (!supabase) return;

    // Re-fetch whenever the user signs in or switches accounts
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          fetchNotifications();
        }
        if (event === "SIGNED_OUT") {
          setState({ ...defaultState, loading: false });
        }
      }
    );

    const handleInsert = (notification) => {
      if (globalNotificationsSub.seenIds.has(notification.id)) {
        return;
      }
      globalNotificationsSub.seenIds.add(notification.id);
      
      setTimeout(() => {
        globalNotificationsSub.seenIds.delete(notification.id);
      }, 5000);

      setState((prev) => {
        if (prev.notifications.some(n => n.id === notification.id)) {
          return prev;
        }
        if (prev.preferences[notification.type] === false) {
          return prev;
        }
        console.log("Adding notification to state (singleton), new unread count:", prev.unreadCount + 1);
        return {
          ...prev,
          notifications: [notification, ...prev.notifications],
          unreadCount: prev.unreadCount + 1,
        };
      });
    };

    const handleDelete = (deletedId) => {
      setState((prev) => {
        const deleted = prev.notifications.find((n) => n.id === deletedId);
        if (!deleted) return prev;
        const wasUnread = !deleted.read_at;
        return {
          ...prev,
          notifications: prev.notifications.filter((n) => n.id !== deletedId),
          unreadCount: wasUnread ? Math.max(0, prev.unreadCount - 1) : prev.unreadCount,
        };
      });
    };

    const listener = { handleInsert, handleDelete };
    globalNotificationsSub.listeners.add(listener);

    const setupSingletonRealtime = async () => {
      if (globalNotificationsSub.channel || globalNotificationsSub.isSettingUp) {
        if (import.meta.env.DEV) {
          console.debug('[Notifications] Singleton already exists or setting up');
        }
        return;
      }

      globalNotificationsSub.isSettingUp = true;

      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) {
        globalNotificationsSub.isSettingUp = false;
        return;
      }

      globalNotificationsSub.userId = userData.user.id;

      console.log("Setting up SINGLETON notifications subscription");

      globalNotificationsSub.channel = supabase
        .channel("notifications-singleton")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userData.user.id}`,
          },
          (payload) => {
            console.log("Singleton: New notification received:", payload.new?.id);
            globalNotificationsSub.listeners.forEach(listener => {
              listener.handleInsert(payload.new);
            });
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userData.user.id}`,
          },
          (payload) => {
            console.log("Singleton: Notification deleted:", payload.old?.id);
            globalNotificationsSub.listeners.forEach(listener => {
              listener.handleDelete(payload.old?.id);
            });
          }
        )
        .subscribe((status) => {
          console.log("Notifications singleton status:", status);
          if (status === 'SUBSCRIBED') {
            globalNotificationsSub.isSettingUp = false;
          }
        });
    };

    setupSingletonRealtime();

    return () => {
      globalNotificationsSub.listeners.delete(listener);
      authSub?.unsubscribe();
    };
  }, [fetchNotifications]);

  const resetNotifications = useCallback(async () => {
    setState({ ...defaultState, loading: false });
    if (globalNotificationsSub.channel) {
      await globalNotificationsSub.channel.unsubscribe();
      globalNotificationsSub.channel = null;
      globalNotificationsSub.isSettingUp = false;
      globalNotificationsSub.userId = null;
      globalNotificationsSub.seenIds.clear();
    }
  }, []);

  const value = {
    ...state,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    updatePreferences,
    refetch: fetchNotifications,
    reset: resetNotifications,
  };

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
};

export const useNotificationsContext = () => {
  const context = useContext(NotificationsContext);
  if (!context) {
    return {
      notifications: [],
      unreadCount: 0,
      loading: false,
      error: null,
      preferences: {},
      markAsRead: () => {},
      markAllAsRead: () => {},
      deleteNotification: () => {},
      updatePreferences: () => {},
      refetch: () => {},
      reset: () => {},
    };
  }
  return context;
};

export const createWelcomeNotification = async (userId) => {
  if (!supabase || !userId) return;

  try {
    const { data: existing, error: existingError } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "system")
      .ilike("title", "%Welcome%")
      .limit(1);

    if (existingError || (existing && existing.length > 0)) {
      return;
    }

    await supabase.from("notifications").insert({
      user_id: userId,
      title: "Welcome to MINT!",
      body: "We're excited to have you on board. Start by completing your profile and exploring your investment options.",
      type: "system",
      payload: { action: "complete_profile" },
    });
  } catch (err) {
    console.error("Error creating welcome notification:", err);
  }
};

export const createKycNotification = async (userId, status) => {
  if (!supabase || !userId) {
    console.log("createKycNotification: Missing supabase or userId", { supabase: !!supabase, userId });
    return false;
  }

  const notifications = {
    verified: {
      title: "Identity Verified",
      body: "Congratulations! Your identity has been successfully verified. You now have full access to all features.",
      payload: { action: "kyc_verified", status: "verified" },
    },
    pending: {
      title: "Verification Under Review",
      body: "Your identity documents have been submitted and are being reviewed. This usually takes a few minutes to a few hours.",
      payload: { action: "kyc_pending", status: "pending" },
    },
    needs_resubmission: {
      title: "Action Required: Resubmit Documents",
      body: "We couldn't verify your identity with the documents provided. Please resubmit clearer photos of your documents.",
      payload: { action: "kyc_resubmit", status: "needs_resubmission" },
    },
    submitted: {
      title: "Documents Submitted",
      body: "Your identity verification documents have been submitted successfully. We'll notify you once the review is complete.",
      payload: { action: "kyc_submitted", status: "submitted" },
    },
  };

  const notificationData = notifications[status];
  if (!notificationData) {
    console.log("createKycNotification: Unknown status", status);
    return false;
  }

  try {
    console.log("Creating KYC notification:", { userId, status, title: notificationData.title });
    
    const { data, error } = await supabase.from("notifications").insert({
      user_id: userId,
      title: notificationData.title,
      body: notificationData.body,
      type: "system",
      payload: notificationData.payload,
    }).select();

    if (error) {
      console.error("Error creating KYC notification:", error);
      return false;
    }

    console.log("KYC notification created successfully:", data);
    return true;
  } catch (err) {
    console.error("Error creating KYC notification:", err);
    return false;
  }
};

export const createBankNotification = async (userId, status, bankName = "your bank") => {
  if (!supabase || !userId) {
    console.log("createBankNotification: Missing supabase or userId");
    return false;
  }

  const notifications = {
    linked: {
      title: "Bank Account Linked",
      body: `Your bank account from ${bankName} has been successfully linked. You can now make deposits and withdrawals.`,
      payload: { action: "bank_linked", status: "linked", bank: bankName },
    },
    pending: {
      title: "Bank Verification In Progress",
      body: `Your ${bankName} account is being verified. This usually takes 1-2 business days.`,
      payload: { action: "bank_pending", status: "pending", bank: bankName },
    },
    failed: {
      title: "Bank Linking Failed",
      body: `We couldn't link your ${bankName} account. Please try again or contact support for assistance.`,
      payload: { action: "bank_failed", status: "failed", bank: bankName },
    },
    removed: {
      title: "Bank Account Removed",
      body: `Your ${bankName} account has been unlinked from your MINT account.`,
      payload: { action: "bank_removed", status: "removed", bank: bankName },
    },
  };

  const notificationData = notifications[status];
  if (!notificationData) {
    console.log("createBankNotification: Unknown status", status);
    return false;
  }

  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("title", notificationData.title)
      .gte("created_at", fiveMinutesAgo)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log("Skipping duplicate bank notification:", notificationData.title);
      return false;
    }

    const { data, error } = await supabase.from("notifications").insert({
      user_id: userId,
      title: notificationData.title,
      body: notificationData.body,
      type: "system",
      payload: notificationData.payload,
    }).select();

    if (error) {
      console.error("Error creating bank notification:", error);
      return false;
    }

    console.log("Bank notification created:", data);
    return true;
  } catch (err) {
    console.error("Error creating bank notification:", err);
    return false;
  }
};

export const createSecurityNotification = async (userId, action, details = {}) => {
  if (!supabase || !userId) {
    console.log("createSecurityNotification: Missing supabase or userId");
    return false;
  }

  const notifications = {
    login: {
      title: "New Login Detected",
      body: `A new login was detected on your account${details.device ? ` from ${details.device}` : ""}.`,
      payload: { action: "security_login", ...details },
    },
    password_changed: {
      title: "Password Changed",
      body: "Your password has been successfully changed. If you didn't make this change, please contact support immediately.",
      payload: { action: "security_password_changed" },
    },
    email_changed: {
      title: "Email Address Updated",
      body: `Your email address has been updated${details.newEmail ? ` to ${details.newEmail}` : ""}.`,
      payload: { action: "security_email_changed", ...details },
    },
  };

  const notificationData = notifications[action];
  if (!notificationData) {
    console.log("createSecurityNotification: Unknown action", action);
    return false;
  }

  try {
    console.log("Creating security notification:", { userId, action, title: notificationData.title });
    
    const { data, error } = await supabase.from("notifications").insert({
      user_id: userId,
      title: notificationData.title,
      body: notificationData.body,
      type: "system",
      payload: notificationData.payload,
    }).select();

    if (error) {
      console.error("Error creating security notification:", error);
      return false;
    }

    console.log("Security notification created successfully:", data);
    return true;
  } catch (err) {
    console.error("Error creating security notification:", err);
    return false;
  }
};

export const getNotificationIcon = (type) => {
  const icons = {
    transaction: { icon: "receipt", color: "bg-emerald-100 text-emerald-600" },
    security: { icon: "shield", color: "bg-red-100 text-red-600" },
    system: { icon: "info", color: "bg-blue-100 text-blue-600" },
    promotion: { icon: "gift", color: "bg-amber-100 text-amber-600" },
    promo: { icon: "gift", color: "bg-amber-100 text-amber-600" },
    verification: { icon: "user-check", color: "bg-purple-100 text-purple-600" },
    kyc: { icon: "user-check", color: "bg-purple-100 text-purple-600" },
    credit: { icon: "credit-card", color: "bg-indigo-100 text-indigo-600" },
    investment: { icon: "trending-up", color: "bg-teal-100 text-teal-600" },
    bank: { icon: "landmark", color: "bg-slate-100 text-slate-600" },
  };
  return icons[type] || icons.system;
};

export const groupNotificationsByDate = (notifications) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups = {
    today: [],
    yesterday: [],
    thisWeek: [],
    older: [],
  };

  notifications.forEach((notification) => {
    const date = new Date(notification.created_at);
    date.setHours(0, 0, 0, 0);

    if (date.getTime() === today.getTime()) {
      groups.today.push(notification);
    } else if (date.getTime() === yesterday.getTime()) {
      groups.yesterday.push(notification);
    } else if (date >= weekAgo) {
      groups.thisWeek.push(notification);
    } else {
      groups.older.push(notification);
    }
  });

  return groups;
};
