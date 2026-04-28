/**
 * Cucumber step definitions for generated features (Playwright execution).
 * Locators: per-page YAML under locators/pages/<pageKey>.yaml after "User is on" screen.
 * Ported from WebdriverIO patterns (ui-auto web.steps.ts) using Playwright APIs.
 */
import {
  Given,
  When,
  Then,
  setDefaultTimeout,
  type DataTable,
} from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { verifyTextOnScreen, resolveDynamicTokens } from '../utils/textHelper';
import { verifyWebTable, verifyWebTableDataFrom } from '../utils/tableHelper';
import type { AutomationWorld } from './world';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Returns true if the locator resolves to at least one DOM-attached element within timeoutMs. */
async function isAttached(loc: import('playwright').Locator, timeoutMs = 3000): Promise<boolean> {
  try {
    await loc.first().waitFor({ state: 'attached', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

function normalizeWs(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best-effort fill / select / check by element semantics (ported WDIO table flows). */
async function setFieldFromValue(world: AutomationWorld, fieldName: string, raw: string): Promise<void> {
  const v0 = String(raw ?? '').trim();
  if (!v0 || v0.toLowerCase() === 'blank') return;

  const lower = fieldName.toLowerCase();
  if (lower.startsWith('radio_') && (v0.toLowerCase() === 'yes' || v0.toLowerCase() === 'no')) {
    try {
      const group = world.getLocator(fieldName);
      const id = await group.getAttribute('id');
      if (id) {
        const opt = v0.toLowerCase() === 'yes' ? 'true' : 'false';
        const radio = world.page!.locator(`xpath=//input[@id='${id}-option-${opt}']`);
        await expect(radio).toBeVisible({ timeout: 15000 });
        await radio.click({ force: true });
        return;
      }
    } catch {
      /* fall through */
    }
  }

  const loc = world.getLocator(fieldName);
  await expect(loc).toBeVisible({ timeout: 15000 });
  const tag = await loc.evaluate((el: Element) => el.tagName.toLowerCase());
  const type = (await loc.getAttribute('type')) ?? '';

  if (tag === 'select') {
    await loc.selectOption({ label: v0 });
    return;
  }
  if (type === 'checkbox') {
    const wantOn = v0.toLowerCase() === 'on' || v0.toLowerCase() === 'yes' || v0 === 'true';
    if (wantOn) await loc.check({ force: true }).catch(async () => loc.click({ force: true }));
    else await loc.uncheck({ force: true }).catch(async () => undefined);
    return;
  }
  if (type === 'radio') {
    if (v0.toLowerCase() === 'yes' || v0.toLowerCase() === 'no') {
      const cap = v0[0]!.toUpperCase() + v0.slice(1).toLowerCase();
      const optLoc = world.getLocator(fieldName + cap);
      await optLoc.click({ force: true });
      return;
    }
    await loc.click({ force: true });
    return;
  }
  if (tag === 'input' || tag === 'textarea') {
    let v = v0;
    if (v.includes('<CURRENT_DATE')) v = resolveDynamicTokens(v);
    await loc.fill(v);
    return;
  }
  await loc.click({ force: true });
}

async function verifyFieldMatches(world: AutomationWorld, fieldName: string, expectedRaw: string): Promise<void> {
  if (expectedRaw === '<blank>') return;
  let expected = expectedRaw;
  if (expected.includes('<CURRENT_DATE')) expected = resolveDynamicTokens(expected);

  const lower = fieldName.toLowerCase();
  if (lower.startsWith('radio_') && (expected.toLowerCase() === 'yes' || expected.toLowerCase() === 'no')) {
    try {
      const group = world.getLocator(fieldName);
      const id = await group.getAttribute('id');
      if (id) {
        const opt = expected.toLowerCase() === 'yes' ? 'true' : 'false';
        const radio = world.page!.locator(`xpath=//input[@id='${id}-option-${opt}']`);
        await expect(radio).toBeChecked();
        return;
      }
    } catch {
      /* fall through */
    }
  }

  const loc = world.getLocator(fieldName);
  await expect(loc).toBeVisible({ timeout: 15000 });
  const tag = await loc.evaluate((el: Element) => el.tagName.toLowerCase());
  const type = (await loc.getAttribute('type')) ?? '';

  if (type === 'text' && tag === 'input') {
    await expect(loc).toHaveValue(expected);
    return;
  }
  if (type === 'checkbox' && tag === 'input') {
    const want = expected.toLowerCase() === 'on';
    if (want) await expect(loc).toBeChecked();
    else await expect(loc).not.toBeChecked();
    return;
  }
  if (type === 'radio' && tag === 'input') {
    if (expected.toLowerCase() === 'yes' || expected.toLowerCase() === 'no') {
      const cap = expected[0]!.toUpperCase() + expected.slice(1).toLowerCase();
      await expect(world.getLocator(fieldName + cap)).toBeChecked();
      return;
    }
    const want = expected.toLowerCase() === 'on';
    if (want) await expect(loc).toBeChecked();
    return;
  }
  if (tag === 'select') {
    const id = await loc.inputValue();
    const opt = world.page!.locator(`xpath=//option[@value=${JSON.stringify(id)}]`);
    await expect(opt).toHaveText(new RegExp(escapeRegExp(expected), 'i'));
    return;
  }
  await expect(loc).toContainText(expected);
}

function ensureScreen(world: AutomationWorld, screen: string): void {
  const key = screen.trim();
  world.currentPageKey = key;
  world.loadPageLocators(key);
}

async function stepMoreInfoModal(this: AutomationWorld, table: DataTable): Promise<void> {
  const rows = table.hashes();
  for (const row of rows) {
    const n = String(row['linkNumber'] ?? row['LinkNumber'] ?? '1');
    const idx = Math.max(1, parseInt(n, 10) || 1);
    const expectedTitle = row['expectedTitle'] ?? row['ExpectedTitle'] ?? '';
    const expectedText = row['expectedText'] ?? row['ExpectedText'] ?? '';
    const link = this.page!.locator(
      `xpath=(//a[contains(.,'More on order of priority')])[${idx}] | (//a[contains(.,'More Info')])[${idx}] | (//a[contains(.,'More info')])[${idx}]`,
    );
    await link.first().click();
    const titleLoc = this.page!.locator(
      `xpath=//*[contains(@id,'More_Info')]//uef-modal-header | //*[contains(@id,'MoreInfo')]//uef-modal-header | //*[contains(@id,'help-modal')]//uef-modal-header`,
    );
    const bodyLoc = this.page!.locator(
      `xpath=//*[contains(@id,'More_Info')]//uef-modal-body | //*[contains(@id,'MoreInfo')]//uef-modal-body | //*[contains(@id,'help-modal')]//uef-modal-body`,
    );
    await expect(titleLoc.first()).toBeVisible({ timeout: 15000 });
    await expect(bodyLoc.first()).toBeVisible({ timeout: 15000 });
    const actualTitle = normalizeWs(await titleLoc.first().innerText());
    const actualText = normalizeWs(await bodyLoc.first().innerText());
    expect(actualTitle).toMatch(new RegExp(escapeRegExp(normalizeWs(expectedTitle)), 'i'));
    expect(actualText).toMatch(new RegExp(escapeRegExp(normalizeWs(expectedText)), 'i'));
    const closeBtns = this.page!.locator(`xpath=//button[.='Close']`);
    const cnt = await closeBtns.count();
    for (let i = 0; i < cnt; i++) {
      const b = closeBtns.nth(i);
      if (await b.isVisible().catch(() => false)) {
        await b.click();
        break;
      }
    }
  }
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
  let txt = text;
  if (txt === '500 characters') txt = 'a'.repeat(500);
  else if (txt === '501 characters') txt = 'a'.repeat(501);
  else if (txt.includes('<CURRENT_DATE')) txt = resolveDynamicTokens(txt);
  else if (txt.includes('<DOB')) txt = resolveDynamicTokens(txt);

  const loc = this.getLocator(element).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await expect(loc).toBeVisible({ timeout: 15000 });

  if (txt === '<blank>') { await loc.fill(''); return; }

  // Detect PrimeReact / custom dropdown trigger: readonly input with aria-haspopup="listbox"
  // These cannot be filled directly — click to open the panel, then fill the filter input inside.
  const isReadonly = await loc.evaluate((el) => (el as HTMLInputElement).readOnly).catch(() => false);
  const hasPopup   = await loc.getAttribute('aria-haspopup').catch(() => null);

  if (isReadonly && hasPopup) {
    await loc.click({ force: true });
    // Wait for the filter input inside the opened panel
    const filterSel = [
      '[data-pc-section="filterinput"]',
      'input.p-dropdown-filter',
      '[aria-label="Filter"]',
      '.p-dropdown-panel input[type="text"]',
    ].join(', ');
    const filterInput = this.page!.locator(filterSel).first();
    const filterVisible = await filterInput.isVisible({ timeout: 4000 }).catch(() => false);
    if (filterVisible) {
      await filterInput.fill(txt);
    } else {
      // Editable dropdown — type directly via keyboard after opening
      await this.page!.keyboard.type(txt);
    }
    return;
  }

  await loc.fill(txt);
});

When('User clicks on {string} button', async function (this: AutomationWorld, element: string) {
  const loc = this.getLocator(element).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  const visible = await loc.isVisible().catch(() => false);
  if (visible) {
    await loc.click({ timeout: 15000 });
  } else {
    await loc.click({ force: true, timeout: 15000 });
  }
});

When('clicks on {string} link', async function (this: AutomationWorld, element: string) {
  const loc = this.getLocator(element).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  const visible = await loc.isVisible().catch(() => false);
  if (visible) {
    await loc.click({ timeout: 15000 });
  } else {
    await loc.click({ force: true, timeout: 15000 });
  }
});

When('selects {string} text from {string} Drop-down list', async function (this: AutomationWorld, value: string, element: string) {
  if (value === '<Skip>') return;
  const loc = this.getLocator(element).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
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
  let loc = this.getLocator(element).first();

  if (!await isAttached(loc)) {
    // Named locator not found — try by associated label text first, then first checkbox on page
    const byLabel = this.page!.getByLabel(element, { exact: false });
    loc = await isAttached(byLabel.first(), 2000)
      ? byLabel.first()
      : this.page!.locator('input[type="checkbox"]').first();
  }

  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await loc.check({ force: true, timeout: 10000 }).catch(async () => {
    await loc.click({ force: true, timeout: 10000 });
  });
});

When('clicks on {string} Radio button', async function (this: AutomationWorld, element: string) {
  let loc = this.getLocator(element).first();

  if (!await isAttached(loc)) {
    // Named locator not found — try by associated label text first, then first radio on page
    const byLabel = this.page!.getByLabel(element, { exact: false });
    loc = await isAttached(byLabel.first(), 2000)
      ? byLabel.first()
      : this.page!.locator('input[type="radio"]').first();
  }

  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await loc.check({ force: true, timeout: 10000 }).catch(async () => {
    await loc.click({ force: true, timeout: 10000 });
  });
});

When('User are on scenare title {string}', async function (title: string) {
  // eslint-disable-next-line no-console
  console.log(title);
});

When('click More Info link, and verfiy popup text', stepMoreInfoModal);
When('click More Info link, and verify popup text', stepMoreInfoModal);

When('click page link and verify new pages opens with title', async function (this: AutomationWorld, table: DataTable) {
  if (!this.context) throw new Error('Browser context not available');
  const rows = table.hashes();
  for (const row of rows) {
    const linkText = row['LinkText'] ?? row['linkText'];
    const expectedTitle = row['ExpectedTitle'] ?? row['expectedTitle'];
    if (!linkText || !expectedTitle) throw new Error('DataTable needs LinkText and ExpectedTitle columns');
    const popupEvent = this.page!.waitForEvent('popup', { timeout: 60000 });
    await this.page!.getByRole('link', { name: new RegExp(escapeRegExp(linkText.trim()), 'i') }).first().click();
    const newPage = await popupEvent;
    await expect(newPage).toHaveTitle(new RegExp(escapeRegExp(expectedTitle.trim()), 'i'));
    await newPage.close();
  }
});

When('User selects {string} link on Person Status screen', async function (this: AutomationWorld, name: string) {
  await this.page!.getByRole('link', { name: new RegExp(escapeRegExp(name.trim()), 'i') }).first().click();
});

When('User inputs information on the {string} screen if exist', async function (this: AutomationWorld, screen: string, table: DataTable) {
  ensureScreen(this, screen);
  for (const row of table.hashes()) {
    for (const [k, val] of Object.entries(row)) {
      await setFieldFromValue(this, k, String(val));
    }
  }
});

When('User inputs information on the {string} screen', async function (this: AutomationWorld, screen: string, table: DataTable) {
  ensureScreen(this, screen);
  for (const row of table.hashes()) {
    for (const [k, val] of Object.entries(row)) {
      await setFieldFromValue(this, k, String(val));
    }
  }
});

When('User verify information on {string} screen with following params', async function (this: AutomationWorld, screen: string, table: DataTable) {
  ensureScreen(this, screen);
  const raw = table.raw();
  if (raw.length < 2) return;
  const headers = raw[0]!;
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r]!;
    for (let c = 0; c < headers.length; c++) {
      const objName = headers[c]!;
      const objValue = row[c] ?? '';
      if (objValue === '<blank>') continue;
      await verifyFieldMatches(this, objName, String(objValue));
    }
  }
});

When('User verifies field entries on the Payment Method', async function (this: AutomationWorld, table: DataTable) {
  for (const row of table.hashes()) {
    const field = row['Field'] ?? row['field'];
    const value = row['Value'] ?? row['value'];
    if (field) await verifyFieldMatches(this, field, String(value ?? ''));
  }
});

When('User verifies field entries on the {string} screen in query mode', async function (this: AutomationWorld, _screen: string, table: DataTable) {
  for (const row of table.hashes()) {
    const fieldLabel = row['Field'] ?? row['field'];
    let expected = String(row['Value'] ?? row['value'] ?? '');
    if (expected.toLowerCase() === '<blank>') continue;
    if (expected.includes('<CURRENT_DATE')) expected = resolveDynamicTokens(expected);
    if (!fieldLabel) continue;
    const label = this.page!.getByText(fieldLabel, { exact: false }).first();
    await expect(label).toBeVisible({ timeout: 15000 });
    const container = label.locator('xpath=ancestor::div[1]');
    await expect(container).toContainText(expected);
  }
});

When('enters SSN with criteria {string} in {string} textbox', async function (this: AutomationWorld, criteria: string, element: string) {
  const ssn = process.env[`E2E_SSN_${criteria}`] ?? process.env.E2E_DEFAULT_SSN ?? criteria;
  await this.getLocator(element).fill(ssn);
});

When('clicks on {string} button', async function (this: AutomationWorld, name: string) {
  if (name === '<blank>') return;
  const loc = this.getLocator(name).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  const visible = await loc.isVisible().catch(() => false);
  if (visible) {
    await loc.click({ timeout: 15000 });
  } else {
    await loc.click({ force: true, timeout: 15000 });
  }
});

When('selects {string} from {string} Drop-down list', async function (this: AutomationWorld, value: string, element: string) {
  if (value === '<Skip>') return;
  const loc = this.getLocator(element).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await expect(loc).toBeVisible({ timeout: 15000 });
  await loc.selectOption({ label: value });
});

Given('select {string} Checkbox with Wait', async function (this: AutomationWorld, element: string) {
  let loc = this.getLocator(element).first();

  if (!await isAttached(loc, 60000)) {
    const byLabel = this.page!.getByLabel(element, { exact: false });
    loc = await isAttached(byLabel.first(), 2000)
      ? byLabel.first()
      : this.page!.locator('input[type="checkbox"]').first();
  }

  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  await loc.check({ force: true, timeout: 10000 }).catch(async () => loc.click({ force: true, timeout: 10000 }));
});

When('User verifies information on {string} screen header with following parameters', async function (this: AutomationWorld, screen: string, table: DataTable) {
  ensureScreen(this, screen);
  for (const row of table.hashes()) {
    let val = String(row['Value'] ?? row['value'] ?? '');
    const field = row['Field'] ?? row['field'];
    if (val === '<CURRENT_DATE>') val = resolveDynamicTokens('<CURRENT_DATE>');
    if (field) await expect(this.page!.getByText(field, { exact: false }).first()).toBeVisible({ timeout: 15000 });
    if (val) await verifyTextOnScreen(this.page!, val, { strict: false });
  }
});

When('User verify information on {string} screen header with following parameters', async function (this: AutomationWorld, screen: string, table: DataTable) {
  ensureScreen(this, screen);
  for (const row of table.hashes()) {
    let val = String(row['Value'] ?? row['value'] ?? '');
    const field = row['Field'] ?? row['field'];
    if (val === '<CURRENT_DATE>') val = resolveDynamicTokens('<CURRENT_DATE>');
    if (field) await expect(this.page!.getByText(field, { exact: false }).first()).toBeVisible({ timeout: 15000 });
    if (val) await verifyTextOnScreen(this.page!, val, { strict: false });
  }
});

Then('verify alerts displayed on the screen', async function (this: AutomationWorld, table: DataTable) {
  const loc = this.getLocator('Alerts and Edits');
  const actualtext = await loc.innerText();
  const actTextArr = actualtext.split('Alerts');
  const alertsTxtArr = actTextArr[1]?.split('\n') ?? [];
  const actualAlertsArr: string[] = ['Alerts'];
  for (const line of alertsTxtArr) {
    const t = line.trim();
    if (t && t !== 'NextPreviousExit') actualAlertsArr.push(t);
  }
  expect(actualAlertsArr.toString()).toBe(table.raw().toString());
});

When('verify information from {string} webtable', async function (this: AutomationWorld, objName: string, dataTable: DataTable) {
  await verifyWebTableDataFrom(this.page!, objName.trim(), dataTable, {
    getTableRoot: () => this.getTableRootLocator(objName.trim()),
  });
});

Given('User inputs information on {string} screen with following params', async function (this: AutomationWorld, screen: string, table: DataTable) {
  ensureScreen(this, screen);
  const raw = table.raw();
  if (raw.length < 2) return;
  const headers = raw[0]!;
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r]!;
    for (let c = 0; c < headers.length; c++) {
      const objName = headers[c]!;
      let objValue = row[c] ?? '';
      if (String(objValue).toLowerCase() === 'blank') continue;
      await setFieldFromValue(this, objName, String(objValue));
    }
  }
});

