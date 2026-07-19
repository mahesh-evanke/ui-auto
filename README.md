# wdio-playwright-library

An installable **BDD test execution engine** built on [Playwright](https://playwright.dev/) and [Cucumber.js](https://cucumber.io/). Install it into your own project to run Gherkin feature files against Playwright, with locators that use Playwright's own semantic strategies (`getByRole`, `getByLabel`, `getByPlaceholder`, `getByTestId`, ...) instead of collapsing to brittle XPath.

**This package only executes feature files — it has no recorder and no AI authoring tooling.** Author your scenarios and locator YAML with [`wdio-playwright-recording`](../wdio-playwright-recording) or [`wdio-playwright-recording-ai`](../wdio-playwright-recording-ai), or write `.feature` files and locator YAML by hand; install this package to run them.

This repository ships runtime code and step definitions as an npm package. It intentionally contains **no feature files, no generated locators, and no authoring tools**: those belong in the consumer project or in the sibling recording branches.

---

## Table of Contents

1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Folder Structure](#folder-structure)
5. [Locators](#locators)
6. [Running Tests](#running-tests)
7. [Reports](#reports)
8. [Configuration](#configuration)
9. [Troubleshooting](#troubleshooting)
10. [Best Practices](#best-practices)
11. [Command Reference](#command-reference)

---

## Features

| Feature | Description |
|---|---|
| ▶️ **Playwright Execution** | Runs Gherkin feature files using Playwright across multiple browsers |
| 🎯 **Semantic Locators** | Replays Playwright's own strategies (role/label/placeholder/testId/altText/title) instead of always falling back to XPath |
| 🏷️ **Tag-Based Execution** | Filter and run tests by Cucumber tags (`@smoke`, `@regression`, etc.) |
| 📊 **HTML Reports** | Generates rich HTML test reports with pass/fail detail |
| 🎬 **Video Recording** | Records video of every test run, saved per scenario with status |
| 🌍 **Multi-Environment** | Switch between `val`, `dev`, and `standalone` environments via config |
| ♻️ **Reusable Steps** | 50+ built-in generic step definitions cover most UI interactions |
| 🧩 **Common Locators** | Shared `common.yaml` for cross-page elements (nav, modals, buttons) |
| ⚡ **Parallel Execution** | Run multiple scenarios concurrently via `maxInstances` config |
| 📱 **Device Emulation** | Emulate mobile/tablet devices (iPhone, Pixel, iPad, etc.) |
| 🔄 **API Replay** | Replay captured API responses without a live backend |

---

## Prerequisites

| Software | Minimum Version | Check Command |
|---|---|---|
| **Node.js** | v18.x or higher | `node --version` |
| **npm** | v9.x or higher | `npm --version` |

> **Browser binaries** are installed automatically by Playwright during `npm install`.
> No separate browser installation is needed.

---

## Installation

Install this package into your own project (it is not meant to be cloned and run standalone):

```bash
npm install wdio-playwright-library
```

`postinstall` then scaffolds your project automatically — it never overwrites a file that already exists:

- `cucumber.js` — points Cucumber at this package's step definitions inside `node_modules`
- `tsconfig.json` — `ts-node` config needed to transpile this package's `.ts` files
- `e2e/config/config.yaml` — browser, environment, and run settings
- `e2e/locators/common.yaml` and `e2e/locators/pages.yaml` — empty starter locator files
- `e2e/features/example.feature` — a starter smoke test scenario
- npm scripts merged into your `package.json` (`run`, `test:*`)

Pin these two dev dependencies yourself after install (npm rewrites `package.json`'s dependency fields right after `postinstall` runs, so the script can't add them for you):

```bash
npm install --save-dev ts-node@^10.9.2 typescript@^5.7.2
```

> `ts-node@10` does not support TypeScript 7's native compiler — pinning both versions avoids that mismatch.

Install Playwright's browser binaries:

```bash
npx playwright install
```

---

## Folder Structure

This is the **library's own** structure — what actually ships in the npm package (see `package.json`'s `files` field):

```
wdio-playwright-library/
│
├── e2e/
│   ├── config/
│   │   └── config.yaml               # Template config: browser, env URLs, run settings
│   │
│   ├── locators/
│   │   ├── common.yaml               # Empty — shared locators used across all your pages
│   │   └── pages.yaml                # Empty — page registry: page keys, titles, labels
│   │
│   ├── stepdefinitions/
│   │   ├── api.ts                    # API step definitions (send request, validate response)
│   │   ├── apiState.ts               # Shared API state types across steps
│   │   ├── hooks.ts                  # Before/After Cucumber hooks (browser setup/teardown)
│   │   ├── web.ts                    # Web/UI step definitions (click, fill, verify, etc.)
│   │   └── world.ts                  # Cucumber World class (browser, page, locator resolution)
│   │
│   └── support/
│       ├── config.ts                 # Loads config.yaml → process.env at startup
│       ├── featurePaths.ts           # Resolves feature/locator file paths by category
│       ├── capture.ts                # API network capture logic (used during UI+API runs)
│       ├── contextOptions.ts         # Browser context/launch option builders
│       ├── tableHelper.ts            # Web table verification utilities
│       ├── textHelper.ts             # Screen text verification utilities
│       ├── matcher.ts                # Matches API steps against captured responses
│       ├── datatable.ts              # DataTable → JSON helper for API steps
│       ├── token.ts                  # Auth token extraction helper for API steps
│       ├── api-config.ts             # Resolves API base URLs from config
│       ├── mode.ts                   # Run mode resolution (UI / API / E2E)
│       └── scripts/
│           ├── run.js                # Test runner: resolves features, passes args to Cucumber
│           └── terminal-formatter.js # CLI output formatting for the runner
│
├── scripts/
│   └── postinstall.js                # Scaffolds the consumer project on npm install
│
├── cucumber.js                       # Cucumber configuration file (library's own dev use)
├── package.json                      # Package metadata, dependencies, npm scripts
└── tsconfig.json                     # TypeScript compiler configuration
```

**Feature files and locators live in the *consumer* project**, not here — this package ships without any. Author them by hand, or with the recorder/AI tooling in `wdio-playwright-recording` / `wdio-playwright-recording-ai`, then install this package to execute them.

### Folder Purpose Summary

| Folder | Purpose |
|---|---|
| `e2e/config/` | Template config controlling browser, environment and run settings |
| `e2e/locators/` | Empty starter YAML locator files, scaffolded into your project on install |
| `e2e/stepdefinitions/` | TypeScript step bindings that execute Playwright actions |
| `e2e/support/` | Shared utilities: locator resolution, API capture/replay, path helpers, run scripts |
| `scripts/postinstall.js` | Scaffolds your project's files on `npm install` |

---

## Locators

This package only **replays** locator YAML — it doesn't generate it. Write it by hand, or author it with `wdio-playwright-recording`/`wdio-playwright-recording-ai`.

### YAML Locator Format

Per-page locator files use a `[kind, value, xpathFallback?]` tuple — plain strings, no embedded JSON:

```yaml
Sign In:
  - role:button
  - Sign In
  - //button[normalize-space(.)='Sign In']

Email Address:
  - placeholder
  - Email Address
  - //input[@placeholder='Email Address']

Login Link:
  - xpath
  - //a[normalize-space(.)='Login']
```

Supported `kind` values:

| Kind | Resolves via |
|---|---|
| `role:<ariaRole>` | `page.getByRole(ariaRole, { name, exact: true })` |
| `label` | `page.getByLabel(value, { exact: true })` |
| `placeholder` | `page.getByPlaceholder(value, { exact: true })` |
| `text` | `page.getByText(value, { exact: true })` |
| `testid` | `page.getByTestId(value)` |
| `alttext` | `page.getByAltText(value, { exact: true })` |
| `title` | `page.getByTitle(value, { exact: true })` |
| `xpath` | `page.locator('xpath=' + value)` |
| `css` | `page.locator(value)` |
| `id` / `name` / `tagName` / `className` / `linkText` / `buttonText` | WDIO-style kinds, translated to their Playwright equivalent — locator YAML written for the WDIO branch of this toolkit works here unmodified |
| anything else | `page.locator('[<kind>="<value>"]')` — generic attribute selector fallback |

When a semantic kind is present, its XPath (third element) is kept only as a `.or()` fallback for resilience — the semantic strategy is what actually resolves the element at runtime.

### Common Locators (`common.yaml`)

Defines shared elements available on **every page** — navigation bar, logout button, modals, toast messages, etc. Checked automatically if an element is not found in the page-specific YAML.

### Page Registry (`pages.yaml`)

Tracks the page title and a representative label for each registered page key. Used by the `User is on "..." screen` step to optionally verify the page loaded correctly.

---

## Running Tests

### Run All Feature Files

```bash
npm run test:all
```

### Run by Category

```bash
npm run test:web    # UI-only tests
npm run test:api    # API-only tests
npm run test:e2e    # End-to-end (UI + API) tests
```

### Run a Single or Multiple Feature Files

```bash
node node_modules/wdio-playwright-library/e2e/support/scripts/run.js login
node node_modules/wdio-playwright-library/e2e/support/scripts/run.js login dashboard checkout
```

### Run Using Tags

```gherkin
@smoke
Scenario: User login with valid credentials
```

```bash
npm run run -- --tags @smoke
npm run run -- --tags "@smoke and not @wip"
npm run run -- --tags "@smoke or @regression"
```

### Preview Without Running

```bash
npm run run -- --tags @smoke --list
```

---

## Reports

| Report | Location |
|---|---|
| HTML Report | `reports/integrationTests/cucumber-report.html` |
| Video Recordings | `reports/recorded/<scenario-name>-<PASS\|FAIL>-<timestamp>.webm` |

```bash
# Windows
start reports/integrationTests/cucumber-report.html

# macOS
open reports/integrationTests/cucumber-report.html

# Linux
xdg-open reports/integrationTests/cucumber-report.html
```

Set `recordVideo: true` in `e2e/config/config.yaml` to save a `.webm` per scenario.

---

## Configuration

All settings live in your project's **`e2e/config/config.yaml`** (scaffolded on install).

```yaml
browser:
  name: chrome            # chromium | chrome | edge | firefox
  headless: false         # true = no visible browser window (CI mode)
  slowMo: 1000
  clickTimeoutMs: 30000
  viewportDevice: " "     # "" = desktop; set to a device name for mobile emulation
  recordVideo: true

run:
  environment: val        # val | dev | standalone
  tags: ""
  retryOnFail: 0
  reportFolder: ./reports/integrationTests
  maxInstances: 1
  features: ./e2e/features/**/*.feature
  getPageTimeoutMs: 40000
  redirectWaitMs: 15000
  verifyTimeoutMs: 20000

urls:
  standalone: http://localhost:4042/
  val: https://your-app.example.com/
  dev: https://your-app.example.com/
```

### Key Configuration Options

| Key | Values | Description |
|---|---|---|
| `browser.name` | `chrome`, `chromium`, `edge`, `firefox` | Browser to run tests in |
| `browser.headless` | `true` / `false` | Hide or show browser window |
| `browser.recordVideo` | `true` / `false` | Enable scenario video recording |
| `browser.viewportDevice` | device name or `" "` | Mobile emulation device |
| `run.environment` | `val`, `dev`, `standalone` | Active environment URL |
| `run.tags` | `@smoke`, `@regression` | Default tag filter for all runs |
| `run.maxInstances` | number | Parallel workers count |
| `run.retryOnFail` | number | Auto-retry count on failure |

---

## Troubleshooting

### Dependency Installation Issues

```bash
npm install --legacy-peer-deps
```

### Browser Installation Issues

```bash
npx playwright install
npx playwright install chromium   # specific browser only
npx playwright install-deps       # Linux/CI system dependencies
```

### Feature Execution Failures

**`Element "X" not found in page "Y"`** — the locator YAML for that page is missing the element. Add it manually:

```yaml
My Button:
  - role:button
  - My Button
```

Or add it to `e2e/locators/common.yaml` if it appears on multiple pages.

**`No active page set`** — a step ran before `Given User is on "..." screen`. Ensure every scenario starts with the correct screen step.

**Feature file not found when running by name** — use `--list` to debug what gets resolved:

```bash
npm run run -- myFeature --list
```

---

## Best Practices

### Locator Maintenance

- **Never** put raw XPaths in step definitions — always use YAML locators
- Prefer semantic kinds (`role:*`, `label`, `placeholder`, `testid`) over `xpath`/`css` when available
- Keep `common.yaml` for elements that appear on 3+ pages
- Use descriptive element names: `Submit Payment Button` not `btn1`

### Tag Usage

```gherkin
@smoke              # Fast, critical path tests
@regression         # Full regression suite
@wip                # Work in progress — excluded from pipelines
```

Always exclude `@wip` in CI: `--tags "not @wip"`.

### Step Definitions

- Prefer the **built-in generic steps** before writing custom ones
- Never hardcode URLs, usernames or passwords inside step definitions — use config or test data

---

## Command Reference

### NPM Scripts (merged into your project by `postinstall`)

| Command | Description |
|---|---|
| `npm run test:all` | Run all feature files |
| `npm run test:web` | Run all UI-only features |
| `npm run test:api` | Run all API-only features |
| `npm run test:e2e` | Run all end-to-end (UI + API) features |
| `npm run cucumber` \| `npm test` | Launch Cucumber CLI directly |

### Runner Commands

| Command | Description |
|---|---|
| `npm run run` | Run all features |
| `npm run run -- <name>` | Run a feature file by name |
| `npm run run -- <a> <b>` | Run multiple named features |
| `npm run run -- --tags @smoke` | Run by tag expression |
| `npm run run -- --list` | List matched files only (no run) |

### Supported Browsers

| Value in `config.yaml` | Browser Used |
|---|---|
| `chromium` | Bundled Chromium (default) |
| `chrome` | Installed Google Chrome |
| `edge` | Microsoft Edge |
| `firefox` | Mozilla Firefox |

### Supported Viewport Devices

Set `browser.viewportDevice` in `e2e/config/config.yaml` to a device name (e.g. `iPhone 14 Pro Max`, `Pixel 7`, `iPad Pro`) or leave as `" "` for full desktop viewport.

---

*Built with [Playwright](https://playwright.dev/) · [Cucumber.js](https://cucumber.io/) · [TypeScript](https://www.typescriptlang.org/)*
