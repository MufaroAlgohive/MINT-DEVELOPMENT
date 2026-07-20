import { supabase } from "./supabase.js";

export const normalizeSymbol = (symbol) => {
  if (typeof symbol !== "string") return symbol;
  const trimmed = symbol.trim();
  if (!trimmed) return symbol;
  return trimmed.split(".")[0].toUpperCase();
};

export const getHoldingsArray = (strategy) => {
  const holdings = strategy?.holdings;
  if (Array.isArray(holdings)) return holdings;
  if (typeof holdings === "string") {
    try {
      const parsed = JSON.parse(holdings);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }
  return [];
};

export const getHoldingSymbol = (holding) => {
  const rawSymbol = holding?.ticker || holding?.symbol || holding;
  return normalizeSymbol(rawSymbol);
};

export const buildHoldingsBySymbol = (holdingsSecurities) => {
  const map = new Map();
  holdingsSecurities.forEach((security) => {
    if (!security?.symbol) return;
    map.set(security.symbol, security);
    const normalized = normalizeSymbol(security.symbol);
    if (normalized && normalized !== security.symbol) {
      map.set(normalized, security);
    }
  });
  return map;
};

const MIN_ASSET_VALUE = 1000;

const getMinFromPrice = (price) => {
  if (!price || price <= 0 || !isFinite(price)) return null;
  if (price < MIN_ASSET_VALUE) {
    const shares = Math.ceil(MIN_ASSET_VALUE / price);
    return Math.max(Math.round(shares * price), MIN_ASSET_VALUE);
  }
  return Math.max(Math.round(price), MIN_ASSET_VALUE);
};


/**
 * Enrich an array of securities with live intraday prices from stock_intraday_c.
 * Adds `intradayPrice` (in Rands) to each security using the latest timestamp row.
 * Requires each security to have an `id` field (the securities_c PK).
 *
 * @param {Array} securities - Already-fetched securities with `id` field
 * @returns {Promise<Array>} Same array with `intradayPrice` added where available
 */
export const enrichSecuritiesWithIntradayPrices = async (securities) => {
  if (!supabase || !securities?.length) return securities;

  const ids = securities.map((s) => s.id).filter(Boolean);
  if (!ids.length) return securities;

  try {
    const { data: intradayRows, error } = await supabase
      .from("stock_intraday_c")
      .select("security_id, current_price, timestamp")
      .in("security_id", ids)
      .order("timestamp", { ascending: false });

    if (error) {
      console.warn("[enrichSecuritiesWithIntradayPrices] Error fetching intraday prices:", error.message);
      return securities;
    }

    const latestBySecurityId = new Map();
    for (const row of intradayRows || []) {
      if (!latestBySecurityId.has(row.security_id)) {
        latestBySecurityId.set(row.security_id, row);
      }
    }

    return securities.map((sec) => {
      const intraday = latestBySecurityId.get(sec.id);
      if (!intraday?.current_price) return sec;
      return {
        ...sec,
        intradayPrice: Number(intraday.current_price) / 100,
      };
    });
  } catch (err) {
    console.warn("[enrichSecuritiesWithIntradayPrices] Exception:", err);
    return securities;
  }
};

export const calculateMinInvestmentSync = (strategy, holdingsBySymbol) => {
  const holdings = getHoldingsArray(strategy);
  if (!holdings.length) {
    return strategy?.min_investment ? Math.round(strategy.min_investment / 100) : null;
  }
  // Price map not loaded yet — return null so callers show nothing instead of a stale DB fallback
  if (!holdingsBySymbol || holdingsBySymbol.size === 0) return null;
  let total = 0;
  let foundAny = false;
  for (const holding of holdings) {
    const rawSymbol = holding.symbol || holding.ticker;
    if (!rawSymbol) continue;
    const normalizedSym = normalizeSymbol(rawSymbol);
    const security = holdingsBySymbol.get(rawSymbol) || holdingsBySymbol.get(normalizedSym);
    const pricePerShare = security?.intradayPrice ?? (security?.last_price ? Number(security.last_price) / 100 : null);
    if (!pricePerShare) continue;
    foundAny = true;
    const shares = Number(holding.shares || holding.quantity || 1);
    if (shares <= 0) continue;
    total += shares * pricePerShare;
  }
  if (!foundAny) {
    // Price map is populated but none matched this strategy's symbols — fall back to DB value
    return strategy?.min_investment ? Math.round(strategy.min_investment / 100) : null;
  }
  // Continuity (liquidated) cash is part of the lot: a buyer funds securities PLUS
  // this cash and holds the full strategy value (securities + continuity = complete
  // value). continuity_cash_cents is attached from strategy_returns_effective_c.
  total += Number(strategy?.continuity_cash_cents || 0) / 100;
  return Math.round(total);
};

export const calculateMinInvestment = async (strategy, holdingsBySymbol) => {
  const holdings = getHoldingsArray(strategy);

  // If no holdings, use min_investment from database
  if (!holdings.length) {
    console.log(`⚠️ [${strategy?.name}] No holdings found, returning null or DB value`);
    return strategy?.min_investment ? Math.round(strategy.min_investment / 100) : null;
  }

  if (!supabase) {
    console.log(`❌ [${strategy?.name}] Supabase not available`);
    return strategy?.min_investment ? Math.round(strategy.min_investment / 100) : null;
  }

  try {
    let total = 0;
    console.log(`📊 [${strategy?.name}] Processing ${holdings.length} holdings`);

    for (const holding of holdings) {
      const symbol = holding.symbol || holding.ticker;
      const shares = Number(holding.shares || holding.quantity || 1);

      console.log(`  → Holding: symbol=${symbol}, shares=${shares}`);

      if (!symbol || shares <= 0) {
        console.log(`  ⊘ Skipped: no symbol or invalid shares`);
        continue;
      }

      console.log(`  🔎 Querying stock_intraday_c for ${symbol}...`);
      const { data, error } = await supabase
        .from("stock_intraday_c")
        .select("current_price")
        .eq("symbol", symbol)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn(`  ❌ Error fetching price for ${symbol}:`, error.message);
        continue;
      }

      if (!data?.current_price) {
        console.warn(`  ❌ No price data found for ${symbol}:`, data);
        continue;
      }

      const contribution = shares * data.current_price;
      console.log(`  ✓ ${symbol}: ${shares} × ${data.current_price} = ${contribution} cents`);
      total += contribution;
    }

    // Convert from cents to Rands and add 8% markup
    const resultBeforeMarkup = Math.round(total / 100);
    const result = Math.round(resultBeforeMarkup * 1.08);
    console.log(`✅ [${strategy?.name}] Total: ${total} cents → R${resultBeforeMarkup} + 8% markup → R${result}`);
    return result;
  } catch (err) {
    console.error(`❌ [${strategy?.name}] Error calculating min investment:`, err);
    return strategy?.min_investment ? Math.round(strategy.min_investment / 100) : null;
  }
};

