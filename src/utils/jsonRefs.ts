/**
 * Resolves {"$ref": "path"} pointers inside a parsed JSON document, so a
 * value that's repeated many times across a large fixture (the same
 * "manager" object under 7 different keys: manager, reportingManager, owner,
 * reviewer, accountManager, approvedBy, createdBy) can be defined ONCE and
 * referenced everywhere else - update it in one place, every reference sees
 * the change, instead of hand-editing N copies and risking them drifting
 * apart:
 *
 *   {
 *     "company": {
 *       "manager": { "name": "Rahul Sharma" },
 *       "departments": [{
 *         "employees": [{ "reportingManager": { "$ref": "company.manager" } }]
 *       }]
 *     }
 *   }
 *
 * The ref path is resolved against the WHOLE document (from the root), using
 * the same path syntax and short/suffix-path fallback as
 * ScenarioCache.get()/getFromJsonFile() - so `{ "$ref": "manager" }` works
 * too, as long as it's unambiguous. Applied automatically by
 * getFromJsonFile()/loadJsonFixture() - nothing extra to call.
 */
import { getByPath } from './pathUtils';
import { searchByPathSuffix, resolveFieldMatches } from './deepSearch';

const REF_KEY = '$ref';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isRefNode(v: unknown): v is { $ref: string } {
  return isPlainObject(v) && typeof v[REF_KEY] === 'string' && Object.keys(v).length === 1;
}

function resolveRefPath(root: unknown, refPath: string): unknown {
  try {
    const direct = getByPath(root, refPath);
    if (direct !== undefined) return direct;
  } catch {
    /* mid-path segment missing at the exact given path - fall through to the suffix search below */
  }
  const matches = searchByPathSuffix(root, refPath);
  return resolveFieldMatches(matches, refPath, { scopeLabel: 'this document' });
}

/** Replaces every {"$ref": "path"} node in `root` with the value found at that path (resolved from the document root). Throws on a circular or unresolvable ref. */
export function resolveRefs<T = unknown>(root: unknown): T {
  const walk = (node: unknown, seenRefPaths: readonly string[]): unknown => {
    if (isRefNode(node)) {
      const refPath = node[REF_KEY];
      if (seenRefPaths.includes(refPath)) {
        throw new Error(`Circular $ref: ${[...seenRefPaths, refPath].join(' -> ')}`);
      }
      const target = resolveRefPath(root, refPath);
      return walk(target, [...seenRefPaths, refPath]);
    }
    if (Array.isArray(node)) return node.map((item) => walk(item, seenRefPaths));
    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, seenRefPaths);
      return out;
    }
    return node;
  };

  return walk(root, []) as T;
}
