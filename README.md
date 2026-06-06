# Playwright + Cucumber Automation Framework

A **record-and-replay BDD test automation framework** built on [Playwright](https://playwright.dev/) and [Cucumber.js](https://cucumber.io/). Record browser sessions visually, auto-generate feature files and YAML locators, then replay as fully executable E2E tests — with zero manual XPath writing.

---

## Table of Contents

1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Folder Structure](#folder-structure)
5. [Recorder Usage](#recorder-usage)
6. [Generated Files](#generated-files)
7. [Running Tests](#running-tests)
8. [Execution Examples](#execution-examples)
9. [Reports](#reports)
10. [Configuration](#configuration)
11. [Troubleshooting](#troubleshooting)
12. [Best Practices](#best-practices)
13. [Example Workflow](#example-workflow)
14. [Command Reference](#command-reference)

---

## Features

| Feature | Description |
|---|---|
| 🎥 **UI Recording** | Record browser clicks, inputs, dropdowns and navigation visually |
| 🌐 **API Recording** | Capture API calls made during UI interactions automatically |
| 🔗 **E2E Recording** | Combine UI steps and API assertions in a single recorded flow |
| 📝 **BDD Feature Generation** | Auto-generate `.feature` files in Gherkin from recorded sessions |
| 📄 **YAML Locator Generation** | Auto-generate per-page YAML locator files — no manual XPath needed |
| ▶️ **Playwright Execution** | Replay recorded features using Playwright across multiple browsers |
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

Before setting up the framework, ensure the following are installed on your machine.

| Software | Minimum Version | Check Command |
|---|---|---|
| **Node.js** | v18.x or higher | `node --version` |
| **npm** | v9.x or higher | `npm --version` |
| **Git** | Any recent version | `git --version` |

> **Browser binaries** are installed automatically by Playwright during `npm install`.  
> No separate browser installation is needed.

---

## Installation

### 1. Clone Repository

```bash
git clone <repository-url>
cd playwright-cucumber-framework
```

### 2. Install Dependencies

**Standard install** (use this normally):
```bash
npm install
```

**Clean install** (use in CI or when `package-lock.json` must be respected exactly):
```bash
npm ci
```

> **When to use which?**
> - `npm install` — local development; updates `package-lock.json` if needed
> - `npm ci` — CI pipelines and fresh environments; strictly follows lock file, faster and more reliable

### 3. Install Playwright Browsers

```bash
npx playwright install
```

> Installs Chromium, Firefox, and WebKit browser binaries required by Playwright.

---

## Folder Structure

```
playwright-cucumber-framework/
│
├── e2e/                              # All test automation lives here
│   │
│   ├── config/
│   │   └── config.yaml               # Central config: browser, env URLs, run settings
│   │
│   ├── features/
│   │   └── generated/                # Auto-generated .feature files (do not edit manually)
│   │       ├── api/                  # API-only feature files
│   │       ├── endtoend/             # UI + API combined feature files
│   │       └── web/                  # UI-only feature files
│   │
│   ├── locators/
│   │   ├── common.yaml               # Shared locators used across all pages
│   │   ├── pages.yaml                # Page registry: page keys, titles, labels
│   │   └── generated/                # Auto-generated per-page locator YAML files
│   │       ├── api/
│   │       ├── endtoend/
│   │       └── web/
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
│       ├── recorder.ts               # Custom Playwright recorder (no codegen UI)
│       ├── browser.ts                # Browser launch helpers
│       ├── capture.ts                # API network capture logic
│       ├── converter.ts              # Converts recorded actions → feature + locator artifacts
│       ├── formatter.ts              # Generates Gherkin text from captured API data
│       ├── tableHelper.ts            # Web table verification utilities
│       ├── textHelper.ts             # Screen text verification utilities
│       ├── pageRegistry.ts           # YAML read/write helpers for pages.yaml
│       ├── mode.ts                   # Run mode resolution (UI / API / E2E)
│       └── scripts/
│           ├── run.js                # Test runner: resolves features, passes args to Cucumber
│           └── generate.js           # Generator: converts recorded-session.json → artifacts
│
├── reports/
│   ├── integrationTests/             # HTML test execution reports
│   └── recorded/                     # Video recordings per scenario (.webm)
│
├── test-results/                     # Raw Cucumber result output
├── cucumber.js                       # Cucumber configuration file
├── package.json                      # Project dependencies and npm scripts
├── tsconfig.json                     # TypeScript compiler configuration
└── config.example.yaml               # Example config (reference for new environments)
```

### Folder Purpose Summary

| Folder | Purpose |
|---|---|
| `e2e/config/` | Single config file controls all browser, environment and run settings |
| `e2e/features/generated/` | Auto-generated Gherkin scenarios — source of truth for what runs |
| `e2e/locators/` | YAML-based element selectors replacing traditional Page Object classes |
| `e2e/stepdefinitions/` | TypeScript step bindings that execute Playwright actions |
| `e2e/support/` | Shared utilities, recorder engine, path helpers, and run scripts |
| `reports/` | HTML reports and scenario video recordings |

---

## Recorder Usage

The recorder captures your browser interactions and API calls in real time, then converts them into runnable Cucumber feature files and YAML locators automatically.

### Start the Recorder

```bash
npm run pw
```

This launches a **real Chromium browser window** with the recorder engine injected. No Playwright Inspector UI is shown.

### How Recording Works

**Step 1 — Browser opens**
The recorder launches a full browser session. Navigate to any page and interact normally.

**Step 2 — UI actions are captured**
Every click, text input, dropdown selection, checkbox interaction, and navigation is recorded with smart locator resolution (prefers `aria-label`, `id`, `name`, `placeholder` over fragile XPaths).

**Step 3 — API calls are captured**
All network API calls made during your UI interactions are automatically intercepted and stored alongside the UI steps.

**Step 4 — Stop and generate**
When done, click **Generate** in the recorder overlay. The framework **automatically** converts the session into:
- A `.feature` file under `e2e/features/generated/<category>/`
- A per-page locator `.yaml` file under `e2e/locators/generated/<category>/`
- An updated `e2e/locators/pages.yaml` registry entry

No separate command is needed — generation happens as part of the recording process.

### Recording Categories

The framework **automatically classifies** your recording into one of three categories:

| Category | When Used |
|---|---|
| `web` | Only UI steps were recorded (clicks, inputs, navigation) |
| `api` | Only API requests were recorded (no browser interaction) |
| `endtoend` | Both UI steps AND API calls were captured together |

---

## Generated Files

### Feature Files (`.feature`)
Located at `e2e/features/generated/<category>/<name>.feature`

```gherkin
@smoke
Feature: Login Flow

  Scenario: User login with valid credentials
    Given User navigates to "https://app.example.com/"
    Given User is on "loginPage" screen
    Given enters "user@example.com" text in "Email Address" textbox
    Given enters "Test@123" text in "Password" textbox
    When User clicks on "Login" button
    When verify "Welcome" text is present on the screen
```

> These files are **auto-generated**. Avoid editing them manually unless adding tags.

### YAML Locator Files (`.yaml`)
Located at `e2e/locators/generated/<category>/<pageKey>.yaml`

```yaml
Email Address:  [css, input[type="email"]]
Password:       [css, input[type="password"]]
Login:          [xpath, //button[normalize-space()='Login']]
```

Each entry maps a **human-readable element name** to a `[strategy, selector]` pair.

### Common Locators (`common.yaml`)
Located at `e2e/locators/common.yaml`

Defines shared elements available on **every page** — navigation bar, logout button, modals, toast messages, etc. The framework checks `common.yaml` automatically if an element is not found in the page-specific YAML.

### Page Registry (`pages.yaml`)
Located at `e2e/locators/pages.yaml`

Tracks the page title and a representative label for each registered page key. Used by the `User is on "..." screen` step to optionally verify the page loaded correctly.

---

## Running Tests

### Run All Feature Files

Runs every `.feature` file found under `e2e/features/generated/`:

```bash
npm run test:all
```

or:

```bash
node e2e/support/scripts/run.js
```

### Run by Category

```bash
# UI-only tests
npm run test:web

# API-only tests
npm run test:api

# End-to-end (UI + API) tests
npm run test:e2e
```

### Run a Single Feature File

```bash
node e2e/support/scripts/run.js login
```

or with the full path:

```bash
node e2e/support/scripts/run.js e2e/features/generated/web/login.feature
```

### Run Multiple Feature Files

```bash
node e2e/support/scripts/run.js login dashboard checkout
```

### Run Using Tags

Add tags in your `.feature` file above `Feature:` or `Scenario:`:

```gherkin
@smoke
Scenario: User login with valid credentials
```

Then run:

```bash
# Run @smoke tagged scenarios
node e2e/support/scripts/run.js --tags @smoke

# Short flag
node e2e/support/scripts/run.js -t @smoke

# Bare tag shorthand
node e2e/support/scripts/run.js @smoke

# Using npm script
npm run run -- --tags @smoke
```

### Tag Expressions

```bash
# Smoke only
node e2e/support/scripts/run.js --tags "@smoke"

# Regression only
node e2e/support/scripts/run.js --tags "@regression"

# Smoke but not work-in-progress
node e2e/support/scripts/run.js --tags "@smoke and not @wip"

# Smoke or regression
node e2e/support/scripts/run.js --tags "@smoke or @regression"

# Multiple bare tags (auto-joined with AND)
node e2e/support/scripts/run.js @smoke @regression

# Run specific category + tag
node e2e/support/scripts/run.js web --tags @smoke
node e2e/support/scripts/run.js endtoend --tags @regression
```

### Preview Without Running

List which feature files would run without executing them:

```bash
node e2e/support/scripts/run.js --tags @smoke --list
```

---

## Execution Examples

```bash
# Run all tests
npm run test:all

# Run all web tests
npm run test:web

# Run all API tests
npm run test:api

# Run all E2E tests
npm run test:e2e

# Run single file by name
node e2e/support/scripts/run.js recordedflow

# Run single file by path
node e2e/support/scripts/run.js e2e/features/generated/endtoend/recordedflow.feature

# Run multiple named files
node e2e/support/scripts/run.js login dashboard profile

# Run all web @smoke tests
node e2e/support/scripts/run.js web --tags @smoke

# Run @regression but exclude @wip
node e2e/support/scripts/run.js --tags "@regression and not @wip"

# Preview what @smoke would run (no execution)
node e2e/support/scripts/run.js @smoke --list

# Parallel execution (configured via maxInstances in config.yaml)
# Set maxInstances: 4 in e2e/config/config.yaml, then:
npm run test:all
```

---

## Reports

### HTML Report

Generated automatically after every test run.

| Report | Location |
|---|---|
| HTML Report | `reports/integrationTests/cucumber-report.html` |
| Video Recordings | `reports/recorded/<scenario-name>-<PASS|FAIL>-<timestamp>.webm` |

### Open the HTML Report

```bash
# Windows
start reports/integrationTests/cucumber-report.html

# macOS
open reports/integrationTests/cucumber-report.html

# Linux
xdg-open reports/integrationTests/cucumber-report.html
```

### What the Report Shows

- ✅ Pass / ❌ Fail status per scenario
- Step-by-step execution detail
- Error messages and stack traces for failures
- Scenario tags and feature names
- Execution duration per step and scenario

### Video Recordings

When `recordVideo: true` is set in `e2e/config/config.yaml`, a `.webm` video is saved for every scenario:

```
reports/recorded/User_login_with_valid_credentials-PASS-2026-06-06_10-30-00.webm
reports/recorded/User_login_with_invalid_password-FAIL-2026-06-06_10-30-45.webm
```

---

## Configuration

All framework settings live in **`e2e/config/config.yaml`**.

```yaml
# ── Browser ────────────────────────────────────────────────────────────────
browser:
  name: chrome            # chromium | chrome | edge | firefox
  headless: false         # true = no visible browser window (CI mode)
  slowMo: 1000            # ms delay between actions (0 for fastest)
  clickTimeoutMs: 30000   # max wait for elements to appear
  viewportDevice: " "     # "" = desktop; set to "iPhone 14 Pro Max" for mobile
  recordVideo: true       # save .webm video per scenario

# ── Test Run ───────────────────────────────────────────────────────────────
run:
  environment: val        # val | dev | standalone
  tags: ""                # default tag filter (empty = run all)
  retryOnFail: 0          # retry failed scenarios N times
  reportFolder: ./reports/integrationTests
  maxInstances: 1         # parallel workers (1 = sequential)
  features: ./e2e/features/generated/**/*.feature
  getPageTimeoutMs: 40000
  redirectWaitMs: 15000
  verifyTimeoutMs: 20000

# ── Environment URLs ────────────────────────────────────────────────────────
urls:
  standalone: http://localhost:4042/
  val: https://customer-billing-deve.vercel.app/
  dev: https://customer-billing-deve.vercel.app/
```

### Key Configuration Options

| Key | Values | Description |
|---|---|---|
| `browser.name` | `chrome`, `chromium`, `edge`, `firefox` | Browser to run tests in |
| `browser.headless` | `true` / `false` | Hide or show browser window |
| `browser.slowMo` | number (ms) | Slow down actions for visibility |
| `browser.recordVideo` | `true` / `false` | Enable scenario video recording |
| `browser.viewportDevice` | device name or `" "` | Mobile emulation device |
| `run.environment` | `val`, `dev`, `standalone` | Active environment URL |
| `run.tags` | `@smoke`, `@regression` | Default tag filter for all runs |
| `run.maxInstances` | number | Parallel workers count |
| `run.retryOnFail` | number | Auto-retry count on failure |

### Cucumber Configuration (`cucumber.js`)

```js
module.exports = {
  default: {
    paths: [],                              // set by run.js at runtime
    require: ['e2e/stepdefinitions/**/*.ts'],
    requireModule: ['ts-node/register'],
    format: ['progress', 'html:...'],
  }
};
```

### TypeScript Configuration (`tsconfig.json`)

Standard TypeScript settings for `ts-node` execution. No changes needed unless adding custom path aliases.

---

## Troubleshooting

### Dependency Installation Issues

**Problem:** `npm install` fails with peer dependency errors.

```bash
# Force install ignoring peer conflicts
npm install --legacy-peer-deps
```

**Problem:** `node_modules` is corrupted or stale.

```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
npm install
```

---

### Browser Installation Issues

**Problem:** `Error: browserType.launch: Executable doesn't exist`

```bash
# Reinstall Playwright browsers
npx playwright install

# Install specific browser only
npx playwright install chromium
```

**Problem:** Browser crashes immediately on Linux/CI.

```bash
# Install system dependencies
npx playwright install-deps
```

---

### Recorder Not Starting

**Problem:** `npm run pw` shows an error about missing files.

- Ensure you are in the project root directory.
- Ensure `npm install` was run successfully.
- Check that `e2e/support/recorder.ts` exists.

**Problem:** Browser opens but recording does not capture actions.

- Ensure the inject script loaded (check browser console for errors).
- Try navigating to the target URL after the browser opens.

---

### Feature Execution Failures

**Problem:** `Element "X" not found in page "Y"` error.

- The locator YAML for that page may be missing the element.
- Open `e2e/locators/generated/<category>/<pageKey>.yaml` and add the missing element manually:
  ```yaml
  My Button: [xpath, //button[normalize-space()='My Button']]
  ```
- Or add it to `e2e/locators/common.yaml` if it appears on multiple pages.

**Problem:** `No active page set` error.

- A step is trying to interact with an element before `Given User is on "..." screen` was called.
- Ensure every scenario starts with the correct screen step.

**Problem:** Feature file not found when running by name.

```bash
# Use --list to debug what gets resolved
node e2e/support/scripts/run.js myFeature --list
```

---

### Report Generation Issues

**Problem:** No HTML report is generated after the run.

- Check that `reportFolder` in `e2e/config/config.yaml` points to a writable path.
- Ensure the `reports/integrationTests/` folder has write permissions.

**Problem:** Video files not saved.

- Set `recordVideo: true` in `e2e/config/config.yaml`.
- Ensure the `reports/recorded/` folder exists or can be created.

---

## Best Practices

### Naming Feature Files

- Use `camelCase` matching the page key: `loginPage.feature`, `customerBilling.feature`
- Keep the file name descriptive and short
- Let the generator name the file — only rename when the default is unclear

### Tag Usage

```gherkin
@smoke              # Fast, critical path tests
@regression         # Full regression suite
@login              # Feature-area tag
@wip                # Work in progress — excluded from pipelines
@flaky              # Known unstable tests to monitor
```

- Tag at **Scenario level** for fine-grained control
- Tag at **Feature level** only when ALL scenarios share the same classification
- Always exclude `@wip` in CI: `--tags "not @wip"`

### Locator Maintenance

- **Never** put raw XPaths in step definitions — always use YAML locators
- Keep `common.yaml` for elements that appear on 3+ pages
- Prefer `css` strategy over `xpath` when both work
- Use descriptive element names: `Submit Payment Button` not `btn1`

### Step Definitions

- Prefer the **built-in generic steps** before writing custom ones
- If a new step is needed, add it to `web.ts` (UI) or `api.ts` (API)
- Never hardcode URLs, usernames or passwords inside step definitions — use config or test data

### Test Data Management

- Do not hardcode test data inside `.feature` files directly for sensitive data
- Use `Scenario Outline` with `Examples:` tables for data-driven testing
- Environment-specific data belongs in `e2e/config/config.yaml` under `urls:`

---

## Example Workflow

Here is a complete end-to-end workflow for a new team member:

### Step 1 — Install

```bash
git clone <repository-url>
cd playwright-cucumber-framework
npm install
npx playwright install
```

### Step 2 — Start the Recorder

```bash
npm run pw
```

A Chrome browser window opens automatically.

### Step 3 — Record Your Flow

1. Navigate to the application URL
2. Perform the user journey (login, fill forms, click buttons)
3. All actions and API calls are captured in real time

### Step 4 — Generate Artifacts

Click the **Generate** button in the recorder overlay. The framework automatically creates:
- `e2e/features/generated/<category>/<pageKey>.feature`
- `e2e/locators/generated/<category>/<pageKey>.yaml`
- Updated `e2e/locators/pages.yaml`

No separate command needed — generation is part of the recording step.

### Step 5 — Add Tags (Optional)

Open the generated `.feature` file and add tags above the `Scenario:`:

```gherkin
@smoke @login
Scenario: User login with valid credentials
```

### Step 6 — Execute the Feature

```bash
# Run by name
node e2e/support/scripts/run.js recordedflow

# Run by tag
node e2e/support/scripts/run.js --tags @smoke
```

### Step 7 — View the Report

```bash
start reports/integrationTests/cucumber-report.html
```

---

## Command Reference

### NPM Scripts

| Command | Description |
|---|---|
| `npm run pw` | Start the Playwright recorder (artifacts auto-generated on stop) |
| `npm run test:all` | Run all feature files |
| `npm run test:web` | Run all UI-only features |
| `npm run test:api` | Run all API-only features |
| `npm run test:e2e` | Run all end-to-end (UI + API) features |
| `npm run cucumber` | Launch Cucumber CLI directly |

### Runner Commands

| Command | Description |
|---|---|
| `node e2e/support/scripts/run.js` | Run all features |
| `node e2e/support/scripts/run.js web` | Run all `web` category features |
| `node e2e/support/scripts/run.js api` | Run all `api` category features |
| `node e2e/support/scripts/run.js endtoend` | Run all `endtoend` category features |
| `node e2e/support/scripts/run.js <name>` | Run a feature file by name |
| `node e2e/support/scripts/run.js <path>` | Run a feature file by path |
| `node e2e/support/scripts/run.js <a> <b>` | Run multiple named features |
| `node e2e/support/scripts/run.js --tags @smoke` | Run by tag expression |
| `node e2e/support/scripts/run.js -t @smoke` | Run by tag (short flag) |
| `node e2e/support/scripts/run.js @smoke` | Run by bare tag |
| `node e2e/support/scripts/run.js --list` | List matched files only (no run) |
| `npm run run -- --tags @smoke` | Run with tag via npm |

### Tag Expression Examples

| Expression | Meaning |
|---|---|
| `@smoke` | Run all `@smoke` scenarios |
| `@smoke and @login` | Must have BOTH tags |
| `@smoke or @regression` | Has EITHER tag |
| `not @wip` | Exclude `@wip` scenarios |
| `@smoke and not @wip` | Smoke tests, excluding WIP |
| `@regression or @smoke` | Either regression or smoke |

### Supported Browsers

| Value in `config.yaml` | Browser Used |
|---|---|
| `chromium` | Bundled Chromium (default) |
| `chrome` | Installed Google Chrome |
| `edge` | Microsoft Edge |
| `firefox` | Mozilla Firefox |

### Supported Viewport Devices

Set `browser.viewportDevice` in `e2e/config/config.yaml`:

| Device Name |
|---|
| `iPhone SE` |
| `iPhone 14 Pro Max` |
| `Pixel 7` |
| `Samsung Galaxy S20 Ultra` |
| `iPad Pro` |
| `Surface Pro 7` |

Leave as `" "` (space) for full desktop viewport.

---

## Contributing

1. Branch from `main`: `git checkout -b feature/my-improvement`
2. Make changes following the best practices above
3. Ensure all existing tests still pass: `npm run test:all`
4. Submit a pull request with a clear description

---

*Built with [Playwright](https://playwright.dev/) · [Cucumber.js](https://cucumber.io/) · [TypeScript](https://www.typescriptlang.org/)*
