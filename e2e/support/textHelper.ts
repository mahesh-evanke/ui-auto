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

type DateUnit = 'Y' | 'M' | 'D';

/** Parses a comma-offset list like ",1Y,-1M,7D" into [{amount:1,unit:'Y'}, ...]. */
function parseDateOffsets(raw: string): Array<{ amount: number; unit: DateUnit }> {
  const out: Array<{ amount: number; unit: DateUnit }> = [];
  const re = /(-?\d+)\s*([YMD])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw || ''))) {
    out.push({ amount: Number(m[1]), unit: m[2].toUpperCase() as DateUnit });
  }
  return out;
}

/**
 * Applies year/month/day offsets to a date. Sums same-unit offsets, then applies
 * in Y -> M -> D order on a single mutating Date so day/month rollover behaves
 * like calendar arithmetic (e.g. +1M on Jan 31 rolls into March, matching
 * native Date.setMonth semantics) rather than three independent calculations.
 */
function applyDateOffsets(base: Date, offsets: Array<{ amount: number; unit: DateUnit }>): Date {
  const d = new Date(base.getTime());
  let dy = 0, dm = 0, dd = 0;
  for (const o of offsets) {
    if (o.unit === 'Y') dy += o.amount;
    else if (o.unit === 'M') dm += o.amount;
    else dd += o.amount;
  }
  if (dy) d.setFullYear(d.getFullYear() + dy);
  if (dm) d.setMonth(d.getMonth() + dm);
  if (dd) d.setDate(d.getDate() + dd);
  return d;
}

/** Renders a date using a dd/mm/yyyy-style pattern (case-insensitive; yy = 2-digit year). */
function formatByPattern(d: Date, format: string | undefined, fallback: string): string {
  const pattern = format && format.trim() ? format.trim() : fallback;
  const yyyy = String(d.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return pattern
    .replace(/yyyy/gi, yyyy)
    .replace(/yy/gi, yy)
    .replace(/mm/gi, mm)
    .replace(/dd/gi, dd);
}

/**
 * Resolves <CURRENT_DATE> style tokens embedded in step/table text:
 *   <CURRENT_DATE>                          today, `defaultFormat` (back-compat: "yyyy-mm-dd")
 *   <CURRENT_DATE+N>                        legacy N-days-forward shorthand
 *   <CURRENT_DATE,1Y>                       +1 year
 *   <CURRENT_DATE,-1M>                      -1 month
 *   <CURRENT_DATE,1D>                       +1 day
 *   <CURRENT_DATE,1Y,1M,1D>                 combined (any order, any count)
 *   <CURRENT_DATE,-1Y,-1M,-1D>              combined, past
 *   <CURRENT_DATE,1Y,1M,1D>:dd/mm/yyyy      combined, with output format
 * Y/M/D are case-insensitive; CURRENT_DATE itself is case-insensitive too.
 */
export function resolveDynamicTokens(input: string, now: Date = new Date(), defaultFormat: string = 'yyyy-mm-dd'): string {
  let out = String(input ?? '');

  // Legacy shorthand: <CURRENT_DATE+N> — N days forward, fixed default format.
  out = out.replace(/<CURRENT_DATE\s*\+\s*([0-9]+)\s*>/gi, (_m, nRaw) => {
    const n = Number(nRaw);
    const d = new Date(now);
    d.setDate(d.getDate() + (Number.isFinite(n) ? n : 0));
    return formatByPattern(d, undefined, defaultFormat);
  });

  // General form: <CURRENT_DATE[,<±N><Y|M|D>...]>[:<format>]
  out = out.replace(
    /<CURRENT_DATE((?:\s*,\s*-?\d+\s*[YMD])*)\s*>(?:\s*:\s*([A-Za-z0-9/\-.]+))?/gi,
    (_m, offsetsRaw: string, formatRaw?: string) => {
      const d = applyDateOffsets(now, parseDateOffsets(offsetsRaw));
      return formatByPattern(d, formatRaw, defaultFormat);
    },
  );

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

  // Frame fallback: the text may live inside an iframe (embedded demos, editors,
  // payment widgets, etc.). Search every child frame before giving up.
  for (const frame of page.frames()) {
    try {
      if (await frame.getByText(needle, { exact: strict }).first().isVisible({ timeout: 500 })) {
        if (debug) {
          // eslint-disable-next-line no-console
          console.log(`[verifyTextOnScreen] Text found inside iframe: "${needle}"`);
        }
        return;
      }
    } catch {
      // ignore and try next frame
    }
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

