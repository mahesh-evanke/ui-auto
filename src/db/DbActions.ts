/**
 * Reusable database verification methods - run a query and assert on its
 * results, the same fluent/chainable pattern as WebActions/ApiActions:
 *
 *   await dbActions
 *     .query('SELECT * FROM users WHERE email = $1', ['tom@example.com'])
 *     .expectRowCount(1)
 *     .saveQueryField('0.id', 'userId');
 *
 * query() is queued (not immediate) for the same reason ApiActions.sendRequest()
 * is: a second query() chained before the first expectRowCount() has actually
 * run would otherwise overwrite the pending result out of order.
 *
 * Depends only on a minimal `QueryablePool` shape (not a concrete driver
 * import), so any driver whose pool exposes `query(text, values?)` works -
 * see db/pool.ts, which builds the real `pg` Pool used by the `dbActions`
 * fixture.
 */
import { expect } from '@playwright/test';
import { Chainable } from '../core/Chainable';
import { ScenarioCache, getByPath } from '../cache/ScenarioCache';

export interface QueryablePool {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

type LastQueryResult = {
  rows: unknown[];
  rowCount: number;
};

export class DbActions extends Chainable<DbActions> {
  private lastResult?: LastQueryResult;

  constructor(
    private readonly pool: QueryablePool,
    readonly context: ScenarioCache = new ScenarioCache(),
  ) {
    super();
  }

  /**
   * Runs a query and stores its result for the next expectRowCount()/
   * saveQueryField()/saveQueryResult() call. `sql`/`params` can be a
   * zero-arg function instead of a plain value - it's only called when this
   * queued action actually runs, so it can safely reference a value saved
   * earlier in the same chain (see ScenarioCache).
   */
  query(sql: string | (() => string), params?: unknown[] | (() => unknown[])): DbActions {
    return this.enqueue(async () => {
      const resolvedSql = typeof sql === 'function' ? sql() : sql;
      const resolvedParams = typeof params === 'function' ? (params as () => unknown[])() : params;
      const result = await this.pool.query(resolvedSql, resolvedParams);
      this.lastResult = { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    });
  }

  /** Asserts the last query returned exactly `expected` rows. */
  expectRowCount(expected: number): DbActions {
    return this.enqueue(async () => {
      if (!this.lastResult) throw new Error('No query has been run yet. Call query(...) first.');
      expect(this.lastResult.rowCount).toBe(expected);
    });
  }

  /** Saves a field from the last query's rows (dot-path, e.g. "0.email" for the first row's email) under `key`, for reuse in a later step. */
  saveQueryField(path: string, key: string): DbActions {
    return this.enqueue(async () => {
      if (!this.lastResult) throw new Error('No query has been run yet. Call query(...) first.');
      const value = getByPath(this.lastResult.rows, path);
      this.context.set(key, value);
    });
  }

  /** Saves the entire last query's rows under `key`, for reuse in a later step. */
  saveQueryResult(key: string): DbActions {
    return this.enqueue(async () => {
      if (!this.lastResult) throw new Error('No query has been run yet. Call query(...) first.');
      this.context.set(key, this.lastResult.rows);
    });
  }

  /** The full rows array from the last query - read after awaiting the chain. */
  get lastQueryRows(): unknown[] {
    return this.lastResult?.rows ?? [];
  }
}
