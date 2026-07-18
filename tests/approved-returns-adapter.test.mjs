import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync(new URL("../api/returns/approved.js", import.meta.url), "utf8");
const adapter = fs.readFileSync(new URL("../src/lib/approvedReturns.js", import.meta.url), "utf8");
const hook = fs.readFileSync(new URL("../src/lib/useUserStrategies.js", import.meta.url), "utf8");

assert.match(api, /authenticateUser/);
assert.match(api, /\.eq\("user_id", user\.id\)/);
assert.match(api, /\.eq\("status", "PROMOTED"\)/);
assert.match(api, /strategy_pnl_cents: Math\.round\(opening \* twr \/ 100\)/);
assert.match(adapter, /Authorization: `Bearer \$\{session\.access_token\}`/);
assert.match(hook, /approvedClientRows\.slice\(\)\.reverse\(\)/);
assert.match(hook, /basket_value: row\.complete_nav_cents/);
assert.match(hook, /ytd_pct: row\.gross_strategy_twr_pct/);
assert.match(hook, /approvedRow\.strategy_pnl_cents/);
assert.match(hook, /approvedRow\.opening_performance_nav_cents/);

console.log("approved returns adapter: 10/10 green");
