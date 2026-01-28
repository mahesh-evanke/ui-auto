/**
 * Minimal SDK-owned element helpers (no e2e dependency).
 * Used by core step definitions for click, type, and wait-for-page.
 */
import * as EC from 'wdio-wait-for';
import { getPageMetadata } from '../locators/locatorProvider';

const DEFAULT_TIMEOUT_MS = 15000;

export async function sdkClick(element: WebdriverIO.Element): Promise<void> {
  await element.click();
}

export async function sdkSendKeys(
  element: WebdriverIO.Element,
  value: string,
  sendEnter: boolean = false
): Promise<void> {
  await element.waitForDisplayed({ timeout: DEFAULT_TIMEOUT_MS });
  await element.clearValue();
  await element.setValue(value);
  if (sendEnter) await element.sendKeys(['Enter']);
}

export async function sdkClearText(element: WebdriverIO.Element): Promise<void> {
  await element.clearValue();
}

export async function sdkWaitForPage(screenName: string): Promise<void> {
  const meta = getPageMetadata(screenName);
  if (!meta) {
    throw new Error(
      `No page metadata for "${screenName}" in pages.json. Add an entry like: "${screenName}": [{"title": "...", "label": "..."}]`
    );
  }
  await browser.waitUntil(EC.titleContains(meta.title), {
    timeout: DEFAULT_TIMEOUT_MS,
    timeoutMsg: `Timeout waiting for page title to contain "${meta.title}" (screen: ${screenName})`,
  });
  if (meta.label) {
    const labelSelector = `//*[contains(text(),"${meta.label}")]`;
    await browser.waitUntil(EC.presenceOf($(labelSelector)), {
      timeout: DEFAULT_TIMEOUT_MS,
      timeoutMsg: `Timeout waiting for label "${meta.label}" (screen: ${screenName})`,
    });
  }
}
