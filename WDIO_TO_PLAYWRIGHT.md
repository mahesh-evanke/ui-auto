# WebDriverIO → Playwright migration guide

This toolkit has a WebDriverIO-based branch (`dependencies` — WDIO helpers under
`e2e/support/html-helpers/`) and this Playwright-based library. Both drive the
**same feature files and the same `[kind, value, xpathFallback]` locator YAML** —
only the automation engine underneath changed. This document maps every WDIO
function that was in use to its Playwright equivalent here, and explains *why*
the Playwright version is usually shorter.

> Function names in the "WDIO (`dependencies` branch)" column are real — pulled
> from `element-helper.ts`, `textbox-helper.ts`, `wait-helper.ts`,
> `dropdown-helper.ts`, `checkbox-helper.ts`, and `misc-utils/PageHelper.ts` on
> that branch. The Playwright column points at the real code in this repo.

---

## 1. The one big difference: explicit waits vs. auto-waiting

This is the change that removes the most code.

**WDIO** — nothing waits on its own. Every interaction is preceded by an
explicit `browser.waitUntil(EC.visibilityOf(el), {...})` from `wdio-wait-for`
(the `WaitHelper` class exists entirely for this):

```ts
// dependencies branch — textbox-helper.ts
await WaitHelper.getInstance().waitForElementToBeDisplayed(locator);
await this.clearText(locator);
await locator.setValue(value);
```

**Playwright** — actionability is built into every action. `.fill()` /
`.click()` already wait for the element to be visible, enabled, and stable
before acting, so the whole `WaitHelper` layer disappears:

```ts
// this library — WebActions.fill()
await loc.fill(txt, { timeout: 8000 });
```

The entire `wait-helper.ts` (≈300 lines: `waitForElement`,
`waitForElementToBeDisplayed`, `waitForElementToBeClickable`,
`waitForElementToBeHidden`, `waitForText`, …) has **no equivalent file** in this
library — it's absorbed into Playwright's auto-waiting plus a couple of
`expect(loc).toBeVisible()` guards in `WebActions.resolveVisible()`.

---

## 2. Locators — the part that did *not* change

Both branches read the same YAML tuple format, so **your locator files migrate
unchanged**. WDIO's `PageHelper.locationPath()` and this library's
`buildLocatorFromTuple()` (`src/locators/locatorResolver.ts`) handle the same
`kind`s:

| Tuple kind | WDIO (`locationPath`) builds | Playwright (`buildLocatorFromTuple`) builds |
|---|---|---|
| `xpath` | `$(value)` | `page.locator('xpath=' + value)` |
| `css` | `$(value)` | `page.locator(value)` |
| `id` | `$('#' + value)` | `page.locator('#' + value)` |
| `name` | `$('[name="value"]')` | `page.locator('[name="value"]')` |
| `className` | `$('.' + value)` | `page.locator('.' + value)` |
| `tagName` | `$('<tag />')` | `page.locator(value)` |
| `linkText` | `$('=' + value)` | `page.getByRole('link', { name, exact: true })` |
| `buttonText` | `$('=' + value)` | `page.getByRole('button', { name, exact: true })` |
| anything else | `$('[kind="value"]')` | `page.locator('[kind="value"]')` |

Playwright adds semantic kinds WDIO didn't have — `role:<ariaRole>`, `label`,
`placeholder`, `text`, `testid`, `alttext`, `title` — plus an optional third
tuple element, an XPath fallback that's OR'd in for resilience. So old tuples
keep working, and new ones can be more robust.

---

## 3. Function-by-function mapping

### Element lookup

| WDIO (`dependencies` branch) | Playwright (this library) |
|---|---|
| `await $(selector)` / `await $$(selector)` | `page.locator(selector)` — lazy, no `await` to *find* |
| `PageConfigHelper.findElement(name, common)` | `webActions.getLocator(name)` / internal `LocatorStore.resolveAcrossFrames()` |
| `PageConfigHelper.findElements(name, common)` | `webActions.getLocator(name)` then `.all()` / `.nth(i)` |
| `browser.getActiveElement()` | `page.locator(':focus')` |

A WDIO `$()` returns a resolved `WebdriverIO.Element` (a live handle you must
re-fetch if the DOM changes). A Playwright `locator` is a lazy *query* re-run on
every use — so "element went stale" bugs largely vanish.

### Clicking & mouse

| WDIO | Playwright |
|---|---|
| `browser.touchAction({ action: 'tap', element })` (`ElementHelper.actionClick`) | `webActions.click(name)` → `loc.click()` |
| `element.doubleClick()` (`actionDoubleClick`) | `loc.dblclick()` |
| `source.dragAndDrop(destination)` (`actionDragAndDrop`) | `source.dragTo(destination)` |
| `browser.touchAction({ action: 'moveTo', element })` (`actionHoverOver`) | `loc.hover()` |
| `actionHoverOverAndClick(a, b)` (touchAction chain) | `await a.hover(); await b.click();` |

