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
8. [Configuration](#configuration)
9. [Running Tests](#running-tests)
10. [Reports](#reports)

---

## Why no BDD

The BDD branches of this toolkit (`wdio-playwright-library` and friends) read `.feature` files, match each Gherkin line against a registered step definition, and run the matching function. This library removes that layer entirely:

| | BDD version | This library |
|---|---|---|
| Test file | `.feature` (Gherkin) | `.spec.ts` (TypeScript) |
| Runner | Cucumber.js | Playwright Test |
| Finding the code for a line | Regex/string match against step definitions | Direct function call |
| Adding a new action | Sometimes needs a new step definition | Call an existing helper method, or add one |

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

`WebActions` and `ApiActions` are chainable — inspired by [playwright-fluent](https://github.com/hdorgeval/playwright-fluent). Every action queues and returns `this`, so one `await` at the end runs the whole sequence instead of one `await` per line:

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

| Kind | Resolves via |
|---|---|
| `role:<ariaRole>` | `page.getByRole(ariaRole, { name, exact: true })` |
| `label` | `page.getByLabel(value, { exact: true })` |
| `placeholder` | `page.getByPlaceholder(value, { exact: true })` |
| `text` | `page.getByText(value, { exact: true })` |
| `testid` | `page.getByTestId(value)` |
| `alttext` | `page.getByAltText(value, { exact: true })` |
| `title` | `page.getByTitle(value, { exact: true })` |
| `xpath` / `css` | `page.locator(...)` |
| `id` / `name` / `tagName` / `className` / `linkText` / `buttonText` | WDIO-style kinds, translated to their Playwright equivalent |
| anything else | `page.locator('[<kind>="<value>"]')` — generic attribute fallback |

Files live at `e2e/locators/generated/<category>/<pageKey>.yaml` in **your** project (`category` is `web`, `api`, or `endtoend`), plus `e2e/locators/common.yaml` for elements shared across pages.

---

## WebActions Reference

| Method | Description |
|---|---|
| `navigate(url)` | `page.goto()` |
| `usePage(pageKey)` | Loads that page's locator YAML |
| `getLocator(name)` | Raw `Locator` for anything not covered below |
| `click(name)` | Click, with scroll/force-click fallback |
| `fill(name, text)` | Fill, with keystroke/DOM-value fallback for masked or custom inputs |
| `check(name)` / `uncheck(name)` | Checkbox/radio toggle |
| `selectDropdown(name, value)` | Native `<select>` or common custom-dropdown libraries |
| `verifyTextPresent(text)` | Substring search anywhere on screen (incl. iframes) |
| `verifyFieldText(name, expected)` | Checks `.value` (inputs) or text content (everything else) |
| `verifyWebTable(name, rows)` | Verifies expected rows appear in a table: `[header, ...dataRows]` |
| `acceptNextDialog()` | Accepts the next native `alert`/`confirm` |

---

## ApiActions Reference

| Method | Description |
|---|---|
| `sendRequest(method, url, body?)` | Registers a request (plain object body, no DataTable conversion needed) |
| `expectStatus(code)` | Executes the pending request (or replays a matching one captured from the page's own network traffic) and asserts the status |
| `validateResponseFields(expected)` | Asserts the last response body contains the given fields, at any depth |
| `lastResponseBody` | The full last response body, for assertions beyond `validateResponseFields` |

API capture is attached automatically per test — if the page under test makes the same request itself, `expectStatus()` replays that captured response instead of firing a duplicate request.

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
