/**
 * Launches Chromium for the custom recorder (no Playwright inspector / codegen UI).
 */
import * as path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import './config'; // load config.yaml → process.env
import { contextOptions, launchOptions } from './contextOptions';

export type LaunchedBrowser = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

export async function launchRecorderBrowser(): Promise<LaunchedBrowser> {
  const browser = await chromium.launch(
    launchOptions({ headless: false, channel: process.env.PW_CHANNEL || undefined }),
  );
  const recordVideoDir =
    process.env.RECORD_VIDEO === '1'
      ? path.resolve(process.cwd(), 'e2e', 'reports', 'recorded', 'recording-session')
      : undefined;
  const context = await browser.newContext(
    contextOptions({ deviceName: process.env.VIEWPORT_DEVICE, recordVideoDir }),
  );
  const page = await context.newPage();

  return { browser, context, page };
}

export async function shutdownBrowser(launched: LaunchedBrowser): Promise<void> {
  await launched.context.close().catch(() => undefined);
  await launched.browser.close().catch(() => undefined);
}