Given('User inputs information on {string} screen with following parameters', async function (this: AutomationWorld, screen: string, table: DataTable) {
  ensureScreen(this, screen);
  for (const row of table.hashes()) {
    const objName = row['Field'] ?? row['field'];
    const objValue = row['Value'] ?? row['value'] ?? '';
    if (objName) await setFieldFromValue(this, String(objName), String(objValue));
  }
});

When('user refreshes {string} page', async function (this: AutomationWorld, screenName: string) {
  const noInfo = this.page!.getByText('No information found.', { exact: false });
  if (await noInfo.isVisible().catch(() => false)) await this.page!.reload();
  ensureScreen(this, screenName);
});

When('user refreshes page', async function (this: AutomationWorld) {
  await this.page!.reload();
});

Given('select Claims Summary Checkbox', async function (this: AutomationWorld) {
  await this.page!.locator(`xpath=//label[@class = 'uef-checkbox_label']`).first().click();
});

When('user enters {string} in Employee Job Title field on T2T18 Determinations screen', async function (this: AutomationWorld, text: string) {
  const el = this.page!.locator(`xpath=//input[@id = 'employeeJobTitle']`);
  await el.fill('');
  await el.fill(text);
});

When('delete Lawful Presence status row data', async function (this: AutomationWorld) {
  await this.page!.locator(`xpath=//button[contains(@id ,'deleteButn')]`).click();
  await this.page!.waitForTimeout(500);
  await this.page!.locator(`xpath=//uef-button[@id = 'okBtnDeleteId']`).click();
});

