import { useSyncExternalStore } from "react";

// Client-side fee values for DISPLAY. The server (api/_lib/fees.js) is always
// authoritative for what's charged; this just makes the UI show the same numbers
// the CTO set in the CRM, instead of hardcoding them in every screen.
//
// Fetch strategy (in priority order):
//   1. GET /api/fees-config  — works in production (Vercel)
//   2. Supabase app_settings — fallback for dev (Express server has no fees route)
//   3. FEE_DEFAULTS          — hardcoded last resort

export const FEE_DEFAULTS = {
  ISIN_FEE_PER_ASSET:          25,     // R0.25 per ISIN — matches api/_lib/fees.js
  BROKER_FEE_RATE:             0.0025,
  TRANSACTION_FEE_RATE:        0.008,  // 0.8% — was incorrectly 0.038 (3.8%)
  WALLET_TRANSACTION_FEE_RATE: 0.008,  // 0.8% — was incorrectly 0.01 (1%)
  OZOW_TRANSACTION_FEE_RATE:   0.025,  // 2.5% — matches api/_lib/fees.js
  CASH_BUFFER_RATE:            0.08,
  AUM_FEE_RATE:                0.0099, // Annual management fee — display only (0.99% p.a.)
};

const num = (v, d) => (v == null || v === "" || isNaN(Number(v)) ? d : Number(v));

function mapFees(f) {
  return {
    ISIN_FEE_PER_ASSET:          num(f.ISIN_FEE_PER_ASSET          ?? f.isinFeePerAsset,                              FEE_DEFAULTS.ISIN_FEE_PER_ASSET),
    BROKER_FEE_RATE:             num(f.BROKER_FEE_RATE             ?? f.brokerFeeRate,                                 FEE_DEFAULTS.BROKER_FEE_RATE),
    TRANSACTION_FEE_RATE:        num(f.TRANSACTION_FEE_RATE        ?? f.transactionFeeRate,                            FEE_DEFAULTS.TRANSACTION_FEE_RATE),
    WALLET_TRANSACTION_FEE_RATE: num(f.WALLET_TRANSACTION_FEE_RATE ?? f.walletTransactionFeeRate,                      FEE_DEFAULTS.WALLET_TRANSACTION_FEE_RATE),
    OZOW_TRANSACTION_FEE_RATE:   num(f.OZOW_TRANSACTION_FEE_RATE   ?? f.ozowTransactionFeeRate,                        FEE_DEFAULTS.OZOW_TRANSACTION_FEE_RATE),
    CASH_BUFFER_RATE:            num(f.CASH_BUFFER_RATE            ?? f.EXECUTION_RESERVE_RATE ?? f.executionReserveRate, FEE_DEFAULTS.CASH_BUFFER_RATE),
    AUM_FEE_RATE:                num(f.AUM_FEE_RATE                ?? f.aumFeeRate,                                    FEE_DEFAULTS.AUM_FEE_RATE),
  };
}

let _fees = { ...FEE_DEFAULTS };
const listeners = new Set();
let _fetchStarted = false;

async function trySupabaseFees() {
  try {
    const { supabase } = await import("./supabase.js");
    if (!supabase) return null;
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "fees")
      .maybeSingle();
    if (!data?.value || typeof data.value !== "object") return null;
    return mapFees(data.value);
  } catch {
    return null;
  }
}

function notify() {
  listeners.forEach((l) => l());
}

function ensureFetch() {
  if (_fetchStarted) return;
  _fetchStarted = true;

  fetch("/api/fees-config")
    .then((r) => (r.ok ? r.json() : null))
    .then(async (j) => {
      if (j && j.success && j.fees) {
        _fees = mapFees(j.fees);
        notify();
        return;
      }
      // API route not available in Express dev — fall back to Supabase
      const sb = await trySupabaseFees();
      if (sb) {
        _fees = sb;
        notify();
      }
    })
    .catch(async () => {
      const sb = await trySupabaseFees();
      if (sb) {
        _fees = sb;
        notify();
      }
    });
}

function subscribe(cb) {
  listeners.add(cb);
  ensureFetch();
  return () => listeners.delete(cb);
}
function getSnapshot() { return _fees; }

export function useFees() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
