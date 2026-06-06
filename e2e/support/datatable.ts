/**
 * JSON <-> Cucumber DataTable conversion for request/response payloads.
 */
import type { DataTable } from '@cucumber/cucumber';

export type DataTableKvRow = { path: string; value: string };

function isObjectLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function flattenJson(input: unknown, prefix: string, out: DataTableKvRow[]): void {
  if (input === undefined) return;

  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i++) {
      flattenJson(input[i], `${prefix}[${i}]`, out);
    }
    return;
  }

  if (isObjectLike(input)) {
    const entries = Object.entries(input);
    for (const [k, v] of entries) {
      const nextPrefix = prefix ? `${prefix}.${k}` : k;
      flattenJson(v, nextPrefix, out);
    }
    return;
  }

  // Leaf: stringify primitive values so generator can wrap them in quotes.
  let s: string;
  if (input === null) s = 'null';
  else if (typeof input === 'string') s = input;
  else if (typeof input === 'number' || typeof input === 'boolean') s = String(input);
  else s = String(input);
  out.push({ path: prefix, value: s });
}

export function jsonToDataTable(input: unknown): DataTableKvRow[] {
  const out: DataTableKvRow[] = [];

  if (input === undefined || input === null) return out;

  if (isObjectLike(input) || Array.isArray(input)) {
    // If prefix is raw, it makes array paths invertible.
    const rootPrefix = 'raw';
    if (Array.isArray(input)) flattenJson(input, rootPrefix, out);
    else flattenJson(input, '', out);
    return out;
  }

  // Primitive request bodies (rare): store as "raw".
  flattenJson(input, 'raw', out);
  return out;
}

function unescapeQuotedString(s: string): string {
  // Handle values like \"...\" produced when we embed quotes into feature files.
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseDataTableValueCell(valueCell: string): unknown {
  const raw = String(valueCell ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return '';

  let unquoted = trimmed;
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    unquoted = trimmed.slice(1, -1);
  }
  unquoted = unescapeQuotedString(unquoted);

  // Support markdown mailto values from features (keep feature same, normalize for API payload):
  // "[test@test.com](mailto:test@test.com)" -> "test@test.com"
  const mdMailto = unquoted.match(/^\[([^\]]+)\]\(mailto:([^)]+)\)$/i);
  if (mdMailto) return String(mdMailto[1] || mdMailto[2] || '');

  // Try to parse primitives (numbers/booleans/null) after stripping outer quotes.
  // If it isn't valid JSON, fall back to string.
  try {
    return JSON.parse(unquoted);
  } catch {
    return unquoted;
  }
}

function parsePathSegments(path: string): Array<string> {
  const raw = String(path ?? '').trim();
  if (!raw) return [];
  // Convert array indexes: a[0].b -> a.0.b
  const normalized = raw.replace(/\[(\d+)\]/g, '.$1');
  return normalized.split('.').map((s) => s.trim()).filter(Boolean);
}

function ensureNextContainer(parent: any, key: string, nextIsIndex: boolean): any {
  if (nextIsIndex) return [];
  if (parent[key] === undefined) return {};
  return parent[key];
}

function setDeepByPath(root: any, segments: string[], value: unknown): void {
  if (!segments.length) return;

  const isIndexSegment = (s: string) => /^\d+$/.test(s);
  let cur = root;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const nextSeg = !isLast ? segments[i + 1] : undefined;
    const nextIsIndex = nextSeg !== undefined && isIndexSegment(nextSeg);

    if (isLast) {
      if (isIndexSegment(seg)) {
        const idx = Number(seg);
        if (!Array.isArray(cur)) {
          // Convert object-like containers to arrays if needed.
          // eslint-disable-next-line no-param-reassign
          cur = [];
        }
        cur[idx] = value;
        return;
      }
      cur[seg] = value;
      return;
    }

    if (isIndexSegment(seg)) {
      const idx = Number(seg);
      if (!Array.isArray(cur)) {
        // eslint-disable-next-line no-param-reassign
        cur = [];
      }
      if (cur[idx] === undefined) cur[idx] = nextIsIndex ? [] : {};
      cur = cur[idx];
      continue;
    }

    if (cur[seg] === undefined) cur[seg] = nextIsIndex ? [] : {};
    cur = cur[seg];
  }
}

/**
 * Convert a Cucumber DataTable (header: path/value) into a nested JSON object.
 * Values are expected to be quoted in feature files; we strip outer quotes and parse primitives.
 */
export function dataTableToJson(dt: DataTable): unknown {
  const raw = dt.raw();
  if (!raw || raw.length < 2) return {};

  const header = raw[0].map((h) => String(h ?? '').trim().toLowerCase());
  const pathIdx = header.findIndex((h) => h === 'path');
  const valueIdx = header.findIndex((h) => h === 'value');
  if (pathIdx < 0 || valueIdx < 0) {
    throw new Error(`DataTable must have headers: | path | value |. Got: ${JSON.stringify(raw[0])}`);
  }

  const out: any = {};
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    const p = String(row[pathIdx] ?? '').trim();
    if (!p) continue;
    const cellVal = row[valueIdx] ?? '';
    const parsedVal = parseDataTableValueCell(String(cellVal));
    const segments = parsePathSegments(p);
    if (!segments.length) continue;
    setDeepByPath(out, segments, parsedVal);
  }
  return out;
}