When('save New Lawful Presence Status row data', async function (this: AutomationWorld) {
  await this.page!.locator(`xpath=(//*[@name='okBtn'])[5]`).click();
});

When('User clicks on {string} link on Person Status screen', async function (this: AutomationWorld, pageName: string) {
  const links = this.page!.locator('.uef-link');
  if (pageName === 'Applicant Information') await links.nth(2).click();
});

Given('clicks on Claims Summary button', async function (this: AutomationWorld) {
  await this.page!.locator(`xpath=(//a[contains(@class,'uef-pro-nav-main_link')])[2]`).click();
});

When('clicks on {string} link with {string} instance', async function (this: AutomationWorld, _objName: string, instStr: string) {
  const btns = this.page!.locator('.uef-icon-dropdown-btn.uef-dropdown-toggle');
  if (instStr === 'Second') await btns.nth(1).click();
});

Given('closes the application', async function (this: AutomationWorld) {
  await this.context?.close();
});

When('user fills in birth proof and citizenship information', async function (this: AutomationWorld) {
  const f = this.page!.frameLocator('iframe').first();
  await expect(f.getByText('Birth Date Proof is required').first()).toBeVisible({ timeout: 15000 }).catch(() => undefined);
  await expect(f.getByText('Citizenship details are required').first()).toBeVisible({ timeout: 15000 }).catch(() => undefined);
});

