---
name: pgPool optional-connection-string danger
description: Why adding an unreachable direct Postgres URL is worse than leaving it unset in this codebase
---

`server/index.cjs` builds a shared `pgPool` from `SUPABASE_DB_URL || DATABASE_URL` (Replit's own
provisioned Postgres). Many features (gift registry sweeper, family migrations, funeral-cover
migrations, session validation) guard with `if (pgPool)` and degrade gracefully when it's `null`.

**Why this matters:** Supabase's direct (non-pooler) Postgres host is often unreachable from the
Replit sandbox network (times out on port 5432). If you add `SUPABASE_DB_URL` pointing at that
direct host, `pgPool` stops being `null` and starts being a *real but broken* pool — every
consumer now attempts a real connection and hangs until timeout, producing cascading
"Connection terminated due to connection timeout" errors across totally unrelated features
(observed: session validation, family account migrations, funeral-cover migrations), not just
the feature you were trying to fix.

**How to apply:** Don't add a direct Supabase DB connection string as a "safety net" unless you've
confirmed it's actually reachable (e.g. test with a raw `pg` client first). If you need atomic
multi-row updates against Supabase-managed tables but can't get a working direct/pooler
connection string, use the Supabase JS client (service role) with optimistic-concurrency
(compare-and-swap UPDATE + `.eq()` on the previous value) instead of raw SQL transactions —
existing CHECK constraints on the table (e.g. `no_oversell`) act as a safety net.

Also: `SUPABASE_DB_URL` is stored as a *secret*, not a plain env var — `deleteEnvVars` (env var
tool) silently no-ops on it. Secrets can only be removed by the user via the Secrets tab in the
Replit GUI.

**Fixed:** The global `pgPool` now uses `DATABASE_URL` only (Replit's local Postgres). `SUPABASE_DB_URL`
is reserved exclusively for one-off isolated pools (e.g. trigger fix). The direct Supabase port 5432
is unreachable from Replit's network so any direct-connection attempt will time out — use the Supabase
JS admin client or Supabase SQL Editor instead for schema changes.
