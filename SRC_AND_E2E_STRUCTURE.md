# `src` and **`e2e`** Folder Structure — Detailed Reference

This document describes the purpose, contents, and usage of the **`src`** and **`e2e`** folders in the UI-Auto E2E framework, including each file, subfolder, and their methods/functions.

---

## 1. Overview

### 1.1 Purpose of the Structure

| Folder | Purpose |
|--------|--------|
| **`src`** | **SDK (framework) code** — Reusable, distributable automation logic. Packaged as `ui-auto-sdk` and consumed by application teams as an NPM dependency. Contains CLI, config loading, WDIO runner, hooks, core step definitions, locator resolution, and browser overlay. |
| **`e2e`** | **Consumer-owned E2E assets** — Feature files, locators, config, and (optionally) app-specific step definitions and support utilities. Lives in the consumer repo; when using the SDK, teams maintain only `e2e/` plus their app. |

### 1.2 How They Work Together

- **`src`** provides:
  - CLI: `npx ui-auto init` and `npx ui-auto run [--env ...] [--tags ...]`
  - Config loading from `e2e/config/config.yaml`
  - WDIO config built from that YAML + overrides
  - SDK hooks (before/after scenario, failure screenshots, overlay injection)
  - Core Gherkin step definitions (navigate, enter text, click button, assert screen)
  - Locator resolution from `e2e/locators/` (common, pages, page-specific JSON)

- **`e2e`** provides:
  - `config.yaml` (environments, browser, features glob, report folder, etc.)
  - Feature files (`.feature`) and tags
  - Locators (`common.json`, `pages.json`, `pages/*.json`)
  - Optional legacy WDIO config (`wdio.conf.ts`) when running via `npm run wdio`
  - App-specific step definitions and support helpers (e.g. CCE, SauceDemo, enrollment flows)

---

## 2. The `src` Folder

### 2.1 Root Files

#### `cli.ts`

**Purpose:** SDK CLI entrypoint. Parses `init` / `run` and options, sets env vars, then delegates to `scaffold` or `runTests`.

**Key functions:**

| Function | Description |
|----------|-------------|
| `parseArgs(argv: string[])` | Parses `process.argv` into `{ command, options }`. Command defaults to `run` if first arg looks like an option. |
| `setEnvFromOptions(opts)` | Maps `--consumerRoot`, `--config`, `--env`, `--tags`, `--browser`, `--maxInstances`, `--headless` to `process.env` (e.g. `UI_AUTO_CONSUMER_ROOT`, `UI_AUTO_ENV`, `UI_AUTO_TAGS`). |
| `main()` | Dispatches `init` → `scaffold` + exit, or `run` → `runTests`; exits with code 2 on unknown command. |

**Usage:** `npx ui-auto init`, `npx ui-auto run --env val --tags "@smoke"`.

---

#### `index.ts`

**Purpose:** Non-CLI public entrypoints for programmatic use.

**Exports:**

- `loadFrameworkConfig` from `./config/loadConfig`
- `runTests` from `./runner/runTests`

---

### 2.2 `src/config/`

#### `consumerRoot.ts`

**Purpose:** Resolves the “consumer root” directory (where the app under test lives). Used to find `e2e/config`, `e2e/locators`, `e2e/features`, etc.

**Exports:**

| Export | Description |
|--------|-------------|
| `CONSUMER_ROOT_ENV` | `'UI_AUTO_CONSUMER_ROOT'` |
| `getConsumerRoot()` | Returns `path.resolve(process.env[CONSUMER_ROOT_ENV])` if set, else `process.cwd()`. |

---

#### `loadConfig.ts`

**Purpose:** Loads and caches consumer YAML config from `e2e/config/config.yaml` (or custom path). Exposes helpers for execution mode and environment.

**Key functions:**

| Function | Description |
|----------|-------------|
| `resolveDefaultConfigPath(consumerRoot)` | `path.join(consumerRoot, 'e2e', 'config', 'config.yaml')`. |
| `loadFrameworkConfig(opts?)` | Loads YAML from config path (default or `opts.configPath`), optionally `opts.consumerRoot`, `opts.bustCache`). Caches per path. Throws if missing/invalid. |
| `getExecutionMode(config)` | Returns `'GRID' \| 'SELENIUMBOX' \| 'LOCAL'` from `config.executionMode`. |
| `getEnvironment(config)` | Returns uppercased `config.environment`. |

