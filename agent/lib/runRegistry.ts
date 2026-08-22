import { EventEmitter } from "node:events";
import { runGeneratedTests } from "../src/runPipeline.js";
import type { ProgressEvent, RunOptionsForTests, TestRunResult } from "../src/types.js";

export interface RunRecord {
  runId: string;
  jobId: string;
  status: "running" | "done" | "failed";
  events: ProgressEvent[];
  logLines: string[];
  emitter: EventEmitter;
  result?: TestRunResult;
  reportPath?: string;
  error?: string;
}

// Same globalThis-pinning rationale as lib/jobRegistry.ts.
const globalForRuns = globalThis as unknown as { __testpilotRuns?: Map<string, RunRecord> };
const runs = globalForRuns.__testpilotRuns ?? (globalForRuns.__testpilotRuns = new Map<string, RunRecord>());

export function getRun(runId: string): RunRecord | undefined {
  return runs.get(runId);
}

/** Starts the explicit, opt-in Run step for an already-generated job. */
export function startRun(opts: RunOptionsForTests): string {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  const record: RunRecord = { runId, jobId: opts.jobId, status: "running", events: [], logLines: [], emitter };
  runs.set(runId, record);

  const onProgress = (event: ProgressEvent) => {
    record.events.push(event);
    record.emitter.emit("progress", event);
  };
  const onLog = (line: string) => {
    record.logLines.push(line);
    if (record.logLines.length > 500) record.logLines.shift();
    record.emitter.emit("log", line);
  };

  void runGeneratedTests(opts, onProgress, onLog)
    .then(({ result, reportPath }) => {
      record.result = result;
      record.reportPath = reportPath;
      record.status = "done";
      record.emitter.emit("done", result);
    })
    .catch((err: unknown) => {
      record.status = "failed";
      record.error = err instanceof Error ? err.message : String(err);
      record.emitter.emit("failed", record.error);
    });

  return runId;
}
