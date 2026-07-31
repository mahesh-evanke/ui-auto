/**
 * Deep-search a nested object/array for every property whose key matches a
 * given field name, returning each match with its full dot/bracket path.
 *
 * This is what lets a spec pull `username` out of a big saved response
 * without knowing its exact path - the client's ask: "rather than giving this
 * entire node.node1.node4 thing, can we get it just by giving username? If it
 * is unique you'll get it; if not, specify which occurrence."
 *
 * Used by ScenarioCache.search()/searchAll() and by the API auto-mapper
 * (src/utils/autoMap.ts).
 */
import { tokenizePath } from './pathUtils';

export interface FieldMatch {
  path: string;
  value: unknown;
}

/** Every property (at any depth) whose key === `fieldName`, with its full path. Array elements are indexed (`items[0].id`). */
export function searchByFieldName(obj: unknown, fieldName: string, prefix = ''): FieldMatch[] {
  const out: FieldMatch[] = [];

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        if (key === fieldName) out.push({ path: childPath, value });
        walk(value, childPath);
      }
    }
  };

  walk(obj, prefix);
  return out;
}

/**
 * Every node (leaf AND intermediate objects/arrays - not just leaves, since
 * "departments[0].manager" itself resolves to an object) whose full tokenized
 * path ENDS WITH the given suffix path. This is what lets a short, partial
 * path like "departments[0].manager.name" resolve inside a big document
 * without repeating its root ("company.departments[0].manager.name") -
 * the client's ask: give the short path, have it found for you.
 *
 * An exact suffix match (e.g. giving the full path) is included too, since
 * "the whole path" is trivially a suffix of itself.
 */
export function searchByPathSuffix(obj: unknown, suffixPath: string, prefix = ''): FieldMatch[] {
  const suffixTokens = tokenizePath(suffixPath);
  if (suffixTokens.length === 0) return [];

  const out: FieldMatch[] = [];

  const endsWithSuffix = (fullTokens: string[]): boolean => {
    if (fullTokens.length < suffixTokens.length) return false;
    const tail = fullTokens.slice(fullTokens.length - suffixTokens.length);
    return tail.every((t, i) => t === suffixTokens[i]);
  };

  const walk = (node: unknown, path: string, tokens: string[]): void => {
    if (endsWithSuffix(tokens)) out.push({ path, value: node });

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`, [...tokens, String(i)]));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        walk(value, childPath, [...tokens, key]);
      }
    }
  };

  walk(obj, prefix, prefix ? tokenizePath(prefix) : []);
  return out;
}

/**
 * Turns a list of field-name matches into a single resolved value, applying
 * the same ambiguity rules everywhere a "search by field name" happens
 * (ScenarioCache.search(), searchInJsonFile()): 0 matches throws, 1 match
 * returns it, several matches require `occurrence` (1-based) or throw listing
 * every path so the caller can disambiguate.
 */
export function resolveFieldMatches<T = unknown>(matches: FieldMatch[], fieldName: string, options?: { occurrence?: number; scopeLabel?: string }): T {
  const scope = options?.scopeLabel ?? 'the given data';

  if (matches.length === 0) {
    throw new Error(`No field named "${fieldName}" found in ${scope}.`);
  }
  if (matches.length === 1) return matches[0].value as T;

  if (options?.occurrence !== undefined) {
    const picked = matches[options.occurrence - 1];
    if (!picked) {
      throw new Error(`occurrence ${options.occurrence} is out of range for "${fieldName}" (found ${matches.length}).`);
    }
    return picked.value as T;
  }

  const paths = matches.map((m, i) => `  ${i + 1}) ${m.path}`).join('\n');
  throw new Error(
    `Field "${fieldName}" is ambiguous - found ${matches.length} matches:\n${paths}\n` +
      `Pass { occurrence: N } (1-based), or read one directly with a path.`,
  );
}