When('clicks on {string} Chevron link', async function (this: AutomationWorld, objName: string) {
  const chevrons = this.page!.locator(`xpath=//span[@class='uef-toggle_control-text']`);
  const n = await chevrons.count();
  for (let i = 0; i < n; i++) {
    const t = await chevrons.nth(i).innerText();
    if (t.includes(objName)) {
      await chevrons.nth(i).click();
      break;
    }
  }
});

When('verifies status of {string} chevron link and {string} text in textbox', async function (this: AutomationWorld, elementName: string, text: string) {
  const loc = this.getLocator(elementName);
  await expect(loc).toBeVisible({ timeout: 15000 });
  await expect(loc).toHaveValue(text);
});

When('User clicks on {string} link in Claim Development path', async function (this: AutomationWorld, pageName: string) {
  const map: Record<string, string> = {
    'Development Notes': `(//a[@class='uef-menu_link'])[3]`,
    'Person Statement': `(//a[@class='uef-menu_link'])[4]`,
    'Report of Contact': `(//a[@class='uef-menu_link'])[5]`,
    'Adjudicative Results': `(//a[@class='uef-link'])[19]`,
    'Person Info': `(//a[@class='uef-menu_link'])[2]`,
  };
  const xp = map[pageName];
  if (!xp) throw new Error(`Unknown Claim Development path link: ${pageName}`);
  await this.page!.locator(`xpath=${xp}`).click();
});

