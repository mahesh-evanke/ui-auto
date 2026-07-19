/**
 * Reusable web automation methods - the non-BDD equivalent of web.ts's step
 * bodies, called directly from spec files instead of matched from Gherkin.
 * Element names resolve through the same [kind, value, xpathFallback] YAML
 * locator format used across every branch of this toolkit.
 */
import { expect, type Locator, type Page, type Frame } from '@playwright/test';
import { LocatorStore } from '../locators/LocatorStore';
import { resolveDynamicTokens, verifyTextOnScreen } from './textHelper';
import { verifyWebTable, type TableRows } from './tableHelper';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeWs(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export class WebActions {
  private readonly locators = new LocatorStore();

  constructor(private readonly page: Page) {}

  /** Loads a page's locator YAML (e2e/locators/generated/<category>/<pageKey>.yaml). */
  usePage(pageKey: string): void {
    this.locators.usePage(pageKey);
  }

  /** Raw locator lookup by name, for anything not covered by the methods below. */
  getLocator(name: string): Locator {
    return this.locators.getLocator(this.page, name);
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  }

  private async resolveVisible(element: string, timeout = 15000): Promise<{ loc: Locator; scope: Page | Frame }> {
    const { loc, scope } = await this.locators.resolveAcrossFrames(this.page, element);
    await expect(loc).toBeVisible({ timeout });
    return { loc, scope };
  }

  /** Normal click first, then scroll + force-click fallback for sticky headers/overlays. */
  async click(name: string): Promise<void> {
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
  }

  /** Robust check/toggle for checkboxes and radio buttons. */
  async check(name: string): Promise<void> {
    const { loc } = await this.resolveVisible(name);
    try {
      await loc.check({ force: true, timeout: 8000 });
      return;
    } catch {
      /* not a native checkable or intercepted */
    }
    await this.click(name);
  }

  async uncheck(name: string): Promise<void> {
    const loc = this.getLocator(name);
    await expect(loc).toBeVisible({ timeout: 15000 });
    await loc.uncheck({ force: true }).catch(async () => undefined);
  }

  /** Fills standard inputs/textareas; falls back to keystroke entry and DOM value assignment. */
  async fill(name: string, text: string): Promise<void> {
    let txt = text;
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
  }

  /**
   * Selects a value from a native <select> or a custom dropdown (PrimeReact,
   * MUI, Ant Design, React-Select, etc.).
   */
  async selectDropdown(name: string, value: string): Promise<void> {
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

    await this.click(name);
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
  }

  /** Substring search anywhere on screen (or inside any iframe) for visible text. */
  async verifyTextPresent(text: string): Promise<void> {
    await verifyTextOnScreen(this.page, text, { strict: false });
  }

  /** Checks a named field's value (inputs/textareas) or text content (everything else). */
  async verifyFieldText(name: string, expected: string): Promise<void> {
    const loc = this.getLocator(name);
    await expect(loc).toBeVisible({ timeout: 15000 });
    const tagName = await loc.evaluate((el: Element) => el.tagName.toLowerCase());
    if (tagName === 'input' || tagName === 'textarea') {
      await expect(loc).toHaveValue(expected);
      return;
    }
    await expect(loc).toContainText(expected);
  }

  /** Verifies expected rows appear in a table: [header, ...dataRows]. */
  async verifyWebTable(name: string, rows: TableRows, options?: { headerDriven?: boolean; unordered?: boolean; strict?: boolean }): Promise<void> {
    await verifyWebTable(this.page, name, rows, { getLocator: (n) => this.getLocator(n) }, { headerDriven: true, ...options });
  }

  /** Accepts the next native browser dialog (alert/confirm) that appears. */
  async acceptNextDialog(): Promise<void> {
    const dlg = await this.page.waitForEvent('dialog', { timeout: 30000 });
    await dlg.accept();
  }

  get raw(): Page {
    return this.page;
  }
}
