import { useState, useEffect, useCallback } from "react";
import { supabaseReady } from "./supabase.js";

/**
 * Fetch all registries owned by the current user.
 */
export function useMyRegistries() {
  const [registries, setRegistries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch("/api/gift-registry/my-registries", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load registries");
      setRegistries(json.registries || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { registries, loading, error, reload: load };
}

/**
 * Fetch a single registry (owner view, auth required).
 */
export function useRegistryDetail(registryId) {
  const [registry, setRegistry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!registryId) return;
    setLoading(true);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch(`/api/gift-registry/${registryId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load registry");
      setRegistry(json.registry);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [registryId]);

  useEffect(() => { load(); }, [load]);

  return { registry, loading, error, reload: load };
}

/**
 * Fetch a registry by its public share token (no auth required to view).
 */
export function usePublicRegistry(token) {
  const [registry, setRegistry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gift-registry/public/${token}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Registry not found");
      setRegistry(json.registry);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  return { registry, loading, error, reload: load };
}

/**
 * Fetch contributions for a registry (owner only).
 */
export function useRegistryContributions(registryId) {
  const [contributions, setContributions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!registryId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await (await supabaseReady).auth.getSession();
        const token = session?.data?.session?.access_token;
        const res = await fetch(`/api/gift-registry/${registryId}/contributions`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!cancelled) setContributions(json.contributions || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [registryId]);

  return { contributions, loading, error };
}

/**
 * Look up active registries for a MINT number.
 */
export async function fetchRegistriesByMintNumber(mintNumber) {
  const res = await fetch(`/api/gift-registry/by-mint-number/${encodeURIComponent(mintNumber)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Not found");
  return json.registries || [];
}
