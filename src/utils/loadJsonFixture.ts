/**
 * Loads a JSON fixture file for use as a request body (or any other large
 * payload) instead of inlining a huge object literal in a spec file:
 *
 *   const body = loadJsonFixture('create-user-payload');
 *   await apiActions.sendRequest('POST', url, body).expectStatus(201);
 *
 * Two kinds of token are resolved in every string value:
 *
 *   <CURRENT_DATE> / <CURRENT_DATE+N>  - see web/textHelper
 *   {{SOME_KEY.path}}                  - looked up in a ScenarioCache, when a
 *                                        lookup function is supplied (that's
 *                                        what ScenarioCache.loadJson() does)
 *
 * {"$ref": "path.to.node"} nodes anywhere in the file are ALSO resolved
 * automatically (before the tokens above) - see jsonRefs.ts. This lets a
 * value repeated many times across a large fixture be defined once and
 * referenced everywhere else, instead of duplicated N times.
 *
 * The {{...}} form is what keeps a large hierarchical payload out of the spec
 * file entirely: write the whole shape once in e2e/data/*.json, mark the few
 * dynamic spots with {{cache.path}}, and the values from earlier UI/API/DB
 * steps get filled in at load time - no need to remember or retype the
 * hierarchy in TypeScript.
 *
 * `overrides` still shallow-merges on top afterwards, for one-off fields that
 * aren't worth a cache entry (e.g. a unique email per run).
 *
 * Note this module deliberately depends on a plain `(path) => unknown` lookup
 * function rather than importing ScenarioCache - that keeps the dependency
 * pointing one way (ScenarioCache -> here) with no import cycle.
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveDynamicTokens } from '../web/textHelper';
import { getByPath, leafSegment } from './pathUtils';
import { searchByFieldName, searchByPathSuffix, resolveFieldMatches } from './deepSearch';
import { resolveRefs } from './jsonRefs';

/** Resolves a `{{path}}` reference to a cached value. Throws if the path isn't resolvable. */
export type CacheLookup = (path: string) => unknown;

const WHOLE_TOKEN = /^\{\{\s*([^}]+?)\s*\}\}$/;
const EMBEDDED_TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * Resolves {{...}} tokens in a single string.
 * - If the string is EXACTLY one token, the cached value is returned with its
 *   original type ("{{userId}}" -> the number 8, not the string "8").
 * - If tokens are embedded in surrounding text, the result is interpolated
 *   into a string ("Bearer {{token}}" -> "Bearer abc123").
 */
function resolveCacheTokensInString(value: string, lookup: CacheLookup): unknown {
  const whole = value.match(WHOLE_TOKEN);
  if (whole) return lookup(whole[1]);

  if (!value.includes('{{')) return value;
  return value.replace(EMBEDDED_TOKEN, (_match, tokenPath: string) => String(lookup(tokenPath.trim())));
}

function resolveTokensDeep(value: unknown, lookup?: CacheLookup): unknown {
  if (typeof value === 'string') {
    const withDates = resolveDynamicTokens(value);
    return lookup ? resolveCacheTokensInString(withDates, lookup) : withDates;
  }
  if (Array.isArray(value)) return value.map((v) => resolveTokensDeep(v, lookup));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveTokensDeep(v, lookup);
    return out;
  }
  return value;
}

/** e2e/data/<name>.json by default; a name containing "/" or "\\" is resolved relative to the project root instead. */
export function fixtureFilePath(name: string): string {
  const fileName = name.endsWith('.json') ? name : `${name}.json`;
  const hasSeparator = fileName.includes('/') || fileName.includes('\\');
  return hasSeparator ? path.resolve(process.cwd(), fileName) : path.join(process.cwd(), 'e2e', 'data', fileName);
}

export function loadJsonFixture<T = unknown>(name: string, overrides?: Record<string, unknown>, lookup?: CacheLookup): T {
  const fp = fixtureFilePath(name);
  if (!fs.existsSync(fp)) {
    throw new Error(`JSON fixture not found: ${fp}\nExpected a file at e2e/data/${name.endsWith('.json') ? name : `${name}.json`} (or pass a path containing "/" to load from elsewhere).`);
  }
  const parsed = resolveRefs(JSON.parse(fs.readFileSync(fp, 'utf8')));
  const resolved = resolveTokensDeep(parsed, lookup);
  return (overrides ? { ...(resolved as Record<string, unknown>), ...overrides } : resolved) as T;
}

