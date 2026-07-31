/**
 * Per-test key/value store shared by WebActions/ApiActions/DbActions
 * (injected by fixtures.ts as the same instance into all three), so a value
 * saved from a UI step, an API response, or a DB query can be reused as
 * input to a later step - even within one fluent chain, via a lazy function
 * argument:
 *
 *   await apiActions
 *     .sendRequest('POST', loginUrl, creds)
 *     .expectStatus(200)
 *     .saveResponseField('token', 'authToken')
 *     .sendRequest('GET', () => `/profile?token=${apiActions.context.get('authToken')}`)
 *     .expectStatus(200);
 *
 * The lazy function only runs when that queued action actually executes, by
 * which point every earlier step in the chain has already completed - so it
 * always sees the freshest saved value, regardless of how many calls were
 * chained under one `await`. Scope is exactly one test: a fresh
 * ScenarioCache is created per test by fixtures.ts and discarded when the
 * test ends - nothing persists across tests, files, or workers.
 *
 * get() has three forms, auto-detected by the arguments:
 *
 *   context.set('LOGIN_FORM', { email: 'a@b.com', password: 'secret' });
 *
 *   context.get('LOGIN_FORM')                             // whole object -> { email, password }
 *   context.get('LOGIN_FORM.email')                       // one field     -> 'a@b.com'
 *   context.get('LOGIN_FORM.email', 'LOGIN_FORM.password')// several fields -> { email, password }
 *
 * The single-path form supports nested objects and array indexes
 * ('CUSTOMER.address.city', 'ORDER.items[0].price'). The multi-path form
 * returns an object keyed by each path's LAST segment ('CUSTOMER.name' ->
 * key 'name', 'CUSTOMER.address.city' -> key 'city').
 *
 * A path doesn't have to start from the root: if the exact path doesn't
 * resolve, get() also tries it as a SUFFIX anywhere in the tree, so a deep
 * value can be reached without remembering (or retyping) everything above
 * it - e.g. inside a big saved 'COMPANY' object, both of these work:
 *
 *   context.get('COMPANY.departments[0].manager.name')  // full path
 *   context.get('departments[0].manager.name')          // short path - same result
 *
 * If a short path matches more than once, get() throws listing every full
 * path it matched; pass that path to getAt(path, occurrence) to pick one.
 */
import { loadJsonFixture, saveJsonFile, getFromJsonFile, getFromJsonFileAt, searchInJsonFile } from '../utils/loadJsonFixture';
import { searchByFieldName, searchByPathSuffix, resolveFieldMatches, type FieldMatch } from '../utils/deepSearch';
import { tokenizePath, getByPath } from '../utils/pathUtils';

export { getByPath } from '../utils/pathUtils';

export class ScenarioCache {
  private readonly store = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  /** One key or path -> that value (whole object for a bare cache key, or a nested value for a dot/bracket path). */
  get<T = unknown>(keyOrPath: string): T;
  /** Several paths -> one object, keyed by each path's last segment (e.g. 'CUSTOMER.address.city' -> 'city'). */
  get<T = Record<string, unknown>>(path1: string, path2: string, ...morePaths: string[]): T;
  get<T = unknown>(...pathsOrKey: string[]): T {
    if (pathsOrKey.length === 0) {
      throw new Error('ScenarioCache.get() requires at least one key or path argument.');
    }

    if (pathsOrKey.length === 1) {
      return this.getSingle(pathsOrKey[0]) as T;
    }

    // Multiple paths -> assemble an object keyed by each path's last segment.
    // (If two paths share a last segment, e.g. 'A.name'/'B.name', the later
    // one wins - pass fewer/renamed paths if that collision matters.)
    const result: Record<string, unknown> = {};
    for (const path of pathsOrKey) {
      const segments = tokenizePath(path);
      const leafKey = segments.length ? segments[segments.length - 1] : path;
      result[leafKey] = this.getSingle(path);
    }
    return result as T;
  }

