import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase";
import { parseOnboardingFlags } from "./checkOnboardingComplete";

const singleton = {
  channel: null,
  authSub: null,
  listeners: new Set(),
  isComplete: false,
  isLoading: true,
  error: null,
};

function notifyListeners() {
  singleton.listeners.forEach((fn) => fn());
}

async function fetchOnboardingStatus() {
  if (!supabase) {
    singleton.isLoading = false;
    notifyListeners();
    return;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      singleton.isComplete = false;
      singleton.isLoading = false;
      notifyListeners();
      return;
    }

    try {
      const res = await fetch("/api/onboarding/status", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const json = await res.json();
        console.log("[useOnboardingStatus] Total Onboarding Status:", json.is_fully_onboarded ? "COMPLETE ✅" : "INCOMPLETE ❌");
        singleton.isComplete = json.is_fully_onboarded === true;
        singleton.isLoading = false;
        notifyListeners();
        return;
      }
    } catch (e) {
      console.warn("[useOnboardingStatus] API fallback to DB:", e.message);
    }

    const { data, error: dbError } = await supabase
      .from("user_onboarding")
      .select("kyc_status, sumsub_raw")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (dbError) throw dbError;

    if (data && data.length > 0) {
      const flags = parseOnboardingFlags(data[0]);
      console.log("[useOnboardingStatus] DB Fallback Flags:", flags.allComplete ? "COMPLETE ✅" : "INCOMPLETE ❌");
      singleton.isComplete = flags.allComplete;
    } else {
      singleton.isComplete = false;
    }
  } catch (err) {
    console.error("[useOnboardingStatus] Error:", err);
    singleton.error = err;
  } finally {
    singleton.isLoading = false;
    notifyListeners();
  }
}

function setupSingletonChannel() {
  if (!supabase) return;

  if (!singleton.channel) {
    singleton.channel = supabase
      .channel("onboarding_status_singleton")
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "user_onboarding",
      }, () => fetchOnboardingStatus())
      .subscribe();
  }

  // Re-fetch whenever the auth session becomes available or refreshes. Without
  // this, an initial fetch that ran before the session was restored would latch
  // isComplete=false forever (no session → early return), wrongly bouncing a
  // fully-onboarded user into the onboarding/identity flow.
  if (!singleton.authSub) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) fetchOnboardingStatus();
    });
    singleton.authSub = data?.subscription || null;
  }
}

function teardownSingletonChannel() {
  if (!supabase) return;
  if (singleton.channel) {
    supabase.removeChannel(singleton.channel);
    singleton.channel = null;
  }
  if (singleton.authSub) {
    singleton.authSub.unsubscribe();
    singleton.authSub = null;
  }
}

export function markOnboardingComplete() {
  singleton.isComplete = true;
  singleton.isLoading = false;
  notifyListeners();
}

export const useOnboardingStatus = ({ enabled = true } = {}) => {
  const [state, setState] = useState({
    onboardingComplete: singleton.isComplete,
    loading: enabled ? singleton.isLoading : false,
    error: singleton.error,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const checkStatus = useCallback(() => {
    if (!enabled) return;
    fetchOnboardingStatus();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const listener = () => {
      setState({
        onboardingComplete: singleton.isComplete,
        loading: singleton.isLoading,
        error: singleton.error,
      });
    };

    singleton.listeners.add(listener);

    if (singleton.listeners.size === 1) {
      setupSingletonChannel();
      if (singleton.isLoading) {
        fetchOnboardingStatus();
      }
    }

    return () => {
      singleton.listeners.delete(listener);
      if (singleton.listeners.size === 0) {
        teardownSingletonChannel();
        singleton.isLoading = true;
        singleton.isComplete = false;
        singleton.error = null;
      }
    };
  }, [enabled]);

  return {
    onboardingComplete: state.onboardingComplete,
    loading: state.loading,
    error: state.error,
    refetch: checkStatus,
  };
};
