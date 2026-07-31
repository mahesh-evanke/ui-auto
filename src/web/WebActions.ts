/**
 * Reusable web automation methods - the non-BDD equivalent of web.ts's step
 * bodies, called directly from spec files instead of matched from Gherkin.
 * Element names resolve through the same [kind, value, xpathFallback] YAML
 * locator format used across every branch of this toolkit.
 *
 * Fluent/chainable, inspired by playwright-fluent: every action queues a
 * closure and returns `this` synchronously, so a spec can chain several
 * actions into one statement instead of one `await` per line:
 *
 *   await webActions
 *     .navigate(url)
 *     .usePage('Login')
 *     .fill('Username Field', 'tomsmith')
 *     .fill('Password Field', 'secret')
 *     .click('Login Button')
 *     .verifyTextPresent('You logged into a secure area');
 *
 * Awaiting after every single call still works exactly as before - each
 * `await` just flushes whatever's queued at that point (see Chainable).
 */
import { expect, type Locator, type Page, type Frame } from '@playwright/test';
import { Chainable } from '../core/Chainable';
import { ScenarioCache } from '../cache/ScenarioCache';
import { LocatorStore } from '../locators/LocatorStore';
import { resolveDynamicTokens, verifyTextOnScreen } from './textHelper';
import { verifyWebTable, readWebTableRows, type TableRows } from './tableHelper';
import type { TableRow } from '../models';
import { saveJsonFile } from '../utils/loadJsonFixture';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeWs(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export class WebActions extends Chainable<WebActions> {
  private readonly locators = new LocatorStore();

  constructor(
    private readonly page: Page,
    readonly context: ScenarioCache = new ScenarioCache(),
  ) {
    super();
  }

  /** Loads a page's locator YAML (e2e/locators/generated/<category>/<pageKey>.yaml). */
  usePage(pageKey: string): WebActions {
    return this.enqueue(async () => {
      this.locators.usePage(pageKey);
    });
  }

  /** Raw locator lookup by name - immediate, not queued, for anything not covered below. */
  getLocator(name: string): Locator {
    return this.locators.getLocator(this.page, name);
  }

  /** Escape hatch to the underlying Playwright Page, for anything this class doesn't cover. */
  get raw(): Page {
    return this.page;
  }

  navigate(url: string): WebActions {
    return this.enqueue(async () => {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    });
  }

  private async resolveVisible(element: string, timeout = 15000): Promise<{ loc: Locator; scope: Page | Frame }> {
    const { loc, scope } = await this.locators.resolveAcrossFrames(this.page, element);
    await expect(loc).toBeVisible({ timeout });
    return { loc, scope };
  }

  /** Normal click first, then scroll + force-click fallback for sticky headers/overlays. */
  click(name: string): WebActions {
    return this.enqueue(async () => {
      const { loc } = await this.resolveVisible(name);
      try {
        await loc.click({ timeout: 10000 });
        return;
      } catch {
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        try {
          await loc.click({ timeout: 5000, force: true });
          return;
        } catch {
          await loc.dispatchEvent('click');
        }
      }
    });
  }

  /** Robust check/toggle for checkboxes and radio buttons. */
  check(name: string): WebActions {
    return this.enqueue(async () => {
      const { loc } = await this.resolveVisible(name);
      try {
        await loc.check({ force: true, timeout: 8000 });
        return;
      } catch {
        /* not a native checkable or intercepted */
      }
      try {
        await loc.click({ timeout: 10000 });
      } catch {
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await loc.click({ timeout: 5000, force: true }).catch(async () => loc.dispatchEvent('click'));
      }
    });
  }

  uncheck(name: string): WebActions {
    return this.enqueue(async () => {
      const loc = this.getLocator(name);
      await expect(loc).toBeVisible({ timeout: 15000 });
      await loc.uncheck({ force: true }).catch(async () => undefined);
    });
  }

  /**
   * Fills standard inputs/textareas; falls back to keystroke entry and DOM
   * value assignment. `text` can be a zero-arg function instead of a plain
   * string - it's only called when this queued action actually runs, so it
   * can safely reference a value saved earlier in the same chain (see
   * extractText() / ApiActions.saveResponseField()).
   */
  fill(name: string, text: string | (() => string)): WebActions {
    return this.enqueue(async () => {
      let txt = typeof text === 'function' ? text() : text;
      if (txt.includes('<CURRENT_DATE')) txt = resolveDynamicTokens(txt);
      const { loc } = await this.resolveVisible(name);
      try {
        await loc.fill(txt, { timeout: 8000 });
        return;
      } catch {
        /* fall through to alternative strategies */
      }
      try {
        await loc.click({ timeout: 5000 });
        await loc.press('Control+A').catch(() => {});
        await loc.press('Delete').catch(() => {});
        await loc.pressSequentially(txt, { timeout: 8000 });
        return;
      } catch {
        /* fall through */
      }
      await loc.evaluate((el, val) => {
        const node = el as HTMLInputElement;
        node.value = val as string;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, txt);
    });
  }

  /**
   * Selects a value from a native <select> or a custom dropdown (PrimeReact,
   * MUI, Ant Design, React-Select, etc.).
   */
  selectDropdown(name: string, value: string): WebActions {
    return this.enqueue(async () => {
      const { loc, scope } = await this.resolveVisible(name);
      const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');

      if (tag === 'select') {
        const attempts: Array<Parameters<Locator['selectOption']>[0]> = [value, { label: value }, { value }];
        for (const opt of attempts) {
          try {
            await loc.selectOption(opt as never);
            return;
          } catch {
            /* next */
          }
        }
        const labels = await loc.locator('option').allInnerTexts().catch(() => [] as string[]);
        const match = labels.find((l) => normalizeWs(l).toLowerCase() === value.toLowerCase());
        if (match) {
          await loc.selectOption({ label: match });
          return;
        }
        throw new Error(`Could not select "${value}" from native <select> "${name}". Available: ${JSON.stringify(labels)}`);
      }

      // Custom dropdown: click the trigger, then find the matching option.
      try {
        await loc.click({ timeout: 10000 });
      } catch {
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await loc.click({ timeout: 5000, force: true }).catch(async () => loc.dispatchEvent('click'));
      }
      const panelSelectors =
        '[role="listbox"], [role="menu"], .p-dropdown-panel, .p-multiselect-panel, .ant-select-dropdown, [class*="dropdown-panel"], [class*="select__menu"], [class*="MuiMenu"]';
      await scope.locator(panelSelectors).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

      const exact = escapeRegExp(value);
      const optionLocators: Locator[] = [
        scope.getByRole('option', { name: value, exact: true }),
        scope.getByRole('menuitem', { name: value, exact: true }),
        scope.locator('[role="option"], [role="menuitem"]').filter({ hasText: new RegExp(`^\\s*${exact}\\s*$`) }),
        scope.locator('.p-dropdown-item, .p-multiselect-item, li.p-dropdown-item').filter({ hasText: new RegExp(`^\\s*${exact}\\s*$`) }),
        scope.locator('.ant-select-item-option, .MuiMenuItem-root').filter({ hasText: new RegExp(`^\\s*${exact}\\s*$`) }),
        scope.locator('li, [class*="option"], [class*="item"]').filter({ hasText: new RegExp(`^\\s*${exact}\\s*$`) }),
        scope.getByText(value, { exact: true }),
        scope.getByRole('option', { name: value }),
        scope.locator('[role="option"], li, [class*="option"]').filter({ hasText: value }),
      ];

      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        for (const opt of optionLocators) {
          const first = opt.first();
          if (await first.count().catch(() => 0)) {
            try {
              await first.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
              await first.click({ timeout: 3000 });
              return;
            } catch {
              /* try next selector */
            }
          }
        }
        await this.page.waitForTimeout(250);
      }
      throw new Error(`Could not select "${value}" from dropdown "${name}" (no matching option found).`);
    });
  }

  /** Substring search anywhere on screen (or inside any iframe) for visible text. */
  verifyTextPresent(text: string): WebActions {
    return this.enqueue(async () => {
      await verifyTextOnScreen(this.page, text, { strict: false });
    });
  }

  /** Checks a named field's value (inputs/textareas) or text content (everything else). */
  verifyFieldText(name: string, expected: string): WebActions {
    return this.enqueue(async () => {
      const loc = this.getLocator(name);
      await expect(loc).toBeVisible({ timeout: 15000 });
      const tagName = await loc.evaluate((el: Element) => el.tagName.toLowerCase());
      if (tagName === 'input' || tagName === 'textarea') {
        await expect(loc).toHaveValue(expected);
        return;
      }
      await expect(loc).toContainText(expected);
    });
  }

  /** Reads a named field's current value (inputs/textareas) or text content (everything else) - shared by extractText()/extractFields(). */
  private async readFieldValue(name: string): Promise<string> {
    const { loc } = await this.resolveVisible(name);
    const tagName = await loc.evaluate((el: Element) => el.tagName.toLowerCase());
    return tagName === 'input' || tagName === 'textarea' ? await loc.inputValue() : ((await loc.textContent()) ?? '').trim();
  }

  /** Reads a named field's value/text and saves it under `key`, for reuse in a later step. */
  extractText(name: string, key: string): WebActions {
    return this.enqueue(async () => {
      const value = await this.readFieldValue(name);
      this.context.set(key, value);
    });
  }

  /**
   * Reads several named fields at once and saves them as one object under
   * `key` - the single-object counterpart to readWebTable()'s array-of-rows
   * capture, for forms that aren't tables (e.g. a login/password form):
   *
   *   await webActions.extractFields({ 'Username Field': 'username', 'Password Field': 'password' }, 'loginForm');
   *   // context.get('loginForm') -> { username: '...', password: '...' }
   */
  extractFields(fields: Record<string, string>, key: string): WebActions {
    return this.enqueue(async () => {
      const result: Record<string, string> = {};
      for (const [locatorName, resultKey] of Object.entries(fields)) {
        result[resultKey] = await this.readFieldValue(locatorName);
      }
      this.context.set(key, result);
    });
  }

  /**
   * Reads several named fields and writes them straight to
   * e2e/data/<fileName>.json - one call instead of extractFields() +
   * ScenarioCache.saveToFile(). No cache key needed at all:
   *
   *   await webActions
   *     .fill('Email Field', 'surya@evanke.com')
   *     .fill('Password Field', 'Test@123')
   *     .saveFieldsToFile({ 'Email Field': 'email', 'Password Field': 'password' }, 'customer-billing');
   *   // -> e2e/data/customer-billing.json = { "email": "surya@evanke.com", "password": "Test@123" }
   *
   * Returns the full path written (read it via the drained chain's return
   * value, or just call getFromJsonFile(fileName, ...) afterwards).
   */
  saveFieldsToFile(fields: Record<string, string>, fileName: string): WebActions {
    return this.enqueue(async () => {
      const result: Record<string, string> = {};
      for (const [locatorName, resultKey] of Object.entries(fields)) {
        result[resultKey] = await this.readFieldValue(locatorName);
      }
      saveJsonFile(fileName, result);
    });
  }

  /** Verifies expected rows appear in a table: [header, ...dataRows]. */
  verifyWebTable(name: string, rows: TableRows, options?: { headerDriven?: boolean; unordered?: boolean; strict?: boolean }): WebActions {
    return this.enqueue(async () => {
      await verifyWebTable(this.page, name, rows, { getLocator: (n) => this.getLocator(n) }, { headerDriven: true, ...options });
    });
  }

  /** Reads the table's actual current rows (header-keyed objects) and saves them under `key`, for reuse in a later step - the capture counterpart to verifyWebTable()'s check. */
  readWebTable(name: string, key: string): WebActions {
    return this.enqueue(async () => {
      const rows: TableRow[] = await readWebTableRows(this.page, name, { getLocator: (n) => this.getLocator(n) });
      this.context.set(key, rows);
    });
  }

  /** Accepts the next native browser dialog (alert/confirm) that appears. */
  acceptNextDialog(): WebActions {
    return this.enqueue(async () => {
      const dlg = await this.page.waitForEvent('dialog', { timeout: 30000 });
      await dlg.accept();
    });
  }
}
