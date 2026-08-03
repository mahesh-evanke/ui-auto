/**
 * Resolves a single FieldMapping (or a whole step's worth of mappings)
 * against the ResponseStore. This is the "Mapping Resolver" box in the
 * architecture diagram - it sits between the raw stored responses and the
 * Expression Engine, and knows nothing about HTTP or the request builder.
 */
import type { FieldMapping, JsonValue, ResponseStore } from './types';
import { getByPath } from './pathResolver';
import { applyValueTemplate, evaluateExpression, resolveTemplate, type IdentifierResolver } from './expressionEngine';

export class MappingResolutionError extends Error {
  constructor(public readonly mapping: FieldMapping, reason: string) {
    super(`Cannot resolve mapping for target "${mapping.targetPath}" (${mapping.target}): ${reason}`);
    this.name = 'MappingResolutionError';
  }
}

/**
 * Turns "step1.response.user.company.id" into a live lookup: split off the
 * step id (segment 0) and section (segment 1: response|request|status),
 * resolve the rest as a path into that step's stored data.
 */
export function makeIdentifierResolver(store: ResponseStore): IdentifierResolver {
  return (identifier: string): JsonValue | undefined => {
    const firstDot = identifier.indexOf('.');
    if (firstDot === -1) return undefined;
    const stepId = identifier.slice(0, firstDot);
    const rest = identifier.slice(firstDot + 1);
    const secondDot = rest.indexOf('.');
    const section = secondDot === -1 ? rest : rest.slice(0, secondDot);
    const subPath = secondDot === -1 ? '' : rest.slice(secondDot + 1);

    const result = store.get(stepId);
    if (!result) return undefined;

    if (section === 'response') return getByPath(result.response, subPath);
    if (section === 'request') return getByPath((result.request.body as JsonValue) ?? null, subPath);
    if (section === 'status' && subPath === '') return result.status;
    return undefined;
  };
}

/** Resolves one mapping to its final value, or throws MappingResolutionError (unless mapping.optional). */
export function resolveMapping(mapping: FieldMapping, store: ResponseStore): JsonValue | undefined {
  const resolve = makeIdentifierResolver(store);

  try {
    if (mapping.expression) {
      return resolveTemplate(mapping.expression, resolve);
    }

    if (mapping.source) {
      const value = mapping.source.includes('{{') ? resolveTemplate(mapping.source, resolve) : resolveDirect(mapping.source, resolve);
      if (value === undefined) throw new Error(`source "${mapping.source}" did not resolve to any value`);
      return mapping.transform ? (applyValueTemplate(mapping.transform, value) as JsonValue) : value;
    }

    throw new Error('mapping has neither `source` nor `expression`');
  } catch (e) {
    if (mapping.optional) return undefined;
    throw new MappingResolutionError(mapping, e instanceof Error ? e.message : String(e));
  }
}

/** Plain "stepId.response.path" reference (no {{ }} wrapper, no operators) - the common case, resolved without invoking the expression parser. */
function resolveDirect(source: string, resolve: IdentifierResolver): JsonValue | undefined {
  // A bare reference is just an identifier; only fall back to the full
  // expression evaluator if it looks like it needs one (has an operator/paren).
  if (/[+\-*/()!<>=&|"']/.test(source)) return evaluateExpression(source, resolve);
  return resolve(source);
}

/** Resolves every mapping for a step, collecting per-mapping errors instead of failing on the first one (feature #7: meaningful validation errors). */
export function resolveStepMappings(
  mappings: FieldMapping[],
  store: ResponseStore,
): { resolved: Array<{ mapping: FieldMapping; value: JsonValue | undefined }>; errors: MappingResolutionError[] } {
  const resolved: Array<{ mapping: FieldMapping; value: JsonValue | undefined }> = [];
  const errors: MappingResolutionError[] = [];

  for (const mapping of mappings) {
    try {
      resolved.push({ mapping, value: resolveMapping(mapping, store) });
    } catch (e) {
      if (e instanceof MappingResolutionError) errors.push(e);
      else throw e;
    }
  }

  return { resolved, errors };
}
