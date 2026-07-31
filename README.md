# playwright-without-bdd-library

A Playwright test automation library with **no BDD/Gherkin layer**. Tests are plain TypeScript files calling reusable helper classes directly — no `.feature` files, no step-definition matching, no Cucumber. Built on [Playwright Test](https://playwright.dev/docs/test-intro)'s own runner.

This repository ships **only the library** — reusable `WebActions`/`ApiActions` classes, locator resolution, and API capture/replay. It contains no test cases of its own (the few files under `tests/` are examples/smoke tests for this repo, not part of the published package). Your project's `*.spec.ts` files live in your own **consumer** project, which imports this package.

---



## Table of Contents

1. [Why no BDD](#why-no-bdd)
2. [Installation](#installation)
3. [Folder Structure](#folder-structure)
4. [Writing Tests](#writing-tests)
5. [Locators](#locators)
6. [WebActions Reference](#webactions-reference)
7. [ApiActions Reference](#apiactions-reference)
8. [CombinedActions Reference](#combinedactions-reference)
9. [Function Reference (every function, by file)](#function-reference-every-function-by-file)
10. [Configuration](#configuration)
11. [Running Tests](#running-tests)
12. [Reports](#reports)

---



## Why no BDD

The BDD branches of this toolkit (`wdio-playwright-library` and friends) read `.feature` files, match each Gherkin line against a registered step definition, and run the matching function. This library removes that layer entirely:


|                             | BDD version                                 | This library                               |
| --------------------------- | ------------------------------------------- | ------------------------------------------ |
| Test file                   | `.feature` (Gherkin)                        | `.spec.ts` (TypeScript)                    |
| Runner                      | Cucumber.js                                 | Playwright Test                            |
| Finding the code for a line | Regex/string match against step definitions | Direct function call                       |
| Adding a new action         | Sometimes needs a new step definition       | Call an existing helper method, or add one |


The underlying engine — locator resolution, robust click/fill, API capture/replay — is the same code, just called directly instead of through Gherkin matching.

---



## Installation

Install into your own project (this is not meant to be cloned and run standalone):

```bash
npm install playwright-without-bdd-library
```

`postinstall` scaffolds your project — it never overwrites a file that already exists:

- `playwright.config.ts` — Playwright Test's own config
- `tsconfig.json`
- `e2e/config/config.yaml` — browser/run settings
- `e2e/locators/common.yaml` — empty starter shared-locator file
- `tests/example.spec.ts` — a starter smoke test
- npm scripts merged into your `package.json` (`test`, `test:headed`, `test:ui`, `report`)

If your package manager skips lifecycle scripts (pnpm's default, `npm install --ignore-scripts`), or you deleted a generated file and want it back, run the same scaffold manually:

```bash
npx playwright-without-bdd-init
```

Install Playwright's browser binaries:

```bash
npx playwright install
```

---



## Folder Structure

**This library's own structure** (what ships — see `package.json`'s `files` field):

```
playwright-without-bdd-library/
│
├── src/
│   ├── core/
│   │   ├── config.ts             # Loads e2e/config/config.yaml → process.env
│   │   └── contextOptions.ts     # Browser/context launch option builders
│   │
│   ├── locators/
│   │   ├── locatorResolver.ts    # [kind, value, xpathFallback] → real Playwright locator
│   │   ├── locatorPaths.ts       # Finds locator YAML files in your project
│   │   └── LocatorStore.ts       # Loads + looks up locator tuples per test
│   │
│   ├── web/
│   │   ├── WebActions.ts         # click/fill/check/selectDropdown/verify*, etc.
│   │   ├── tableHelper.ts        # Web table verification
│   │   └── textHelper.ts         # Screen text verification + <CURRENT_DATE> tokens
│   │
│   ├── api/
│   │   ├── ApiActions.ts         # sendRequest/expectStatus/validateResponseFields
│   │   ├── capture.ts            # Network capture for API replay
│   │   ├── matcher.ts            # Captured-API matching
│   │   ├── token.ts              # Auth token extraction
│   │   └── api-config.ts         # ${alias} URL resolution from locator YAML
│   │
│   ├── fixtures.ts                # Playwright Test fixtures: webActions, apiActions
│   └── index.ts                   # Public exports
│
├── e2e/
│   ├── config/config.yaml         # Template config
│   └── locators/common.yaml       # Empty starter shared-locator file
│
├── scripts/postinstall.js         # Scaffolds your project on npm install
├── playwright.config.ts           # This repo's own dev/example config
├── package.json
└── tsconfig.json
```

**Your consumer project** holds the actual tests:

```
your-project/
├── e2e/
│   ├── config/config.yaml
│   └── locators/
│       ├── common.yaml
│       └── generated/
│           └── web/
│               └── LoginPage.yaml
├── tests/
│   ├── login.spec.ts
│   └── api/orders.spec.ts
├── playwright.config.ts
└── package.json
```

---



## Writing Tests

Import `test`/`expect` from the package instead of `@playwright/test` directly — that's what wires up `webActions`/`apiActions`:

```ts
import { test, expect } from 'playwright-without-bdd-library';

test('login', async ({ webActions }) => {
  await webActions.navigate('https://example.com/login');
  webActions.usePage('LoginPage'); // loads e2e/locators/generated/web/LoginPage.yaml

  await webActions.fill('Username Field', 'tomsmith');
  await webActions.fill('Password Field', 'SuperSecretPassword!');
  await webActions.click('Login Button');

  await webActions.verifyTextPresent('You logged into a secure area');
});
```



### Fluent chaining (fewer lines)

`WebActions` and `ApiActions` are chainable — inspired by [playwright-fluent](https://github.com/hdorgeval/playwright-fluent) (see [PLAYWRIGHT_FLUENT_COMPARISON.md](PLAYWRIGHT_FLUENT_COMPARISON.md) for a full function-by-function comparison of what playwright-fluent offers vs. what this library has). Every action queues and returns `this`, so one `await` at the end runs the whole sequence instead of one `await` per line:

```ts
test('login', async ({ webActions }) => {
  await webActions
    .navigate('https://example.com/login')
    .usePage('LoginPage')
    .fill('Username Field', 'tomsmith')
    .fill('Password Field', 'SuperSecretPassword!')
    .click('Login Button')
    .verifyTextPresent('You logged into a secure area');
});
```

Same idea for `ApiActions`:

```ts
await apiActions
  .sendRequest('POST', url, { title: 'foo' })
  .expectStatus(201)
  .validateResponseFields({ title: 'foo' });
```

Both styles work and can be mixed freely — `await`ing after every single call still runs immediately, exactly as before; chaining several calls under one `await` just batches them. Pick whichever reads better for a given test.

`test.describe`/`test()` group scenarios the same way `Feature:`/`Scenario:` did — just as code instead of Gherkin.

### Soft assertions (`softly()`)

Call `.softly()` mid-chain to switch every action queued *after* it into soft-assert mode: a failure is collected instead of stopping the chain, so the rest of the checks still run. The final `await` still throws — summarizing every collected failure — so the test still fails overall:

```ts
await webActions
  .softly()
  .verifyFieldText('First Name', 'Jane')
  .verifyFieldText('Last Name', 'Doe')
  .verifyFieldText('Email', 'jane@example.com');
// all three run even if the first one fails; the await throws with all failures listed
```

Inspect individual failures (e.g. in a `catch` block) via `webActions.getSoftFailures()`. Actions queued *before* `.softly()` are unaffected — they still fail the chain immediately, as usual.

### Combined web + API chain (`actions` fixture)

For tests that interleave UI steps and direct API calls, the `actions` fixture chains both `WebActions` and `ApiActions` into one statement instead of two separate chains:

```ts
test('checkout page reflects the API total', async ({ actions }) => {
  await actions
    .navigate('https://example.com/cart')
    .verifyTextPresent('Your Cart')
    .sendRequest('GET', '/api/cart/total')
    .expectStatus(200)
    .validateResponseFields({ total: 42 });
});
```

`actions.web` and `actions.api` are the underlying `WebActions`/`ApiActions` instances, for anything not covered by `CombinedActions`' own methods.

### Reusing responses between steps

A plain argument like `fill(name, text)` or `sendRequest(method, url, body)` is evaluated *immediately* when you call it — but a prior step's response only exists once that step has actually run, which hasn't happened yet while you're still building the chain. So a value from one step can't be a plain argument to a later step in the *same* chain.

The fix: `fill()` and `sendRequest()` accept a **zero-arg function** instead of a plain value. The function is only called when that queued step actually executes — by which point every earlier step has already completed — so it can safely read a value saved earlier in the chain.

Save a value with `saveResponseField(path, key)` / `saveResponseBody(key)` (on `apiActions`/`actions`) or `extractText(name, key)` (on `webActions`/`actions`), then read it back via `.context.get(key)`:

```ts
// API response -> input to the next API call, in one chain
await apiActions
  .sendRequest('POST', loginUrl, credentials)
  .expectStatus(200)
  .saveResponseField('token', 'authToken') // dot-path into the response body
  .sendRequest('GET', () => `/profile?token=${apiActions.context.get('authToken')}`)
  .expectStatus(200);

// Text read from the page -> input to an API call, in one chain
await actions
  .navigate('https://example.com/account')
  .extractText('Account Id', 'accountId')
  .sendRequest('GET', () => `/api/accounts/${actions.context.get('accountId')}/orders`)
  .expectStatus(200);
```

`context` is a small shared per-test key/value store (`TestContext`) — the same instance backs `webActions.context`, `apiActions.context`, and `actions.context`, so a value saved on one side is visible on the other. `context.get(key)` throws a clear error if nothing was saved under that key yet, rather than silently returning `undefined`.

#### Every API response is cached automatically, too

You don't have to remember to call `saveResponseBody()` for a response you *might* need later — every response is cached automatically as it's received, keyed by method + URL. Read any earlier response back with `getCachedResponse(method, url)`:

```ts
await apiActions.sendRequest('GET', '/posts/1').expectStatus(200);
await apiActions.sendRequest('GET', '/posts/2').expectStatus(200);

// Neither call above saved anything explicitly - both responses are still there:
const post1 = apiActions.getCachedResponse<{ id: number }>('GET', '/posts/1');
const post2 = apiActions.getCachedResponse<{ id: number }>('GET', '/posts/2');
```

`getCachedResponse()` is immediate (not queued) — call it after `await`ing the request that produced the response you want. `saveResponseField()`/`saveResponseBody()` are still useful when you want a short, memorable alias (`'authToken'`) instead of remembering the exact method+URL.

---

### Large request/response bodies (`loadJsonFixture`)

A request body that's dozens of fields long is unreadable inline in a spec file. Move it to a JSON file under `e2e/data/` and load it instead:

```json
// e2e/data/create-post-payload.json
{ "title": "foo", "body": "bar", "userId": 1 }
```

```ts
import { test, expect, loadJsonFixture } from 'playwright-without-bdd-library';

test('create a post', async ({ apiActions }) => {
  const body = loadJsonFixture('create-post-payload');
  await apiActions.sendRequest('POST', url, body).expectStatus(201).validateResponseFields(body);
});
```

Pass a second argument to override just the field(s) that need to vary per run, without duplicating the whole fixture file:

```ts
const body = loadJsonFixture('create-post-payload', { title: `foo-${Date.now()}` });
```

`<CURRENT_DATE>`/`<CURRENT_DATE+N>` tokens (see [Configuration](#configuration)) are resolved in every string value of the loaded JSON, same as in `fill()`. A name containing `/` is resolved relative to the project root instead of `e2e/data/`, if the fixture lives elsewhere.

---



## Locators

Same `[kind, value, xpathFallback?]` tuple format used across every branch of this toolkit — locator YAML authored for the BDD/WDIO branches works here unmodified.

```yaml
Sign In:
  - role:button
  - Sign In
  - //button[normalize-space(.)='Sign In']

Email Address:
  - placeholder
  - Email Address
  - //input[@placeholder='Email Address']
```


| Kind                                                                | Resolves via                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `role:<ariaRole>`                                                   | `page.getByRole(ariaRole, { name, exact: true })`                 |
| `label`                                                             | `page.getByLabel(value, { exact: true })`                         |
| `placeholder`                                                       | `page.getByPlaceholder(value, { exact: true })`                   |
| `text`                                                              | `page.getByText(value, { exact: true })`                          |
| `testid`                                                            | `page.getByTestId(value)`                                         |
| `alttext`                                                           | `page.getByAltText(value, { exact: true })`                       |
| `title`                                                             | `page.getByTitle(value, { exact: true })`                         |
| `xpath` / `css`                                                     | `page.locator(...)`                                               |
| `id` / `name` / `tagName` / `className` / `linkText` / `buttonText` | WDIO-style kinds, translated to their Playwright equivalent       |
| anything else                                                       | `page.locator('[<kind>="<value>"]')` — generic attribute fallback |


Files live at `e2e/locators/generated/<category>/<pageKey>.yaml` in **your** project (`category` is `web`, `api`, or `endtoend`), plus `e2e/locators/common.yaml` for elements shared across pages.

### Shorthand format

`- kind: value`— a single YAML mapp shorthand ing entry — can stand in for the `[kind, value]` pair, saving a line:

```yaml
Password Field:
  - label: Password
  - //input[@id='password']       # xpath fallback, still optional
```

is equivalent to:

```yaml
Password Field:
  - label
  - Password
  - //input[@id='password']
```



### Typo suggestions

If a name passed to `webActions.fill()`/`.click()`/etc. isn't found in any loaded locator YAML, the library falls back to a broad semantic guess (as before) but also logs a "did you mean...?" warning naming the closest registered name, so a typo doesn't silently degrade into flaky matching:

```
[locators] "Usernam Field" not found in any loaded locator YAML - did you mean "Username Field"? Falling back to a broad guess.
```



### Typed locator names

Regenerate a `LocatorName` union type covering every name across your locator YAML files:

```bash
npx playwright-without-bdd-generate-types
```

This writes `e2e/locators/generated/locator-names.d.ts`. Import `LocatorName` in your own typed wrapper functions (or reference it in editor tooling) to catch a typo'd element name at compile time instead of at runtime. Re-run it whenever you add or rename a locator entry.

---



## WebActions Reference


| Method                            | Description                                                         |
| --------------------------------- | ------------------------------------------------------------------- |
| `navigate(url)`                   | `page.goto()`                                                       |
| `usePage(pageKey)`                | Loads that page's locator YAML                                      |
| `getLocator(name)`                | Raw `Locator` for anything not covered below                        |
| `click(name)`                     | Click, with scroll/force-click fallback                             |
| `fill(name, text)`                | Fill, with keystroke/DOM-value fallback for masked or custom inputs |
| `check(name)` / `uncheck(name)`   | Checkbox/radio toggle                                               |
| `selectDropdown(name, value)`     | Native `<select>` or common custom-dropdown libraries               |
| `verifyTextPresent(text)`         | Substring search anywhere on screen (incl. iframes)                 |
| `verifyFieldText(name, expected)` | Checks `.value` (inputs) or text content (everything else)          |
| `verifyWebTable(name, rows)`      | Verifies expected rows appear in a table: `[header, ...dataRows]`   |
| `acceptNextDialog()`              | Accepts the next native `alert`/`confirm`                           |
| `extractText(name, key)`          | Saves a field's value/text under `key` in `.context`, for reuse in a later step |
| `context`                         | Shared `TestContext` key/value store (see [Reusing responses between steps](#reusing-responses-between-steps)) |


---



## ApiActions Reference


| Method                             | Description                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `sendRequest(method, url, body?)`  | Registers a request (plain object body, no DataTable conversion needed)                                                      |
| `expectStatus(code)`               | Executes the pending request (or replays a matching one captured from the page's own network traffic) and asserts the status |
| `validateResponseFields(expected)` | Asserts the last response body contains the given fields, at any depth                                                       |
| `lastResponseBody`                 | The full last response body, for assertions beyond `validateResponseFields`                                                  |
| `saveResponseField(path, key)`     | Saves a field from the last response body (dot-path, e.g. `"user.token"`) under `key` in `.context`, for reuse in a later step |
| `saveResponseBody(key)`            | Saves the entire last response body under `key` in `.context`                                                                |
| `getCachedResponse(method, url)`   | Reads any previously-received response body by method+URL — cached automatically, no explicit save call needed              |
| `context`                          | Shared `TestContext` key/value store (see [Reusing responses between steps](#reusing-responses-between-steps))               |


API capture is attached automatically per test — if the page under test makes the same request itself, `expectStatus()` replays that captured response instead of firing a duplicate request.

---



## CombinedActions Reference

Available via the `actions` fixture — see [Combined web + API chain](#combined-web--api-chain-actions-fixture).


| Method                                                                                        | Description                                                                       |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `navigate(url)` / `usePage(pageKey)` / `click(name)` / `fill(name, text)`                     | Delegates to the underlying `WebActions`                                          |
| `verifyTextPresent(text)` / `verifyFieldText(name, expected)` / `verifyWebTable(name, rows)`  | Delegates to the underlying `WebActions`                                          |
| `sendRequest(method, url, body?)` / `expectStatus(code)` / `validateResponseFields(expected)` | Delegates to the underlying `ApiActions`                                          |
| `extractText(name, key)` / `saveResponseField(path, key)` / `saveResponseBody(key)`           | Delegates to the underlying `WebActions`/`ApiActions` — see [Reusing responses between steps](#reusing-responses-between-steps) |
| `getCachedResponse(method, url)`                                                              | Delegates to the underlying `ApiActions` — reads any previously-received response by method+URL |
| `lastResponseBody`                                                                            | The last API response body                                                        |
| `context`                                                                                     | Shared `TestContext` key/value store (same instance as `web.context`/`api.context`) |
| `web` / `api`                                                                                 | The underlying `WebActions`/`ApiActions` instances, for anything not listed above |


---



## Function Reference (every function, by file)

Every function/method in the library and what it's for — useful when you need something not covered by the tables above, or when contributing to the library itself.

### `src/core/Chainable.ts` — `Chainable<TSelf>` (base class for WebActions/ApiActions/CombinedActions)


| Function                          | Use                                                                       |
| --------------------------------- | ------------------------------------------------------------------------- |
| `enqueue(action)`                 | Queues an action closure and returns `this`, enabling the fluent chain    |
| `softly()`                        | Marks every action queued after this call as soft (collected, not thrown) |
| `getSoftFailures()`               | Returns the errors collected during the last soft-mode drain              |
| `lastError()`                     | Returns the error from the last chain that threw, if any                  |
| `drain()` *(private)*             | Runs every queued action in order when the chain is awaited               |
| `then(onfulfilled?, onrejected?)` | Makes the class awaitable — triggers `drain()`                            |

### `src/core/TestContext.ts` — `TestContext`

| Function | Use |
|---|---|
| `set(key, value)` | Saves a value under `key` |
| `get(key)` | Reads a saved value; throws a clear error if `key` was never set |
| `has(key)` | Whether `key` has a saved value |
| `getByPath(obj, path)` *(module-level)* | Reads a dot-path (e.g. `"user.token"`) out of a nested object, used by `ApiActions.saveResponseField()` |




### `src/web/WebActions.ts` — `WebActions`


| Function                                              | Use                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `usePage(pageKey)`                                    | Loads a page's locator YAML                                          |
| `getLocator(name)`                                    | Raw `Locator` lookup by name, immediate (not queued)                 |
| `raw` (getter)                                        | Escape hatch to the underlying Playwright `Page`                     |
| `navigate(url)`                                       | `page.goto()`                                                        |
| `resolveVisible(element, timeout?)` *(private)*       | Resolves a locator (across frames) and waits for it to be visible    |
| `click(name)`                                         | Click, with scroll/force-click fallback                              |
| `check(name)` / `uncheck(name)`                       | Checkbox/radio toggle                                                |
| `fill(name, text)`                                    | Fill, with keystroke/DOM-value fallback for masked or custom inputs  |
| `selectDropdown(name, value)`                         | Selects from a native `<select>` or common custom-dropdown libraries |
| `verifyTextPresent(text)`                             | Substring search anywhere on screen (incl. iframes)                  |
| `verifyFieldText(name, expected)`                     | Checks `.value` (inputs) or text content (everything else)           |
| `verifyWebTable(name, rows, options?)`                | Verifies expected rows appear in a table                             |
| `acceptNextDialog()`                                  | Accepts the next native `alert`/`confirm`                            |
| `extractText(name, key)`                              | Reads a field's value/text and saves it under `key` in `.context`, for reuse in a later step |
| `context` (getter)                                    | Shared `TestContext` key/value store, injected via the constructor   |
| `escapeRegExp(s)` / `normalizeWs(s)` *(module-level)* | Small string helpers used internally by `selectDropdown`/matching    |




### `src/api/ApiActions.ts` — `ApiActions`


| Function                                                     | Use                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `sendRequest(method, url, body?)`                            | Registers a request to run on the next `expectStatus()`                 |
| `expectStatus(code)`                                         | Executes (or replays a captured) request and asserts the status         |
| `validateResponseFields(expected)`                           | Asserts the last response body contains the given fields, at any depth  |
| `lastResponseBody` (getter)                                  | The full body of the last response                                      |
| `saveResponseField(path, key)`                               | Saves a field from the last response body (dot-path) under `key` in `.context`, for reuse in a later step |
| `saveResponseBody(key)`                                      | Saves the entire last response body under `key` in `.context`           |
| `getCachedResponse(method, url)`                             | Reads any previously-received response body by method+URL — cached automatically inside `expectStatus()` |
| `cacheKeyFor(method, normalizedUrl)` *(private)*             | Builds the `"<METHOD> <url>"` key every response is auto-cached under   |
| `context` (getter)                                           | Shared `TestContext` key/value store, injected via the constructor      |
| `createSyntheticResponse(captured)` *(module-level)*         | Wraps a captured network API as a `{status, json}` response-like object |
| `parseResponseBodyFromJsonOrText(resp)` *(module-level)*     | Parses a response body as JSON, falling back to text                    |
| `assertJsonIncludesPaths(actual, expected)` *(module-level)* | Recursively asserts `actual` contains every field/path in `expected`    |




### `src/combined/CombinedActions.ts` — `CombinedActions`


| Function                                                                                               | Use                                                                              |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `navigate` / `usePage` / `click` / `fill` / `verifyTextPresent` / `verifyFieldText` / `verifyWebTable` / `extractText` | Each queues and immediately drains one `WebActions` call, preserving chain order |
| `sendRequest` / `expectStatus` / `validateResponseFields` / `saveResponseField` / `saveResponseBody`                  | Each queues and immediately drains one `ApiActions` call, preserving chain order |
| `lastResponseBody` (getter)                                                                            | The last API response body                                                       |
| `context` (getter)                                                                                     | `this.api.context` — the same shared `TestContext` instance as `web.context`     |




### `src/locators/LocatorStore.ts` — `LocatorStore`


| Function                                                                               | Use                                                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `loadCommonLocators()` *(private)*                                                     | Loads every `common.yaml`/`common.json` into the shared locator map                |
| `usePage(pageKey)`                                                                     | Loads a page's locator YAML into the page-scoped map                               |
| `tryResolveTuple(name)`                                                                | Looks up a name's `[kind, value, xpathFallback?]` tuple (page-scoped, then common) |
| `smartLocator(page, name)`                                                             | Fallback broad semantic guess when a name isn't registered anywhere                |
| `getLocator(page, name)`                                                               | Resolves a name to a real Playwright `Locator`                                     |
| `getLocatorInFirstFrame(page, name)`                                                   | Resolves a name inside the first `<iframe>`                                        |
| `resolveAcrossFrames(page, name)`                                                      | Tries the main page, then every child frame, for a matching locator                |
| `getTableRootLocator(page, objName)`                                                   | Resolves a table's root element by name                                            |
| `allKnownNames()`                                                                      | Every locator name currently loaded, used for typo suggestions                     |
| `warnIfUnresolved(name)` *(private)*                                                   | Logs a "did you mean...?" warning when a name isn't found anywhere                 |
| `isPlainObject(v)` / `tupleFromYamlValue(v)` / `parseLocatorFile(fp)` *(module-level)* | YAML parsing helpers, including the `[{kind: value}, xpathFallback?]` shorthand    |




### `src/locators/suggestLocatorName.ts`


| Function                                             | Use                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `levenshteinDistance(a, b)`                          | Computes edit distance between two strings                                    |
| `suggestClosestName(name, candidates, maxDistance?)` | Returns the closest candidate name, or `undefined` if nothing is close enough |




### `src/locators/locatorResolver.ts`


| Function                              | Use                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `buildLocatorFromTuple(scope, tuple)` | Turns a `[kind, value, xpathFallback?]` tuple into a real Playwright `Locator` |




### `src/locators/locatorPaths.ts`


| Function                              | Use                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `locatorDir(cat)`                     | Path to a category's locator folder (`e2e/locators/generated/<cat>`)            |
| `locatorFilePath(cat, pageKey, ext?)` | Full path to one page's locator file                                            |
| `findLocatorFile(pageKey)`            | Locates a page's locator file across categories/extensions/flat-layout fallback |
| `findCommonFiles()`                   | Every `common.yaml`/`common.json` file across categories, plus the shared one   |




### `src/codegen/generateLocatorTypes.ts`


| Function                                                                                      | Use                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `generateLocatorTypes(outFile?)`                                                              | Scans every locator YAML/JSON file and writes a `LocatorName` union type |
| `collectNamesFromFile(fp)` / `walk(dir, files)` / `collectAllLocatorFiles()` *(module-level)* | File-scanning helpers used by `generateLocatorTypes`                     |

### `src/utils/loadJsonFixture.ts`

| Function | Use |
|---|---|
| `loadJsonFixture(name, overrides?)` | Loads `e2e/data/<name>.json` (or a path containing `/`), resolves `<CURRENT_DATE>` tokens, and shallow-merges `overrides` on top |
| `resolveTokensDeep(value)` / `fixtureFilePath(name)` *(module-level)* | Recursive token resolution + fixture-path resolution helpers used by `loadJsonFixture` |




### `src/web/textHelper.ts`


| Function                                                                         | Use                                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `resolveDynamicTokens(input, now?)`                                              | Replaces `<CURRENT_DATE>`/`<CURRENT_DATE+N>` tokens with real dates     |
| `verifyTextOnScreen(page, text, opts?)`                                          | Substring search for text anywhere on screen, incl. iframes, with retry |
| `shouldDebug(explicit?)` / `formatCurrentDate(d)` / `sleep(ms)` *(module-level)* | Small internal helpers                                                  |




### `src/web/tableHelper.ts`


| Function                                                                                                      | Use                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `verifyWebTable(page, objName, rows, deps?, options?)`                                                        | Verifies expected rows appear in a table (`[header, ...dataRows]`)     |
| `resolveTableRoot(page, objName, getLocator?)`                                                                | Finds a table's root element by role/caption/aria-label/id/uniqueness  |
| `ensureTableElement(root)`                                                                                    | Descends into a nested `<table>` if the resolved root isn't one itself |
| `readTableData(table)`                                                                                        | Extracts headers + row cell text from a live `<table>`                 |
| `tableRowsToExpectedRows(rows)`                                                                               | Converts `[header, ...dataRows]` into header-keyed row objects         |
| `buildHeaderIndex(headers)`                                                                                   | Maps normalized header text to its column index                        |
| `compareCell(actual, expected, strict)`                                                                       | Cell-level comparison (exact or contains)                              |
| `scoreRow(actualCells, expectedCells, strict)`                                                                | Counts how many expected cells match a candidate row                   |
| `normalizeSpaces(s)` / `normalizeComparable(s)` / `normalizeDateLike(s)` / `log(debug, msg)` *(module-level)* | Text/date normalization + conditional logging helpers                  |




### `src/api/capture.ts`


| Function                                                   | Use                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `attachApiCapture(page, targetCapturedApis, options?)`     | Listens to every request/response on a page and records matched pairs, for `expectStatus()` to replay |
| `redactHeaderValue(key, value)` / `redactHeaders(headers)` | Strips `Authorization`/`Cookie` values before storing captured headers                                |
| `tryParseJson(raw)` / `contentTypeLooksJson(contentType)`  | Best-effort JSON parsing/detection for captured bodies                                                |
| `withTimeout(p, timeoutMs, onTimeout)`                     | Bounds an async body-parse with a fallback if it hangs                                                |
| `makeRequestKey(req)`                                      | Builds a matching key (method+URL+content-type+body length) to pair a request with its response       |




### `src/api/matcher.ts`


| Function                              | Use                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `normalizeUrl(inputUrl)`              | Strips scheme/host/trailing slash so URLs compare consistently                  |
| `urlToHostPlaceholder(normalizedUrl)` | Rebuilds a dummy absolute URL from a normalized path, for URL parsing utilities |
| `findCapturedApi(args)`               | Finds an unconsumed captured request matching a method+URL                      |
| `waitForCapturedApi(args)`            | Polls for a matching captured request up to a timeout                           |




### `src/api/token.ts`


| Function                               | Use                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `extractTokenFromJson(body)`           | Pulls an auth token out of a response body (`token`/`accessToken`/`access_token`/`jwt`) |
| `buildAuthorizationHeader(authToken?)` | Builds a `{ Authorization: 'Bearer ...' }` header, or `{}` if no token                  |




### `src/api/api-config.ts`


| Function                                                                                   | Use                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `resolveApiUrl(url)`                                                                       | Replaces `${alias}` tokens in a URL with base URLs collected from locator YAML |
| `clearApiUrlAliasCache()`                                                                  | Clears the cached alias map (for tests that change config between runs)        |
| `walkYamlFiles(dir, out)` / `collectStrings(obj, into)` / `loadAliases()` *(module-level)* | Alias-collection helpers used by `resolveApiUrl`                               |




### `src/core/config.ts`


| Function                                                    | Use                                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `loadConfig()`                                              | Loads `e2e/config/config.yaml` and maps it into `process.env` (real env vars always win) |
| `channelFor(name?)` / `setEnv(key, value)` *(module-level)* | Maps a browser name to a Playwright channel; sets an env var only if unset               |




### `src/core/contextOptions.ts`


| Function                | Use                                                                            |
| ----------------------- | ------------------------------------------------------------------------------ |
| `resolveDevice(name?)`  | Looks up a Playwright device descriptor by name (e.g. `"iPhone 12 Pro"`)       |
| `launchOptions(extra?)` | Browser launch options that hide the "controlled by automated software" banner |
| `contextOptions(opts)`  | Context options applying device emulation + optional video recording           |




### `src/fixtures.ts`


| Export   | Use                                                                                         |
| -------- | ------------------------------------------------------------------------------------------- |
| `test`   | `@playwright/test`'s `test`, extended with the `webActions`/`apiActions`/`actions`/`testContext` fixtures |
| `expect` | Re-exported from `@playwright/test`, unchanged                                              |

`testContext` isn't meant to be used directly in a spec — it's the single `TestContext` instance injected into both `webActions`/`apiActions` (and named `testContext`, not `context`, to avoid colliding with Playwright's own built-in `context: BrowserContext` fixture). Reach it via `webActions.context`/`apiActions.context`/`actions.context` instead.




### `scripts/scaffold.js`


| Function                                              | Use                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `writeIfMissing(consumerRoot, relPath, content)`      | Writes a file into the consumer project, never overwriting an existing one                              |
| `mergePackageJsonField(consumerRoot, field, entries)` | Merges keys into the consumer's `package.json`, never overwriting an existing key                       |
| `runScaffold(consumerRoot, libraryRoot)`              | Writes every scaffold file (`playwright.config.ts`, `tsconfig.json`, config/locator YAML, starter spec) |




### `scripts/postinstall.js` / `scripts/init.js` / `scripts/generate-locator-types.js`

CLI entry points — `postinstall.js` runs `runScaffold()` automatically on `npm install`; `init.js` runs it manually (`npx playwright-without-bdd-init`); `generate-locator-types.js` runs the locator-name codegen manually (`npx playwright-without-bdd-generate-types`). No additional exported functions beyond what's documented above.

---



## Configuration

`e2e/config/config.yaml` in your project:

```yaml
browser:
  name: chrome            # chromium | chrome | edge | firefox
  headless: false
  slowMo: 0
  clickTimeoutMs: 30000
  recordVideo: true

run:
  retryOnFail: 0
  reportFolder: ./reports/integrationTests
  maxInstances: 1
```

Real environment variables always win over `config.yaml` (e.g. `HEADLESS=true npm test`).

`playwright.config.ts` (scaffolded into your project) is Playwright Test's own config format — add `projects`, change `testDir`, etc. as needed.

---



## Running Tests

```bash
npm test               # playwright test
npm run test:headed    # visible browser
npm run test:ui        # Playwright's interactive UI mode
npx playwright test tests/login.spec.ts
npx playwright test --grep @smoke
```

---



## Reports

```bash
npm run report          # opens the HTML report
```

Report location: `reports/integrationTests/` (configurable via `run.reportFolder`).