/**
 * Orchestrates the full pipeline from the architecture diagram:
 *
 *   Workflow -> Execution Engine -> Response Store -> Mapping Resolver
 *   -> Expression Engine -> Final Request Builder -> HTTP Executor
 *
 * This class IS the "Execution Engine" box; everything else it calls into
 * (mappingResolver, expressionEngine, requestBuilder, dependencyGraph) is a
 * separate, independently testable module. The UI never talks to this class
 * directly in production - it talks to whatever API server wraps it - but
 * nothing here assumes a UI exists at all.
 */
import { flattenJson } from './flatten';
import { buildDependencyGraph, detectCycles, topologicalOrder } from './dependencyGraph';
import { resolveStepMappings, MappingResolutionError } from './mappingResolver';
import { buildRequest } from './requestBuilder';
import { InMemoryResponseStore } from './responseStore';
import { validateMappingType } from './validator';
import {
  CircularDependencyError,
  WorkflowValidationError,
  type HttpExecutor,
  type ResponseStore,
  type StepResult,
  type ValidationIssue,
  type WorkflowStep,
} from './types';

export interface WorkflowExecutionResult {
  store: ResponseStore;
  order: string[];
  warnings: ValidationIssue[];
}

/**
 * Validates a workflow WITHOUT executing it: cycle detection (feature #10)
 * plus structural checks (every `source`/`expression` step reference must
 * point at a step that actually exists in this workflow - feature #7/#8).
 * Throws WorkflowValidationError / CircularDependencyError on hard failures.
 */
export function validateWorkflow(steps: WorkflowStep[]): { order: string[] } {
  const stepIds = new Set(steps.map((s) => s.id));
  const issues: ValidationIssue[] = [];

  for (const step of steps) {
    for (const mapping of step.mappings) {
      const text = mapping.source ?? mapping.expression;
      if (!text) continue;
      const refMatch = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\./);
      if (refMatch && !stepIds.has(refMatch[1]) && !mapping.optional) {
        issues.push({
          severity: 'error',
          stepId: step.id,
          targetPath: mapping.targetPath,
          code: 'MISSING_STEP',
          message: `References step "${refMatch[1]}" which does not exist in this workflow`,
        });
      }
    }
  }

  if (issues.length > 0) throw new WorkflowValidationError(issues);

  const graph = buildDependencyGraph(steps);
  detectCycles(graph); // throws CircularDependencyError on a cycle
  return { order: topologicalOrder(graph) };
}

/**
 * Executes every step in dependency order, resolving mappings and building
 * each request from prior steps' stored responses. Stops at the first step
 * whose mappings contain an unresolvable, non-optional reference - the
 * thrown error identifies exactly which target/step failed and why.
 */
export async function executeWorkflow(steps: WorkflowStep[], httpExecutor: HttpExecutor): Promise<WorkflowExecutionResult> {
  const { order } = validateWorkflow(steps);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const store = new InMemoryResponseStore();
  const warnings: ValidationIssue[] = [];

  for (const stepId of order) {
    const step = byId.get(stepId)!;
    const { resolved, errors } = resolveStepMappings(step.mappings, store);

    if (errors.length > 0) {
      throw new WorkflowValidationError(
        errors.map((e) => ({
          severity: 'error' as const,
          stepId: step.id,
          targetPath: e.mapping.targetPath,
          code: 'UNRESOLVED_REFERENCE' as const,
          message: e.message,
        })),
      );
    }

    for (const { mapping, value } of resolved) {
      const issue = validateMappingType(mapping, value, step.id);
      if (issue) warnings.push(issue);
    }

    const request = buildRequest(step, resolved);
    const start = Date.now();
    const { status, body: responseBody } = await httpExecutor.execute(request);
    const durationMs = Date.now() - start;

    const stepResult: StepResult = {
      stepId: step.id,
      request,
      response: responseBody,
      status,
      flattenedResponse: flattenJson(responseBody),
      durationMs,
      executedAt: new Date().toISOString(),
    };
    store.set(step.id, stepResult);
  }

  return { store, order, warnings };
}

export { CircularDependencyError, WorkflowValidationError, MappingResolutionError };
