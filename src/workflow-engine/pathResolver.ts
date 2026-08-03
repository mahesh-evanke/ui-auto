/**
 * Parses and applies dot/bracket JSON paths - "data.users[0].orders[0].items[0].price" -
 * shared by the flattener's inverse (get) and the request builder (set).
 * No dependency on any particular object shape; works on any JsonValue.
 */
import type { JsonValue } from './types';

export type PathSegment = { kind: 'key'; key: string } | { kind: 'index'; index: number };

/** "a.b[0].c" -> [{key:"a"},{key:"b"},{index:0},{key:"c"}] */
export function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const re = /([^[.\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) segments.push({ kind: 'key', key: m[1] });
    else segments.push({ kind: 'index', index: Number(m[2]) });
  }
  return segments;
}

/** Reads a path off any JSON value; returns undefined if the path doesn't exist (never throws). */
export function getByPath(root: JsonValue | undefined, path: string): JsonValue | undefined {
  if (!path) return root;
  let current: JsonValue | undefined = root;
  for (const seg of parsePath(path)) {
    if (current === null || current === undefined) return undefined;
    if (seg.kind === 'index') {
      if (!Array.isArray(current)) return undefined;
      current = current[seg.index];
    } else {
      if (typeof current !== 'object' || Array.isArray(current)) return undefined;
      current = (current as Record<string, JsonValue>)[seg.key];
    }
  }
  return current;
}

/**
 * Writes `value` at `path` inside `root`, creating intermediate objects/arrays
 * as needed. Mutates and returns `root` (pass `{}` for a fresh object).
 * Used by the Final Request Builder to assemble a body/headers object one
 * mapping at a time, e.g. setByPath({}, "customer.address.city", "Chennai").
 */
export function setByPath(root: JsonValue, path: string, value: JsonValue | undefined): JsonValue {
  const segments = parsePath(path);
  if (segments.length === 0) return value as JsonValue;

  let current: any = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = segments[i + 1];
    const key: string | number = seg.kind === 'key' ? seg.key : seg.index;

    if (current[key as never] === undefined || current[key as never] === null || typeof current[key as never] !== 'object') {
      current[key as never] = next.kind === 'index' ? [] : {};
    }
    current = current[key as never];
  }

  const last = segments[segments.length - 1];
  const key: string | number = last.kind === 'key' ? last.key : last.index;
  current[key as never] = value as never;
  return root;
}
