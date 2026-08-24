import { EventEmitter } from "node:events";
import type { ProgressEvent } from "../src/types.js";

export interface TaskRecord<T> {
  taskId: string;
  status: "running" | "done" | "failed";
  events: ProgressEvent[];
  logLines: string[];
  emitter: EventEmitter;
  result?: T;
  error?: string;
}

// Same globalThis-pinning rationale as lib/jobRegistry.ts and lib/runRegistry.ts.
const globalForTasks = globalThis as unknown as { __testpilotTasks?: Map<string, TaskRecord<unknown>> };
const tasks = globalForTasks.__testpilotTasks ?? (globalForTasks.__testpilotTasks = new Map());

export function getTask<T = unknown>(taskId: string): TaskRecord<T> | undefined {
  return tasks.get(taskId) as TaskRecord<T> | undefined;
}

/**
 * Generic background-task runner backing the staged Requirements/Scenarios
 * workflow's four async operations (analyze, re-analyze, build manual
 * scenarios, generate automation) - one implementation instead of copying
 * jobRegistry.ts's/runRegistry.ts's pattern a further four times. Unlike
 * jobRegistry.ts, there's no placeholder-id re-keying: every one of these
 * operations already knows which job workspace it's writing into (the
 * caller passes that jobId in separately), so the taskId here only needs to
 * track THIS ONE run's progress/result, not double as a lookup key for
 * on-disk state the way job ids do elsewhere.
 */
export function startTask<T>(
  prefix: string,
  run: (onProgress: (e: ProgressEvent) => void, onLog: (line: string) => void) => Promise<T>
): string {
  const taskId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  const record: TaskRecord<T> = { taskId, status: "running", events: [], logLines: [], emitter };
  tasks.set(taskId, record as TaskRecord<unknown>);

  const onProgress = (event: ProgressEvent) => {
    record.events.push(event);
    record.emitter.emit("progress", event);
  };
  const onLog = (line: string) => {
    record.logLines.push(line);
    if (record.logLines.length > 500) record.logLines.shift();
    record.emitter.emit("log", line);
  };

  void run(onProgress, onLog)
    .then((result) => {
      record.result = result;
      record.status = "done";
      record.emitter.emit("done", result);
    })
    .catch((err: unknown) => {
      record.status = "failed";
      record.error = err instanceof Error ? err.message : String(err);
      record.emitter.emit("failed", record.error);
    });

  return taskId;
}
