/**
 * Builds a request payload by auto-copying fields from a source object (e.g.
 * the previous API's response) wherever the field NAMES match - so a chained
 * API call only has to spell out the fields that DON'T carry over.
 *
 * The client's ask (part_2): "when I call API 2 and pass in API 1's response,
 * whatever field names match, you map it - the user only specifies the ones
 * that aren't the same or can't be matched directly."
 *
 * You write a template where the fields to pull from the source are marked
 * with the sentinel `'<AUTO>'`; everything else is a literal you keep control
 * of:
 *
 *   const body = autoMap(
 *     { appId: '<AUTO>', claimSeqNo: '<AUTO>', action: 'SUBMIT' },  // template
 *     api1Response,                                                  // source
 *   );
 *   // -> { appId: <from source>, claimSeqNo: <from source>, action: 'SUBMIT' }
 *
 * Each `'<AUTO>'` is resolved by searching the source for a field of the same
 * KEY name (searchByFieldName). A unique match fills it; an ambiguous or
 * missing one throws by default (so you notice), unless `keepUnresolved` is
 * set - then the sentinel stays and the key is reported in `unresolved`.
 */
import { searchByFieldName } from './deepSearch';

export const AUTO = '<AUTO>';

export interface AutoMapOptions {
  /** Also fill `null` template leaves from the source by key name (not just `'<AUTO>'`). */
  fillNulls?: boolean;
  /** Leave an unresolved sentinel in place instead of throwing; the key is added to the returned `unresolved` list. */
  keepUnresolved?: boolean;
}

export interface AutoMapResult<T = Record<string, unknown>> {
  value: T;
  /** Keys whose `'<AUTO>'` could not be uniquely resolved from the source. */
  unresolved: string[];
}

function isSentinel(value: unknown, options: AutoMapOptions): boolean {
  return value === AUTO || (Boolean(options.fillNulls) && value === null);
}

/** Like autoMap(), but returns both the payload and the list of keys that couldn't be resolved. */
export function autoMapReport<T = Record<string, unknown>>(template: unknown, source: unknown, options: AutoMapOptions = {}): AutoMapResult<T> {
  const unresolved: string[] = [];

  const build = (node: unknown, keyName: string): unknown => {
    if (Array.isArray(node)) return node.map((item) => build(item, keyName));
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = build(v, k);
      return out;
    }
    if (isSentinel(node, options)) {
      const matches = searchByFieldName(source, keyName);
      if (matches.length === 1) return matches[0].value;
      unresolved.push(keyName);
      if (!options.keepUnresolved) {
        const detail =
          matches.length === 0
            ? `no field named "${keyName}" in the source`
            : `field "${keyName}" is ambiguous in the source (${matches.length} matches: ${matches.map((m) => m.path).join(', ')})`;
        throw new Error(`autoMap could not resolve "${keyName}" - ${detail}. Provide it explicitly, or set keepUnresolved.`);
      }
      return node; // keep the sentinel
    }
    return node;
  };

  return { value: build(template, '') as T, unresolved };
}

/** Builds a payload, auto-filling every `'<AUTO>'` leaf from `source` by matching field name. Throws on any unresolved sentinel unless `keepUnresolved`. */
export function autoMap<T = Record<string, unknown>>(template: unknown, source: unknown, options?: AutoMapOptions): T {
  return autoMapReport<T>(template, source, options).value;
}
