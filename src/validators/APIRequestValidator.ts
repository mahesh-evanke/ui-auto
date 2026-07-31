/**
 * Validates that an API request payload matches the data that produced it -
 * either a table's worth of rows (e.g. UI-captured INPUT_ROWS vs. the Save
 * API's request body) or a single object (e.g. a login form's captured
 * fields vs. a login API's request body). Delegates to TableValidator/
 * ObjectComparator - no comparison logic duplicated here.
 */
import { compareObjects } from './ObjectComparator';
import { compareTables, type TableValidatorOptions } from './TableValidator';
import { getByPath } from '../cache/ScenarioCache';
import type { TableRow, ObjectComparisonResult, TableComparisonResult } from '../models';

export interface ApiRequestValidatorOptions extends TableValidatorOptions {
  /** Dot-path into the request payload where the array-of-rows/object actually lives, if the payload isn't the comparison target itself (e.g. "data.rows"). */
  payloadPath?: string;
}

export function validateApiRequest(
  inputData: TableRow[] | TableRow,
  requestPayload: unknown,
  options: ApiRequestValidatorOptions = {},
): TableComparisonResult | ObjectComparisonResult {
  const { payloadPath, ...rest } = options;
  const actualData = payloadPath ? getByPath(requestPayload, payloadPath) : requestPayload;

  if (Array.isArray(inputData)) {
    return compareTables(inputData, Array.isArray(actualData) ? (actualData as TableRow[]) : [], rest);
  }
  return compareObjects(inputData, actualData, rest);
}