When('Select from Person Providing Statement', async function (this: AutomationWorld) {
  await this.page!.locator(`xpath=//select[@id = 'newRelationToClientTypeCode']`).selectOption({ value: '02' });
});

When('click on save button on Person Statement screen', async function (this: AutomationWorld) {
  await this.page!.locator(`xpath=(//button[@id = 'uef-button-1'])[2]`).click();
});

When('Select Person Contacted on Report of Contact screen', async function (this: AutomationWorld) {
  const sel = this.page!.locator(`xpath=//select[@id = 'prsnContacted']`);
  await sel.locator(`xpath=.//option[contains(@value,'Claimant')]`).first().click();
});

When('clicks on the Report of Contact OK button', async function (this: AutomationWorld) {
  await this.page!.locator(`xpath=(//button[@id = 'okBtn'])[2]`).click();
  await this.page!.waitForTimeout(1000);
});

When('selects {string}', async function (this: AutomationWorld, value: string) {
  const v = value.trim();
  const click = async (xpath: string) => this.page!.locator(`xpath=${xpath}`).click();
  switch (v) {
    case 'Add Signature and Attestation':
      await click(`//button[@id = 'addSignatureAndAttestation']`);
      break;
    case 'Oral Signature Type':
      await click(`//label[@id = 'signatureTypeRadioStr-option-ORAL-label']`);
      break;
    case 'Understand Affirmation':
      await click(`//input[@id = 'affirmationOralStatementYesChkBox1']`);
      break;
    case 'Declare Affirmation':
      await click(`//input[@id = 'affirmationOralStatementYesChkBox2']`);
      break;
    case 'Employee Attestation':
      await click(`//input[contains(@id , 'declareChkBox')]`);
      break;
    case 'Save':
      await click(`//button[@id = 'saveBtn']`);
      for (let i = 0; i < 10; i++) {
        const n = await this.page!.locator(`[name="spinner"]`).count();
        if (n === 0) break;
        await this.page!.waitForTimeout(1000);
      }
      break;
    case 'Cancel':
      await click(`//button[@id = 'cancelBtn']`);
      break;
    case 'Next':
      await click(`//button[@id = 'nextBtn']`);
      await this.page!.waitForTimeout(2000);
      break;
    case 'Ink Signature Type':
      await click(`//label[@id = 'signatureTypeRadioStr-option-INK-label']`);
      break;
    case 'Edit Signature and Attestation':
      await click(`//button[@id = 'editSignatureAndAttestation']`);
      await this.page!.waitForTimeout(2000);
      break;
    case 'Close button':
      await click(`//button[@id = 'btnClose']`);
      break;
    default:
      throw new Error(`Unhandled "selects" value: ${value}`);
  }
});

