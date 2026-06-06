/**
 * Text verification helper for Playwright pages.
 * Supports dynamic tokens and controlled debug logging.
 */
import type { Page } from 'playwright';

export type TextVerifyOptions = {
  /** Default false (contains match). */
  strict?: boolean;
  /** Total timeout (ms). Default 15000 to match existing step behavior. */
  timeoutMs?: number;
  /** Extra fallback retry budget (ms) after initial wait. Default 8000. */
  fallbackRetryMs?: number;
  /** Enable debug logs. Default reads VERIFY_DEBUG env. */
  debug?: boolean;
};

function shouldDebug(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  return String(process.env.VERIFY_DEBUG || '').toLowerCase() === 'true';
}

function formatCurrentDate(d: Date): string {
  // YYYY-MM-DD (stable, locale-independent)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function resolveDynamicTokens(input: string, now: Date = new Date()): string {
  let out = String(input ?? '');

  // <CURRENT_DATE+N>
  out = out.replace(/<CURRENT_DATE\s*\+\s*([0-9]+)\s*>/gi, (_m, nRaw) => {
    const n = Number(nRaw);
    const d = new Date(now);
    d.setDate(d.getDate() + (Number.isFinite(n) ? n : 0));
    return formatCurrentDate(d);
  });

  // <CURRENT_DATE>
  out = out.replace(/<CURRENT_DATE>/gi, () => formatCurrentDate(now));

  return out;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function verifyTextOnScreen(page: Page, text: string, opts?: TextVerifyOptions): Promise<void> {
  const debug = shouldDebug(opts?.debug);
  const strict = Boolean(opts?.strict);
  // Wait limits come from config.yaml (run.verifyTimeoutMs / run.redirectWaitMs),
  // overridable per call via opts. Defaults used only if config is absent.
  const envNum = (k: string, d: number) => {
    const n = Number(process.env[k]);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const timeoutMs = typeof opts?.timeoutMs === 'number' ? opts!.timeoutMs! : envNum('VERIFY_TIMEOUT_MS', 20000);
  const fallbackRetryMs = typeof opts?.fallbackRetryMs === 'number' ? opts!.fallbackRetryMs! : 8000;
  const redirectWaitMs = envNum('REDIRECT_WAIT_MS', 15000);

  const needle = resolveDynamicTokens(text);
  if (debug) {
    // eslint-disable-next-line no-console
    console.log(`[verifyTextOnScreen] Searching for text (strict=${strict}): "${needle}"`);
  }

  // If a previous action (e.g. clicking Login) triggered a redirect, let the new
  // page settle first — so we check the page the user actually lands on, not the
  // one being navigated away from. Limit comes from config (run.redirectWaitMs).
  await page.waitForLoadState('domcontentloaded', { timeout: redirectWaitMs }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: Math.min(redirectWaitMs, 8000) }).catch(() => {});

  // Primary (matches existing step behavior): getByText(...).first() visible.
  // This is a LIVE locator: it keeps re-checking the current DOM for `timeoutMs`,
  // so a redirect that lands within the window is picked up automatically.
  try {
    await page.getByText(needle, { exact: strict }).first().waitFor({ state: 'visible', timeout: timeoutMs });
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(`[verifyTextOnScreen] Text found: "${needle}"`);
    }
    return;
  } catch (e) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(`[verifyTextOnScreen] Primary search failed, retrying...`);
    }
  }

  // Fallback retry: poll a global DOM contains search for a short window.
  const deadline = Date.now() + Math.max(0, fallbackRetryMs);
  const xpath =
    `//body//*[contains(normalize-space(.), ${JSON.stringify(needle)})]`;

  while (Date.now() < deadline) {
    try {
      const loc = page.locator(`xpath=${xpath}`).first();
      if (await loc.isVisible({ timeout: 500 })) {
        if (debug) {
          // eslint-disable-next-line no-console
          console.log(`[verifyTextOnScreen] Text found via XPath fallback: "${needle}"`);
        }
        return;
      }
    } catch {
      // ignore and retry
    }
    await sleep(250);
  }

  if (debug) {
    // eslint-disable-next-line no-console
    console.log(`[verifyTextOnScreen] Text NOT found: "${needle}"`);
  }
  let where = '';
  try { where = page.url(); } catch { /* ignore */ }
  throw new Error(
    `Text not found on screen: "${needle}"` +
      (where ? `\nChecked page: ${where} (waited ${(timeoutMs + fallbackRetryMs) / 1000}s incl. redirect).` : ''),
  );
}

