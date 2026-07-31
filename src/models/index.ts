/**
 * Generic, business-agnostic types shared by the validators, WebActions'
 * table-capture methods, and DbActions. No domain meaning is baked in here
 * (no "Customer"/"Employee" shape) - a consumer project's own spec file
 * defines its own domain interfaces on top of these, the same way every
 * other example in tests/ is local to the test rather than shipped by the
 * library.
 */

/** One row of table-shaped data: header/column name -> cell value. */
export type TableRow = Record<string, unknown>;

/** One field-level mismatch found by ObjectComparator, addressed by JSON path (e.g. "0.age" or "user.email"). */
export interface FieldDifference {
  path: string;
  expected: unknown;
  actual: unknown;
}

/** Result of comparing two single objects (or two primitive values). */
export interface ObjectComparisonResult {
  matched: boolean;
  differences: FieldDifference[];
}

/** Result of comparing one row-pair within a table comparison. */
export interface RowComparisonResult extends ObjectComparisonResult {
  rowIndex: number;
}

/** Result of comparing two arrays of table rows. */
export interface TableComparisonResult {
  expectedCount: number;
  actualCount: number;
  countMatched: boolean;
  rows: RowComparisonResult[];
  allMatched: boolean;
}

/** Generic shape for "what was sent" in an API validation step. */
export interface RequestModel<T = unknown> {
  method: string;
  url: string;
  body?: T;
}

/** Generic shape for "what came back" in an API validation step. */
export interface ResponseModel<T = unknown> {
  status: number;
  body: T;
}

/** Generic shape for a database query's result set. */
export interface DatabaseQueryResult<T = TableRow> {
  rows: T[];
  rowCount: number;
}