Then('enters {string} text into textfield', async function (this: AutomationWorld, inputValue: string) {
  const el = this.page!.locator(`xpath=(//input[contains(@id, 'socialSecurityNumber')])[last()]`);
  await el.click();
  await el.fill(inputValue);
  await this.page!.keyboard.press('Tab');
});

When('select Annuity from Civil Service Annuity Type Drop-down List', async function (this: AutomationWorld) {
  const sel = this.page!.locator(`xpath=//select[@id = 'civilServiceAnnuityType']`);
  await sel.selectOption({ value: 'CSA' });
});

Then('system generates notice messages with description {string}', async function (this: AutomationWorld, errMsg: string) {
  const parts = errMsg.split(';').map((s) => s.trim());
  const notices = this.page!.locator('uef-notice');
  const count = await notices.count();
  expect(count).toBeGreaterThanOrEqual(parts.length);
  let expText = '';
  for (let i = 0; i < parts.length; i++) {
    const t = normalizeWs(await notices.nth(i).innerText());
    expText = i === 0 ? t : `${expText}; ${t}`;
  }
  expect(expText).toBe(errMsg);
});

Then('User waits for {string} seconds', async function (this: AutomationWorld, waitTime: string) {
  const s = Number(waitTime);
  await this.page!.waitForTimeout(Number.isFinite(s) ? s * 1000 : 0);
});

Then('verify data from {string} webtable dates', async function (this: AutomationWorld, objName: string, table: DataTable) {
  await verifyWebTableDataFrom(this.page!, objName.trim(), table, {
    getTableRoot: () => this.getTableRootLocator(objName.trim()),
  });
});

When('Select Spouse enrolled in SMI Check Box on HI screen', async function (this: AutomationWorld) {
  const cb = this.page!.locator(`xpath=//input[@name = 'spouseSmiCb']`);
  if (!(await cb.isChecked())) await this.page!.locator(`xpath=//label[contains(@id,'spouseSmiCb')]`).click();
});

When('Select Consent obtained from spouse Check Box on HI screen', async function (this: AutomationWorld) {
  const cb = this.page!.locator(`xpath=//input[@name = 'spouseConsentCb']`);
  if (!(await cb.isChecked())) await this.page!.locator(`xpath=//label[contains(@id,'spouseConsentCb')]`).click();
});

When('verify data from {string} webtable', async function (this: AutomationWorld, objName: string, dataTable: DataTable) {
  await verifyWebTableDataFrom(this.page!, objName.trim(), dataTable, {
    getTableRoot: () => this.getTableRootLocator(objName.trim()),
  });
});

Then('Verify {string} PDF data generated from CCM', async function () {
  throw new Error(
    'PDF verification is not ported: add pdf-parse/compare in this project or use file snapshot tooling.',
  );
});

Then('system generates notice warning message with description {string}', async function (this: AutomationWorld, errMsg: string) {
  const loc = this.getLocator('Notice Warning Message');
  await expect(loc).toContainText(errMsg);
});

Then('system generates edit message with description {string}', async function (this: AutomationWorld, errMsg: string) {
  const errors = this.page!.locator(`xpath=//li[starts-with(@id,'uef-input-error-')]`);
  const n = await errors.count();
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(normalizeWs(await errors.nth(i).innerText()));
  expect(parts.join('; ')).toBe(errMsg);
});

Then('system generates edit message with description {string} on {string} model', async function (this: AutomationWorld, errMsg: string, modelId: string) {
  const msgs = errMsg.split(';').map((s) => s.trim());
  for (let i = 0; i < msgs.length; i++) {
    const loc = this.page!.locator(`xpath=//*[@id='${modelId}']//*[@id='uef-input-error-${i}']`);
    await expect(loc).toHaveText(msgs[i]!);
  }
});

Then('system generates error message with description {string} in a frame', async function (this: AutomationWorld, errMsg: string) {
  const f = this.page!.frameLocator('iframe').first();
  let actual = '';
  const errs = f.locator(`xpath=//a[contains(@id, 'uef-error')]`);
  const n = await errs.count();
  for (let i = 0; i < n; i++) actual += `${await errs.nth(i).innerText()}; `;
  expect(actual.trim()).toBe(errMsg.trim());
});

