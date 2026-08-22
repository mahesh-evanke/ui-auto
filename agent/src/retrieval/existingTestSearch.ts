import fs from "node:fs";
import path from "node:path";
import type { ExistingTestMatch, TargetFrameworkAnalysis } from "../types.js";

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "should", "with", "user"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Finds the target repo's own existing tests (spec/feature files) whose
 * filename or content plausibly already covers the given requirement text -
 * spec §18's coverage-gap analysis ("existing coverage: N scenarios").
 * Filename-token match is cheap and reliable; content match is a fallback
 * for generically-named files.
 */
export function findExistingTests(rootDir: string, target: TargetFrameworkAnalysis, requirementText: string): ExistingTestMatch[] {
  const queryTokens = new Set(tokenize(requirementText));
  if (queryTokens.size === 0) return [];

  const candidates: { relPath: string; kind: ExistingTestMatch["kind"] }[] = [
    ...target.existingSpecFiles.map((p) => ({ relPath: p, kind: "spec" as const })),
    ...target.existingFeatureFiles.map((p) => ({ relPath: p, kind: "feature" as const })),
    ...target.existingStepDefFiles.map((p) => ({ relPath: p, kind: "stepdef" as const })),
  ];

  const matches: ExistingTestMatch[] = [];
  for (const { relPath, kind } of candidates) {
    const filenameTokens = tokenize(relPath);
    const filenameOverlap = filenameTokens.filter((t) => queryTokens.has(t));
    if (filenameOverlap.length > 0) {
      matches.push({ path: relPath, kind, matchedOn: filenameOverlap.join(", ") });
      continue;
    }
    try {
      const content = fs.readFileSync(path.join(rootDir, relPath), "utf-8").slice(0, 4000);
      const contentTokens = new Set(tokenize(content));
      const overlap = [...queryTokens].filter((t) => contentTokens.has(t));
      if (overlap.length >= 2) {
        matches.push({ path: relPath, kind, matchedOn: overlap.slice(0, 5).join(", ") });
      }
    } catch {
      // unreadable/binary - skip
    }
  }

  return matches;
}
