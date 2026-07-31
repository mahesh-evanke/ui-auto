/**
 * Generic dot/bracket-path utilities shared by ScenarioCache and
 * loadJsonFixture/getFromJsonFile. Lives here (not in ScenarioCache.ts) so
 * loadJsonFixture.ts can use it without an import cycle: ScenarioCache.ts
 * depends on loadJsonFixture.ts (loadJson/saveToFile/getFromFile), so
 * loadJsonFixture.ts must not depend back on ScenarioCache.ts.
 */

/**
 * Splits a path into its segments, understanding both dot and bracket
 * notation: "CUSTOMER.address.city" -> ["CUSTOMER","address","city"],
 * "ORDER.items[0].price" -> ["ORDER","items","0","price"].
 */
export function tokenizePath(path: string): string[] {
  const tokens: string[] = [];
  const re = /[^.[\]]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    const token = match[0].trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

/** Walks pre-tokenized path segments into a nested object/array. */
function resolveTokens(obj: unknown, tokens: string[]): unknown {
  let current: unknown = obj;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      throw new Error(`Cannot read "${token}" of ${current}`);
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

/**
 * Reads a path (e.g. "user.token", "0.email", or "items[0].price") out of a
 * nested object/array. Returns undefined for a missing leaf property; throws
 * only when a mid-path segment tries to descend into null/undefined.
 */
export function getByPath(obj: unknown, path: string): unknown {
  return resolveTokens(obj, tokenizePath(path));
}

/** The last path segment is its field/leaf name ('user.address.city' -> 'city', 'items[0].id' -> 'id'). */
export function leafSegment(path: string): string {
  const segments = tokenizePath(path);
  return segments.length ? segments[segments.length - 1] : path;
}
