import pg from 'pg';

const { Pool } = pg;

let _pool = null;

/**
 * Returns a singleton pg Pool for direct PostgreSQL access.
 * Used in gift-registry endpoints that need atomic transactions
 * (BEGIN/COMMIT/ROLLBACK) which aren't possible via the Supabase JS client.
 *
 * Connection string priority:
 *   1. SUPABASE_DB_URL  — explicit Supabase Postgres URL
 *   2. DATABASE_URL     — generic fallback
 */
export function createPool() {
  if (_pool) return _pool;

  const connectionString =
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'No database connection string found. Set SUPABASE_DB_URL or DATABASE_URL.'
    );
  }

  _pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  _pool.on('error', (err) => {
    console.warn('[pgPool] Idle client error:', err.message);
  });

  return _pool;
}
