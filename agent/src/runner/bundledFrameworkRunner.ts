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
  // 1. Point every existing navigate step at the URL the user supplied
  //    (single or double quoted - the model produces both).
  const withUrl = featureContent.replace(
    /(User navigates to\s+)(["'])([^"']*)\2/g,
    (_m, prefix: string, quote: string) => `${prefix}${quote}${baseUrl}${quote}`
  );

  // 2. Give every scenario that still has no navigate step one. Without this
  //    such a scenario runs against about:blank and every assertion in it
  //    fails for the wrong reason.
  const lines = withUrl.split(/\r?\n/);
  const out: string[] = [];
  const scenarioRe = /^(\s*)(Scenario(?: Outline)?:)/;

  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const m = lines[i].match(scenarioRe);
    if (!m) continue;

    // Look ahead to the end of this scenario for an existing navigate step.
    let hasNavigate = false;
    for (let j = i + 1; j < lines.length; j++) {
      if (scenarioRe.test(lines[j]) || /^\s*Feature:/.test(lines[j])) break;
      if (/User navigates to\s+["']/.test(lines[j])) {
        hasNavigate = true;
        break;
      }
    }
    if (!hasNavigate) out.push(`${m[1]}  Given User navigates to "${baseUrl}" URL`);
  }
  return out.join("\n");
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
    throw new Error(
      `Bundled framework step definitions not found at ${stepDefsDir}.\n` +
        `If this is a copy of just the agent/ folder, run "npm run sync-framework" from inside a full ` +
        `checkout of the playwright-cucumber-framework repo first, then copy agent/ (it will include ` +
        `its own e2e/ after that).`
    );
  }

  // ts-node needs a CommonJS tsconfig to compile these files - agent/'s own
  // tsconfig.json is set up for the ESM Next.js app and would conflict.
  // tsconfig.e2e.json exists when frameworkRoot is this agent's own synced
  // copy (see scripts/sync-framework.mjs); fall back to the plain
  // tsconfig.json some other checkout of the framework might use instead.
  const e2eTsconfig = path.join(frameworkRoot, "tsconfig.e2e.json");
  const tsNodeProject = fs.existsSync(e2eTsconfig) ? e2eTsconfig : path.join(frameworkRoot, "tsconfig.json");

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
            // A small per-action delay in headed mode is what actually makes
            // the run watchable - with 0 (used for headless, where nobody is
            // looking), Playwright fires every click/navigation instantly and
            // the window opens and closes too fast for a human to see
            // anything happen, even though it genuinely ran headed.
            SLOW_MO: headed ? "300" : "0",
            VERIFY_TIMEOUT_MS: "15000",
            GET_PAGE_TIMEOUT_MS: "60000",
            REDIRECT_WAIT_MS: "15000",
            CLICK_TIMEOUT_MS: "15000",
            ...process.env,
            TS_NODE_PROJECT: tsNodeProject,
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
