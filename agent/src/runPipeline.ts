import fs from "node:fs";
import path from "node:path";
import { getJobPaths } from "./workspace/jobWorkspace.js";
import { runCucumberScenario } from "./runner/cucumberExecutionRunner.js";
import { runPlaywrightSpec } from "./runner/playwrightExecutionRunner.js";
import { runInBundledFramework } from "./runner/bundledFrameworkRunner.js";
import { runBundledWithAutoFix } from "./autoFix.js";
import { writeRunResultFile } from "./guard.js";
import type { ProgressEvent, RunContext, RunOptionsForTests, TestRunResult } from "./types.js";

/**
 * Executes an already-generated job's test artifacts against a real,
 * already-running application URL the user provides. This is a distinct,
 * explicit, opt-in step from generation (src/pipeline.ts) - generation never
 * calls this, and this never re-generates anything. It's the only place in
 * TestPilot that installs dependencies into or runs code from the target
 * repo, and it only does so because the user explicitly asked to run the
 * tests just generated.
 */
export async function runGeneratedTests(
  opts: RunOptionsForTests,
  onProgress: (event: ProgressEvent) => void,
  onLog: (line: string) => void = () => {}
): Promise<{ result: TestRunResult; reportPath: string }> {
  const emit = (label: string, status: ProgressEvent["status"] = "done") => onProgress({ label, status });

  const paths = getJobPaths(opts.jobId);
  emit(`Loaded job ${opts.jobId}`);

  const runContextPath = path.join(paths.analysis, "run-context.json");
  if (!fs.existsSync(runContextPath)) {
    throw new Error(`No run-context.json found for job ${opts.jobId} - was it generated with an older version of TestPilot?`);
  }
  const runContext = JSON.parse(fs.readFileSync(runContextPath, "utf-8")) as RunContext;

  const harness = opts.harness ?? "bundled";

  // The bundled harness runs entirely inside this repository, so it does not
  // need the target repo on disk at all - only its URL. The "target" harness
  // executes the target's own framework, so that clone must still exist.
  if (harness === "target" && !fs.existsSync(runContext.resolvedRootDir)) {
    throw new Error(
      `Target repository no longer exists at ${runContext.resolvedRootDir} - it may have been a temporary clone that was cleaned up. Re-run generation first.`
    );
  }

  emit(`Running against: ${opts.baseUrl}`, "active");

  let result: TestRunResult;

  if (harness === "bundled") {
    const feature = runContext.generatedArtifacts.find((a) => a.kind === "feature");
    if (!feature) {
      throw new Error(
        "No generated .feature file found for this job. The bundled harness runs Gherkin features against this repo's step definitions; " +
          "re-run generation, or pass --harness target to execute the target repo's own tests."
      );
    }
    const stepDefs = runContext.generatedArtifacts.find((a) => a.kind === "step-definitions");
    emit("Running the generated feature with the bundled Playwright + Cucumber framework...", "active");
    result = await runInBundledFramework(
      feature.absolutePath,
      stepDefs?.absolutePath ?? null,
      paths.runResults,
      opts.baseUrl,
      opts.headed,
      onLog,
      opts.browserName,
      opts.viewportDevice
    );

    // Opt-out, not opt-in: correcting a failure and re-running is the whole
    // point of a Run step that failed, so it happens unless explicitly
    // disabled. Bundled-harness only - it rewrites the canonical .feature
    // artifact and needs an LLM call, neither of which the target harness's
    // own-repo execution does.
    if (opts.autoFix !== false && result.failed > 0) {
      result = await runBundledWithAutoFix(
        opts,
        runContext,
        feature.absolutePath,
        stepDefs?.absolutePath ?? null,
        paths.runResults,
        result,
        emit,
        onLog
      );
    }
  } else if (runContext.frameworkKind === "playwright-cucumber") {
    const feature = runContext.generatedArtifacts.find((a) => a.kind === "feature");
    if (!feature) throw new Error("No generated .feature file found for this job.");
    const stepDefs = runContext.generatedArtifacts.find((a) => a.kind === "step-definitions");

    emit("Installing dependencies in target repo if needed...", "active");
    emit("Running cucumber against the target's own app...", "active");
    result = await runCucumberScenario(
      runContext.resolvedRootDir,
      feature.absolutePath,
      stepDefs?.absolutePath ?? null,
      paths.runResults,
      opts.baseUrl,
      onLog
    );
  } else {
    const spec = runContext.generatedArtifacts.find((a) => a.kind === "playwright-spec");
    if (!spec) throw new Error("No generated Playwright spec found for this job.");

    emit("Installing dependencies in target repo if needed...", "active");
    emit("Running Playwright against the target's own app...", "active");
    result = await runPlaywrightSpec(runContext.resolvedRootDir, spec.absolutePath, opts.baseUrl, opts.headed, onLog);
  }

  emit(`Run complete: ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped`);

  const reportContent = JSON.stringify({ jobId: opts.jobId, baseUrl: opts.baseUrl, ranAt: new Date().toISOString(), result }, null, 2);
  const reportAbsPath = writeRunResultFile(paths, "run-report.json", reportContent);
  emit(`Run report: ${reportAbsPath}`);

  return { result, reportPath: reportAbsPath };
}
