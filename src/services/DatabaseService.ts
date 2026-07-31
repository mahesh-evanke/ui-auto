/**
 * Thin factory dispatching to the right connection-pool builder for the
 * configured database engine. Only 'postgres' is wired today (db/pool.ts);
 * adding 'mysql'/'mssql' later means one new pool-builder file plus one new
 * case here - DbActions itself never needs to change, since it depends only
 * on the driver-agnostic QueryablePool interface (db/DbActions.ts).
 */
import type { QueryablePool } from '../db/DbActions';
import { createDbPool } from '../db/pool';

export type DatabaseEngine = 'postgres';

export function createDatabaseService(engine: DatabaseEngine = 'postgres'): QueryablePool {
  switch (engine) {
    case 'postgres':
      return createDbPool();
    default:
      throw new Error(`Unsupported database engine "${engine}". Only "postgres" is wired today - add a new pool builder (see db/pool.ts) to support others.`);
  }
}
