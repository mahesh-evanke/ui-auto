/**
 * Mode/flag parsing from environment variables.
 */

export type TestMode = 'API' | 'API_UI';

export type RunConfig = {
  mode: TestMode;
  capture: boolean;
  openBrowser: boolean;

  /** Browser should be opened for this run. */
  shouldOpenBrowser: boolean;
  /** Attach API capture listeners to the browser page. */
  captureEnabled: boolean;

  /**
   * When no matching captured API is found:
   * - If direct execution is allowed, we will send requests via APIRequestContext.fetch().
   * - Otherwise we throw (replay-only mode).
   */
  allowDirectApiExecution: boolean;
};

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return String(raw).trim().toLowerCase() === 'true';
}

export function readRunConfigFromEnv(): RunConfig {
  const modeRaw = (process.env.MODE || '').trim();
  // Safer default: if MODE isn't provided, prefer API+UI so UI scenarios work out of the box.
  const mode: TestMode = !modeRaw ? 'API_UI' : modeRaw === 'API_UI' ? 'API_UI' : 'API';

  // Backward-compatible default: keep OPEN_BROWSER=true unless explicitly disabled.
  const capture = envBool('CAPTURE', false);
  const openBrowser = envBool('OPEN_BROWSER', true);

  const shouldOpenBrowser = mode === 'API_UI' || capture || openBrowser;
  const captureEnabled = shouldOpenBrowser;
  const allowDirectApiExecution = mode === 'API' && !capture && !openBrowser;

  return {
    mode,
    capture,
    openBrowser,
    shouldOpenBrowser,
    captureEnabled,
    allowDirectApiExecution,
  };
}

