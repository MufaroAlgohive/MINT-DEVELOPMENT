import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";

const emptyProfile = {
  id: null,
  email: "",
  firstName: "",
  lastName: "",
  avatarUrl: "",
  phoneNumber: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  idNumber: "",
  mintNumber: "",
  wallet_balance: 0, // ADDED wallet_balance
  watchlist: [],
  declarations: null,
};

const buildProfile = ({ user, row }) => {
  const metadata = user?.user_metadata || {};

  // Google OAuth puts names in full_name/name/given_name/family_name.
  // Email/password signup uses first_name/last_name. Handle both.
  const googleFullName = metadata.full_name || metadata.name || "";
  const googleParts = googleFullName.trim().split(/\s+/);
  const googleFirst = googleParts[0] || "";
  const googleLast = googleParts.slice(1).join(" ");

  // Treat a DB value of "Unknown" (set by a legacy trigger fallback) as empty
  // so that the real name from OAuth metadata takes precedence.
  const dbFirst = row?.first_name && row.first_name.toLowerCase() !== "unknown" ? row.first_name : "";
  const dbLast  = row?.last_name  && row.last_name.toLowerCase()  !== "unknown" ? row.last_name  : "";

  return {
    id: row?.id || user?.id || "",
    email: row?.email || user?.email || "",
    firstName: dbFirst || metadata.first_name || metadata.given_name || googleFirst || "",
    lastName:  dbLast  || metadata.last_name  || metadata.family_name || googleLast  || "",
    avatarUrl: row?.avatar_url || metadata.avatar_url || metadata.picture || "",
    phoneNumber: row?.phone_number || metadata.phone_number || "",
    dateOfBirth: row?.date_of_birth || metadata.date_of_birth || "",
    gender: row?.gender || metadata.gender || "",
    address: row?.address || metadata.address || "",
    idNumber: row?.id_number || metadata.id_number || "",
    mintNumber: row?.mint_number || row?.wallet_mint_number || "",
    wallet_balance: row?.wallet_balance ?? row?.wallets_balance ?? 0,
    watchlist: row?.watchlist || [],
    declarations: row?.declarations || null,
  };
};

let globalProfileCache = null;

export const useProfile = ({ enabled = true } = {}) => {
  const [profile, setProfile] = useState(globalProfileCache || emptyProfile);
  const [loading, setLoading] = useState(enabled && !globalProfileCache);

  const loadProfile = useCallback(async () => {
    if (!enabled) {
      if (!globalProfileCache) setLoading(false);
      return;
    }
    try {
      if (!supabase) {
        setLoading(false);
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        setProfile(emptyProfile);
        setLoading(false);
        return;
      }

      const user = userData.user;
      let rowData = null;
      let rowError = null;

      const { data: d1, error: e1 } = await supabase
        .from("profiles")
        .select(
          "id, first_name, last_name, email, avatar_url, phone_number, date_of_birth, gender, address, id_number, watchlist, declarations"
        )
        .eq("id", user.id)
        .maybeSingle();

      // Fetch from wallets table as well
      const { data: wData } = await supabase
        .from("wallets")
        .select("balance, mint_number")
        .eq("user_id", user.id)
        .maybeSingle();

      const rowToBuild = d1 || { id: user.id, email: user.email };
      if (wData) {
        rowToBuild.wallets_balance = wData.balance;
        rowToBuild.wallet_mint_number = wData.mint_number;
      }

      if (!e1) {
        rowData = rowToBuild;
      } else if (e1.message?.includes('mint_number')) {
        const { data: d2, error: e2 } = await supabase
          .from("profiles")
          .select(
            "id, first_name, last_name, email, avatar_url, phone_number, date_of_birth, gender, address, id_number, watchlist, declarations"
          )
          .eq("id", user.id)
          .maybeSingle();
        rowData = e2 ? null : d2;
        rowError = e2;
      } else {
        rowError = e1;
      }

      const built = buildProfile({ user, row: rowError ? null : rowData });
      globalProfileCache = built;
      setProfile(built);
      setLoading(false);

      // If the DB row has a stale "Unknown" / empty name but we now have the
      // real name from OAuth metadata, write it back so the DB stays in sync.
      const rawFirst = rowData?.first_name || "";
      const rawLast  = rowData?.last_name  || "";
      const needsNameSync =
        built.firstName &&
        (!rawFirst || rawFirst.toLowerCase() === "unknown") &&
        (!rawLast  || rawLast.toLowerCase()  === "unknown");
      if (needsNameSync) {
        try {
          await supabase.from("profiles").upsert({
            id:         user.id,
            first_name: built.firstName,
            last_name:  built.lastName,
            email:      built.email,
          }, { onConflict: "id" });
        } catch (_syncErr) {
          // Non-fatal — display is already correct from metadata
        }
      }

      if (!built.mintNumber && user.id) {
        try {
          const { data: sess } = await supabase.auth.getSession();
          const token = sess?.session?.access_token;
          if (token) {
            const resp = await fetch('/api/user/ensure-mint-number', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            });
            if (resp.ok) {
              const result = await resp.json();
              if (result.mint_number) {
                setProfile(prev => ({ ...prev, mintNumber: result.mint_number }));
              }
            }
          }
        } catch (mintErr) {
          console.log('Mint number generation deferred');
        }
      }
    } catch (error) {
      console.error("Failed to load profile", error);
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    loadProfile();

    // Safety timer — if the profile hasn't loaded in 6 s, release the skeleton
    // so the page doesn't hang forever (e.g. when getUser is slow/throttled)
    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 6000);

    let authSub;
    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
            await loadProfile();
          } else if (event === 'SIGNED_OUT') {
            globalProfileCache = null;
            setProfile(emptyProfile);
            setLoading(false);
          }
        }
      );
      authSub = subscription;
    }

    const handleProfileUpdate = () => {
      loadProfile();
    };
    window.addEventListener("profile-updated", handleProfileUpdate);
    return () => {
      clearTimeout(safetyTimer);
      if (authSub) authSub.unsubscribe();
      window.removeEventListener("profile-updated", handleProfileUpdate);
    };
  }, [loadProfile, enabled]);

  const refetch = useCallback(() => {
    loadProfile();
  }, [loadProfile]);

  return { profile, loading, setProfile, refetch };
};

