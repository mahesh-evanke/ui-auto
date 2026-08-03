/**
 * Public types for the dynamic response-to-request mapping engine.
 * UI concerns (drag/drop, node rendering) live entirely outside this module -
 * everything here operates on plain data, so it can be driven by a UI, a CLI,
 * or a test.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type FieldType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'undefined';

/** One leaf (or empty container) discovered by flattening a JSON response - what the UI renders as a draggable node. */
export interface FlattenedField {
  /** Dot/bracket path, e.g. "user.company.id" or "data.users[0].orders[0].items[0].price". */
  path: string;
  value: JsonValue | undefined;
  type: FieldType;
}

/** A single step in the workflow (one HTTP call). */
export interface WorkflowStep {
  id: string;
  name: string;
  method: string;
  /** May itself contain {{stepX.response...}} tokens, e.g. "/users/{{step1.response.user.id}}". */
  url: string;
  headers?: Record<string, string>;
  /** Request body template - values may be literals OR "" placeholders resolved via `mappings`. */
  body?: JsonValue;
  queryParams?: Record<string, string>;
  pathParams?: Record<string, string>;
  /** Field-by-field mappings applied on top of headers/body/queryParams/pathParams before execution. */
  mappings: FieldMapping[];
}

export type MappingTarget = 'body' | 'headers' | 'queryParams' | 'pathParams';

/**
 * One draggable connection: a target field on THIS step, wired to a source
 * field on a PRECEDING step's response (or a literal/expression).
 *
 * Exactly one of `source` / `expression` should be set:
 *   - `source`: a plain path reference, e.g. "step1.response.user.id"
 *   - `expression`: a richer expression string, e.g.
 *       "{{step1.response.firstName}} {{step1.response.lastName}}"
 *       "Bearer {{step1.response.accessToken}}"
 *       "step1.response.price * step1.response.quantity"
 *       "if(step1.response.status == \"ACTIVE\", \"OK\", \"BLOCKED\")"
 */
export interface FieldMapping {
  target: MappingTarget;
  /** Dot/bracket path within the target container, e.g. "customerId" or "customer.address.city". */
  targetPath: string;
  source?: string;
  expression?: string;
  /** Applied AFTER `source` resolves, e.g. transform: "Bearer ${value}" wraps the resolved token. Ignored when `expression` is used instead of `source`. */
  transform?: string;
  /** Optional expected type for validation (see validator.ts). */
  expectedType?: FieldType;
  /** True if resolution failure should not fail the step (value is simply omitted). */
  optional?: boolean;
}

/** What gets stored per executed step - the "Response Store" in the architecture diagram. */
export interface StepResult {
  stepId: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: JsonValue;
  };
  response: JsonValue;
  status: number;
  /** Precomputed once per step so the UI can list fields without re-flattening on every render. */
  flattenedResponse: FlattenedField[];
  durationMs: number;
  executedAt: string;
}

/** In-memory (or pluggable) store of every step's result so far, keyed by step id. */
export interface ResponseStore {
  get(stepId: string): StepResult | undefined;
  set(stepId: string, result: StepResult): void;
  has(stepId: string): boolean;
  all(): Record<string, StepResult>;
}

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  stepId: string;
  targetPath: string;
  message: string;
  code:
    | 'UNRESOLVED_REFERENCE'
    | 'TYPE_MISMATCH'
    | 'CIRCULAR_DEPENDENCY'
    | 'MISSING_STEP'
    | 'EXPRESSION_ERROR'
    | 'SCHEMA_CHANGED';
}

export class WorkflowValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((i) => `[${i.severity}] step=${i.stepId} target=${i.targetPath}: ${i.message}`).join('\n'));
    this.name = 'WorkflowValidationError';
  }
}

export class CircularDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

/** Pluggable HTTP executor - the engine never calls fetch/axios directly, so it's testable without a network. */
export interface HttpExecutor {
  execute(request: { method: string; url: string; headers: Record<string, string>; body?: JsonValue }): Promise<{
    status: number;
    body: JsonValue;
  }>;
}
