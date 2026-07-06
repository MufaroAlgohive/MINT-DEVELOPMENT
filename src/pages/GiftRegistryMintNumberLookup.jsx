import React, { useState } from "react";
import { fetchRegistriesByMintNumber } from "../lib/useGiftRegistry.js";
import { OCCASION_LABELS, getRegistryProgress } from "../lib/giftRegistryUtils.js";
import GiftRegistryProgressBar from "../components/GiftRegistryProgressBar.jsx";

/**
 * Search for a MINT user's active registries by their MINT number.
 * Entry: navigateTo("giftRegistryLookup")
 */
export default function GiftRegistryMintNumberLookup({ onNavigate, onBack }) {
  const [mintNumber, setMintNumber] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSearch() {
    const cleaned = mintNumber.trim().toUpperCase();
    if (!cleaned) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const registries = await fetchRegistriesByMintNumber(cleaned);
      setResults(registries);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleOpen(reg) {
    if (typeof onNavigate === "function") {
      onNavigate("giftRegistryPublic", { token: reg.share_token });
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f9fc] pb-24">
      {/* Header */}
      <div className="bg-white px-5 pt-14 pb-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 -ml-2 rounded-xl text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-800">Find a Registry</h1>
            <p className="text-xs text-gray-400">Search by MINT number</p>
          </div>
        </div>
      </div>

      <div className="px-5 pt-6 space-y-4">
        <div>
          <label className="text-xs text-gray-500 font-medium block mb-2">
            Enter a MINT number
          </label>
          <div className="flex gap-2">
            <input
              className="flex-1 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-purple-300 uppercase"
              placeholder="e.g. LON…2026"
              value={mintNumber}
              onChange={(e) => setMintNumber(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button
              onClick={handleSearch}
              disabled={!mintNumber.trim() || loading}
              className="px-5 py-3 rounded-2xl bg-[#6B21A8] text-white text-sm font-semibold disabled:opacity-40"
            >
              {loading ? "…" : "Search"}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 text-center">{error}</p>
        )}

        {results !== null && results.length === 0 && (
          <div className="text-center py-10">
            <p className="text-2xl mb-2">🔍</p>
            <p className="font-medium text-gray-700">No active registries found</p>
            <p className="text-sm text-gray-400 mt-1">
              This person may not have any open registries right now.
            </p>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 font-medium">{results.length} active registr{results.length === 1 ? "y" : "ies"} found</p>
            {results.map((reg) => {
              const progress = getRegistryProgress(reg.items || []);
              const eventDate = reg.event_date
                ? new Date(reg.event_date).toLocaleDateString("en-ZA", {
                    day: "numeric", month: "short", year: "numeric",
                  })
                : null;

              return (
                <button
                  key={reg.id}
                  onClick={() => handleOpen(reg)}
                  className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 text-left"
                >
                  <p className="font-semibold text-gray-800 text-sm mb-0.5">{reg.title}</p>
                  <p className="text-xs text-gray-400 mb-3">
                    {OCCASION_LABELS[reg.occasion] || reg.occasion}
                    {eventDate ? ` · ${eventDate}` : ""}
                  </p>
                  <GiftRegistryProgressBar
                    percent={progress.percent}
                    filledQty={progress.funded}
                    targetQty={progress.total}
                    height="h-1.5"
                  />
                  <p className="text-[10px] text-purple-600 font-medium mt-1.5 text-right">
                    View registry →
                  </p>
                </button>
              );
            })}
          </div>
        )}

        <div className="text-center pt-4">
          <p className="text-xs text-gray-400">
            Don't know the MINT number? Ask them to share their registry link directly.
          </p>
        </div>
      </div>
    </div>
  );
}
