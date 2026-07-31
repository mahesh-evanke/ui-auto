/**
 * Compares UI/API-input rows against database rows - a DB-flavored preset
 * over TableValidator (type coercion, date-only comparison, and null/empty
 * equivalence all default on, since DB columns commonly round-trip as
 * strings, timestamps, and NULLs that the UI/API represent differently).
 * No comparison logic duplicated - this is purely default options.
 */
import { compareTables, type TableValidatorOptions } from './TableValidator';
import type { TableRow, TableComparisonResult } from '../models';

export function validateDatabaseRows(inputRows: TableRow[], dbRows: TableRow[], options: TableValidatorOptions = {}): TableComparisonResult {
  return compareTables(inputRows, dbRows, {
    coerceTypes: true,
    dateTolerance: 'dateOnly',
    treatNullAsEmpty: true,
    ...options,
  });
}
