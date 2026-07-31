/**
 * Compares two arrays of table rows - pairs rows, then delegates every
 * row's field-level diff to ObjectComparator (no duplicate comparison
 * logic). Used directly for UI-table-vs-DB/API validation, and by
 * DatabaseValidator as a DB-flavored preset.
 */
import { compareObjects, type ObjectComparatorOptions } from './ObjectComparator';
import type { TableRow, RowComparisonResult, TableComparisonResult } from '../models';

export interface TableValidatorOptions extends ObjectComparatorOptions {
  /** Field name to pair expected/actual rows by (handles reordering); default is positional pairing (row 0 vs row 0, etc). */
  matchBy?: string;
}

export function compareTables(expected: TableRow[], actual: TableRow[], options: TableValidatorOptions = {}): TableComparisonResult {
  const { matchBy, ...comparatorOptions } = options;

  const pairs: Array<{ rowIndex: number; exp: TableRow | undefined; act: TableRow | undefined }> = [];

  if (matchBy) {
    const actualByKey = new Map<string, TableRow>();
    for (const row of actual) actualByKey.set(String(row[matchBy]), row);
    expected.forEach((exp, rowIndex) => {
      pairs.push({ rowIndex, exp, act: actualByKey.get(String(exp[matchBy])) });
    });
  } else {
    const len = Math.max(expected.length, actual.length);
    for (let rowIndex = 0; rowIndex < len; rowIndex++) {
      pairs.push({ rowIndex, exp: expected[rowIndex], act: actual[rowIndex] });
    }
  }

  const rows: RowComparisonResult[] = pairs.map(({ rowIndex, exp, act }) => {
    const result = compareObjects(exp, act, comparatorOptions);
    return { rowIndex, ...result };
  });

  const countMatched = expected.length === actual.length;
  return {
    expectedCount: expected.length,
    actualCount: actual.length,
    countMatched,
    rows,
    allMatched: countMatched && rows.every((r) => r.matched),
  };
}
