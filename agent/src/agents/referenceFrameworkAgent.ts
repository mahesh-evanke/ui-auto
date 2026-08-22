import fs from "node:fs";
import path from "node:path";
import type { ReferenceFrameworkProfile, StepDefinitionEntry } from "../types.js";

const STEP_REGISTRATION_RE = /\b(Given|When|Then)\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g;

function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
    } else if (/\.(ts|js)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function extractSteps(filePath: string, kind: "ui" | "api"): StepDefinitionEntry[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const entries: StepDefinitionEntry[] = [];
  let match: RegExpExecArray | null;
  STEP_REGISTRATION_RE.lastIndex = 0;
  while ((match = STEP_REGISTRATION_RE.exec(content)) !== null) {
    const [, keyword, , stepText] = match;
    entries.push({
      stepText: stepText.replace(/\\(['"`])/g, "$1"),
      keyword: keyword as "Given" | "When" | "Then",
      kind,
      sourceFile: filePath,
    });
  }
  return entries;
}

function findOneLocatorExample(rootDir: string): string | null {
  const locatorsDir = path.join(rootDir, "locators");
  if (!fs.existsSync(locatorsDir)) return null;
  // Look for a non-trivial (non-empty, non-{}) yaml file.
  const stack = [locatorsDir];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.ya?ml$/i.test(entry.name)) {
        const content = fs.readFileSync(full, "utf-8").trim();
        if (content && content !== "{}") return `${path.relative(rootDir, full)}:\n${content.slice(0, 800)}`;
      }
    }
  }
  return null;
}

/**
 * Deterministic (no LLM) regex extraction of every Given/When/Then step
 * registration under the reference framework's step-definition-like
 * directories, plus one real locator YAML example. This is the ground-truth
 * reuse vocabulary generated Gherkin must prefer over inventing new phrasing
 * - see src/retrieval/stepDefinitionIndex.ts.
 */
export function analyzeReferenceFramework(referenceRootDir: string): ReferenceFrameworkProfile {
  const notes: string[] = [];
  if (!fs.existsSync(referenceRootDir)) {
    notes.push(`Reference framework path not found: ${referenceRootDir} - proceeding without a reuse vocabulary.`);
    return { rootDir: referenceRootDir, steps: [], locatorExample: null, notes };
  }

  const stepDirCandidates = ["stepdefinitions", "step-definitions", "steps"];
  const apiDirCandidates = ["api-step-definitions", "api-steps"];

  const uiFiles: string[] = [];
  const apiFiles: string[] = [];
  for (const name of stepDirCandidates) {
    const dir = path.join(referenceRootDir, name);
    if (fs.existsSync(dir)) uiFiles.push(...walkTsFiles(dir));
  }
  for (const name of apiDirCandidates) {
    const dir = path.join(referenceRootDir, name);
    if (fs.existsSync(dir)) apiFiles.push(...walkTsFiles(dir));
  }

  const steps: StepDefinitionEntry[] = [];
  for (const f of uiFiles) steps.push(...extractSteps(f, "ui"));
  for (const f of apiFiles) steps.push(...extractSteps(f, "api"));

  // Some frameworks (confirmed true of the default reference framework) keep
  // API steps inside the same directory as UI steps rather than a separate
  // api-step-definitions folder - files named like "api.ts" within the UI
  // step dirs are reclassified as API steps by filename heuristic.
  for (const step of steps) {
    if (step.kind === "ui" && /\bapi\b/i.test(path.basename(step.sourceFile, path.extname(step.sourceFile)))) {
      step.kind = "api";
    }
  }

  if (steps.length === 0) {
    notes.push("No Given/When/Then step registrations found under the reference framework's step-definition directories.");
  }

  const locatorExample = findOneLocatorExample(referenceRootDir);
  if (!locatorExample) {
    notes.push("No non-empty locator YAML example found in the reference framework.");
  }

  return { rootDir: referenceRootDir, steps, locatorExample, notes };
}
