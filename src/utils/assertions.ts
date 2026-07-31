/**
 * Custom assertion helpers - run a validator, print its report via logger.ts,
 * then assert via Playwright's own `expect` so a mismatch fails the test
 * with the diff already printed above the failure. Plain standalone async-
 * free functions (not Chainable methods), meant to be called directly in a
 * spec alongside `await` actions, e.g.:
 *
 *   await webActions.readWebTable('table1', 'INPUT_ROWS');
 *   await apiActions.sendRequest('POST', url, () => webActions.context.get('INPUT_ROWS')).expectStatus(201);
 *   expectRowsToMatch(webActions.context.get('INPUT_ROWS'), apiActions.lastResponseBody as TableRow[]);
 */
import { expect } from '@playwright/test';
import { compareObjects, type ObjectComparatorOptions } from '../validators/ObjectComparator';
import { compareTables, type TableValidatorOptions } from '../validators/TableValidator';
import { validateDatabaseRows } from '../validators/DatabaseValidator';
import { logTableComparisonReport, logObjectComparisonReport } from './logger';
import type { TableRow } from '../models';

export function expectRowsToMatch(expected: TableRow[], actual: TableRow[], options?: TableValidatorOptions): void {
  const result = compareTables(expected, actual, options);
  logTableComparisonReport('ROW COMPARISON', result);
  expect(result.allMatched, 'Row comparison failed - see console report above.').toBe(true);
}

export function expectObjectsToMatch(expected: unknown, actual: unknown, options?: ObjectComparatorOptions): void {
  const result = compareObjects(expected, actual, options);
  logObjectComparisonReport('OBJECT COMPARISON', result.differences);
  expect(result.matched, 'Object comparison failed - see console report above.').toBe(true);
}

export function expectDatabaseToMatch(expected: TableRow[], actual: TableRow[], options?: TableValidatorOptions): void {
  const result = validateDatabaseRows(expected, actual, options);
  logTableComparisonReport('DATABASE COMPARISON', result);
  expect(result.allMatched, 'Database comparison failed - see console report above.').toBe(true);
}
