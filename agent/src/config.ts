import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
export const DEFAULT_MODEL = process.env.TESTPILOT_MODEL ?? "llama3.2";

export const AGENT_WORKSPACE_DIR = "agent-workspace";

/**
 * Walks up from this file to find the bundled test framework's root - the
 * directory holding both `e2e/` (step definitions, locators) and a cucumber
 * config file. `npm run sync-framework` copies both directly into `agent/`
 * (as `agent/e2e/` and `agent/cucumber.cjs` - .cjs because agent/'s own
 * package.json is "type": "module"), so that's found first and is what a
 * standalone copy of just the agent/ folder runs on. If that hasn't been
 * synced, the walk continues up to the framework repo root's own
 * `e2e/` + `cucumber.js`, so nothing breaks for an unsynced checkout either.
 */
function findBundledFrameworkRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const hasE2e = fs.existsSync(path.join(dir, "e2e", "stepdefinitions"));
    const hasCucumberConfig =
      fs.existsSync(path.join(dir, "cucumber.cjs")) || fs.existsSync(path.join(dir, "cucumber.js"));
    if (hasE2e && hasCucumberConfig) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to two levels up (agent/src -> agent -> repo root). Callers
  // surface a clear error if the framework genuinely isn't there.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * The Playwright + Cucumber framework bundled in this same repository. It is
 * BOTH the source of the reusable step vocabulary AND the harness that
 * actually executes generated tests, so a target repository only has to be
 * an application reachable at a URL - it needs no test framework of its own.
 */
export const BUNDLED_FRAMEWORK_ROOT = findBundledFrameworkRoot();

/**
 * Local reference test-automation framework studied for testing conventions
 * (step-definition text, locator file shape, naming) that generated
 * artifacts should follow. Read-only, never modified. Defaults to the
 * bundled framework's own `e2e/` directory; override with
 * TESTPILOT_REFERENCE_FRAMEWORK_PATH to study a different framework.
 */
export const DEFAULT_REFERENCE_FRAMEWORK_PATH =
  process.env.TESTPILOT_REFERENCE_FRAMEWORK_PATH ?? path.join(BUNDLED_FRAMEWORK_ROOT, "e2e");

export const MAX_TOTAL_AGENT_STEPS = 100;
