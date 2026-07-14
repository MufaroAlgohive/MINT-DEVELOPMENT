/**
 * One-time backfill script — strategy returns 1d_pct + Jul 13/14 basket_value
 *
 * What this does:
 *  1. Fetches all 2026 strategies_returns_c rows (which have basket_value but null 1d_pct)
 *  2. For each strategy, walks dates in order and computes 1d_pct = Δbasket / basket_prev
 *  3. Fetches missing Jul 13 EOD prices from Yahoo (CLS, SHP, SDO, WBC, ADH, GRT, MRP)
 *     and writes them to stock_returns_c
 *  4. Computes basket_value for Jul 13 and Jul 14 rows using current strategy templates
 *     and stock_returns_c prices for those dates
 *  5. Writes all updates to the DB
 *
 * Run:  node server/scripts/backfill-strategy-1d-pct.cjs
 */

'use strict';

const https = require('https');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────

function sbFetch(path, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL + path);
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const reqOpts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: options.prefer || '',
        ...(options.headers || {}),
      },
    };
    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function dbGet(path) {
  const r = await sbFetch(path);
  if (!Array.isArray(r.data)) throw new Error(`GET ${path} failed: ${JSON.stringify(r.data)}`);
  return r.data;
}

async function dbPatch(table, match, updates) {
  const q = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  const r = await sbFetch(`/rest/v1/${table}?${q}`, {
    method: 'PATCH',
    body: updates,
    prefer: 'return=minimal',
  });
  return r.status;
}

async function dbUpsert(table, rows, onConflict) {
  const r = await sbFetch(`/rest/v1/${table}`, {
    method: 'POST',
    body: rows,
    prefer: `resolution=merge-duplicates,return=minimal`,
    headers: onConflict ? { 'Prefer': `resolution=merge-duplicates,return=minimal` } : {},
  });
  return r.status;
}

// ── Yahoo Finance EOD price fetcher ───────────────────────────────────────────