  private getSingle(keyOrPath: string, occurrence?: number): unknown {
    // Exact key always wins - only fall back to path parsing when there's no
    // literal entry under `keyOrPath` itself, so a key that happens to contain
    // a dot (e.g. an auto-cached "METHOD /url" key) still resolves directly.
    if (this.store.has(keyOrPath)) return this.store.get(keyOrPath);

    const segments = tokenizePath(keyOrPath);
    if (segments.length > 1) {
      const topKey = segments[0];
      if (this.store.has(topKey)) {
        const rest = segments.slice(1).join('.');
        try {
          const resolved = getByPath(this.store.get(topKey), rest);
          // A missing nested field resolves to undefined; for a cache read that
          // should fail the same clear way a missing top-level key does, so we
          // fall through to the suffix-search fallback below rather than
          // returning undefined.
          if (resolved !== undefined) return resolved;
        } catch {
          /* descended into null/undefined mid-path - fall through */
        }
        // Full dot-path under this key didn't resolve - try it as a SHORT/
        // partial path within that key's value instead, e.g. get('COMPANY.departments[0].manager.name')
        // still finding it even if the actual shape nests deeper than expected.
        const suffixMatches = searchByPathSuffix(this.store.get(topKey), rest, topKey);
        if (suffixMatches.length > 0) {
          return resolveFieldMatches(suffixMatches, keyOrPath, { occurrence, scopeLabel: `"${topKey}"` });
        }
      }
    }

    // No cache key matches the path's first segment at all - the root was
    // probably omitted entirely (e.g. cache holds 'COMPANY' but the caller
    // wrote 'departments[0].manager.name' with no 'COMPANY.' prefix). Search
    // for that short path as a suffix across every cached entry.
    const globalMatches: FieldMatch[] = [];
    for (const [topKey, value] of this.store.entries()) globalMatches.push(...searchByPathSuffix(value, keyOrPath, topKey));
    if (globalMatches.length > 0) {
      return resolveFieldMatches(globalMatches, keyOrPath, { occurrence, scopeLabel: 'the cache' });
    }

    throw new Error(`No value saved under key/path "${keyOrPath}". Call saveResponseField()/saveResponseBody()/extractText()/readWebTable()/extractFields()/saveQueryField() first.`);
  }

  /**
   * Same as get(), for a single path that's genuinely ambiguous (matches more
   * than once via the short/suffix-path fallback) and you want a specific
   * occurrence (1-based) instead of the "ambiguous - found N matches" error:
   *
   *   context.getAt('manager.name', 2); // "manager.name" appears under every department - get the 2nd one
   *
   * (For an unambiguous path, get(path) is simpler - this is only needed when
   * the same short path genuinely matches more than once.)
   */
  getAt<T = unknown>(keyOrPath: string, occurrence: number): T {
    return this.getSingle(keyOrPath, occurrence) as T;
  }