**Options:** `LoadConfigOptions`: `configPath?`, `consumerRoot?`, `bustCache?`.

---

### 2.3 `src/init/`

#### `postinstall.ts`

**Purpose:** Runs on `npm install` when the SDK is added as a dependency. Uses `INIT_CWD` or `cwd` as consumer root and calls `scaffold` with `force: false` so existing files are not overwritten.

---

#### `scaffold.ts`

**Purpose:** Creates the `e2e` folder structure, default `config.yaml`, locators, a sample feature, and (when available) `GHERKIN_STEP_DEFINITIONS.md`. Used by `ui-auto init` and postinstall.

**Key exports:**

| Export | Description |
|--------|-------------|
| `ScaffoldOptions` | `consumerRoot?`, `force?`. |
| `scaffold(opts?)` | Creates `e2e/config`, `e2e/features`, `e2e/locators`, `e2e/locators/pages`; writes default config, `common.json`, `pages.json`, `Login Page.json`, `login.feature`; optionally step-defs doc. Skips existing files unless `force` is true. |

**Defaults:** Local Chrome, `val` env, `@smoke` tags, `./reports/integrationTests`, `./e2e/features/**/*.feature`, placeholder URLs.

---

### 2.4 `src/injection/`

#### `injectAutomationOverlay.ts`

**Purpose:** Injects a small automation overlay into the current page via `browser.execute`. Shows scenario name and status (e.g. running / passed / failed). Idempotent across navigations and SPA route changes.

**Exports:**

| Export | Description |
|--------|-------------|
| `OverlayState` | `{ scenarioName?: string; status?: string }`. |
| `injectAutomationOverlay(state?)` | Injects style + overlay DOM, updates title and status. Uses `__ui_auto_overlay__` and `__ui_auto_overlay_style__` IDs. |

---

### 2.5 `src/locators/`

#### `locatorProvider.ts`

**Purpose:** Resolves and reads consumer locators from `e2e/locators/`. Supports `common.json`, `pages.json`, and `pages/<PageName>.json`. Uses an in-memory cache.

**Key functions:**

| Function | Description |
|----------|-------------|
| `resolveLocatorsDir(opts?)` | `path.join(consumerRoot, 'e2e', 'locators')`. |
| `resolveCommonLocatorsPath(opts?)` | `.../e2e/locators/common.json`. |
| `resolvePagesMapPath(opts?)` | `.../e2e/locators/pages.json`. |
| `resolvePageLocatorsPath(pageName, opts?)` | `.../e2e/locators/pages/<pageName>.json`. |
| `getElementLocator(elementName, opts)` | Returns `[kind, value]` (e.g. `['id','username']`) from common or page JSON. `opts`: `common?`, `pageName?`, `consumerRoot?`. |
| `getPageUrlByName(pageName, opts?)` | Returns URL string for `pageName` from `pages.json` if stored as string. |
| `getPageMetadata(screenName, opts?)` | Returns `{ title, label? }` from `pages.json` entry (array of metadata objects). |
| `clearLocatorCache()` | Clears the JSON cache. |

**Types:** `LocatorOpts`, `PageMetadata`.

---

### 2.6 `src/runner/`

#### `runTests.ts`

**Purpose:** Programmatic WDIO runner used by the CLI.

**Exports:**

| Export | Description |
|--------|-------------|
| `RunOptions` | `wdioConfigPath?`, `wdioArgs?`. |
| `runTests(opts?)` | Uses `@wdio/cli` Launcher with `wdio.sdk.conf.js` (or `opts.wdioConfigPath`). Returns exit code. |

---

#### `hooks.ts`

**Purpose:** Central WDIO + Cucumber hooks used by the SDK config. Handles logging, failure screenshots, overlay updates, and cookie clearing.

**Exports:**

| Export | Description |
|--------|-------------|
| `sdkHooks.beforeScenario(world)` | Sets `PageContext` scenario name; clears cookies unless same scenario as previous; injects overlay with status `running`. |
| `sdkHooks.beforeCommand(commandName)` | Re-injects overlay on `url` / `navigateTo` / `refresh`. |
| `sdkHooks.afterScenario(_world, result)` | On failure: full-page scroll + screenshots per viewport, attaches to cucumber-json, injects overlay `failed`. On pass: overlay `passed`. |

