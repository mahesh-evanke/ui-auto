/**
 * Launches Chromium for the custom recorder (no Playwright inspector / codegen UI).
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export type LaunchedBrowser = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

export async function launchRecorderBrowser(): Promise<LaunchedBrowser> {
  const browser = await chromium.launch({
    headless: false,
    channel: process.env.PW_CHANNEL || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  return { browser, context, page };
}

export async function shutdownBrowser(launched: LaunchedBrowser): Promise<void> {
  await launched.context.close().catch(() => undefined);
  await launched.browser.close().catch(() => undefined);
}
