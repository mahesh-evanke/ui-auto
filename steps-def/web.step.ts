/**
 * Cucumber step definitions for generated features (Playwright execution).
 * Locators: per-page YAML under locators/pages/<pageKey>.yaml after "User is on" screen.
 */
import {
  Given,
  When,
  setDefaultTimeout,
  type DataTable,
} from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { verifyTextOnScreen } from '../utils/textHelper';
import { verifyWebTable, verifyWebTableDataFrom } from '../utils/tableHelper';
import type { AutomationWorld } from './world';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

Given('User navigates to {string} URL', async function (this: AutomationWorld, url: string) {
  if (!this.page) throw new Error('Browser page not initialized. Ensure OPEN_BROWSER=true or MODE=API_UI.');
  await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
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