  /** Whether a key or path resolves to a value (follows the same rules as get()). */
  has(keyOrPath: string): boolean {
    if (this.store.has(keyOrPath)) return true;
    try {
      this.getSingle(keyOrPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads a JSON fixture from e2e/data/<name>.json and fills in every
   * {{cache.path}} token from THIS cache - so a large hierarchical payload
   * lives in a file, not in the spec, and its dynamic parts come from earlier
   * UI/API/DB steps automatically:
   *
   *   // e2e/data/create-order.json
   *   { "customer": { "id": "{{userId}}", "email": "{{LOGIN_FORM.email}}" }, ... }
   *
   *   await apiActions
   *     .sendRequest('POST', url, () => apiActions.context.loadJson('create-order'))
   *     .expectStatus(201);
   *
   * A token that is the WHOLE string keeps the cached value's type
   * ("{{userId}}" -> the number 8); an embedded token interpolates into a
   * string ("Bearer {{token}}"). `overrides` shallow-merges on top afterwards.
   */
  loadJson<T = unknown>(fixtureName: string, overrides?: Record<string, unknown>): T {
    return loadJsonFixture<T>(fixtureName, overrides, (path) => this.get(path));
  }

  /**
   * The reverse of loadJson(): writes a cached value out to e2e/data/<name>.json,
   * so a response you captured mid-test can be inspected in an editor and
   * loaded back later - in this test (`loadJson(name)`) or as a starting
   * point for a checked-in fixture file:
   *
   *   await apiActions.sendRequest('POST', loginUrl, creds).expectStatus(200).saveResponseBody('LOGIN_RESPONSE');
   *   apiActions.context.saveToFile('LOGIN_RESPONSE', 'login-response'); // writes e2e/data/login-response.json
   *   // ...later, in this test or a future one:
   *   const saved = apiActions.context.loadJson('login-response');
   *
   * `fileName` defaults to `keyOrPath` with anything that isn't safe in a
   * filename replaced with "-" (so an auto-cached key like "GET /posts/1"
   * still produces a valid file). Returns the full path written.
   */
  saveToFile(keyOrPath: string, fileName?: string): string {
    const value = this.get(keyOrPath);
    const name = fileName ?? keyOrPath.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return saveJsonFile(name, value);
  }

  /**
   * Reads directly from e2e/data/<name>.json on disk - NOT from this cache's
   * in-memory store. The file is re-read on every call, so if you (or the
   * user) hand-edit the JSON between calls, the next read reflects the edit
   * immediately. Same three forms as get(): whole file, one path
   * ('items[0].price'), or several paths -> one object - and the same
   * short/partial-path fallback (see get()'s doc comment).
   *
   *   context.getFromFile('order-items', 'items[0].price');  // -> 250, straight off disk
   */
  getFromFile<T = unknown>(fileName: string, ...pathsOrNone: string[]): T {
    return getFromJsonFile<T>(fileName, ...pathsOrNone);
  }

  /** Same as getFromFile(), for a single path that's genuinely ambiguous - pick a specific occurrence (1-based). */
  getFromFileAt<T = unknown>(fileName: string, path: string, occurrence: number): T {
    return getFromJsonFileAt<T>(fileName, path, { occurrence });
  }

  /** Same as search(), but searches e2e/data/<fileName>.json on disk directly instead of this cache's in-memory store. Re-reads the file every call. */
  searchInFile<T = unknown>(fileName: string, fieldName: string, options?: { occurrence?: number }): T {
    return searchInJsonFile<T>(fileName, fieldName, options);
  }

  /**
   * Finds a value by FIELD NAME instead of full path - so you don't have to
   * remember where a field sits in a large saved response:
   *
   *   context.set('LOGIN_RESPONSE', { data: { user: { username: 'surya' } } });
   *   context.search('username');            // -> 'surya' (found anywhere in the tree)
   *
   * - 0 matches -> throws.
   * - exactly 1 match -> returns its value.
   * - >1 matches -> pass `occurrence` (1-based) to pick one, otherwise throws
   *   listing every path so you can disambiguate with get(path).
   * - `in` scopes the search to a single cached key instead of the whole cache.
   */
  search<T = unknown>(fieldName: string, options?: { in?: string; occurrence?: number }): T {
    const matches = this.searchAll(fieldName, options);
    return resolveFieldMatches<T>(matches, fieldName, {
      occurrence: options?.occurrence,
      scopeLabel: options?.in ? `"${options.in}"` : 'the cache',
    });
  }

  /** Every match for a field name (path + value), for discovery/disambiguation. `in` scopes to one cached key. */
  searchAll(fieldName: string, options?: { in?: string }): FieldMatch[] {
    if (options?.in) return searchByFieldName(this.get(options.in), fieldName, options.in);
    const out: FieldMatch[] = [];
    for (const [topKey, value] of this.store.entries()) out.push(...searchByFieldName(value, fieldName, topKey));
    return out;
  }

  /** Every top-level key currently stored. */
  keys(): string[] {
    return [...this.store.keys()];
  }

  /**
   * Every readable dot-path, so you can discover what's available instead of
   * remembering a large response's shape:
   *
   *   context.paths('LOGIN_RESPONSE');
   *   // -> ['LOGIN_RESPONSE.access_token', 'LOGIN_RESPONSE.user.id', 'LOGIN_RESPONSE.user.email', ...]
   *
   * Omit `key` to list paths across every cached entry. Only leaf values are
   * listed (the paths you'd actually pass to get()); arrays are indexed.
   */
  paths(key?: string): string[] {
    const entries: Array<[string, unknown]> = key ? [[key, this.get(key)]] : [...this.store.entries()];
    const out: string[] = [];
    for (const [topKey, value] of entries) collectLeafPaths(value, topKey, out);
    return out;
  }

  /** Pretty-prints every key and its value to the console - a quick "what's in the cache right now?" mid-test. */
  dump(label = 'SCENARIO CACHE'): void {
    const bar = '='.repeat(60);
    console.log(bar);
    console.log(label);
    console.log(bar);
    if (this.store.size === 0) {
      console.log('(empty)');
    } else {
      for (const [k, v] of this.store.entries()) {
        console.log(`${k} =`);
        console.log(JSON.stringify(v, null, 2));
      }
    }
    console.log(bar);
  }

  /** Removes every saved value - rarely needed since scope is already one test, but useful mid-test if a scenario intentionally resets. */
  clear(): void {
    this.store.clear();
  }
}

/** Walks a value and collects the dot-path of every leaf (non-object) it contains. */
function collectLeafPaths(value: unknown, prefix: string, out: string[]): void {
  if (Array.isArray(value)) {
    if (value.length === 0) out.push(prefix);
    value.forEach((item, i) => collectLeafPaths(item, `${prefix}[${i}]`, out));
    return;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out.push(prefix);
    for (const [k, v] of entries) collectLeafPaths(v, `${prefix}.${k}`, out);
    return;
  }
  out.push(prefix);
}
