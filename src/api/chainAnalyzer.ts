/**
 * Analyzes a sequence of captured API calls to find how they're connected -
 * i.e. which response field of an earlier call feeds a request field (body OR
 * URL path parameter) of a later call. This is the "without UI, generate a
 * chained API test" analysis the client asked for: run over a captured
 * sequence (ApiActions.capturedApis, or any hand-recorded CapturedApi[]),
 * surface the output->input relationships, and let generateApiChainSpec()
 * turn that into a runnable spec instead of a hardcoded, fragile replay.
 *
 * This is the ANALYSIS layer; src/codegen/generateApiChainSpec.ts is the
 * code-generation layer built on top of it.
 */
import type { CapturedApi } from './capture';
import { getByPath } from '../cache/ScenarioCache';

/** Every leaf (primitive) value in an object/array, with its dot/bracket path. */
function leafEntries(obj: unknown, prefix = ''): Array<{ path: string; value: unknown }> {
  const out: Array<{ path: string; value: unknown }> = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    if (node !== undefined) out.push({ path, value: node });
  };
  walk(obj, prefix);
  return out;
}

/**
 * Numeric path segments in a URL, treated as an "id" field for matching
 * purposes - REST APIs overwhelmingly follow the .../resource/{id} pattern
 * (e.g. GET /users/1, GET /posts/1/comments), so a purely-numeric segment is
 * a strong signal of "this is a generated id being passed as input", even
 * though it never appears as a named JSON field. Path is marked with the
 * `$url:` sentinel (segment index) so generateApiChainSpec() knows to rebuild
 * the URL as a template literal instead of touching a request body field.
 *
 * Numeric QUERY parameters are matched too, e.g. `?postId=1` - but by the
 * query key's own NAME ("postId"), not the generic "id", since a query param
 * is already explicitly named (unlike a bare path segment). Marked with the
 * `$query:<key>` sentinel.
 */
function urlIdLeaves(url: string): Array<{ path: string; value: unknown }> {
  const out: Array<{ path: string; value: unknown }> = [];
  const [pathname, queryString] = url.split('?');

  pathname.split('/').forEach((segment, i) => {
    if (/^\d+$/.test(segment)) out.push({ path: `$url:${i}`, value: Number(segment) });
  });

  if (queryString) {
    for (const pair of queryString.split('&')) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined && /^\d+$/.test(value)) {
        out.push({ path: `$query:${key}`, value: Number(value) });
      }
    }
  }

  return out;
}

/** The last dot/bracket segment of a path is its field name (`user.address.city` -> `city`, `items[0].id` -> `id`). A `$url:` path is always named "id"; a `$query:<key>` path is named after that key (see urlIdLeaves). */
function leafName(path: string): string {
  if (path.startsWith('$url:')) return 'id';
  if (path.startsWith('$query:')) return path.slice('$query:'.length);
  const parts = path.split(/[.[\]]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export interface ApiChainLink {
  /** Index of the earlier call whose response supplies the value. */
  fromCall: number;
  fromPath: string;
  /** Index of the later call whose request consumes the value. Body path, "$url:<segmentIndex>" for a URL path parameter, or "$query:<key>" for a URL query parameter. */
  toCall: number;
  toPath: string;
  field: string;
  /** 'value' = same field name AND same value; 'name' = same field name, different/absent value. */
  matchType: 'value' | 'name';
}

export interface ApiChainReport {
  calls: Array<{ index: number; method: string; url: string; status: number }>;
  links: ApiChainLink[];
}

/**
 * Detects output->input links across captured calls. For every request leaf
 * of a later call (body field OR numeric URL path segment), looks for an
 * earlier call's response leaf with the same field name; if the values also
 * match it's a strong ('value') link, otherwise a weaker ('name') link worth
 * reviewing rather than auto-wiring blindly.
 */
export function analyzeApiChain(calls: CapturedApi[]): ApiChainReport {
  const responseLeaves = calls.map((c) => leafEntries(c.responseBody));
  const requestLeaves = calls.map((c) => [...leafEntries(c.requestBody), ...urlIdLeaves(c.url)]);

  const links: ApiChainLink[] = [];

  for (let to = 0; to < calls.length; to++) {
    for (const reqLeaf of requestLeaves[to]) {
      const field = leafName(reqLeaf.path);

      for (let from = 0; from < to; from++) {
        const nameMatches = responseLeaves[from].filter((r) => leafName(r.path) === field);
        if (nameMatches.length === 0) continue;

        const valueMatch = nameMatches.find((r) => r.value === reqLeaf.value);
        const chosen = valueMatch ?? nameMatches[0];
        links.push({
          fromCall: from,
          fromPath: chosen.path,
          toCall: to,
          toPath: reqLeaf.path,
          field,
          matchType: valueMatch ? 'value' : 'name',
        });
      }
    }
  }

  return {
    calls: calls.map((c, i) => ({ index: i, method: c.method, url: c.url, status: c.status })),
    links,
  };
}

/** Resolves a link's source value from the captured calls - handy when turning a report into real chaining. */
export function resolveLinkValue(calls: CapturedApi[], link: ApiChainLink): unknown {
  return getByPath(calls[link.fromCall]?.responseBody, link.fromPath);
}
