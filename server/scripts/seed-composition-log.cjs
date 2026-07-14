/**
 * One-time script — seed strategy_composition_log_c with historical compositions
 *
 * This must be run AFTER the strategy_composition_log_c table has been created
 * (the server creates it on startup via runStrategyCompositionLogMigration).
 *
 * Historical compositions derived from cc_audit_log:
 *   Yield Basket:     Jan 1 – Jun 14  →  NED×2, SUI×5, DIB×20, CLI×20, EXX×5
 *                     Jun 15 – Jun 30 →  NED×2, SUI×5, DIB×20, ABG×1, EXX×5
 *                     Jul 1 –  now    →  NED×2, SUI×5, DIB×20, ABG×1, TBS×3
 *   MINT Multi-sector: Jan 1 – Jun 15 →  PPH×20, OMU×13, VOD×5, ARL×3, NY1×6, TGA×3
 *                     Jun 16 – now    →  PPH×20, OMU×13, VOD×5, ARL×3, NY1×4, STX500×2
 *   MINT Diversified:  Jan 1 – Jun 17 →  GRT×28, DSY×3, MTN×4, SBK×3, VKE×18, CML×8, INL×3, MRP×3, STX500×4, STXNDQ×3
 *                     Jun 18 – now    →  GRT×22, DSY×1, MTN×2, SBK×1, MRP×2, STX500×2, STXNDQ×2
 *   All others: only one composition (current), effective from 2026-01-01
 *
 * Run:  node server/scripts/seed-composition-log.cjs
 */

'use strict';

const https = require('https');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars'); process.exit(1);
}

function sbFetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL + path);
    const body = opts.body ? JSON.stringify(opts.body) : undefined;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: opts.prefer || '',
      },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, data: d }); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const h = (sym, shares) => ({ symbol: `${sym}.JO`, shares });

// Historical phase definitions per strategy name
const PHASE_OVERRIDES = {
  'Yield Basket': [
    { effective_from: '2026-01-01', effective_to: '2026-06-14', holdings: [h('NED',2),h('SUI',5),h('DIB',20),h('CLI',20),h('EXX',5)] },
    { effective_from: '2026-06-15', effective_to: '2026-06-30', holdings: [h('NED',2),h('SUI',5),h('DIB',20),h('ABG',1),h('EXX',5)] },
    { effective_from: '2026-07-01', effective_to: null, holdings: [h('NED',2),h('SUI',5),h('DIB',20),h('ABG',1),h('TBS',3)] },
  ],
  'MINT Multi-sector': [
    { effective_from: '2026-01-01', effective_to: '2026-06-15', holdings: [h('PPH',20),h('OMU',13),h('VOD',5),h('ARL',3),h('NY1',6),h('TGA',3)] },
    { effective_from: '2026-06-16', effective_to: null, holdings: [h('PPH',20),h('OMU',13),h('VOD',5),h('ARL',3),h('NY1',4),h('STX500',2)] },
  ],
  'MINT Diversified Basket': [
    { effective_from: '2026-01-01', effective_to: '2026-06-17', holdings: [h('GRT',28),h('DSY',3),h('MTN',4),h('SBK',3),h('VKE',18),h('CML',8),h('INL',3),h('MRP',3),h('STX500',4),h('STXNDQ',3)] },
    { effective_from: '2026-06-18', effective_to: null, holdings: [h('GRT',22),h('DSY',1),h('MTN',2),h('SBK',1),h('MRP',2),h('STX500',2),h('STXNDQ',2)] },
  ],
};

async function main() {
  console.log('=== Seeding strategy_composition_log_c ===\n');

  // Fetch active strategies
  const { data: strategies } = await sbFetch('/rest/v1/strategies_c?status=eq.active&select=id,name,holdings');
  console.log(`Found ${strategies.length} active strategies\n`);

  // Clear existing log entries (idempotent re-seed)
  console.log('Clearing existing log entries...');
  const stratIds = strategies.map(s => s.id).join(',');
  await sbFetch(`/rest/v1/strategy_composition_log_c?strategy_id=in.(${stratIds})`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  });

  const logRows = [];

  for (const strategy of strategies) {
    const overrides = PHASE_OVERRIDES[strategy.name];

    if (overrides) {
      // Use historical phases from audit log
      for (const phase of overrides) {
        logRows.push({
          strategy_id: strategy.id,
          effective_from: phase.effective_from,
          effective_to: phase.effective_to,
          holdings: phase.holdings,
        });
      }
      console.log(`✓ ${strategy.name} — ${overrides.length} historical phases`);
    } else {
      // Single composition all year — current template
      logRows.push({
        strategy_id: strategy.id,
        effective_from: '2026-01-01',
        effective_to: null,
        holdings: strategy.holdings,
      });
      console.log(`✓ ${strategy.name} — 1 phase (unchanged)`);
    }
  }

  // Insert all log rows
  console.log(`\nInserting ${logRows.length} composition log entries...`);
  const { status } = await sbFetch('/rest/v1/strategy_composition_log_c', {
    method: 'POST',
    body: logRows,
    prefer: 'return=minimal',
  });
  console.log(`Insert status: ${status}`);

  if (status >= 200 && status < 300) {
    console.log('\n=== Seed complete ===');
  } else {
    console.error('\n=== Seed FAILED ===');
    process.exit(1);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
