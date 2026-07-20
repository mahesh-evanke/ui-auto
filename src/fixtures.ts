/**
 * Playwright Test fixtures - the non-BDD replacement for Cucumber's World +
 * Before/After hooks. Every spec imports `test`/`expect` from here (or from
 * the package root) instead of `@playwright/test` directly, to get
 * `webActions`/`apiActions` wired up automatically per test.
 */
import { test as base, expect } from '@playwright/test';
import './core/config'; // load e2e/config/config.yaml -> env on first import
import { WebActions } from './web/WebActions';
import { ApiActions } from './api/ApiActions';
import { CombinedActions } from './combined/CombinedActions';
import { attachApiCapture } from './api/capture';

type Fixtures = {
  webActions: WebActions;
  apiActions: ApiActions;
  actions: CombinedActions;
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  apiActions: async ({ page, request }, use) => {
    const apiActions = new ApiActions(request);
    const capture = attachApiCapture(page, apiActions.capturedApis);
    await use(apiActions);
    capture.stop();
  },
  webActions: async ({ page }, use) => {
    await use(new WebActions(page));
  },
  actions: async ({ webActions, apiActions }, use) => {
    await use(new CombinedActions(webActions, apiActions));
  },
});

export { expect };
