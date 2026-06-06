/**
 * Shared browser launch + context options for the recorder and the test runner.
 *  - Mobile/device emulation via Playwright device descriptors (config: browser.viewportDevice)
 *  - Optional video recording (config: browser.recordVideo)
 *  - Hides the "Chrome is being controlled by automated test software" banner.
 */
import { devices, type LaunchOptions, type BrowserContextOptions } from 'playwright';

/** Resolve a Playwright device descriptor by name (e.g. "iPhone 12 Pro"). */
export function resolveDevice(name?: string): (typeof devices)[string] | null {
  const n = String(name || '').trim();
  if (!n) return null;
  return devices[n] ?? null;
}

/** Launch options that remove Playwright/automation branding from the window. */
export function launchOptions(extra: LaunchOptions = {}): LaunchOptions {
  return {
    ...extra,
    // Drop the "controlled by automated test software" infobar + automation flags.
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      ...(extra.args ?? []),
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run',
    ],
  };
}

/** Context options applying device emulation + optional video recording. */
export function contextOptions(opts: {
  deviceName?: string;
  recordVideoDir?: string;
  defaultViewport?: { width: number; height: number };
}): BrowserContextOptions {
  const dev = resolveDevice(opts.deviceName);
  const base: BrowserContextOptions = dev
    ? { ...dev }
    : { viewport: opts.defaultViewport ?? { width: 1280, height: 800 } };
  return {
    ...base,
    ignoreHTTPSErrors: true,
    ...(opts.recordVideoDir ? { recordVideo: { dir: opts.recordVideoDir } } : {}),
  };
}