**Helpers:** `getReportFolder()` from config, `takeFailureScreenshot(num)`.

---

#### `wdio.sdk.conf.ts`

**Purpose:** SDK WDIO config entrypoint. Builds config at runtime from `config.yaml` and env overrides (`UI_AUTO_ENV`, `UI_AUTO_TAGS`, etc.).

**Exports:** `config` — built via `buildWdioConfig` with `getConsumerRoot()`, `UI_AUTO_CONFIG_PATH`, and overrides.

---

#### `wdioConfigBuilder.ts`

**Purpose:** Builds the full WDIO config from `config.yaml`, environment, and overrides. Configures specs, capabilities, Cucumber, report paths, and SDK hooks.

**Key functions:**

| Function | Description |
|----------|-------------|
| `resolveBaseUrl(cfg, environment)` | Maps `VAL`/`DEV`/`STANDALONE` to `valUrl`/`devUrl`/`standaloneUrl`. |
| `resolveBrowserName(cfg, browserOverride?)` | Normalizes browser (e.g. IE, Chrome, Edge). |
| `applyDriverEnv(cfg, browserName)` | Sets `CHROMEDRIVER_FILEPATH` / `EDGEDRIVER_PATH` from config when provided. |
| `selectFeaturesByTags(featureGlob, tagsCsv, consumerRoot)` | Glob features, parse with `parseFeatureFile`, filter by feature/scenario tags; returns paths. |
| `buildWdioConfig(opts)` | Full WDIO config: capabilities, baseUrl, specs, `cucumberOpts` (retry, require SDK stepdefs, timeouts), `beforeScenario` / `beforeCommand` / `afterScenario` from `sdkHooks`, Cucumber JSON reporter, `onPrepare` / `onComplete` (HTML report via `multiple-cucumber-html-reporter`). |

**Options:** `BuildWdioConfigOptions` — `configPath?`, `consumerRoot?`, `overrides?` (env, tags, browser, maxInstances, headless).

---

### 2.7 `src/stepdefinitions/`

#### `core_stepdefs.ts`

**Purpose:** App-agnostic Gherkin step definitions. Consumers write features using these steps; framework logic stays in the SDK.

**Steps:**

| Step | Description |
|------|-------------|
| `Given('User navigates to {string} URL', ...)` | `browser.url(url)`. |
| `Given('enters {string} text in {string} textbox', ...)` | Resolves element via `SdkPageHelper.findElement`, then `sdkSendKeys` or `sdkClearText` for `<blank>`. |
| `When('User clicks on {string} button', ...)` | Finds element (clickable wait), then `sdkClick`. |
| `Then('User is on {string} screen', ...)` | Sets `PageContext.setCurrentPage`, then `sdkWaitForPage` (title + optional label from `pages.json`). |

Uses `PageContext`, `SdkPageHelper`, and `sdkElementHelpers`.

---

### 2.8 `src/support/`

#### `gherkin-parser.ts`

**Purpose:** Lightweight Gherkin parser for tag-based feature selection. Uses `@cucumber/gherkin` to parse feature and scenario tags only.

**Exports:**

| Export | Description |
|--------|-------------|
| `ParsedScenario` | `{ name, tags, stepCount }`. |
| `ParsedFeatureFile` | `{ featureName, featureTags, scenarios }`. |
| `parseFeatureFile(filePath)` | Parses file, returns feature name, feature-level tags, and scenarios with tags and step count. |

---

#### `PageContext.ts`

**Purpose:** Lightweight static context for current page and scenario across hooks and step definitions.

**API:**

| Member | Description |
|--------|-------------|
| `currentPage`, `scenarioName`, `sameScenarioSwitch` | Static state. |
| `setCurrentPage(name)`, `getCurrentPage()` | Get/set current page. |
| `setScenarioName(name)`, `getScenarioName()` | Get/set scenario name. |

---

#### `PageHelper.ts`

**Purpose:** SDK page helper. Resolves locators via `locatorProvider` and converts them to WDIO selectors.

**API:**

| Method | Description |
|--------|-------------|
| `SdkPageHelper.locator(elementName, common)` | Returns `[kind, value]` from common or current page locators. |
| `SdkPageHelper.selector(elementName, common)` | Same but returns selector string (id → `#`, name → `[name="..."]`, etc.). |
| `SdkPageHelper.findElement(elementName, common, waitFormat?)` | Gets selector, optionally waits for clickable (`waitFormat` contains `'click'`), returns `$(selector)`. |

