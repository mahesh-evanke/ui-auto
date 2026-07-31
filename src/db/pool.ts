/**
 * Builds a PostgreSQL connection pool from DB_* env vars - set via
 * e2e/config/config.yaml's `database:` section, or real env vars, which
 * always win (see core/config.ts). One pool per worker, shared by every
 * DbActions instance in that worker (see fixtures.ts's `dbPool` fixture) -
 * created lazily, only when a test actually requests `dbActions`.
 */
import { Pool } from 'pg';
import '../core/config'; // ensure config.yaml -> env mapping has run

export function createDbPool(): Pool {
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
}