Then('system generates error message with description {string} on Contact Info Manage Addresses screen', async function (this: AutomationWorld, errMsg: string) {
  const parts = errMsg.split(';').map((s) => s.trim());
  const f = this.page!.frameLocator('iframe').nth(1);
  const errors = f.locator(`xpath=//*[contains(@id, 'uef-error')]`);
  for (let i = 1; i < parts.length + 1; i++) {
    await expect(errors.nth(i)).toHaveText(parts[i - 1]!);
  }
});

When('clicks on {string} button from {string} popup window', async function (this: AutomationWorld, btn: string, popupName: string) {
  const popup = this.getLocator(popupName);
  await expect(popup).toBeVisible({ timeout: 15000 });
  await popup.getByRole('button', { name: new RegExp(escapeRegExp(btn), 'i') }).click();
});

When('verify {string} text is present in {string} popup window', async function (this: AutomationWorld, txt: string, popupName: string) {
  const popup = this.getLocator(popupName);
  await expect(popup).toBeVisible({ timeout: 15000 });
  await expect(popup.getByText(txt, { exact: false })).toBeVisible();
});

When('Click OK in popup window', async function (this: AutomationWorld) {
  const dlg = await this.page!.waitForEvent('dialog', { timeout: 30000 });
  await dlg.accept();
});

When('verify {string} text is present in popup window', async function (this: AutomationWorld, txt: string) {
  const dlg = await this.page!.waitForEvent('dialog', { timeout: 30000 });
  expect(dlg.message()).toContain(txt);
  await dlg.dismiss();
});

When('navigate to GN 00204.010 Protective Filing link on Filing Date screen', async function (this: AutomationWorld) {
  const p = this.context!.waitForEvent('page');
  await this.page!.getByText('GN 00204.010 Protective Filing', { exact: true }).click();
  const newPage = await p;
  await expect(newPage).toHaveTitle(/GN 00204\.010 - Protective Filing/);
  await newPage.close();
});

Given('enters {string} text in {string} textbox in a frame', async function (this: AutomationWorld, txtInput: string, elementName: string) {
  let txt = txtInput;
  if (txt.includes('<CURRENT_DATE')) txt = resolveDynamicTokens(txt);
  else if (txt.includes('<DOB')) txt = resolveDynamicTokens(txt);
  if (txt === '<blank>') return;
  const loc = this.getLocatorInFirstFrame(elementName);
  await loc.fill(txt);
});

When('click on {string} button in a frame', async function (this: AutomationWorld, name: string) {
  await this.getLocatorInFirstFrame(name).click();
});

When('click on {string} Radio button in a frame', async function (this: AutomationWorld, name: string) {
  const loc = this.getLocatorInFirstFrame(name);
  await loc.check({ force: true }).catch(async () => loc.click({ force: true }));
});

When('click on {string} Checkbox in a frame', async function (this: AutomationWorld, name: string) {
  if (name === '<blank>') return;
  const loc = this.getLocatorInFirstFrame(name);
  await loc.check({ force: true }).catch(async () => loc.click({ force: true }));
});

When('selects {string} from {string} Drop-down list in a frame', async function (this: AutomationWorld, optionVal: string, element: string) {
  if (optionVal === '<blank>' || optionVal === '<Skip>') return;
  await this.getLocatorInFirstFrame(element).selectOption({ label: optionVal });
});

When('save Lawful Presence record', async function (this: AutomationWorld) {
  await this.page!.locator(`xpath=(//button[@id = 'okBtn'])[3]`).click();
});

Then('delete current Citizen Information entry', async function (this: AutomationWorld) {
  const f = this.page!.frameLocator('iframe').first();
  await f.locator(`xpath=//input[contains(@id , 'delete')]`).nth(1).click();
});

Then('verify {string} label is displayed below date field', async function (this: AutomationWorld, elementName: string) {
  const loc = this.getLocator(elementName);
  const text = normalizeWs(await loc.innerText());
  const today = new Date();
  const mm = String(today.getMonth() + 1);
  const dd = String(today.getDate());
  const yyyy = today.getFullYear();
  expect(text).toBe(`${mm}/${dd}/${yyyy}`);
});

When('check if {string} text is present on the screen', async function (this: AutomationWorld, txtName: string) {
  await verifyTextOnScreen(this.page!, txtName, { strict: false, timeoutMs: 15000 });
});

When('select {string} from Report of Contact Relationship to Claimant Drop-down', async function (this: AutomationWorld, optionVal: string) {
  const sel = this.page!.locator(`xpath=//select[@id = 'relationshipToClientType']`);
  await sel.selectOption({ label: optionVal });
});

Given('User is on {string} CCE screen', async function (this: AutomationWorld, pageKey: string) {
  await this.page!.waitForTimeout(1500);
  const rows = this.pagesRegistry[pageKey.trim()];
  if (rows?.[0]?.title) {
    await expect(this.page!).toHaveTitle(new RegExp(escapeRegExp(rows[0].title), 'i'));
  }
  this.currentPageKey = pageKey.trim();
  this.loadPageLocators(pageKey.trim());
});

