/**
 * Recursively flattens ANY JSON value into a flat list of {path, value, type}
 * "draggable node" entries - the source of the UI's response-field tree.
 *
 * Handles, at unlimited nesting depth: objects, arrays, arrays of arrays,
 * arrays of objects, objects containing arrays, null, undefined/optional
 * properties, and primitives. Empty objects/arrays and null leaves are kept
 * as their own node (with type 'object'/'array'/'null') so the UI can still
 * show - and the user can still map - "this field exists but is empty/null".
 */
import type { FieldType, FlattenedField, JsonValue } from './types';

export function typeOf(value: JsonValue | undefined): FieldType {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  if (t === 'object') return 'object';
  return 'undefined';
}

export function flattenJson(root: JsonValue | undefined, prefix = ''): FlattenedField[] {
  const out: FlattenedField[] = [];

  function walk(value: JsonValue | undefined, path: string): void {
    const t = typeOf(value);

    if (t === 'array') {
      const arr = value as JsonValue[];
      if (arr.length === 0) {
        out.push({ path, value: arr, type: 'array' });
        return;
      }
      arr.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }

    if (t === 'object') {
      const obj = value as Record<string, JsonValue>;
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        out.push({ path, value: obj, type: 'object' });
        return;
      }
      for (const key of keys) {
        const childPath = path ? `${path}.${key}` : key;
        walk(obj[key], childPath);
      }
      return;
    }

    // Primitive, null, or undefined - a real leaf.
    out.push({ path, value, type: t });
  }

  walk(root, prefix);
  return out;
}

/** Convenience: flatten() as a path -> value map, for quick lookups without re-walking the tree. */
export function flattenToMap(root: JsonValue | undefined): Map<string, JsonValue | undefined> {
  const map = new Map<string, JsonValue | undefined>();
  for (const field of flattenJson(root)) map.set(field.path, field.value);
  return map;
}
