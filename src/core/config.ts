/**
 * Loads config.yaml once and maps it into process.env, so all existing
 * env-based code keeps working without a .env file.
 *
 * Real environment variables ALWAYS win over config.yaml (so you can still
 * override on the command line, e.g. HEADLESS=false npx playwright test).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

let loaded = false;

type ConfigShape = {
  browser?: {
    name?: string;
    headless?: boolean;
    slowMo?: number;
    clickTimeoutMs?: number;
    viewportDevice?: string;
    recordVideo?: boolean;
  };
  run?: {
    retryOnFail?: number | string;
    reportFolder?: string;
    maxInstances?: number;
    getPageTimeoutMs?: number;
    redirectWaitMs?: number;
    verifyTimeoutMs?: number;
  };
};

function setEnv(key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  // Real env vars take precedence over config.yaml.
  if (process.env[key] !== undefined) return;
  process.env[key] = String(value);
}

/** Map a browser name to a Playwright channel value. */
function channelFor(name?: string): string | undefined {
  const n = String(name || '').toLowerCase();
  if (n === 'chrome') return 'chrome';
  if (n === 'edge' || n === 'msedge') return 'msedge';
  // chromium / firefox / blank → no channel (use bundled browser)
  return undefined;
}

export function loadConfig(): ConfigShape {
  const cfgPath = path.resolve(process.cwd(), 'e2e', 'config', 'config.yaml');
  let cfg: ConfigShape = {};
  if (fs.existsSync(cfgPath)) {
    try {
      const doc = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
      if (doc && typeof doc === 'object') cfg = doc as ConfigShape;
    } catch {
      cfg = {};
    }
  }

  if (loaded) return cfg;
  loaded = true;

  // ── Browser ──
  if (cfg.browser) {
    if (cfg.browser.headless !== undefined) setEnv('HEADLESS', cfg.browser.headless ? 'true' : 'false');
    setEnv('SLOW_MO', cfg.browser.slowMo);
    setEnv('CLICK_TIMEOUT_MS', cfg.browser.clickTimeoutMs);
    setEnv('VIEWPORT_DEVICE', cfg.browser.viewportDevice);
    if (cfg.browser.recordVideo !== undefined) setEnv('RECORD_VIDEO', cfg.browser.recordVideo ? '1' : '0');
    const ch = channelFor(cfg.browser.name);
    if (ch) setEnv('PW_CHANNEL', ch);
  }

  // ── Run ──
  if (cfg.run) {
    setEnv('RETRY_ON_FAIL', cfg.run.retryOnFail);
    setEnv('REPORT_FOLDER', cfg.run.reportFolder);
    setEnv('GET_PAGE_TIMEOUT_MS', cfg.run.getPageTimeoutMs);
    setEnv('REDIRECT_WAIT_MS', cfg.run.redirectWaitMs);
    setEnv('VERIFY_TIMEOUT_MS', cfg.run.verifyTimeoutMs);
    setEnv('MAX_INSTANCES', cfg.run.maxInstances);
  }

  return cfg;
}

// Load immediately on import.
export const config = loadConfig();