export const getAdjustedShares = (holding, holdingsBySymbol) => {
  const rawSymbol = holding.ticker || holding.symbol || holding;
  const normalizedSym = normalizeSymbol(rawSymbol);
  const security = holdingsBySymbol.get(rawSymbol) || holdingsBySymbol.get(normalizedSym);
  let shares = Number(holding.shares || holding.quantity || 1);
  if (security?.last_price != null) {
    const pricePerShare = Number(security.last_price) / 100;
    const holdingValue = shares * pricePerShare;
    if (holdingValue < MIN_ASSET_VALUE && pricePerShare > 0) {
      shares = Math.ceil(MIN_ASSET_VALUE / pricePerShare);
    }
  }
  return shares;
};

export const getStrategyHoldingsSnapshot = (strategy, holdingsBySymbol) => {
  const holdings = getHoldingsArray(strategy);
  if (!holdings.length) return [];
  const sorted = [...holdings].sort((a, b) => {
    const weightA = Number(a.weight || a.shares || a.quantity || 0);
    const weightB = Number(b.weight || b.shares || b.quantity || 0);
    return weightB - weightA;
  });
  return sorted.map((holding) => {
    const rawSymbol = holding.ticker || holding.symbol || holding;
    const normalizedSym = normalizeSymbol(rawSymbol);
    const security = holdingsBySymbol.get(rawSymbol) || holdingsBySymbol.get(normalizedSym);
    return {
      id: security?.id || null,
      symbol: rawSymbol,
      name: security?.name || rawSymbol,
      logo_url: security?.logo_url || null,
    };
  });
};

export const getStrategyCurrentValue = (investedAmount, metrics) => {
  if (!investedAmount || investedAmount <= 0) return 0;
  if (!metrics) return investedAmount;
  const raw = metrics.r_ytd ?? metrics.r_ytd_pct ?? metrics.r_1y ?? metrics.r_1y_pct ?? metrics.r_3m ?? metrics.r_3m_pct ?? metrics.r_1m ?? metrics.r_1m_pct ?? 0;
  // Sanity check: returns must be a decimal fraction (e.g. 0.10 = 10%).
  // If the value is stored as a whole-number percentage (e.g. 10 instead of 0.10),
  // or is otherwise corrupted, cap to a safe range to prevent absurd portfolio values.
  const bestReturn = (typeof raw === "number" && isFinite(raw) && raw > -1 && raw < 5)
    ? raw
    : 0;
  return Number((investedAmount * (1 + bestReturn)).toFixed(2));
};

