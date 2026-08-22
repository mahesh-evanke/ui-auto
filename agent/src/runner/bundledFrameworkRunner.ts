import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { BUNDLED_FRAMEWORK_ROOT } from "../config.js";
import { parseCucumberReport, type CucumberFeatureReport } from "./cucumberExecutionRunner.js";
import type { TestRunResult } from "../types.js";

const RUN_DIR_NAME = ".testpilot-run";

/**
 * The bundled framework's Gherkin has no baseURL concept - the URL is a
 * literal inside the `User navigates to "<url>" URL` step (see
 * e2e/stepdefinitions/web.ts). So at run time we rewrite that literal to the
 * URL the user supplied, rather than teaching the framework a new env var.
 * If the feature has no navigate step at all, one is prepended so the run
 * still lands on the right application.
 */
export function applyBaseUrlToFeature(featureContent: string, baseUrl: string): string {
  const navigateRe = /(User navigates to\s+")([^"]*)(")/g;
  if (navigateRe.test(featureContent)) {
    return featureContent.replace(navigateRe, (_m, prefix: string, _old: string, suffix: string) => `${prefix}${baseUrl}${suffix}`);
  }

  // No navigate step - insert one as the first step of every Scenario.
  return featureContent.replace(
    /^(\s*)(Scenario(?: Outline)?:.*)$/gm,
    (_m, indent: string, scenarioLine: string) =>
      `${indent}${scenarioLine}\n${indent}  Given User navigates to "${baseUrl}" URL`
  );
}

/**
 * Executes a generated .feature file against a user-supplied application URL
 * using THIS repository's bundled Playwright + Cucumber framework - its step
 * definitions, its World/hooks (browser setup), its locator resolution.
 *
 * This is the difference from runCucumberScenario(): that one runs inside the
 * TARGET repo and needs the target to already be a Cucumber project. Here the
 * target repo only has to be an application reachable at a URL; the harness
 * is the framework we ship alongside this agent, so `e2e/stepdefinitions`
 * (76+ UI steps) is always available regardless of what the target contains.
 *
 * The generated feature is copied (with its URL rewritten) into a throwaway
 * directory inside the framework root and always cleaned up afterward - the
 * canonical artifact under the job's generated-tests/ is never modified.
 */
export async function runInBundledFramework(
  featureAbsPath: string,
  newStepDefsAbsPath: string | null,
  reportDir: string,
  baseUrl: string,
  headed: boolean,
  onLog: (line: string) => void
): Promise<TestRunResult> {
  const frameworkRoot = BUNDLED_FRAMEWORK_ROOT;

  const cucumberBin = path.join(frameworkRoot, "node_modules", "@cucumber", "cucumber", "bin", "cucumber.js");
  if (!fs.existsSync(cucumberBin)) {
    throw new Error(
      `The bundled framework's dependencies are not installed.\n` +
        `Run "npm install" in ${frameworkRoot} first (missing ${cucumberBin}).`
    );
  }

  const stepDefsDir = path.join(frameworkRoot, "e2e", "stepdefinitions");
  if (!fs.existsSync(stepDefsDir)) {
    throw new Error(`Bundled framework step definitions not found at ${stepDefsDir}`);
  }

  const runDir = path.join(frameworkRoot, RUN_DIR_NAME);
  fs.mkdirSync(runDir, { recursive: true });

  try {
    const original = fs.readFileSync(featureAbsPath, "utf-8");
    const withUrl = applyBaseUrlToFeature(original, baseUrl);
    const featureCopyPath = path.join(runDir, path.basename(featureAbsPath));
    fs.writeFileSync(featureCopyPath, withUrl, "utf-8");
    onLog(`Running against ${baseUrl} using the bundled framework at ${frameworkRoot}\n`);

    const jsonReportPath = path.join(reportDir, "cucumber-report.json");
    const args = [
      cucumberBin,
      featureCopyPath,
      "--require-module",
      "ts-node/register",
      "--require",
      path.join(stepDefsDir, "**", "*.ts"),
    ];
    if (newStepDefsAbsPath) args.push("--require", newStepDefsAbsPath);
    // Both parts quoted: an unquoted Windows report path ("C:\...") makes the
    // drive-letter colon ambiguous with the format/target separator, which
    // cucumber warns about and may mis-split.
    args.push("--format", `"json":"${jsonReportPath.replace(/\\/g, "/")}"`);

    const rawOutput = await new Promise<string>((resolve) => {
      const child = execFile(
        process.execPath,
        args,
        {
          cwd: frameworkRoot,
          // A real env var wins over e2e/config/config.yaml (see
          // e2e/support/config.ts's setEnv), so these control the run without
          // editing the framework's own config file.
          //
          // The framework's checked-in config is tuned for watching a human
          // demo (slowMo 1s, verify timeout 200s). A generated test whose
          // assertion is simply wrong would then take minutes per step to
          // fail, so the run step tightens them - while still deferring to
          // anything the user set explicitly in their own environment.
          env: {
            SLOW_MO: "0",
            VERIFY_TIMEOUT_MS: "15000",
            GET_PAGE_TIMEOUT_MS: "60000",
            REDIRECT_WAIT_MS: "15000",
            CLICK_TIMEOUT_MS: "15000",
            ...process.env,
            TESTPILOT_BASE_URL: baseUrl,
            CUCUMBER_HTML_REPORT: "0",
            HEADLESS: headed ? "false" : "true",
            // Video is on by default in the framework's config (it exists to
            // review recorded demos). For an agent run it just fills
            // reports/recorded/ and, because finalizing the file keeps child
            // handles open, delays this process's own exit - so force it off.
            RECORD_VIDEO: "0",
          },
          maxBuffer: 20 * 1024 * 1024,
        },
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
  } finally {
    // maxRetries covers Windows briefly holding a lock on the feature file
    // after the cucumber process exits (EBUSY/EPERM), which would otherwise
    // throw here and mask the real run result.
    fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
