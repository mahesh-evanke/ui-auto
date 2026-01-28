/**
 * Consumer-root resolution for the SDK.
 *
 * The SDK runs inside a consumer repo, but the framework code lives in the SDK package.
 * To locate consumer-owned assets (features, locators, config.yaml, test-data), we resolve
 * a "consumer root" directory.
 *
 * Resolution order:
 * 1) Explicit env var `UI_AUTO_CONSUMER_ROOT`
 * 2) `process.cwd()` (expected when consumer runs `npx ui-auto ...` from repo root)
 */
import * as path from 'path';

export const CONSUMER_ROOT_ENV = 'UI_AUTO_CONSUMER_ROOT';

export function getConsumerRoot(): string {
  const envRoot = process.env[CONSUMER_ROOT_ENV];
  if (envRoot && envRoot.trim().length > 0) {
    return path.resolve(envRoot.trim());
  }
  return process.cwd();
}
