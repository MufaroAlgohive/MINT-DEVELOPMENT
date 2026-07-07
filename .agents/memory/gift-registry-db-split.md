---
name: Gift registry database split
description: pgPool and supabaseAdmin connect to SEPARATE databases; all gift/securities data lives in Supabase only.
---

## Rule
Never use pgPool to query or update gift_events, gift_registry_items, or any application data. All gift registry data lives in Supabase, accessed exclusively via supabaseAdmin REST.

**Why:** SUPABASE_DB_URL points to a local PostgreSQL — pgPool queries against gift_events return 0 rows. securities_c does not exist in the local DB at all. Any ALTER TABLE run via pgPool does NOT add the column to Supabase, so supabaseAdmin writes to a non-existent column will silently no-op.

**How to apply:**
- DDL migrations (local schema only): pgPool is fine
- Gift registry CRUD: supabaseAdmin only
- Preview logos: store as flat top-level user_metadata keys `gift_rp_<registryId>` via `supabaseAdmin.auth.admin.updateUserById` — Supabase merges user_metadata at top level, so each registry key is written atomically (no read-modify-write race between concurrent adds)
- Never add a column to gift_events via pgPool ALTER TABLE and then try to write it via supabaseAdmin — Supabase won't see the column
