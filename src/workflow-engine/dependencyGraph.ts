/**
 * Builds a step dependency graph from every mapping's `source`/`expression`
 * references, detects circular dependencies, and produces a valid execution
 * order (topological sort) - independent of the order steps happen to be
 * declared in, so the engine scales to unlimited steps (feature #9) and
 * catches cycles (feature #10) before anything executes.
 */
import { CircularDependencyError, type WorkflowStep } from './types';

/** Every "stepX" identifier referenced anywhere in a mapping's source/expression string. */
function referencedStepIds(text: string, knownStepIds: Set<string>): string[] {
  const found = new Set<string>();
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (knownStepIds.has(m[0])) found.add(m[0]);
  }
  return [...found];
}

export interface DependencyGraph {
  /** stepId -> set of stepIds it depends on (must run first). */
  dependencies: Map<string, Set<string>>;
}

export function buildDependencyGraph(steps: WorkflowStep[]): DependencyGraph {
  const stepIds = new Set(steps.map((s) => s.id));
  const dependencies = new Map<string, Set<string>>();

  for (const step of steps) {
    const deps = new Set<string>();
    for (const mapping of step.mappings) {
      const text = mapping.source ?? mapping.expression ?? '';
      for (const refId of referencedStepIds(text, stepIds)) {
        if (refId !== step.id) deps.add(refId);
      }
    }
    dependencies.set(step.id, deps);
  }

  return { dependencies };
}

/** DFS-based cycle detection. Throws CircularDependencyError (with the cycle path) on the first cycle found. */
export function detectCycles(graph: DependencyGraph): void {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of graph.dependencies.keys()) color.set(id, WHITE);

  const path: string[] = [];

  function visit(id: string): void {
    color.set(id, GRAY);
    path.push(id);

    for (const dep of graph.dependencies.get(id) ?? []) {
      const depColor = color.get(dep);
      if (depColor === GRAY) {
        const cycleStart = path.indexOf(dep);
        throw new CircularDependencyError([...path.slice(cycleStart), dep]);
      }
      if (depColor === WHITE) visit(dep);
    }

    path.pop();
    color.set(id, BLACK);
  }

  for (const id of graph.dependencies.keys()) {
    if (color.get(id) === WHITE) visit(id);
  }
}

/**
 * Kahn's algorithm: returns step ids in an order where every step comes
 * after everything it depends on. Assumes detectCycles() has already been
 * called (a cyclic graph has no valid topological order).
 */
export function topologicalOrder(graph: DependencyGraph): string[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep -> [ids that depend on it]

  for (const id of graph.dependencies.keys()) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }
  for (const [id, deps] of graph.dependencies) {
    inDegree.set(id, deps.size);
    for (const dep of deps) dependents.get(dep)!.push(id);
  }

  const queue = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const newDeg = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (order.length !== graph.dependencies.size) {
    throw new Error('topologicalOrder: graph has a cycle (call detectCycles() first)');
  }
  return order;
}
