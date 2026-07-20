import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../server/index.cjs', import.meta.url), 'utf8');
const start = source.indexOf('async function computeAndSaveStrategyReturns()');
const end = source.indexOf('// Market open', start);
assert.ok(start >= 0 && end > start, 'strategy return job must exist');
const job = source.slice(start, end);

const checks = [
  [/from\('strategy_returns_effective_c'\)/, 'reads the canonical return contract'],
  [/from\('strategy_composition_log_c'\)/, 'resolves effective-dated composition'],
  [/from\('strategy_valuation_rules_c'\)/, 'includes global continuity cash'],
  [/publish_guarded_strategy_return/, 'publishes through the guarded RPC'],
  [/compositionChanged/, 'detects a rebalance boundary'],
  [/BOUNDARY BLOCKED/, 'blocks an unreconciled boundary'],
  [/price_timestamp_is_oldest_used:\s*true/, 'records conservative price freshness'],
];

for (const [pattern, label] of checks) assert.match(job, pattern, label);
assert.doesNotMatch(job, /from\('strategies_returns_c'\)\s*\.delete\(/s, 'never deletes a production return before publishing');
assert.doesNotMatch(job, /from\('strategies_returns_c'\)\s*\.insert\(/s, 'never writes the legacy return table directly');

console.log(`guarded strategy return job: ${checks.length + 2}/${checks.length + 2} green`);