**Selector mapping:** xpath, id, name, tagName, linkText, buttonText, className, generic `[kind="value"]`.

---

#### `sdkElementHelpers.ts`

**Purpose:** Minimal element helpers used by core step definitions (no e2e-specific deps). Click, type, clear, wait-for-page.

**Functions:**

| Function | Description |
|----------|-------------|
| `sdkClick(element)` | `element.click()`. |
| `sdkSendKeys(element, value, sendEnter?)` | Wait displayed, clear, setValue, optionally Enter. |
| `sdkClearText(element)` | `element.clearValue()`. |
| `sdkWaitForPage(screenName)` | Uses `getPageMetadata(screenName)`; waits for title and optional label via `wdio-wait-for`. |

---

## 3. The `e2e` Folder

### 3.1 `e2e/config/`

#### `config.yaml`

**Purpose:** Consumer-owned runtime configuration. Defaults (often from scaffold): `executionMode: local`, `browserName: chrome`, `environment: val`, `tags: "@smoke"`, `maxInstances: 1`, `reportFolder: ./reports/integrationTests`, `allScriptsTimeout`, `getPageTimeout`, `features` glob, `valUrl` / `devUrl` / `standaloneUrl`. Optional: `chromedriverpath`, `edgedriverpath`, `seleniumAddress`, Selenium Box settings, etc.

**Used by:** SDK `loadConfig` / `wdioConfigBuilder` and legacy `wdio.conf.ts`.

---

#### `wdio.conf.ts`

**Purpose:** Legacy WebdriverIO config when running via `npm run wdio` (non-SDK). Reads `config.yaml`, sets `baseUrl` by environment, configures Cucumber (stepdefs under `e2e/stepdefinitions/**/*.ts`), reporters, and hooks (`beforeScenario`, `afterScenario`). Uses `PageConfigHelper`, `parseFeatureFile` from `e2e/support`, tag-based feature selection, and custom `takeScreenshot` / HTML report generation.

**Note:** SDK flow uses `wdio.sdk.conf` + `wdioConfigBuilder` instead; this file supports the pre-SDK `wdio` script.

---

### 3.2 `e2e/features/`

| File | Purpose |
|------|--------|
| `login.feature` | Sample login flow (navigate, Login Page, username/password, click Login, Home). Tagged `@smoke` `@login`. |
| `1_Home Page.feature` | CCE home-page scenarios (office code, claim, edits). Uses `GoToPage` and app-specific steps. Tagged e.g. `@WebUI` `@page-test` `@homepage`. |
| `SauceDemo_Login.feature` | SauceDemo login (navigate to saucedemo.com, Login Page, credentials, Products screen). Tagged `@WebUI` `@saucedemo` `@login` `@test`. |
| `test/attribute.feature` | Attribute-test scenarios (partially commented). Uses “User navigates to Home Page screen…”. |

Features reference steps from both SDK core steps and e2e-specific step definitions.

---

### 3.3 `e2e/locators/`

| File | Purpose |
|------|--------|
| `common.json` | Shared locators across pages (default `{}`). |
| `pages.json` | Map of **screen name → page metadata** (and optionally URL). e.g. `"Login Page": [{"title":"...","label":"Login"}]`, `"Home": [...]`. Used for `getPageMetadata` / `getPageUrlByName`. |
| `pages/Home Page.json` | Locators for “Home Page” (e.g. Office Code, ClaimID, Policy Net, Sign Out). |
| `pages/Login Page.json` | Locators for “Login Page” (Username, Password, Login). |

Format: `"ElementName": ["kind", "value"]` (e.g. `["id","username"]`). Same contract as `locatorProvider` in `src`.

---

### 3.4 `e2e/stepdefinitions/`

#### `web_actions_stepdefs.ts`

**Purpose:** Large set of app-specific step definitions for CCE and similar flows. Overrides or extends SDK-style steps (e.g. `Given('User navigates to {string} URL')`, `When('User clicks on {string} button')`, `Given('User is on {string} screen')`) and adds many domain-specific steps.

**Examples:**

