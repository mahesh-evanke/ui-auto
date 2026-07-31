# playwright-fluent vs. playwright-without-bdd-library

[playwright-fluent](https://github.com/hdorgeval/playwright-fluent) is a reference-only project studied while designing this library's fluent chaining (`Chainable`, `.softly()`) — nothing here was copied from it, and its repo is never modified by this project. This document maps every public function on its `PlaywrightFluent` class to what exists (or doesn't) in `playwright-without-bdd-library`, so it's clear what was ported, what was intentionally left out, and what this library adds that playwright-fluent doesn't have.

**Status key:** ✅ have a direct equivalent · ⚠️ possible via an escape hatch, not a dedicated method · ❌ not implemented

---

## Navigation / lifecycle

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `navigateTo(url)` | Go to a URL | `webActions.navigate(url)` | ✅ |
| `close()` | Close the browser/page | Handled by Playwright Test itself per test | ⚠️ |
| `previousPage()` / `switchBackToPage()` / `switchToPreviousTab()` | Multi-tab/page navigation | `webActions.raw` (escape hatch to the real `Page`) | ⚠️ |
| `currentPage()` / `currentPageOrFrame()` | Get the active page/frame | `webActions.raw` | ⚠️ |
| `hasBeenRedirectedToAnotherTab()` | Detect tab redirects | — | ❌ |
| `currentBrowser()` / `withBrowser(name)` | Inspect/select browser | `e2e/config/config.yaml` → `browser.name` (chromium/chrome/edge/firefox) | ✅ (config, not chain method) |
| `pause()` | Pause execution (debugging) | `npx playwright test --debug` / `PWDEBUG=1` | ⚠️ (Playwright Test feature, not our API) |

## Element interaction

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `click(selector)` | Click, with visibility/stability waits | `webActions.click(name)` — plus scroll/force-click/dispatch-event fallback chain | ✅ |
| `doubleClick(selector)` | Double-click | `webActions.raw` / `webActions.getLocator(name)` | ⚠️ |
| `clickAtPosition(x, y)` | Click at raw coordinates | — | ❌ |
| `hover(selector)` | Hover | — | ❌ |
| `check(selector)` / `uncheck(selector)` | Checkbox/radio toggle | `webActions.check(name)` / `.uncheck(name)` | ✅ |
| `clear(selector)` / `clearText(selector)` | Clear a field | `webActions.fill(name, '')`, or handled inside `fill()`'s select-all+delete fallback | ⚠️ |
| `select(selector, value)` / `selectByValue(selector, value)` | Choose a `<select>`/custom-dropdown option | `webActions.selectDropdown(name, value)` — native `<select>` **and** common custom-dropdown libraries (PrimeReact/MUI/Ant/React-Select) | ✅ (broader scope) |
| `typeText(selector, text)` / `pasteText(selector, text)` | Enter text | `webActions.fill(name, text)` — `.fill()` first, keystroke fallback, DOM-value fallback | ✅ |
| `holdDownKey(key)` / `releaseKey(key)` / `pressKey(key)` | Keyboard control | `webActions.raw.keyboard` | ⚠️ |
| `switchToIframe(selector)` | Manually switch context into an iframe | Automatic — `resolveAcrossFrames()`/`getLocatorInFirstFrame()` search main page + every child frame for you, no manual switch needed | ✅ (different approach) |

## Element/state queries

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `exists()` / `doesNotExist()` / `isVisible()` / `isNotVisible()` / `isVisibleInViewport()` / `isNotVisibleInViewport()` | Presence/visibility checks | `webActions.getLocator(name)` + Playwright's own `.isVisible()`/`.count()` | ⚠️ |
| `isEnabled()` / `isDisabled()` / `isChecked()` / `isUnchecked()` / `isReadOnly()` / `hasFocus()` | Element state checks | `webActions.getLocator(name)` + raw Playwright assertions | ⚠️ |
| `hasText(value)` / `hasValue(value)` / `hasExactValue(value)` | Content assertions | `webActions.verifyTextPresent(text)` (anywhere on screen) / `webActions.verifyFieldText(name, expected)` (field value or text content) | ✅ |
| `getValueOf()` / `getInnerTextOf()` / `getSelectedText()` / `getSelectedOptionOf()` / `getAllSelectedOptionsOf()` / `getAllOptionsOf()` | Read element data | `webActions.getLocator(name)` + Playwright's `.inputValue()`/`.textContent()`/etc. | ⚠️ |
| `getCurrentUrl()` | Current page URL | `webActions.raw.url()` | ⚠️ |
| `getCurrentWindowState()` / `getToday()` | Window state / current date | `<CURRENT_DATE>` / `<CURRENT_DATE+N>` tokens (resolved inside `fill()`/table verification) cover the date case | ⚠️ |

## Assertions

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `expectThat(selector)` / `expectThatSelector(selector)` | Fluent, auto-retrying assertion builder (`.expectThat(sel).hasText(...)`) | `webActions.verifyTextPresent()` / `.verifyFieldText()` / `.verifyWebTable()` — a fixed set of built-in checks instead of a generic assertion builder | ⚠️ (narrower, purpose-built set) |
| `expectThatAsyncFunc(func)` | Assert on an arbitrary async function's result | — | ❌ |
| `expectThatDialog()` | Assert on dialog state/value | — (see Dialogs below) | ❌ |
| *(none — fluent has no soft-assert mode)* | Collect multiple failures instead of stopping at the first | `webActions.softly()` — every action queued after it collects failures instead of throwing, final `await` reports all of them together | ✅ **(we have this, fluent doesn't)** |

## Selectors

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `selector(cssOrText)` | Build up a selector inline, chainable (`.selector('div').withText('Foo').find('button')`) | Named locators in YAML (`e2e/locators/generated/**/*.yaml`), resolved via `[kind, value, xpathFallback?]` tuples and looked up by name | ✅ (different paradigm — named/data-driven vs. inline-builder) |

## Dialogs (alert/confirm/prompt)

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `waitForDialog()` / `acceptDialog()` / `cancelDialog()` / `typeTextInDialogAndSubmit()` / `isDialogOpened()` / `isDialogClosed()` / `currentDialog()` | Full dialog lifecycle control | `webActions.acceptNextDialog()` — accepts the next dialog only | ⚠️ (accept-only, no cancel/prompt-text/inspect) |

## Network

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `onRequestTo(url)` / `recordRequestsTo(url)` / `getRecordedRequestsTo(url)` / `getLastRecordedRequestTo(url)` / `clearRecordedRequestsTo(url)` | Manually record/query requests to a URL | `ApiActions` capture is automatic per test (`attachApiCapture`) — every request/response is captured and available for `expectStatus()` to replay, rather than queried on demand | ⚠️ (different model — automatic replay vs. manual inspection) |
| `recordFailedRequests()` / `getFailedRequests()` / `clearFailedRequests()` | Track failed requests | — | ❌ |
| `delayRequestsTo(url)` | Artificially slow a request | — | ❌ |
| `recordNetworkActivity()` / `getRecordedNetworkActivity()` | Full network activity log | `apiActions.capturedApis` (captured request/response pairs, used internally by `expectStatus()`) | ⚠️ |
| `getAllMocksWithDisplayName()` / `getLastMockWithDisplayName()` / `hasMockWithDisplayName()` / `removeMocksWithDisplayName()` | Route mocking | — | ❌ |

## Page errors / tracing / video / screenshots

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `recordPageErrors()` / `getPageErrors()` / `clearPageErrors()` | Capture uncaught page JS errors | — | ❌ |
| `startTracing()` / `stopTracingAndSaveTrace()` | Playwright trace recording | `playwright.config.ts` → `trace: 'retain-on-failure'` (global, config-driven instead of a chain call) | ✅ (config, not chain method) |
| `recordVideo()` / `getRecordedVideoPath()` / `clearVideoFilesOlderThan()` | Video recording | `e2e/config/config.yaml` → `browser.recordVideo` | ✅ (config, not chain method) |
| `takeFullPageScreenshotAsBase64()` | Screenshot as base64 | `webActions.raw.screenshot()` | ⚠️ |

## Waiting

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `wait(ms)` | Fixed delay | `webActions.raw.waitForTimeout(ms)` | ⚠️ |
| `waitUntil(predicateFunc, options?)` | Poll a custom predicate | — | ❌ |
| `waitForStabilityOf(func)` | Wait until a value stops changing | — | ❌ (each of our actions has its own built-in wait/retry instead) |

## Configuration (`.with...` builder methods)

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `withOptions()` / `withViewport()` / `withWindowSize()` / `withGeolocation()` / `withTimezone()` / `withPermissions()` / `withExtraHttpHeaders()` / `ignoreHttpsErrors()` / `emulateDevice()` | Browser/context configuration, chainable per-test | `e2e/config/config.yaml` (`browser.viewportDevice`, etc.) + `src/core/contextOptions.ts` (`resolveDevice`, `launchOptions`, `contextOptions`) + `playwright.config.ts` | ✅ (config-file + project-level, not per-chain) |
| `withStorageState()` / `currentStorageState()` / `saveStorageStateTo()` | Auth/session persistence | Playwright Test's own `storageState` project option | ⚠️ (native Playwright feature, not wrapped by us) |
| `withDefaultWaitOptions()` / `withDefaultAssertOptions()` | Global timeout/retry defaults | `VERIFY_TIMEOUT_MS`, `CLICK_TIMEOUT_MS`, etc. env vars (set via `config.yaml` or real env vars) | ✅ (env-driven, not chain method) |
| `withCursor()` | Visualize mouse position during a run | — | ❌ |
| `withTracing()` / `withDialogs()` | Enable tracing/dialog features | See Dialogs and Tracing rows above | ⚠️ |

## Escape hatches

| playwright-fluent | Purpose | Our equivalent | Status |
|---|---|---|---|
| `invokeMethod(...)` | Call an arbitrary method on the underlying Playwright object | `webActions.raw` (real `Page`) / `webActions.getLocator(name)` (real `Locator`) | ✅ |
| `lastError()` | The error from the last chain that threw | `Chainable.lastError()` — same idea, ported directly | ✅ |

---

## What this library has that playwright-fluent doesn't

playwright-fluent is web-automation-only. This library additionally covers:

| Feature | Where |
|---|---|
| First-class API testing chained with web actions (`sendRequest`/`expectStatus`/`validateResponseFields`) | `ApiActions`, `CombinedActions` |
| Automatic API capture + replay (reuse a request the page itself already made instead of firing a duplicate) | `src/api/capture.ts`, `ApiActions.expectStatus()` |
| Named, YAML-driven locators shared across a whole project (`[kind, value, xpathFallback?]` tuples, plus a `{kind: value}` shorthand) | `LocatorStore`, `locatorResolver.ts` |
| Typed `LocatorName` codegen from locator YAML (`npx playwright-without-bdd-generate-types`) | `src/codegen/generateLocatorTypes.ts` |
| "Did you mean...?" typo suggestions for locator names | `suggestClosestName()` in `LocatorStore` |
| Soft assertions (`.softly()`) — collect every failure in a chain instead of stopping at the first | `Chainable.softly()` |
| Project scaffolding on install, or on demand (`npx playwright-without-bdd-init`) | `scripts/scaffold.js` |
| Runs on Playwright Test's own runner (`test.describe`/`test()`, fixtures, reporters) rather than a standalone driver | `src/fixtures.ts` |

---

*Generated as a reference while building this library's fluent-chaining API — re-check against playwright-fluent's actual source (`src/fluent-api/playwright-fluent.ts`) if it's updated, since this table reflects a point-in-time read of that repo.*
