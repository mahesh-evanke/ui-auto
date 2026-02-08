# WDIO Cucumber Framework Audit (Post-Migration)

Audit of this project against WebdriverIO v9 + wdio-cucumber-framework standards. The project was migrated from an older WDIO version.

---

## What Already Aligns With Standards

### 1. **Framework and packages**
- `framework: 'cucumber'` is set in `wdio.conf.ts`.
- `@wdio/cucumber-framework` ^9.23.0 and related `@wdio/*` packages are at v9.
- Step definitions use `Given` / `When` / `Then` and `DataTable` from `@cucumber/cucumber` (supported; WDIO docs allow either `@cucumber/cucumber` or `@wdio/cucumber-framework`).

### 2. **cucumberOpts**
- **require**: Uses glob `./e2e/stepdefinitions/**/*.ts` (good practice).
- **timeout**: Uses config-driven value (e.g. getPageTimeout).
- **retry**: Set (0).
- **failFast**, **dryRun**, **backtrace**, **snippets**, **source**, **format**: Present.
- **ignoreUndefinedDefinitions**: Set to false (undefined steps fail the run).

### 3. **Hooks**
- **beforeScenario** / **afterScenario** implemented in config (WDIO-style Cucumber hooks).
- **onPrepare** / **onComplete** used for report folder and HTML report generation.
- Screenshot-on-failure logic lives in **afterScenario** and attaches to Cucumber JSON.

### 4. **Runner and capabilities**
- **runner: 'local'** with no hostname/port for local runs (WDIO starts the driver).
- Capabilities use **wdio:edgedriverOptions** / **wdio:chromedriverOptions** with **binary** when paths are set (no driver download).
- **browserName** uses `msedge` for Edge (WDIO v9 convention).

### 5. **Reporters**
- **cucumberjs-json** reporter with `jsonFolder` under `reportFolder`; HTML report path uses `reportFolder` (e.g. `reportFolder + '/reportHtml/' + time`).

### 6. **Feature files**
- Gherkin with `Feature`, `Scenario` / `Scenario Outline`, `Examples`, and tags.
- Step wording matches step definitions (Given/When/Then).

### 7. **Global browser**
- Step definitions use the global `browser` object; WDIO injects it at runtime. Config uses `declare const browser` for type-checking.

---

## Gaps and Recommendations

### 1. **Tag filtering: prefer `tags` over `tagExpression`**
- **Current**: `tagExpression: String(e2eConfig.tags ?? '')` in `cucumberOpts`.
- **Standard**: WDIO docs state **tagExpression** is deprecated in favor of **tags**.
- **Recommendation**: Add `tags: String(e2eConfig.tags ?? '')` and, when comfortable, remove `tagExpression` so tag filtering is done via Cucumber’s standard `tags` option.

### 2. **TypeScript step definitions: explicit loader**
- **Current**: `require: ['./e2e/stepdefinitions/**/*.ts']` with `requireModule: []`.
- **Risk**: Cucumber will `require()` those `.ts` files; without a TS loader they may not run unless the runner compiles them elsewhere.
- **Recommendation**: If you ever see “Cannot find module” or step files not loading, add a TS loader in `cucumberOpts`, for example:
  - `requireModule: ['ts-node/register']` or
  - `requireModule: ['tsx/cjs']`
  (You already have `ts-node` and `tsx` in the project.) If tests already run, the runner may be compiling; then this is optional but improves clarity and portability.

### 3. **Specs vs tag-based feature filtering**
- **Current**: `specs` is set to a precomputed list built by parsing feature files and filtering by tags (gherkin-parse + custom loop). `cucumberOpts.tagExpression` is also set.
- **Standard**: Typically `specs` is a glob (e.g. `features: "./e2e/features/**/*.feature"`) and tag filtering is done only via `cucumberOpts.tags`.
- **Recommendation**: For consistency with WDIO Cucumber examples, consider:
  - Setting `specs` from the config feature glob (e.g. `String(e2eConfig.features)` or equivalent),
  - Using only `tags` (or `tagExpression` until removed) in `cucumberOpts` for filtering.
  If the current dual filtering (pre-filtered specs + tagExpression) is intentional (e.g. to reduce loaded features), you can keep it but document it.

### 4. **Strict mode for undefined steps**
- **Current**: `strict: false`.
- **Recommendation**: For stricter BDD and to catch missing steps, consider `strict: true` (fail on undefined or pending steps). Enable when the suite is stable and you want to enforce full coverage.

### 5. **Path and line separators**
- **Current**: `path.replace('e2e\\','..\\')` when building the feature list (Windows backslash).
- **Recommendation**: Use `path.join` or a normalized path so behavior is consistent on Unix and Windows (e.g. `path.relative(process.cwd(), path.resolve(path))` or similar).

### 6. **Cucumber JSON reporter package**
- **Current**: `wdio-cucumberjs-json-reporter` with `cucumberJson.attach()` in afterScenario.
- **Note**: This is a common reporter for Cucumber JSON; ensure it is compatible with the installed `@wdio/cucumber-framework` major version (e.g. no deprecated APIs).

---

## Optional Improvements

- **tagsInTitle**: Set `tagsInTitle: true` in `cucumberOpts` if you want tags included in scenario titles in reports.
- **failFast**: Use `failFast: true` (or override via CLI) during local dev for faster feedback.
- **Retries**: You have `retry: 0`; for flaky tests you can use `retry` and optionally `retryTagFilter` per WDIO Cucumber docs.
- **World / context**: If you need shared state, use Cucumber World or the `context` object passed to hooks and steps; avoid relying on global variables where avoidable.
- **baseUrl**: Already set from config; ensure all `browser.url()` / navigation use it or a full URL so behavior is consistent across environments.

---

## Summary

| Area              | Status        | Action |
|-------------------|---------------|--------|
| Framework & deps  | Aligned       | None   |
| cucumberOpts      | Mostly aligned| Prefer `tags`, add TS requireModule if needed |
| Hooks             | Aligned       | None   |
| Capabilities      | Aligned       | None   |
| Reporters & paths | Aligned       | None   |
| Tag filtering     | Deprecated opt| Add `tags`, later drop `tagExpression` |
| Spec loading      | Custom        | Optional: simplify to glob + tags |
| Strict / failFast | Optional      | Consider for quality and dev speed |

Overall the project fits WDIO Cucumber framework standards for v9. The main follow-ups are using **tags** instead of **tagExpression**, optionally registering a TypeScript **requireModule** for step definitions, and (if desired) simplifying specs to a glob plus tag-based filtering and enabling **strict** mode.