- **Given:** `User is on {string} screen`, `User navigates to {string} URL`, `User inputs information on {string} screen...`, `select {string} Checkbox`, etc.
- **When:** `enters {string} text in {string} textbox`, `User clicks on {string} button`, `clicks on {string} link`, `selects ... from ... Drop-down list`, `verify ...`, `verify data from {string} webtable`, etc.
- **Then:** `system generates edit message with description {string}`, `system generates notice message...`, `verify alerts displayed...`, `Verify {string} PDF data...`, etc.

Uses `PageConfigHelper`, `ElementHelper`, `TextboxHelper`, `CheckboxHelper`, `DropDownHelper`, `WaitHelper`, `CSVReader`, `TimeChanger`, `EnrollCalcInput`, `EnrollResultsCalc`, `PDFManager`, and other e2e support utilities.

---

#### `appSpecific/GoToPage_stepdefs.ts`

**Purpose:** Navigation steps for CCE and similar apps. Sets current page, navigates to “Home Page” or other screens, establishes new/existing claims, handles T2 RIB flows, query mode, etc.

**Examples:**

- `Given('Set page name to {string}')`
- `Given('User navigates to {string} screen to Establish New Medicare claim')`
- `Given('Go to page {string}')`
- `Given('User navigates to T2 RIB {string} screen for an new claim with {string} test data criteria')`
- `Given('User navigates to T2 RIB {string} screen for an existing claim with {string} test data criteria')`
- … plus query-mode, pending-claim, and enrollment variants.

Uses `config.baseUrl`, `WaitHelper`, `PageConfigHelper`, `ElementHelper`, `TextboxHelper`, `CheckboxHelper`, `DropDownHelper`, `CSVReader`, `EnrollCalcInput`.

---

#### `appSpecific/HomePage.ts`

**Purpose:** Home-page-specific steps, e.g. datatable-driven verification of edit messages in a given column.

**Example:** `Given('enters inputs with header names {string} from datatable to verify the edit message in {string} column', ...)`.

---

#### `appSpecific/EnrollCalcInput.ts`, `EnrollResultsCalc.ts`

**Purpose:** Domain models and calculations for enrollment-related scenarios (e.g. HI/SMI, filing dates). Used by `web_actions_stepdefs` and `GoToPage_stepdefs`.

---

### 3.5 `e2e/support/`

#### `html-helpers/`

Reusable helpers for UI interactions:

| File | Export | Purpose |
|------|--------|---------|
| `element-helper.ts` | `ElementHelper` | Click, scroll, get text, etc. |
| `textbox-helper.ts` | `TextboxHelper` | Send keys, clear, get value. |
| `checkbox-helper.ts` | `CheckboxHelper` | Mark checkbox, wait for display. |
| `dropdown-helper.ts` | `DropDownHelper` | Select by text/value. |
| `wait-helper.ts` | `WaitHelper` | Wait for page title, label, element, etc. |
| `table-helper.ts` | `TableHelper` | Table operations. |
| `test-table.ts` | `TableHelper` | Additional table helpers. |
| `page-helper.ts` | `PageHelper` | Page-level helpers. |

---

#### `misc-utils/`

| File | Export | Purpose |
|------|--------|---------|
| `PageHelper.ts` | `PageConfigHelper` | Current page/scenario, locator resolution (via `locatorProvider`), `findElement` / `findElements`, `answerQuestions`, `changeFrame`, etc. |
| `gherkin-parser.ts` | `parseFeatureFile` | Same role as SDK gherkin-parser; parses feature/scenario tags for tag-based selection. |
| `csv-reader.ts` | `CSVReader` | Read test data from CSV (e.g. SSN, criteria). |
| `TimeChanger.ts` | `TimeChanger` | Date formatting, `<CURRENT_DATE>`, `<DOB>`, etc. |
| `PageVariables.ts` | `PageVariables` | Hold page-extracted values (SSN, name, addresses, etc.). |
| `string-manipulation-helper.ts` | `StringManipulationHelper` | String checks, random strings, special-char handling. |
| `json-helper.ts` | `JsonHelper` | JSON read/write utilities. |
| `validation-helper.ts` | `ValidationsHelper` | Validation helpers. |
| `constants.ts` | `Constants` | Shared constants. |
| `DataClass.ts` | `DataClass` | Data structures. |
| `FeatureFileReport.ts` | `FeatureFileReport` | Feature-file reporting utilities. |
| `PDFManager.ts` | `PDFManager` | PDF download path, expected text path, compare. |
| `PSCHelper.ts` | `PSCHelper` | PSC-related helpers. |
| `common-page.validations.ts` | `CommonPageValidations` | Common validations. |
| `js-helper.ts` | `JsHelper` | JS utilities. |

