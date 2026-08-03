/**
 * Type validation for resolved mapping values (feature #11) - warns rather
 * than hard-fails on mismatches by default, since APIs routinely return
 * "numeric-looking strings" etc; callers can escalate warnings to errors if
 * their workflow demands strict typing.
 */
import { typeOf } from './flatten';
import type { FieldMapping, FieldType, JsonValue, ValidationIssue } from './types';

/** True if `value`'s actual type is compatible with `expected` (numeric strings count as compatible with 'number', same idea for 'boolean'). */
export function isTypeCompatible(value: JsonValue | undefined, expected: FieldType): boolean {
  const actual = typeOf(value);
  if (actual === expected) return true;
  if (expected === 'number' && actual === 'string' && value !== '' && !Number.isNaN(Number(value))) return true;
  if (expected === 'boolean' && actual === 'string' && (value === 'true' || value === 'false')) return true;
  return false;
}

export function validateMappingType(mapping: FieldMapping, value: JsonValue | undefined, stepId: string): ValidationIssue | null {
  if (!mapping.expectedType) return null;
  if (isTypeCompatible(value, mapping.expectedType)) return null;

  return {
    severity: 'warning',
    stepId,
    targetPath: mapping.targetPath,
    code: 'TYPE_MISMATCH',
    message: `Expected type "${mapping.expectedType}" but resolved value has type "${typeOf(value)}" (value: ${JSON.stringify(value)})`,
  };
}
