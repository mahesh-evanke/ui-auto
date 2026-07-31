/**
 * Validates an API response's status code, success flag, record count, and
 * business fields, and extracts generated IDs for saving into a
 * ScenarioCache (e.g. ScenarioCache.set('CUSTOMER_IDS', result.extractedIds)).
 * Business-field comparison delegates to ObjectComparator.
 */
import { compareObjects, type ObjectComparatorOptions } from './ObjectComparator';
import { getByPath } from '../cache/ScenarioCache';
import type { ResponseModel, ObjectComparisonResult } from '../models';

export interface ApiResponseValidatorOptions extends ObjectComparatorOptions {
  expectedStatus: number;
  /** Dot-path to a boolean "success" flag in the response body, if any. */
  successField?: string;
  /** Dot-path to an array in the response body whose length is checked against expectedRecordCount. */
  recordCountField?: string;
  expectedRecordCount?: number;
  /** Dot-path to the generated id(s) to extract (a single id or an array of ids). */
  idField?: string;
  /** Business fields to deep-compare against the response body (partial object - compared at the paths present here). */
  expectedFields?: Record<string, unknown>;
}

export interface ApiResponseValidationResult {
  statusMatched: boolean;
  successMatched: boolean;
  recordCountMatched: boolean;
  fieldsResult?: ObjectComparisonResult;
  extractedIds?: unknown;
  allMatched: boolean;
}

export function validateApiResponse(response: ResponseModel, options: ApiResponseValidatorOptions): ApiResponseValidationResult {
  const statusMatched = response.status === options.expectedStatus;

  let successMatched = true;
  if (options.successField) {
    const successValue = getByPath(response.body, options.successField);
    successMatched = successValue === true || successValue === 'true';
  }

  let recordCountMatched = true;
  if (options.recordCountField && options.expectedRecordCount !== undefined) {
    const records = getByPath(response.body, options.recordCountField);
    recordCountMatched = Array.isArray(records) && records.length === options.expectedRecordCount;
  }

  let fieldsResult: ObjectComparisonResult | undefined;
  if (options.expectedFields) {
    fieldsResult = compareObjects(options.expectedFields, response.body, options);
  }

  const extractedIds = options.idField ? getByPath(response.body, options.idField) : undefined;

  return {
    statusMatched,
    successMatched,
    recordCountMatched,
    fieldsResult,
    extractedIds,
    allMatched: statusMatched && successMatched && recordCountMatched && (fieldsResult?.matched ?? true),
  };
}
