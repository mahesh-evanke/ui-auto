/**
 * Playwright Test fixtures - the non-BDD replacement for Cucumber's World +
 * Before/After hooks. Every spec imports `test`/`expect` from here (or from
 * the package root) instead of `@playwright/test` directly, to get
 * `webActions`/`apiActions` wired up automatically per test.
 */
import { test as base, expect } from '@playwright/test';
import type { Pool } from 'pg';
import './core/config'; // load e2e/config/config.yaml -> env on first import
import { ScenarioCache } from './cache/ScenarioCache';
import { WebActions } from './web/WebActions';
import { ApiActions } from './api/ApiActions';
import { CombinedActions } from './combined/CombinedActions';
import { DbActions } from './db/DbActions';
import { createDbPool } from './db/pool';
import { attachApiCapture } from './api/capture';

type Fixtures = {
  webActions: WebActions;
  apiActions: ApiActions;
  actions: CombinedActions;
  scenarioCache: ScenarioCache;
  dbActions: DbActions;
};

type WorkerFixtures = {
  dbPool: Pool;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
  // One pool per worker, only created if a test actually requests dbActions
  // (Playwright fixtures are lazy) - so tests that never touch the database
  // never attempt a connection. See db/pool.ts.
  // eslint-disable-next-line no-empty-pattern
  dbPool: [
    async ({}, use) => {
      const pool = createDbPool();
      await use(pool);
      await pool.end();
    },
    { scope: 'worker' },
  ],
  // One shared store per test, injected into webActions/apiActions/dbActions
  // below, so a value saved from a UI step, an API response, or a DB query
  // can be reused as input to any of the others - see ScenarioCache.
  // eslint-disable-next-line no-empty-pattern
  scenarioCache: async ({}, use) => {
    await use(new ScenarioCache());
  },
  apiActions: async ({ page, request, scenarioCache }, use) => {
    const apiActions = new ApiActions(request, scenarioCache);
    const capture = attachApiCapture(page, apiActions.capturedApis);
    await use(apiActions);
    capture.stop();
  },
  webActions: async ({ page, scenarioCache }, use) => {
    await use(new WebActions(page, scenarioCache));
  },
  actions: async ({ webActions, apiActions }, use) => {
    await use(new CombinedActions(webActions, apiActions));
  },
  dbActions: async ({ dbPool, scenarioCache }, use) => {
    await use(new DbActions(dbPool, scenarioCache));
  },
});

export { expect };