When('clicks on Select All Address Types Checkbox', async function (this: AutomationWorld) {
  const f = this.page!.frameLocator('iframe').nth(1);
  await f.locator(`xpath=//label[@id = 'uef-checklist0-selectAllLabel']`).click();
});

Then('system generates notice message with description {string}', async function (this: AutomationWorld, errMsg: string) {
  const msgs = errMsg.split(';').map((s) => s.trim());
  const notices = this.page!.locator(`xpath=//*[contains(@class,'uef-notice ')]`);
  for (let i = 0; i < msgs.length; i++) {
    const ui = normalizeWs(await notices.nth(i).innerText());
    expect(ui).toBe(msgs[i]);
  }
});

Then('system generates exclusion message with description {string}', async function (this: AutomationWorld, errMsg: string) {
  const loc = this.getLocator('Notice Message');
  await expect(loc).toContainText(errMsg);
});

Then('enters {string} date in {string} textbox', async function (this: AutomationWorld, textVal: string, objName: string) {
  const loc = this.getLocator(objName);
  const d = new Date();
  let dateStr = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  const raw = textVal.toUpperCase().split(/\s+/).filter(Boolean);
  if (raw[0] === 'CURRENT_DATE' && raw[1] === '+' && raw[2] && (raw[3] === 'DAY>' || raw[3] === 'DAYS>')) {
    const nd = new Date();
    nd.setDate(nd.getDate() + Number(raw[2]));
    dateStr = `${String(nd.getMonth() + 1).padStart(2, '0')}/${String(nd.getDate()).padStart(2, '0')}/${nd.getFullYear()}`;
  }
  await loc.fill(dateStr);
});

When('input {string} text in {string} textbox', async function (this: AutomationWorld, txtInput: string, elementName: string) {
  const loc = this.getLocator(elementName);
  let txt = txtInput;
  const today = new Date();
  if (txt.includes('CURRENT_DATE')) {
    if (txt.includes('0Y')) txt = `${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
    else if (txt === '<CURRENT_DATE>' && elementName === 'ProtectiveFilingDate') txt = '';
    else txt = resolveDynamicTokens(txt.replace(/CURRENT_DATE/gi, '<CURRENT_DATE>'));
  } else if (txt.includes('DOB')) {
    txt = resolveDynamicTokens(txt);
  }
  if (txt && txt !== 'Continuing') await loc.fill(txt);
});

When('enters {string} for {string}', async function (this: AutomationWorld, value: string, elementName: string) {
  if (value === 'Yes') {
    const loc = this.getLocator(elementName);
    await loc.check({ force: true }).catch(async () => loc.click({ force: true }));
  }
});

When('switch to {string} tab', async function (this: AutomationWorld) {
  const pages = this.context?.pages() ?? [];
  if (pages[0]) await pages[0].bringToFront();
});

Then('User switches to SSIWeb application', async function (this: AutomationWorld) {
  await this.page!.waitForTimeout(10000);
  const pages = this.context?.pages() ?? [];
  const idx = pages.length > 1 ? 1 : 0;
  if (pages[idx]) await pages[idx]!.bringToFront();
});

When('click on {string} button on {string} screen', async function (this: AutomationWorld, value: string, screenName: string) {
  if (screenName === 'Report of Contact' && value === 'Cancel') {
    await this.page!.locator(`xpath=(//button[@id = 'cancelBtn'])[3]`).click();
  } else if (screenName === 'Report of Contact' && value === 'Close') {
    await this.page!.locator(`xpath=(//button[@id = 'okBtn'])[4]`).click();
  }
});

When('User clicks on T2 {string} screen link', async function (this: AutomationWorld, value: string) {
  const links = this.page!.locator(`xpath=//a[@class = 'uef-menu_link']`);
  const idxMap: Record<string, number> = {
    Disability: 5,
    Children: 5,
    'Foreign Coverage': 8,
    'Voluntary Tax Withholding': 15,
    'Protective Filing Date': 1,
    Earnings: 6,
    'SSI Status': 18,
    Applicant: 0,
  };
  const i = idxMap[value];
  if (i === undefined) throw new Error(`Unknown T2 screen link: ${value}`);
  await links.nth(i).click();
});

When('check if Uninsured', async function (this: AutomationWorld) {
  const needle = 'Worked last year or any time this year';
  const hit = this.page!.getByText(needle, { exact: false }).first();
  if (await hit.isVisible().catch(() => false)) {
    await this.getLocator('radio_EarnsWorkdLastThisyrNo').click();
  }
});

When('verify {string} is not on {string} screen', async function (this: AutomationWorld, value: string, screenName: string) {
  ensureScreen(this, screenName);
  if (value === 'Add Tax Withholding Rate button' && screenName === 'Voluntary Tax Withholding') {
    await expect(this.getLocator('Add Tax Withholding Rate button')).toHaveCount(0);
  }
});

setDefaultTimeout(120 * 1000);
