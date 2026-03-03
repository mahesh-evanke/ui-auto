#!/usr/bin/env node
/**
 * Copies built dist and GHERKIN_STEP_DEFINITIONS.md to ui-auto-sdk package,
 * then runs npm pack to produce ui-auto-sdk-0.1.0.tgz.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const sdkDir = path.join(root, "ui-auto-sdk-0.1.0", "package");
const distSrc = path.join(root, "dist");
const distDst = path.join(sdkDir, "dist");
const webioSrc = path.join(root, "webio");
const webioDst = path.join(sdkDir, "webio");
const gherkinSrc = path.join(root, "e2e", "docs", "GHERKIN_STEP_DEFINITIONS.md");
const gherkinDst = path.join(sdkDir, "GHERKIN_STEP_DEFINITIONS.md");

if (!fs.existsSync(sdkDir)) {
  console.error("SDK package folder not found:", sdkDir);
  process.exit(1);
}

if (fs.existsSync(distSrc)) {
  if (fs.existsSync(distDst)) fs.rmSync(distDst, { recursive: true });
  fs.cpSync(distSrc, distDst, { recursive: true });
}

if (fs.existsSync(webioSrc)) {
  if (fs.existsSync(webioDst)) fs.rmSync(webioDst, { recursive: true });
  fs.cpSync(webioSrc, webioDst, { recursive: true });
}

if (fs.existsSync(gherkinSrc)) {
  fs.copyFileSync(gherkinSrc, gherkinDst);
}

const r = spawnSync("npm", ["pack"], { cwd: sdkDir, stdio: "inherit", shell: true });
process.exit(r.status || 0);
