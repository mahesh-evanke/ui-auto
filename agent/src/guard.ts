import path from "node:path";
import fs from "node:fs";
import type { JobPaths } from "./types.js";

/**
 * The cloned repository is read-only, full stop - the agent never writes
 * into it. Every generated file goes through here so a bad model output
 * can't touch anything outside the job's own generatedTests/analysis/reports
 * directories, structurally rather than just by prompting. There is no path
 * that resolves inside paths.repository that this will ever accept.
 */
function assertWritableInJob(paths: JobPaths, allowedRoot: string, targetPath: string): string {
  const absTarget = path.resolve(allowedRoot, targetPath);
  const rel = path.relative(allowedRoot, absTarget);
  const isInsideAllowed = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));

  if (!isInsideAllowed) {
    throw new Error(
      `Refusing to write outside ${allowedRoot}: attempted path "${targetPath}" resolves to ${absTarget}. ` +
        `TestPilot never writes into the cloned repository - only into this job's own output directories.`
    );
  }
  return absTarget;
}

export function writeGeneratedTestFile(paths: JobPaths, relativePath: string, content: string): string {
  const absPath = assertWritableInJob(paths, paths.generatedTests, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
  return absPath;
}

export function writeAnalysisFile(paths: JobPaths, relativePath: string, content: string): string {
  const absPath = assertWritableInJob(paths, paths.analysis, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
  return absPath;
}

export function writeReportFile(paths: JobPaths, relativePath: string, content: string): string {
  const absPath = assertWritableInJob(paths, paths.reports, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
  return absPath;
}

export function writeRunResultFile(paths: JobPaths, relativePath: string, content: string): string {
  const absPath = assertWritableInJob(paths, paths.runResults, relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
  return absPath;
}
