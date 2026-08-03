/** Simple in-memory ResponseStore. Swap for a Redis/DB-backed implementation in production (same interface). */
import type { ResponseStore, StepResult } from './types';

export class InMemoryResponseStore implements ResponseStore {
  private results = new Map<string, StepResult>();

  get(stepId: string): StepResult | undefined {
    return this.results.get(stepId);
  }
  set(stepId: string, result: StepResult): void {
    this.results.set(stepId, result);
  }
  has(stepId: string): boolean {
    return this.results.has(stepId);
  }
  all(): Record<string, StepResult> {
    return Object.fromEntries(this.results);
  }
}
