#!/usr/bin/env node
// Copies the step definitions, support helpers, config, and locators this
// agent depends on from the framework repo root into agent/e2e/, so a copy
// or archive of just the agent/ folder is self-contained and runnable
// without anyone needing to know that e2e/ lives one level up.
//
// The repo root's e2e/ stays the single source of truth (it's the
// framework's own primary test suite) - this script is how agent/e2e/ stays
// in sync with it. Re-run after editing step definitions:
//   npm run sync-framework
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(agentRoot, "..");

const COPIES = [
  ["e2e/stepdefinitions", "e2e/stepdefinitions"],
  ["e2e/support", "e2e/support"],
  ["e2e/config", "e2e/config"],
  ["e2e/locators", "e2e/locators"],
  // .cjs, not .js: this file sits directly under agent/, which is scoped
  // "type": "module" by agent/package.json (Next.js/ESM) - Node would treat
  // a plain .js file here as ESM and choke on its module.exports syntax.
  // Cucumber's own config loader auto-discovers cucumber.cjs, so renaming
  // needs no extra flag.
  ["cucumber.js", "cucumber.cjs"],
];

function assertSource(src) {
  if (!fs.existsSync(src)) {
    throw new Error(
      `Expected to find ${src} - this script must run from inside a checkout of the full ` +
        `playwright-cucumber-framework repo (agent/ as a subfolder), not from a standalone copy of agent/.`
    );
  }
}

for (const [rel, destRel] of COPIES) {
  const src = path.join(repoRoot, rel);
  const dest = path.join(agentRoot, destRel);
  assertSource(src);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`synced ${rel} -> agent/${destRel}`);
}

// agent/package.json declares "type": "module" (Next.js/ESM), but the
// copied step definitions are written for ts-node's CommonJS transform
// (require/module.exports, same as the framework's own cucumber.js
// config). Node resolves module type per-directory from the nearest
// package.json, so scoping agent/e2e back to CommonJS here is what lets
// cucumber's --require load these files without "found an ES module" -
// the same trick already used for step definitions this agent generates
// (see src/pipeline.ts's stepDefsDir package.json write).
fs.writeFileSync(path.join(agentRoot, "e2e", "package.json"), JSON.stringify({ type: "commonjs" }, null, 2) + "\n");
console.log("wrote agent/e2e/package.json (type: commonjs)");

console.log("\nDone. agent/ now has its own copy of the step definitions and can run standalone.");
