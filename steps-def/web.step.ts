/**
 * Cucumber step definitions for generated features (Playwright execution).
 * Locators: per-page YAML under locators/pages/<pageKey>.yaml after "User is on" screen.
 */
import {
  After,
  Before,
  Given,
  When,
  setDefaultTimeout,
  setWorldConstructor,
  World,
  type IWorldOptions,
} from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { DataTable } from '@cucumber/cucumber';
import { verifyTextOnScreen } from '../utils/textHelper';
import { verifyWebTable, verifyWebTableDataFrom } from '../utils/tableHelper';

type LocatorTuple = [string, string];

type PageRegistryRow = { title: string; label: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class AutomationWorld extends World {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  /** Active screen key from last "User is on ... screen" step */
  currentPageKey?: string;
  pagesRegistry: Record<string, PageRegistryRow[]> = {};
  /** Locators for current page (locators/pages/<pageKey>.yaml) */
  readonly pageLocatorByName = new Map<string, LocatorTuple>();
  /** Optional shared locators (locators/common.yaml) — same shape as page yaml */
  readonly commonLocatorByName = new Map<string, LocatorTuple>();

  constructor(props: IWorldOptions) {
    super(props);
  }

  loadCommonLocators(): void {
    this.commonLocatorByName.clear();
    const fp = path.join(__dirname, '..', 'locators', 'common.yaml');
    if (!fs.existsSync(fp)) return;
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const doc = yaml.load(raw) as unknown;
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return;
      for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
        if (Array.isArray(v) && v.length >= 2) this.commonLocatorByName.set(k, [String(v[0]), String(v[1])]);
      }
    } catch {
      this.commonLocatorByName.clear();
    }
  }

  /** Resolve table/container: current page YAML → common.yaml → //*[@id=name] */
  getTableRootLocator(objName: string) {
    const p = this.page!;
    const name = objName.trim();
    const fromMap = (m: Map<string, LocatorTuple>): Locator | null => {
      const direct = m.get(name);
      const tuple = direct ?? [...m.entries()].find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
      if (!tuple) return null;
      const [kind, expr] = tuple;
      if (kind.toLowerCase() === 'xpath') return p.locator(`xpath=${expr}`);
      return p.locator(expr);
    };
    return fromMap(this.pageLocatorByName) ?? fromMap(this.commonLocatorByName) ?? p.locator(`xpath=//*[@id=${JSON.stringify(name)}]`);
  }

  loadPagesRegistry(): void {
    this.pagesRegistry = {};
    const p = path.join(__dirname, '..', 'locators', 'pages.yaml');
    if (!fs.existsSync(p)) return;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const doc = yaml.load(raw) as unknown;
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) this.pagesRegistry = doc as Record<string, PageRegistryRow[]>;
    } catch {
      this.pagesRegistry = {};
    }
  }

  loadPageLocators(pageKey: string): void {
    this.pageLocatorByName.clear();
    const fp = path.join(__dirname, '..', 'locators', 'pages', `${pageKey}.yaml`);
    if (!fs.existsSync(fp)) {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, yaml.dump({}, { noRefs: true, lineWidth: 160 }), 'utf8');
    }
    const raw = fs.readFileSync(fp, 'utf8');
    const doc = yaml.load(raw) as unknown;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return;
    for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length >= 2) this.pageLocatorByName.set(k, [String(v[0]), String(v[1])]);
    }
  }

  resolveTarget(name: string): LocatorTuple {
    if (!this.currentPageKey) {
      throw new Error(`No active page set. Add step: Given User is on "<pageKey>" screen`);
    }

    const key = name.trim();
    const direct = this.pageLocatorByName.get(key);
    if (direct) return direct;
    const found = [...this.pageLocatorByName.entries()].find(([k]) => k.toLowerCase() === key.toLowerCase());
    if (found) return found[1];

    const fp = path.join(__dirname, '..', 'locators', 'pages', `${this.currentPageKey}.yaml`);
    throw new Error(`Element "${name}" not found in page "${this.currentPageKey}"\nFile: ${fp}`);
  }

  getLocator(name: string) {
    const [kind, expr] = this.resolveTarget(name);
    const p = this.page!;
    if (kind.toLowerCase() === 'xpath') {
      return p.locator(`xpath=${expr}`);
    }
    return p.locator(expr);
  }
}