/**
 * Resolves one path against `data`: tries the EXACT path first
 * ("company.departments[0].manager.name"); if that doesn't resolve, falls
 * back to a suffix search so a shorter, partial path also works
 * ("departments[0].manager.name" - no need to repeat the "company." root,
 * or remember the full path at all). Ambiguous suffix matches throw listing
 * every full path that matched, same as search()/searchInJsonFile().
 */
function resolveOnePath(data: unknown, path: string, options?: { occurrence?: number; scopeLabel?: string }): unknown {
  try {
    const direct = getByPath(data, path);
    if (direct !== undefined) return direct;
  } catch {
    /* a mid-path segment doesn't exist at the exact given path - fall through to the suffix search below */
  }

  const matches = searchByPathSuffix(data, path);
  return resolveFieldMatches(matches, path, options);
}

/**
 * Reads e2e/data/<name>.json fresh off disk EVERY call - no {{...}} token
 * resolution, no caching layer, nothing kept in memory between calls. This is
 * for data a user maintains by hand-editing the file directly: edit the JSON,
 * the very next call sees the change, because it's read straight from disk
 * each time (unlike a value loaded into ScenarioCache once via loadJson/set,
 * which stays fixed for the rest of the test).
 *
 * Same three forms as ScenarioCache.get(): whole file, one path
 * ('items[0].price'), or several paths -> one object keyed by each path's
 * last segment. Every path form also accepts a SHORT/partial path - see
 * resolveOnePath() - so "departments[0].manager.name" resolves the same as
 * the full "company.departments[0].manager.name" inside a big document.
 */
export function getFromJsonFile<T = unknown>(name: string, ...pathsOrNone: string[]): T {
  const data = readRawJsonFile(name);
  if (pathsOrNone.length === 0) return data as T;
  if (pathsOrNone.length === 1) return resolveOnePath(data, pathsOrNone[0], { scopeLabel: `file "${name}"` }) as T;

  const result: Record<string, unknown> = {};
  for (const p of pathsOrNone) result[leafSegment(p)] = resolveOnePath(data, p, { scopeLabel: `file "${name}"` });
  return result as T;
}

/**
 * Same idea as getFromJsonFile(), but for a single path where you already
 * know it's ambiguous and want a specific occurrence (1-based) instead of
 * the "ambiguous - found N matches" error:
 *
 *   getFromJsonFileAt('company', 'departments[*].manager.name', { occurrence: 2 }); // 2nd department's manager
 *
 * (For an unambiguous path, getFromJsonFile(name, path) is simpler - this is
 * only needed when the same short path genuinely matches more than once.)
 */
export function getFromJsonFileAt<T = unknown>(name: string, path: string, options: { occurrence: number }): T {
  const data = readRawJsonFile(name);
  return resolveOnePath(data, path, { occurrence: options.occurrence, scopeLabel: `file "${name}"` }) as T;
}

/**
 * The reverse of getFromJsonFile(): writes ANY value straight to
 * e2e/data/<name>.json, pretty-printed - no ScenarioCache involved, no key
 * required to already exist anywhere. This is the direct "save this to a
 * file" primitive; ScenarioCache.saveToFile() is a thin wrapper over this for
 * saving a value that's already in the cache.
 *
 *   saveJsonFile('login-response', { access_token: '...', user: { id: 8 } });
 *   // -> e2e/data/login-response.json, ready for getFromJsonFile('login-response', ...)
 *
 * Returns the full path written.
 */
export function saveJsonFile(name: string, value: unknown): string {
  const filePath = fixtureFilePath(name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  return filePath;
}

/** Same as ScenarioCache.search(), but searches e2e/data/<name>.json fresh off disk instead of the in-memory cache - see getFromJsonFile(). */
export function searchInJsonFile<T = unknown>(name: string, fieldName: string, options?: { occurrence?: number }): T {
  const data = readRawJsonFile(name);
  const matches = searchByFieldName(data, fieldName);
  return resolveFieldMatches<T>(matches, fieldName, { occurrence: options?.occurrence, scopeLabel: `file "${name}"` });
}

function readRawJsonFile(name: string): unknown {
  const fp = fixtureFilePath(name);
  if (!fs.existsSync(fp)) {
    throw new Error(`JSON file not found: ${fp}\nExpected a file at e2e/data/${name.endsWith('.json') ? name : `${name}.json`} (or pass a path containing "/" to load from elsewhere).`);
  }
  return resolveRefs(JSON.parse(fs.readFileSync(fp, 'utf8')));
}
