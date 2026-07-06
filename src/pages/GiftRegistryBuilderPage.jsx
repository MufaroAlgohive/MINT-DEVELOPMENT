import React, { useState, useEffect } from "react";
import { useRegistryDetail } from "../lib/useGiftRegistry.js";
import { supabaseReady } from "../lib/supabase.js";
import { centsToRand, calcMinTrancheForAsset } from "../lib/giftRegistryUtils.js";

/**
 * Add/remove shares, ETFs, baskets to a registry.
 * Entry: navigateTo("giftRegistryBuilder", { registryId })
 * Next:  navigateTo("giftRegistryPreview", { registryId })
 */
export default function GiftRegistryBuilderPage({ registryId, registry: initialRegistry, onNavigate, onBack }) {
  const { registry, loading, reload } = useRegistryDetail(registryId);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [quantityMap, setQuantityMap] = useState({});
  const [error, setError] = useState(null);

  const current = registry || initialRegistry;
  const items = current?.items || [];

  // Search securities from existing securities_c table
  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const session = await (await supabaseReady).auth.getSession();
        const token = session?.data?.session?.access_token;
        const res = await fetch(`/api/markets/search?q=${encodeURIComponent(search)}&limit=10`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        setSearchResults(json.results || json.securities || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  async function handleAdd(security) {
    const qty = quantityMap[security.id] || quantityMap[security.isin] || 1;
    setAddingId(security.id || security.isin);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch("/api/gift-registry/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          registryId,
          isin: security.isin,
          instrumentType: security.type || "SHARE",
          targetQuantity: qty,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not add item");
      setSearch("");
      setSearchResults([]);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setAddingId(null);
    }
  }

  async function handleRemove(itemId) {
    setRemovingId(itemId);
    setError(null);
    try {
      const session = await (await supabaseReady).auth.getSession();
      const token = session?.data?.session?.access_token;
      const res = await fetch(`/api/gift-registry/items/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not remove item");
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setRemovingId(null);
    }
  }

  function handlePreview() {
    if (typeof onNavigate === "function") onNavigate("giftRegistryPreview", { registryId, registry: current });
  }

  return (
    <div className="min-h-screen bg-[#f8f9fc] pb-28">
      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 rounded-xl text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-800">Add Shares</h1>
            <p className="text-xs text-gray-400 truncate">{current?.title || "Your registry"}</p>
          </div>
        </div>
      </div>

      <div className="px-5 pt-5 space-y-5">
        {/* Search */}
        <div>
          <label className="text-xs text-gray-500 font-medium block mb-2">Search shares, ETFs, or baskets</label>
          <div className="relative">
            <input
              className="w-full border border-gray-200 rounded-2xl px-4 py-3 pl-10 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
              placeholder="e.g. MTN, Naspers, Satrix 40…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <svg className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="mt-2 bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
              {searchResults.map((sec) => {
                const minQty = calcMinTrancheForAsset(sec.last_price);
                return (
                  <div key={sec.id || sec.isin} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                    {sec.logo_url ? (
                      <img src={sec.logo_url} className="w-8 h-8 rounded-lg object-cover" alt={sec.name} />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                        <span className="text-purple-700 font-bold text-xs">{(sec.name || "?")[0]}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{sec.name}</p>
                      <p className="text-xs text-gray-400">{sec.isin} · ~{centsToRand(sec.last_price)}</p>
                    </div>
                    {/* Qty input */}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={minQty}
                        step={1}
                        className="w-14 border border-gray-200 rounded-xl px-2 py-1.5 text-sm text-center text-gray-800 bg-gray-50 focus:outline-none"
                        value={quantityMap[sec.id || sec.isin] || minQty}
                        onChange={(e) =>
                          setQuantityMap((m) => ({
                            ...m,
                            [sec.id || sec.isin]: Math.max(minQty, parseInt(e.target.value) || minQty),
                          }))
                        }
                      />
                      <button
                        onClick={() => handleAdd(sec)}
                        disabled={addingId === (sec.id || sec.isin)}
                        className="px-3 py-1.5 rounded-xl bg-[#6B21A8] text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {addingId === (sec.id || sec.isin) ? "…" : "Add"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {searching && (
            <p className="text-xs text-gray-400 mt-2 text-center">Searching…</p>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Current items */}
        <div>
          <p className="text-xs text-gray-500 font-medium mb-3">
            Your wishlist ({items.length} item{items.length !== 1 ? "s" : ""})
          </p>

          {loading && !current && (
            <div className="space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-16 bg-white rounded-2xl animate-pulse" />)}
            </div>
          )}

          {items.length === 0 && !loading && (
            <div className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-200">
              <p className="text-gray-400 text-sm">Search above to add shares to your registry</p>
            </div>
          )}

          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="bg-white rounded-2xl p-3.5 flex items-center gap-3 border border-gray-100">
                {item.logo_url ? (
                  <img src={item.logo_url} className="w-9 h-9 rounded-xl border border-gray-100" alt={item.name} />
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center">
                    <span className="text-purple-700 font-bold text-sm">{(item.name || item.isin || "?")[0]}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{item.name || item.isin}</p>
                  <p className="text-xs text-gray-400">{item.target_quantity} share{item.target_quantity !== 1 ? "s" : ""} · ~{centsToRand(item.price_snapshot_cents)}/share</p>
                </div>
                <button
                  onClick={() => handleRemove(item.id)}
                  disabled={removingId === item.id}
                  className="p-2 rounded-xl text-red-400 hover:bg-red-50 disabled:opacity-40"
                >
                  {removingId === item.id ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      {items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-5 py-4 safe-bottom">
          <button
            onClick={handlePreview}
            className="w-full py-4 rounded-2xl bg-[#6B21A8] text-white font-semibold text-sm"
          >
            Preview & publish →
          </button>
        </div>
      )}
    </div>
  );
}
