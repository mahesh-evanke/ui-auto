import type { RepoAnalysis, TargetFrameworkAnalysis, TestFrameworkKind } from "../types.js";

function isFeatureFile(p: string): boolean {
  return p.endsWith(".feature");
}
function isSpecFile(p: string): boolean {
  return /\.(spec|test)\.(ts|tsx|js|jsx)$/.test(p);
}
function isStepDefFile(p: string): boolean {
  const lower = p.toLowerCase();
  return (
    /\.(steps|stepdefinitions|step-definitions)\.(ts|js)$/.test(lower) ||
    /\/(step-definitions|stepdefinitions|steps)\//.test(lower)
  );
}
function isLocatorFile(p: string): boolean {
  const lower = p.toLowerCase();
  return (lower.endsWith(".yaml") || lower.endsWith(".yml")) && lower.includes("locator");
}
function isConfigFile(p: string): boolean {
  const lower = p.toLowerCase();
  return /playwright\.config\.(ts|js|mjs)$/.test(lower) || /^cucumber\.(js|cjs|json)$/.test(basenameOf(lower));
}
function basenameOf(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1];
}

/**
 * Classifies the TARGET repo's existing test stack (deterministic file-tree
 * scan, no LLM) so the generator knows whether to produce a .spec.ts or a
 * .feature + step-definitions, and to locate existing artifacts for the
 * reuse search in src/retrieval/stepDefinitionIndex.ts.
 */
export function detectTargetFramework(analysis: RepoAnalysis): TargetFrameworkAnalysis {
  const existingFeatureFiles = analysis.fileTree.filter(isFeatureFile);
  const existingSpecFiles = analysis.fileTree.filter(isSpecFile);
  const existingStepDefFiles = analysis.fileTree.filter(isStepDefFile);
  const existingLocatorFiles = analysis.fileTree.filter(isLocatorFile);
  const configFiles = analysis.fileTree.filter(isConfigFile);

  const deps = { ...(analysis.packageJson?.dependencies ?? {}), ...(analysis.packageJson?.devDependencies ?? {}) };
  const hasCucumber = Boolean(deps["@cucumber/cucumber"]) || existingFeatureFiles.length > 0 || configFiles.some((f) => f.startsWith("cucumber."));
  const hasPlaywright = analysis.hasPlaywright || analysis.hasPlaywrightConfig || existingSpecFiles.length > 0;
  const hasOtherTestFramework = Boolean(deps["jest"] || deps["vitest"] || deps["cypress"] || deps["mocha"]);

  let kind: TestFrameworkKind;
  if (hasCucumber && hasPlaywright) kind = "playwright-cucumber";
  else if (hasPlaywright) kind = "playwright";
  else if (hasOtherTestFramework) kind = "other";
  else kind = "none";

  return { kind, configFiles, existingSpecFiles, existingFeatureFiles, existingStepDefFiles, existingLocatorFiles };
}