Other: `findTag.ps1` (PowerShell), `testrunconstants.ts` (test-run constants).

---

### 3.6 `e2e/GHERKIN_STEP_DEFINITIONS.md`

**Purpose:** Reference of legacy (e2e) Gherkin step definitions: Given/When/Then with short descriptions and parameters. Used when writing or maintaining feature files that rely on `e2e/stepdefinitions` (e.g. `web_actions_stepdefs`, `GoToPage_stepdefs`).

---

## 4. Why This Structure?

### 4.1 Separation of Concerns

- **`src`** = stable, reusable SDK. Consumers don’t edit it; they upgrade the package.
- **`e2e`** = consumer-owned tests and config. Teams add features, locators, and app-specific steps.

### 4.2 Single Responsibility

- **Config:** `e2e/config/config.yaml` (and optionally `wdio.conf.ts`) — environments, browsers, report paths, features.
- **Locators:** `e2e/locators/` — all selectors and page metadata in one place.
- **Features:** `e2e/features/` — Gherkin only; no framework logic.
- **Steps:** SDK provides generic steps in `src`; app-specific steps in `e2e/stepdefinitions` and `appSpecific`.

### 4.3 Scalability and Consistency

- New apps add `e2e/` (or use scaffold), point config at their URLs, and maintain locators + features.
- Same CLI, same overlay, same reporting contracts across consumers.
- Tag-based selection and env overrides keep runs flexible without duplicating framework code.

### 4.4 Two Run Modes

1. **SDK flow:** `npx ui-auto run` → `wdio.sdk.conf` + `wdioConfigBuilder` → SDK hooks, SDK core steps, overlay. Uses `e2e` only for config, features, locators.
2. **Legacy flow:** `npm run wdio` → `e2e/config/wdio.conf.ts` → e2e hooks, e2e stepdefs, e2e support. Full use of `e2e/stepdefinitions` and `e2e/support`.

### 4.5 Consumer Contract

Consumers are expected to:

- Keep `e2e/config/config.yaml` valid and paths correct.
- Maintain `e2e/locators` (and `pages.json` metadata) for screens used in steps.
- Write features against SDK steps and/or e2e steps, using tags for filtering.

The structure keeps framework evolution in `src` and app-specific evolution in `e2e`, with a clear, consistent layout for both SDK and legacy runs.

---

## 5. Quick Reference

| Area | Location | Purpose |
|------|----------|---------|
| CLI | `src/cli.ts` | `init` / `run`, env mapping |
| Config loading | `src/config/loadConfig.ts` | YAML load, execution mode, environment |
| Consumer root | `src/config/consumerRoot.ts` | Resolve app root |
| Scaffold | `src/init/scaffold.ts` | Create `e2e` layout + defaults |
| Overlay | `src/injection/injectAutomationOverlay.ts` | Browser UI overlay |
| Locators | `src/locators/locatorProvider.ts` | Resolve `e2e/locators` JSON |
| Runner | `src/runner/runTests.ts`, `wdioConfigBuilder.ts` | WDIO launch + config |
| Hooks | `src/runner/hooks.ts` | Before/after scenario, screenshots, overlay |
| Core steps | `src/stepdefinitions/core_stepdefs.ts` | Navigate, enter text, click, assert screen |
| Support | `src/support/` | PageContext, PageHelper, gherkin-parser, sdkElementHelpers |
| E2E config | `e2e/config/` | `config.yaml`, `wdio.conf.ts` |
| E2E features | `e2e/features/` | `.feature` files |
| E2E locators | `e2e/locators/` | `common.json`, `pages.json`, `pages/*.json` |
| E2E steps | `e2e/stepdefinitions/` | App-specific and legacy steps |
| E2E support | `e2e/support/` | Html-helpers, misc-utils |

---

*Generated for the UI-Auto E2E framework. For CLI usage and consumer setup, see `README.md`, `CONSUMER_QUICKSTART.md`, and `CONSUMER_CONTRACT.md`.*
