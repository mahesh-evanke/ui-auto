import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_WORKSPACE_DIR } from "../config.js";
import type { JobPaths } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(__dirname, "..", "..");

function timestampId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `job_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

function pathsForJobId(jobId: string): JobPaths {
  const root = path.join(toolRoot, AGENT_WORKSPACE_DIR, jobId);
  return {
    jobId,
    root,
    repository: path.join(root, "repository"),
    legacyRepository: path.join(root, "legacy-repository"),
    analysis: path.join(root, "analysis"),
    generatedTests: path.join(root, "generated-tests"),
    reports: path.join(root, "reports"),
    logs: path.join(root, "logs"),
    runResults: path.join(root, "run-results"),
  };
}

/**
 * repository/ is a read-only clone; generatedTests/, analysis/, and reports/
 * are siblings, never nested inside it - see src/guard.ts for the write
 * enforcement this layout is designed around.
 */
export function createJobWorkspace(): JobPaths {
  const paths = pathsForJobId(timestampId());
  for (const dir of [paths.root, paths.analysis, paths.generatedTests, paths.reports, paths.logs, paths.runResults]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

/** Resolves paths for a job created by a previous run (e.g. for the Run step, which executes an already-generated job's artifacts). */
export function getJobPaths(jobId: string): JobPaths {
  const paths = pathsForJobId(jobId);
  if (!fs.existsSync(paths.root)) {
    throw new Error(`No job found with id "${jobId}" under ${AGENT_WORKSPACE_DIR}/`);
  }
  fs.mkdirSync(paths.runResults, { recursive: true });
  return paths;
}

export function writeLog(paths: JobPaths, name: string, content: string): void {
  fs.writeFileSync(path.join(paths.logs, name), content, "utf-8");
}
