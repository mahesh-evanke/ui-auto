/**
 * Additional UI step aliases to support the API/UI example feature wording.
 */
import { Given, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import type { AutomationWorld } from './world';

function escapeRegExp(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeForXPathLiteral(s: string): string {
  // Prefer single-quoted literal; if input contains single quotes, fall back to concat().
  const v = String(s);
  if (!v.includes("'")) return `'${v}'`;
  const parts = v.split("'");
  return `concat(${parts.map((p) => `'${p}'`).join(`, "\'", `)})`;
}

async function clickByName(page: any, name: string): Promise<void> {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('Click name cannot be empty');

  const timeoutMs = Number(process.env.CLICK_TIMEOUT_MS || '30000');
  const lower = trimmed.toLowerCase();

  const candidates: string[] = [trimmed];
  if (lower === 'login') {
    candidates.push('log in');
    candidates.push('log-in');
    candidates.push('sign in');
    candidates.push('signin');
  }

  const tryClick = async (loc: any): Promise<boolean> => {
    const cnt = await loc.count().catch(() => 0);
    if (!cnt) return false;
    const first = loc.first();
    await expect(first).toBeVisible({ timeout: timeoutMs });
    await first.scrollIntoViewIfNeeded().catch(() => undefined);
    await first.click();
    return true;
  };

  for (const candidate of candidates) {
    const cLower = candidate.toLowerCase();
    const exact = new RegExp(`^${escapeRegExp(candidate)}$`, 'i');
    const contains = new RegExp(`${escapeRegExp(candidate)}`, 'i');

    // 1) Prefer semantic roles.
    if (await tryClick(page.getByRole('button', { name: exact }).first())) return;
    if (await tryClick(page.getByRole('button', { name: contains }).first())) return;
    if (await tryClick(page.getByRole('link', { name: exact }).first())) return;
    if (await tryClick(page.getByRole('link', { name: contains }).first())) return;

    // 2) Fallback: click by visible text (case-insensitive).
    const text = page.getByText(contains, { exact: false }).first();
    if ((await text.count().catch(() => 0)) > 0) {
      await expect(text).toBeVisible({ timeout: timeoutMs });
      await text.scrollIntoViewIfNeeded().catch(() => undefined);
      await text.click();
      return;
    }

    // 3) Heuristics: aria-label/id/name/href containing the keyword.
    const byHref = page
      .locator(`a[href*=${JSON.stringify(candidate)} i], button[onclick*=${JSON.stringify(candidate)} i]`)
      .first();
    if ((await byHref.count().catch(() => 0)) > 0) {
      await tryClick(byHref);
      return;
    }

    const lowerLiteral = escapeForXPathLiteral(cLower);
    const byAttrs = page
      .locator(
        `xpath=//*[(@aria-label and contains(translate(@aria-label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), ${lowerLiteral})) or (@id and contains(translate(@id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), ${lowerLiteral})) or (@name and contains(translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'), ${lowerLiteral}))]`,
      )
      .first();
    if ((await byAttrs.count().catch(() => 0)) > 0) {
      await tryClick(byAttrs);
      return;
    }
  }

  throw new Error(`Could not find a clickable element for name "${trimmed}"`);
}

Given('User navigates to {string}', async function (this: AutomationWorld, url: string) {
  if (!this.page) throw new Error('Browser page not initialized. Ensure OPEN_BROWSER=true or MODE=API_UI.');
  await this.page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
  await this.page.locator('body').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);
});

When('User clicks on {string}', async function (this: AutomationWorld, elementName: string) {
  if (!this.page) throw new Error('Browser page not initialized. Ensure OPEN_BROWSER=true or MODE=API_UI.');
  await clickByName(this.page, elementName);
});