export const getStrategyReturnPct = (metrics) => {
  if (!metrics) return 0;
  const raw = metrics.r_ytd ?? metrics.r_ytd_pct ?? metrics.r_1y ?? metrics.r_1y_pct ?? metrics.r_3m ?? metrics.r_3m_pct ?? metrics.r_1m ?? metrics.r_1m_pct ?? 0;
  const bestReturn = (typeof raw === "number" && isFinite(raw) && raw > -1 && raw < 5)
    ? raw
    : 0;
  return bestReturn * 100;
};

export const computeExtendedSummary = (analytics) => {
  const curves = analytics?.curves || {};
  const allPoints = Object.values(curves).flat().map(p => p?.v).filter(v => v != null);

  if (allPoints.length < 2) {
    return { volatility: null, sharpe_ratio: null, max_drawdown: null, pct_positive_months: null };
  }

  // Daily returns from index values
  const returns = [];
  for (let i = 1; i < allPoints.length; i++) {
    returns.push((allPoints[i] - allPoints[i - 1]) / allPoints[i - 1]);
  }

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance * 252); // annualised

  const sharpe_ratio = volatility > 0 ? (mean * 252) / volatility : null;

  // Max drawdown
  let peak = allPoints[0];
  let max_drawdown = 0;
  for (const v of allPoints) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < max_drawdown) max_drawdown = dd;
  }

  // % positive months from calendar_returns
  const calReturns = analytics?.calendar_returns || [];
  const positiveMonths = calReturns.filter(r => r?.return > 0).length;
  const pct_positive_months = calReturns.length > 0 ? positiveMonths / calReturns.length : null;

  return { volatility, sharpe_ratio, max_drawdown, pct_positive_months };
};

/**
 * Calculates the aggregate YTD return for a strategy based on its holdings
 * and the individual YTD performance of the underlying securities.
 * Formula: (Total Value Today / Total Value on Jan 1st) - 1
 * 
 * @param {Object} strategy - The strategy object with holdings array
 * @param {Map} holdingsBySymbol - Map of Symbol -> Security Metrics
 * @returns {number|null} The calculated YTD return, or null if insufficient data
 */
export const calculateYtdReturn = (strategy, holdingsBySymbol) => {
  const holdings = getHoldingsArray(strategy);

  if (holdings.length > 0) {
    let todayValue = 0;
    let jan1Value = 0;
    let matched = 0;
    let skipped = 0;

    for (const holding of holdings) {
      const rawSymbol = holding.ticker || holding.symbol || holding;
      const normalizedSym = normalizeSymbol(rawSymbol);

      // Match security data from our map
      const security = holdingsBySymbol.get(rawSymbol) || holdingsBySymbol.get(normalizedSym);
      
      const lastPriceCents = Number(security?.last_price ?? 0);
      const ytdPerf = Number(security?.ytd_performance ?? NaN);

      if (lastPriceCents <= 0 || isNaN(ytdPerf)) {
        skipped++;
        continue;
      }

      // DATA SANITY CHECK: Identify garbage data or extreme outliers
      if (ytdPerf > 500 || ytdPerf < -90) {
        console.warn(`[calculateYtdReturn] Skipping ${rawSymbol} due to extreme YTD performance (${ytdPerf.toFixed(2)}%). Likely garbage data.`);
        skipped++;
        continue;
      }

      const lastPrice = lastPriceCents / 100;
      const shares = Number(holding.shares || holding.quantity || 1);
      
      const currentHoldingValue = shares * lastPrice;
      const jan1Price = lastPrice / (1 + (ytdPerf / 100));
      const jan1HoldingValue = shares * jan1Price;

      todayValue += currentHoldingValue;
      jan1Value += jan1HoldingValue;
      matched++;
    }

    if (matched > 0 && jan1Value > 0) {
      const calculatedReturn = (todayValue / jan1Value) - 1;
      console.log(`🧮 [calculateYtdReturn] ${strategy?.name || 'Strategy'}: result=${(calculatedReturn * 100).toFixed(2)}% (matched ${matched}/${holdings.length} holdings)`);
      return calculatedReturn;
    }
  }

  // Fallback to existing r_ytd metric from strategy if calculation isn't possible
  return strategy.strategy_metrics?.[0]?.r_ytd_pct ?? strategy.strategy_metrics?.[0]?.r_ytd ?? 0;
};