function yahooFetch(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function fetchYahooEodPrice(baseSymbol, targetDate) {
  // targetDate = "YYYY-MM-DD"  — we want the closing price ON that date
  const sym = `${baseSymbol}.JO`;
  const t = new Date(targetDate + 'T12:00:00Z');
  const p1 = Math.floor(t.getTime() / 1000) - 7 * 86400;
  const p2 = Math.floor(t.getTime() / 1000) + 2 * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&period1=${p1}&period2=${p2}`;
  try {
    const json = await yahooFetch(url);
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    let bestPrice = null;
    for (let i = 0; i < timestamps.length; i++) {
      const d = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
      if (d <= targetDate && closes[i] > 0) bestPrice = Math.round(closes[i]);
    }
    return bestPrice;
  } catch (e) {
    console.warn(`  Yahoo fetch failed for ${sym}: ${e.message}`);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Strategy 1d_pct backfill ===\n');

  // ── Step 1: fetch all 2026 returns rows ────────────────────────────────────
  console.log('Step 1: Fetching all 2026 strategies_returns_c rows...');
  const rows = await dbGet(
    '/rest/v1/strategies_returns_c' +
    '?as_of_date=gte.2026-01-01' +
    '&select=strategy_id,as_of_date,basket_value,1d_pct' +
    '&order=strategy_id.asc,as_of_date.asc' +
    '&limit=2000'
  );
  console.log(`  ${rows.length} rows fetched`);

  // ── Step 2: compute 1d_pct for rows with basket_value ─────────────────────
  console.log('\nStep 2: Computing 1d_pct from consecutive basket_value pairs...');

  // Group by strategy
  const byStrategy = {};
  for (const row of rows) {
    (byStrategy[row.strategy_id] = byStrategy[row.strategy_id] || []).push(row);
  }

  const updates = []; // { strategy_id, as_of_date, 1d_pct }

  for (const [stratId, stratRows] of Object.entries(byStrategy)) {
    // stratRows are already sorted by as_of_date asc
    for (let i = 1; i < stratRows.length; i++) {
      const prev = stratRows[i - 1];
      const curr = stratRows[i];
      if (curr['1d_pct'] !== null) continue; // already has a value, skip
      if (!prev.basket_value || !curr.basket_value) continue; // can't compute without both

      const pct = ((curr.basket_value - prev.basket_value) / prev.basket_value) * 100;
      updates.push({ strategy_id: stratId, as_of_date: curr.as_of_date, '1d_pct': parseFloat(pct.toFixed(6)) });
    }
  }

  console.log(`  ${updates.length} 1d_pct values to write (from existing basket_values)`);

  // Write in batches of 50
  let written = 0;
  for (const upd of updates) {
    const status = await dbPatch(
      'strategies_returns_c',
      { strategy_id: upd.strategy_id, as_of_date: upd.as_of_date },
      { '1d_pct': upd['1d_pct'] }
    );
    if (status < 300) written++;
    else console.warn(`  PATCH failed (${status}) for ${upd.strategy_id} ${upd.as_of_date}`);
  }
  console.log(`  ${written}/${updates.length} rows updated`);

  // ── Step 3: fetch missing Jul 13 prices from Yahoo ────────────────────────
  console.log('\nStep 3: Fetching missing Jul 13 prices from Yahoo...');
  const MISSING_SYMBOLS = ['CLS', 'SHP', 'SDO', 'WBC', 'ADH', 'GRT', 'MRP'];
  const TARGET_DATE = '2026-07-13';

  const newPrices = {}; // base → cents
  for (const sym of MISSING_SYMBOLS) {
    process.stdout.write(`  Fetching ${sym}.JO for ${TARGET_DATE}... `);
    const price = await fetchYahooEodPrice(sym, TARGET_DATE);
    if (price) {
      newPrices[sym] = price;
      console.log(`${price}c`);
    } else {
      console.log('NOT FOUND');
    }
  }

  // Write to stock_returns_c
  const priceRows = Object.entries(newPrices).map(([base, price]) => ({
    symbol: `${base}.JO`,
    as_of_date: TARGET_DATE,
    current_price: price,
  }));

  if (priceRows.length) {
    console.log(`  Writing ${priceRows.length} price rows to stock_returns_c...`);
    const status = await dbUpsert('stock_returns_c', priceRows);
    console.log(`  Upsert status: ${status}`);
  }

  // ── Step 4: fetch all strategies and build basket_value for Jul 13 & 14 ───
  console.log('\nStep 4: Computing basket_value for Jul 13 and Jul 14...');

  const strategies = await dbGet(
    '/rest/v1/strategies_c?status=eq.active&select=id,name,holdings'
  );

  // Collect all symbols needed
  const allSymbols = new Set();
  for (const s of strategies) {
    for (const h of (s.holdings || [])) {
      const sym = (h.symbol || h.ticker || '').toUpperCase();
      if (sym) allSymbols.add(sym);
    }
  }
  const symList = [...allSymbols].join(',');

  // Fetch Jul 13 prices (now complete after step 3)
  const jul13Prices = await dbGet(
    `/rest/v1/stock_returns_c?as_of_date=eq.${TARGET_DATE}&symbol=in.(${encodeURIComponent(symList)})&select=symbol,current_price`
  );
  const jul13Map = {};
  for (const r of jul13Prices) {
    const base = r.symbol.split('.')[0].toUpperCase();
    if (!jul13Map[base]) jul13Map[base] = r.current_price;
  }
  console.log(`  Jul 13 price map: ${Object.keys(jul13Map).length} symbols`);

  // Fetch Jul 14 prices (use stock_returns_c for Jul 14 — already written by EOD job)
  const jul14Prices = await dbGet(
    `/rest/v1/stock_returns_c?as_of_date=eq.2026-07-14&symbol=in.(${encodeURIComponent(symList)})&select=symbol,current_price`
  );
  // Fall back to Jul 13 prices for symbols missing on Jul 14
  const jul14Map = { ...jul13Map };
  for (const r of jul14Prices) {
    const base = r.symbol.split('.')[0].toUpperCase();
    jul14Map[base] = r.current_price; // override with Jul 14 if available
  }
  console.log(`  Jul 14 price map: ${Object.keys(jul14Map).length} symbols`);

  // For each strategy, compute basket_value for Jul 13 and Jul 14
  // and look up the most recent previous basket_value for 1d_pct computation

  // Get the most recent basket_value before Jul 13 for each strategy
  const prevBaskets = await dbGet(
    '/rest/v1/strategies_returns_c' +
    '?as_of_date=lt.2026-07-13' +
    '&basket_value=not.is.null' +
    '&select=strategy_id,as_of_date,basket_value' +
    '&order=as_of_date.desc' +
    '&limit=100'
  );
  const prevBasketMap = {}; // strategy_id → basket_value of most recent row before Jul 13
  for (const r of prevBaskets) {
    if (!prevBasketMap[r.strategy_id]) prevBasketMap[r.strategy_id] = r.basket_value;
  }

  for (const strategy of strategies) {
    const holdings = strategy.holdings || [];
    if (!holdings.length) continue;

    const computeBasket = (priceMap) => {
      let val = 0;
      let matched = 0;
      for (const h of holdings) {
        const sym = (h.symbol || h.ticker || '').split('.')[0].toUpperCase();
        const shares = Number(h.shares || h.quantity || 1);
        const price = priceMap[sym];
        if (!price) { console.warn(`    Missing price for ${sym} in ${strategy.name}`); continue; }
        val += shares * price;
        matched++;
      }
      return matched === holdings.length ? val : null; // require all symbols
    };

    const basket13 = computeBasket(jul13Map);
    const basket14 = computeBasket(jul14Map);
    const prevBasket = prevBasketMap[strategy.id];

    console.log(`  ${strategy.name}: Jul13=${basket13}c, Jul14=${basket14}c, prev=${prevBasket}c`);

    // Update Jul 13
    if (basket13 !== null) {
      const pct13 = prevBasket ? parseFloat((((basket13 - prevBasket) / prevBasket) * 100).toFixed(6)) : null;
      await dbPatch(
        'strategies_returns_c',
        { strategy_id: strategy.id, as_of_date: '2026-07-13' },
        { basket_value: basket13, '1d_pct': pct13 }
      );
    }

    // Update Jul 14
    if (basket14 !== null) {
      const pct14 = basket13 ? parseFloat((((basket14 - basket13) / basket13) * 100).toFixed(6)) : null;
      await dbPatch(
        'strategies_returns_c',
        { strategy_id: strategy.id, as_of_date: '2026-07-14' },
        { basket_value: basket14, '1d_pct': pct14 }
      );
    }
  }

  console.log('\n=== Backfill complete ===');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