`WebActions.click()` also layers on a scroll → force-click → `dispatchEvent`
fallback chain that the WDIO `touchAction` tap didn't have.

### Text input

| WDIO (`textbox-helper.ts`) | Playwright (`WebActions.fill()`) |
|---|---|
| `locator.setValue(value)` | `loc.fill(value)` |
| `locator.clearValue()` (`clearText`) | `loc.fill('')` (or the select-all + delete fallback inside `fill()`) |
| `locator.getValue()` (`getValue`) | `loc.inputValue()` |
| `locator.sendKeys(['ENTER'])` | `loc.press('Enter')` |
| `locator.scrollIntoView()` | `loc.scrollIntoViewIfNeeded()` (Playwright also auto-scrolls before acting) |

### Dropdowns

| WDIO (`dropdown-helper.ts`) | Playwright (`WebActions.selectDropdown()`) |
|---|---|
| `element.selectByVisibleText(text)` | `loc.selectOption({ label: text })` |
| `element.selectByAttribute('value', v)` | `loc.selectOption({ value: v })` |
| `selectDropdownByNumber(el, index)` | `loc.selectOption({ index })` |
| custom-dropdown open + click option (manual `browser.pause` + xpath) | same idea, but built into `selectDropdown()` with the option-panel selectors and no fixed `pause()` |

### Checkboxes / radios

| WDIO (`checkbox-helper.ts`) | Playwright (`WebActions.check()` / `.uncheck()`) |
|---|---|
| `element.isSelected()` then conditional `.click()` (`markCheckbox`) | `loc.check()` / `loc.uncheck()` — idempotent, no manual is-selected branch |

### Assertions / reads

| WDIO | Playwright |
|---|---|
| `EC.visibilityOf(loc)` + `waitUntil` | `expect(loc).toBeVisible()` |
| `element.isDisplayed()` | `loc.isVisible()` |
| `element.getText()` | `loc.textContent()` / `loc.innerText()` |
| `browser.getTitle()` | `page.title()` |
| `waitForText(text)` scanning `$('<body>')` | `webActions.verifyTextPresent(text)` (`textHelper.verifyTextOnScreen`) |

### Frames, waits, misc

| WDIO | Playwright |
|---|---|
| `browser.switchToFrame(frame)` + `switchToParentFrame()` | No switching — `page.frameLocator(...)` / `LocatorStore.resolveAcrossFrames()` searches page + every frame automatically |
| `browser.waitUntil(EC.elementToBeClickable(loc), {...})` | *(nothing — auto-waited)* |
| `browser.pause(1000)` | `page.waitForTimeout(1000)` — but rarely needed; prefer auto-wait/`expect` |
| `browser.keys('Escape')` | `page.keyboard.press('Escape')` |
| global `browser` / `$` / `$$` | injected `page` (via the `webActions` fixture) — no globals |

---

## 4. Structural differences

| | WDIO (`dependencies`) | Playwright (this library) |
|---|---|---|
| Element handle | `WebdriverIO.Element` (resolved, can go stale) | `Locator` (lazy query, re-evaluated each use) |
| Globals | `browser`, `$`, `$$` are global | `page` injected per test via a fixture — no globals |
| Waiting | explicit, via `WaitHelper` + `wdio-wait-for` (`EC.*`) | implicit auto-waiting + `expect(locator)` |
| Iframes | manual `switchToFrame` / `switchToParentFrame` | automatic cross-frame resolution |
| Runner | Cucumber.js + `@wdio/*` | Cucumber.js *(BDD branches)* or Playwright Test *(this no-BDD library)* |
| Helper layers | `ElementHelper` / `TextboxHelper` / `WaitHelper` / `DropdownHelper` / `CheckboxHelper` (static classes) | one `WebActions` class (methods, chainable) |

---

## 5. Migration checklist

1. **Keep your locator YAML as-is** — the `[kind, value, xpathFallback?]` format
   is identical (§2). Optionally upgrade brittle `xpath` tuples to `role:`/
   `label`/`placeholder` kinds now available.
2. **Delete the wait layer.** Every `WaitHelper.getInstance().waitFor*()` and
   `browser.waitUntil(EC.*)` call goes away — Playwright waits for you. Keep an
   explicit `expect(loc).toBeVisible()` only where you're *asserting* visibility,
   not gating an action.
3. **Swap the interaction calls** using §3 (e.g. `setValue` → `fill`,
   `selectByVisibleText` → `selectOption({ label })`, `isSelected`+`click` →
   `check`).
4. **Drop frame switching** — remove `switchToFrame`/`switchToParentFrame`; let
   `resolveAcrossFrames()` find elements inside iframes automatically.
5. **Remove `browser.pause()`** calls — replace the few that remain with an
   `expect(...)` on the thing you were actually waiting for.
6. **Replace globals with the fixture** — `browser`/`$` become the injected
   `page` (reachable via `webActions.raw` if you need the raw Playwright `Page`).

Net effect: the five WDIO helper classes collapse into `WebActions`, and the
entire wait/frame-switching apparatus disappears — same feature files, same
locators, far less glue code.
