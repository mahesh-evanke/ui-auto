import { EventEmitter } from "node:events";
import { runJob } from "../src/pipeline.js";
import type { JobPaths, JobResult, ProgressEvent, RunOptions } from "../src/types.js";

export interface JobRecord {
  jobId: string;
  status: "running" | "done" | "failed";
  events: ProgressEvent[];
  logLines: string[];
  emitter: EventEmitter;
  paths?: JobPaths;
  result?: JobResult;
  error?: string;
}

// In-memory only: this is a local single-user app, no need for durable
// cross-process job state. A page refresh re-fetches from GET /api/jobs/[id]
// (backed by this same map) so the checklist survives client navigation
// within one server process lifetime.
//
// Pinned to globalThis rather than a plain module-scope variable: in Next.js
// dev mode each route.ts is compiled/reloaded somewhat independently, and a
// module-scope singleton can end up as a different instance between e.g.
// POST /api/jobs and GET /api/jobs/[jobId]/events, silently losing the job
// (observed as a 404 on the events route right after creating a job).
// globalThis survives route-module recompilation within the same process.
const globalForJobs = globalThis as unknown as { __testpilotJobs?: Map<string, JobRecord> };
const jobs = globalForJobs.__testpilotJobs ?? (globalForJobs.__testpilotJobs = new Map<string, JobRecord>());

export function getJob(jobId: string): JobRecord | undefined {
  return jobs.get(jobId);
}

/**
 * Starts a job in the background and returns its id immediately. Progress
 * events and log lines are fanned out over the record's EventEmitter for
 * SSE consumption by app/api/jobs/[jobId]/events.
 */
export function startJob(opts: RunOptions): string {
  const placeholderId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  const record: JobRecord = {
    jobId: placeholderId,
    status: "running",
    events: [],
    logLines: [],
    emitter,
  };
  jobs.set(placeholderId, record);

  const onProgress = (event: ProgressEvent) => {
    record.events.push(event);
    record.emitter.emit("progress", event);
  };
  const onLog = (line: string) => {
    record.logLines.push(line);
    if (record.logLines.length > 500) record.logLines.shift();
    record.emitter.emit("log", line);
  };

  void runJob(opts, onProgress, onLog)
    .then(({ paths, job }) => {
      // Re-key the record under the real job id (created inside runJob) so
      // report/screenshot routes addressed by that id find it too.
      record.paths = paths;
      record.result = job;
      record.status = "done";
      jobs.set(job.jobId, record);
      record.emitter.emit("done", job);
    })
    .catch((err: unknown) => {
      record.status = "failed";
      record.error = err instanceof Error ? err.message : String(err);
      record.emitter.emit("failed", record.error);
    });

  return placeholderId;
}