setWorldConstructor(AutomationWorld);

Before(async function (this: AutomationWorld) {
  this.loadPagesRegistry();
  this.loadCommonLocators();
  this.currentPageKey = undefined;
  this.browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  this.context = await this.browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  this.page = await this.context.newPage();
});

After(async function (this: AutomationWorld) {
  await this.context?.close().catch(() => undefined);
  await this.browser?.close().catch(() => undefined);
});

Given('User navigates to {string} URL', async function (this: AutomationWorld, url: string) {
  await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
});

Given('User is on {string} screen', async function (this: AutomationWorld, pageKey: string) {
  const key = pageKey.trim();
  const rows = this.pagesRegistry[key];
  if (!rows || !rows[0] || !rows[0].title) {
    throw new Error(`No page metadata for "${key}" in locators/pages.yaml`);
  }
  this.currentPageKey = key;
  this.loadPageLocators(key);
  const { title } = rows[0];
  await expect(this.page!).toHaveTitle(new RegExp(escapeRegExp(title), 'i'));
});

Given('enters {string} text in {string} textbox', async function (this: AutomationWorld, text: string, element: string) {
  const loc = this.getLocator(element);
  await expect(loc).toBeVisible({ timeout: 15000 });
  await loc.fill(text);
});

When('User clicks on {string} button', async function (this: AutomationWorld, element: string) {
  const loc = this.getLocator(element);
  await expect(loc).toBeVisible({ timeout: 15000 });
  await loc.click();
});

When('clicks on {string} link', async function (this: AutomationWorld, element: string) {
  const loc = this.getLocator(element);
  await expect(loc).toBeVisible({ timeout: 15000 });
  await loc.click();
});

When('selects {string} text from {string} Drop-down list', async function (this: AutomationWorld, value: string, element: string) {
  const loc = this.getLocator(element);
  await expect(loc).toBeVisible({ timeout: 15000 });
  await loc.selectOption({ label: value });
});

When('verify {string} text is present on the screen', async function (this: AutomationWorld, text: string) {
  await verifyTextOnScreen(this.page!, text, { strict: false, timeoutMs: 15000 });
});

When('verify {string} web table contains', async function (this: AutomationWorld, objName: string, dataTable: DataTable) {
  await verifyWebTable(this.page!, objName, dataTable, { getLocator: (n) => this.getLocator(n) }, { headerDriven: true });
});

When('verify data from {string} web table', async function (this: AutomationWorld, objName: string, dataTable: DataTable) {
  await verifyWebTableDataFrom(this.page!, objName.trim(), dataTable, {
    getTableRoot: () => this.getTableRootLocator(objName.trim()),
  });
});

When('Verify field {string} text is {string}', async function (this: AutomationWorld, field: string, value: string) {
  const loc = this.getLocator(field);
  await expect(loc).toBeVisible({ timeout: 15000 });
  const tagName = await loc.evaluate((el: Element) => el.tagName.toLowerCase());
  if (tagName === 'input' || tagName === 'textarea') {
    await expect(loc).toHaveValue(value);
    return;
  }
  await expect(loc).toContainText(value);
});

Given('select {string} Checkbox', async function (this: AutomationWorld, element: string) {
  const loc = this.getLocator(element);
  await expect(loc).toBeVisible({ timeout: 15000 });
  await loc.check({ force: true }).catch(async () => {
    await loc.click({ force: true });
  });
});

When('clicks on {string} Radio button', async function (this: AutomationWorld, element: string) {
  const loc = this.getLocator(element);
  await expect(loc).toBeVisible({ timeout: 15000 });
  await loc.check({ force: true }).catch(async () => {
    await loc.click({ force: true });
  });
});

setDefaultTimeout(120 * 1000);
