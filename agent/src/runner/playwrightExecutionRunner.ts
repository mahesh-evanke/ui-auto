import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { ensureNodeModulesInstalled, ensurePackageInstalled, ensureChromiumInstalled } from "./dependencyEnsurer.js";
import type { ExecutedTestResult, TestRunResult } from "../types.js";

const RUN_DIR_NAME = ".testpilot-run";
const CONFIG_FILE_NAME = "testpilot-run.config.ts";
const REPORT_FILE_NAME = "testpilot-run-report.json";

const CONFIG_TEMPLATE = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  // Explicit, not left to Playwright's default (which resolves relative to
  // rootDir, not this config's own directory, and was observed to land
  // outside the throwaway run directory - a leftover test-results/ dir in
  // the target repo that the run step's cleanup never touched).
  outputDir: './test-results',
  timeout: 30_000,
  reporter: [['json', { outputFile: '${REPORT_FILE_NAME}' }]],
  use: {
    baseURL: process.env.TESTPILOT_BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
`;

/**
 * Runs a generated .spec.ts against a real, already-running app URL. Only
 * ever invoked by the explicit, user-triggered Run step - never during
 * generation.
 *
 * Both the spec file and the Playwright config import '@playwright/test',
 * and Node's ESM resolution for that import walks UP from the importing
 * file's own directory looking for node_modules/@playwright/test - it does
 * not follow the process's cwd. The canonical generated spec lives under
 * TestPilot's own agent-workspace/, which has no such node_modules ancestor
 * (only targetRootDir does), so running it in place fails with "Cannot find
 * package '@playwright/test'" even after installing it correctly into the
 * target repo. The fix: copy the spec (unmodified) into a throwaway
 * directory INSIDE the target repo just for this run, execute it from
 * there, and always clean the throwaway directory up afterward - the
 * canonical file under generated-tests/ is never touched.
 */
export async function runPlaywrightSpec(
  targetRootDir: string,
  specAbsPath: string,
  baseUrl: string,
  headed: boolean,
  onLog: (line: string) => void
): Promise<TestRunResult> {
  ensureNodeModulesInstalled(targetRootDir, onLog);
  ensurePackageInstalled(targetRootDir, "@playwright/test", true, onLog);
  ensureChromiumInstalled(targetRootDir, onLog);

  const runDir = path.join(targetRootDir, RUN_DIR_NAME);
  fs.mkdirSync(runDir, { recursive: true });
  const specCopyPath = path.join(runDir, path.basename(specAbsPath));
  const configPath = path.join(runDir, CONFIG_FILE_NAME);
  const jsonReportPath = path.join(runDir, REPORT_FILE_NAME);

  fs.copyFileSync(specAbsPath, specCopyPath);
  fs.writeFileSync(configPath, CONFIG_TEMPLATE, "utf-8");
  try {
    fs.unlinkSync(jsonReportPath);
  } catch {
    // fine if it doesn't exist yet
  }

  // No positional file-filter arg: Playwright's CLI matches positional args
  // against paths relative to rootDir, so an absolute path there silently
  // matched nothing ("No tests found") even with correct testDir/config
  // resolution. testDir:'.' already scopes discovery to just this one
  // directory (the copy), so omitting the filter runs exactly that spec.
  const args = ["playwright", "test", "--config", configPath];
  if (headed) args.push("--headed");

  let rawOutput: string;
  try {
    rawOutput = await new Promise<string>((resolve) => {
      const child = execFile(
        "npx",
        args,
        { cwd: runDir, env: { ...process.env, TESTPILOT_BASE_URL: baseUrl }, shell: true, maxBuffer: 20 * 1024 * 1024 },
        (_err, stdout, stderr) => resolve(`${stdout}\n${stderr}`)
      );
      child.stdout?.on("data", (d) => onLog(d.toString()));
      child.stderr?.on("data", (d) => onLog(d.toString()));
    });

    if (!fs.existsSync(jsonReportPath)) {
      return { ran: true, passed: 0, failed: 0, skipped: 0, tests: [], rawOutput: rawOutput.slice(-8000) };
    }
    const json = JSON.parse(fs.readFileSync(jsonReportPath, "utf-8"));
    return parsePlaywrightReport(json, rawOutput);
  } finally {
    // Never leave the throwaway run directory (or its test-results/
    // screenshots/traces) behind in the target repo.
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

function parsePlaywrightReport(json: any, rawOutput: string): TestRunResult {
  const tests: ExecutedTestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const walkSuites = (suites: any[]) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const result of spec.tests ?? []) {
          const outcome = result.results?.[0];
          const status: ExecutedTestResult["status"] =
            outcome?.status === "passed" ? "passed" : outcome?.status === "skipped" ? "skipped" : "failed";
          if (status === "passed") passed++;
          else if (status === "skipped") skipped++;
          else failed++;
          tests.push({ title: spec.title, status, error: outcome?.error?.message, durationMs: outcome?.duration ?? 0 });
        }
      }
      if (suite.suites) walkSuites(suite.suites);
    }
  };
  walkSuites(json.suites);

  return { ran: true, passed, failed, skipped, tests, rawOutput: rawOutput.slice(-8000) };
}
