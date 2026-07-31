/**
 * Playwright Test fixtures - the non-BDD replacement for Cucumber's World +
 * Before/After hooks. Every spec imports `test`/`expect` from here (or from
 * the package root) instead of `@playwright/test` directly, to get
 * `webActions`/`apiActions` wired up automatically per test.
 */
import { test as base, expect } from '@playwright/test';
import './core/config'; // load e2e/config/config.yaml -> env on first import
import { TestContext } from './core/TestContext';
import { WebActions } from './web/WebActions';
import { ApiActions } from './api/ApiActions';
import { CombinedActions } from './combined/CombinedActions';
import { attachApiCapture } from './api/capture';

type Fixtures = {
  webActions: WebActions;
  apiActions: ApiActions;
  actions: CombinedActions;
  testContext: TestContext;
};

export const test = base.extend<Fixtures>({
  // One shared store per test, injected into both webActions and apiActions
  // below, so a value saved from a UI step or an API response can be reused
  // as input to the other - see TestContext.
  // eslint-disable-next-line no-empty-pattern
  testContext: async ({}, use) => {
    await use(new TestContext());
  },
  apiActions: async ({ page, request, testContext }, use) => {
    const apiActions = new ApiActions(request, testContext);
    const capture = attachApiCapture(page, apiActions.capturedApis);
    await use(apiActions);
    capture.stop();
  },
  webActions: async ({ page, testContext }, use) => {
    await use(new WebActions(page, testContext));
  },
  actions: async ({ webActions, apiActions }, use) => {
    await use(new CombinedActions(webActions, apiActions));
  },
});

export { expect };
