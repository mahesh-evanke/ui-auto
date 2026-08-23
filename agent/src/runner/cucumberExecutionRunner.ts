import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { detectTargetFramework } from "../agents/testFrameworkDetector.js";
import { analyzeRepository } from "../agents/codebaseAnalysisAgent.js";
import { ensureNodeModulesInstalled, ensurePackageInstalled } from "./dependencyEnsurer.js";
import type { ExecutedTestResult, TestRunResult } from "../types.js";

interface CucumberStepResult {
  status: "passed" | "failed" | "skipped" | "pending" | "undefined" | "ambiguous";
  error_message?: string;
  duration?: { seconds?: number; nanos?: number };
}
interface CucumberStep {
  /** "Given"/"When"/"Then" as literally written in the .feature - undefined for a Background step's own header line, present on the actual step. */
  keyword?: string;
  /** The step text (without the keyword), e.g. `enters "x" text in "email" textbox`. */
  name?: string;
  result?: CucumberStepResult;
}
interface CucumberElement {
  name: string;
  steps: CucumberStep[];
}
export interface CucumberFeatureReport {
  elements: CucumberElement[];
}

/**
 * Runs cucumber-js against a generated .feature file, reusing the TARGET
 * repo's own existing step-definition files (which already provide the
 * World/hooks that launch a browser and expose "page") alongside the newly
 * generated step-definitions file - nothing is copied into the target repo,
 * every file is passed to cucumber via its own absolute path.
 *
 * Note: steps reused from the reference framework (as opposed to the
 * target's own existing step defs) will show up as "undefined" here if the
 * target repo doesn't happen to share that exact step text - that's a real,
 * visible signal in cucumber's own output, not a silent failure.
 */
export async function runCucumberScenario(
  targetRootDir: string,
  featureAbsPath: string,
  newStepDefsAbsPath: string | null,
  reportDir: string,
  baseUrl: string,
  onLog: (line: string) => void
): Promise<TestRunResult> {
  ensureNodeModulesInstalled(targetRootDir, onLog);
  ensurePackageInstalled(targetRootDir, "@cucumber/cucumber", true, onLog);
  ensurePackageInstalled(targetRootDir, "ts-node", true, onLog);

  const cucumberBin = path.join(targetRootDir, "node_modules", "@cucumber", "cucumber", "bin", "cucumber.js");
  if (!fs.existsSync(cucumberBin)) {
    throw new Error(`@cucumber/cucumber did not install correctly in ${targetRootDir} (missing ${cucumberBin})`);
  }

  const analysis = analyzeRepository(targetRootDir);
  const target = detectTargetFramework(analysis);

  const args = [cucumberBin, featureAbsPath, "--require-module", "ts-node/register"];
  for (const relStepDef of target.existingStepDefFiles) {
    args.push("--require", path.join(targetRootDir, relStepDef));
  }
  if (newStepDefsAbsPath) {
    args.push("--require", newStepDefsAbsPath);
  }
  const jsonReportPath = path.join(reportDir, "cucumber-report.json");
  args.push("--format", `json:${jsonReportPath}`);

  const rawOutput = await new Promise<string>((resolve) => {
    const child = execFile(
      process.execPath,
      args,
      { cwd: targetRootDir, env: { ...process.env, TESTPILOT_BASE_URL: baseUrl }, maxBuffer: 20 * 1024 * 1024 },
      (_err, stdout, stderr) => resolve(`${stdout}\n${stderr}`)
    );
    child.stdout?.on("data", (d) => onLog(d.toString()));
    child.stderr?.on("data", (d) => onLog(d.toString()));
  });

  if (!fs.existsSync(jsonReportPath)) {
    return { ran: true, passed: 0, failed: 0, skipped: 0, tests: [], rawOutput: rawOutput.slice(-8000) };
  }

  const report = JSON.parse(fs.readFileSync(jsonReportPath, "utf-8")) as CucumberFeatureReport[];
  return parseCucumberReport(report, rawOutput);
}

export function parseCucumberReport(report: CucumberFeatureReport[], rawOutput: string): TestRunResult {
  const tests: ExecutedTestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const feature of report) {
    for (const scenario of feature.elements ?? []) {
      const statuses = (scenario.steps ?? []).map((s) => s.result?.status ?? "undefined");
      const failedStep = (scenario.steps ?? []).find((s) => s.result?.status === "failed" || s.result?.status === "undefined");
      const durationNs = (scenario.steps ?? []).reduce(
        (sum, s) => sum + (s.result?.duration?.seconds ?? 0) * 1e9 + (s.result?.duration?.nanos ?? 0),
        0
      );

      let status: ExecutedTestResult["status"];
      if (statuses.includes("failed") || statuses.includes("undefined") || statuses.includes("ambiguous")) {
        status = "failed";
        failed++;
      } else if (statuses.every((s) => s === "passed")) {
        status = "passed";
        passed++;
      } else {
        status = "skipped";
        skipped++;
      }

      tests.push({
        title: scenario.name,
        status,
        error: failedStep?.result?.error_message ?? (statuses.includes("undefined") ? "One or more steps had no matching step definition" : undefined),
        durationMs: Math.round(durationNs / 1e6),
        failedStepKeyword: failedStep?.keyword?.trim(),
        failedStepText: failedStep?.name,
      });
    }
  }

  return { ran: true, passed, failed, skipped, tests, rawOutput: rawOutput.slice(-8000) };
}
