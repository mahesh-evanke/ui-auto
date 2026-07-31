/**
 * The one recursive deep-diff implementation in the library - everything
 * else (TableValidator, APIRequestValidator, APIResponseValidator,
 * DatabaseValidator) delegates to this instead of re-implementing
 * comparison logic. Walks two values (objects, arrays, or primitives) in
 * parallel and collects every field-level difference, addressed by a
 * dot/bracket JSON path (e.g. "0.age", "user.email").
 */
import type { FieldDifference, ObjectComparisonResult } from '../models';

export interface ObjectComparatorOptions {
  /** Dot-paths (relative to the comparison root) to skip entirely - e.g. dynamic fields like timestamps or generated ids. */
  ignoreFields?: string[];
  /** Compare numbers/booleans against their string form, so "25" matches 25 (common for DB columns returned as strings). */
  coerceTypes?: boolean;
  /** 'dateOnly' truncates ISO datetime strings/Date objects to their date part before comparing, so time-of-day differences are ignored. */
  dateTolerance?: 'exact' | 'dateOnly';
  /** Treat null, undefined, and '' as equivalent - common when a DB NULL round-trips as '' through the UI/API. */
  treatNullAsEmpty?: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})T/;

function normalizeForCompare(value: unknown, options: ObjectComparatorOptions): unknown {
  if (options.treatNullAsEmpty && (value === null || value === undefined)) return '';

  if (value instanceof Date) {
    return options.dateTolerance === 'dateOnly' ? value.toISOString().slice(0, 10) : value.toISOString();
  }

  if (typeof value === 'string' && options.dateTolerance === 'dateOnly') {
    const match = value.match(ISO_DATE_PREFIX);
    if (match) return match[1];
  }

  if (options.coerceTypes && (typeof value === 'number' || typeof value === 'boolean')) {
    return String(value);
  }

  return value;
}

function valuesEqual(expected: unknown, actual: unknown, options: ObjectComparatorOptions): boolean {
  const a = normalizeForCompare(expected, options);
  const b = normalizeForCompare(actual, options);
  if (options.coerceTypes) return String(a) === String(b);
  return a === b;
}

/** Deep-compares `expected` against `actual`, returning every field-level difference found (empty array = full match). */
export function compareObjects(expected: unknown, actual: unknown, options: ObjectComparatorOptions = {}): ObjectComparisonResult {
  const differences: FieldDifference[] = [];
  const ignoreSet = new Set(options.ignoreFields ?? []);

  const walk = (exp: unknown, act: unknown, path: string): void => {
    if (ignoreSet.has(path)) return;

    if (Array.isArray(exp) || Array.isArray(act)) {
      const expArr = Array.isArray(exp) ? exp : [];
      const actArr = Array.isArray(act) ? act : [];
      const len = Math.max(expArr.length, actArr.length);
      for (let i = 0; i < len; i++) walk(expArr[i], actArr[i], path ? `${path}.${i}` : String(i));
      return;
    }

    if (isPlainObject(exp) || isPlainObject(act)) {
      const expObj = isPlainObject(exp) ? exp : {};
      const actObj = isPlainObject(act) ? act : {};
      const keys = new Set([...Object.keys(expObj), ...Object.keys(actObj)]);
      for (const key of keys) walk(expObj[key], actObj[key], path ? `${path}.${key}` : key);
      return;
    }

    if (!valuesEqual(exp, act, options)) {
      differences.push({ path, expected: exp, actual: act });
    }
  };

  walk(expected, actual, '');
  return { matched: differences.length === 0, differences };
}
