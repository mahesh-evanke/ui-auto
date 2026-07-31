/**
 * Loads a JSON fixture file for use as a request body (or any other large
 * payload) instead of inlining a huge object literal in a spec file:
 *
 *   const body = loadJsonFixture('create-user-payload');
 *   await apiActions.sendRequest('POST', url, body).expectStatus(201);
 *
 * Resolves <CURRENT_DATE>/<CURRENT_DATE+N> tokens (see textHelper) in every
 * string value, then optionally shallow-merges `overrides` on top - for the
 * handful of fields that need to vary per test run (e.g. a unique email),
 * without duplicating the whole fixture file per test:
 *
 *   const body = loadJsonFixture('create-user-payload', { email: `test-${Date.now()}@example.com` });
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveDynamicTokens } from '../web/textHelper';

function resolveTokensDeep(value: unknown): unknown {
  if (typeof value === 'string') return resolveDynamicTokens(value);
  if (Array.isArray(value)) return value.map(resolveTokensDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveTokensDeep(v);
    return out;
  }
  return value;
}

/** e2e/data/<name>.json by default; a name containing "/" or "\\" is resolved relative to the project root instead. */
function fixtureFilePath(name: string): string {
  const fileName = name.endsWith('.json') ? name : `${name}.json`;
  const hasSeparator = fileName.includes('/') || fileName.includes('\\');
  return hasSeparator ? path.resolve(process.cwd(), fileName) : path.join(process.cwd(), 'e2e', 'data', fileName);
}

export function loadJsonFixture<T = unknown>(name: string, overrides?: Record<string, unknown>): T {
  const fp = fixtureFilePath(name);
  if (!fs.existsSync(fp)) {
    throw new Error(`JSON fixture not found: ${fp}\nExpected a file at e2e/data/${name.endsWith('.json') ? name : `${name}.json`} (or pass a path containing "/" to load from elsewhere).`);
  }
  const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const resolved = resolveTokensDeep(parsed);
  return (overrides ? { ...(resolved as Record<string, unknown>), ...overrides } : resolved) as T;
}
