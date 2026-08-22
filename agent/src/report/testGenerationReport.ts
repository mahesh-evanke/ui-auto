import fs from "node:fs";
import path from "node:path";
import { writeReportFile } from "../guard.js";
import type { JobPaths, TestGenerationReport } from "../types.js";

export function buildTestGenerationReport(report: TestGenerationReport, paths: JobPaths): { mdPath: string; jsonPath: string } {
  const jsonRel = "report.json";
  writeReportFile(paths, jsonRel, JSON.stringify(report, null, 2));

  const md = renderMarkdown(report);
  const mdRel = "report.md";
  writeReportFile(paths, mdRel, md);

  return { mdPath: path.join(paths.reports, mdRel), jsonPath: path.join(paths.reports, jsonRel) };
}

function renderMarkdown(r: TestGenerationReport): string {
  const lines: string[] = [];
  lines.push("# Test Generation Report");
  lines.push("");
  lines.push(`**Repository:** ${r.repo}`);
  lines.push(`**Branch:** ${r.branch}`);
  lines.push(`**Requirement:** ${r.requirement}`);
  lines.push(`**Detected test framework:** ${r.frameworkKind}`);
  lines.push(`**Started:** ${r.startedAt}`);
  lines.push(`**Finished:** ${r.finishedAt}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Repository files analyzed: ${r.filesAnalyzedCount}`);
  lines.push(`- Relevant files identified: ${r.relevantFilesCount}`);
  lines.push(`- Existing test files discovered: ${r.existingTestFilesCount}`);
  lines.push(`- Test scenarios generated: ${r.scenarioCount}`);
  lines.push(`- Existing steps reused: ${r.reusedStepsCount}`);
  lines.push(`- New steps generated: ${r.newStepsCount}`);
  lines.push(`- Requirements covered: ${r.requirementsCoveredCount}/${r.requirementsTotalCount}`);
  lines.push("");

  lines.push("## Generated Artifacts");
  lines.push("");
  if (r.artifacts.length === 0) {
    lines.push("None.");
  } else {
    for (const a of r.artifacts) {
      lines.push(`- \`${a.relativePath}\` (${a.kind})`);
    }
  }
  lines.push("");

  lines.push("## Coverage Matrix");
  lines.push("");
  lines.push("| Requirement | Scenario | Artifact |");
  lines.push("|---|---|---|");
  for (const row of r.coverage) {
    lines.push(`| ${row.requirementId} | ${row.scenarioId} | ${row.artifactFileName} |`);
  }
  lines.push("");

  if (r.assumptions.length) {
    lines.push("## Assumptions");
    for (const a of r.assumptions) lines.push(`- ${a}`);
    lines.push("");
  }

  if (r.gaps.length) {
    lines.push("## Potential Gaps");
    for (const g of r.gaps) lines.push(`- ${g}`);
    lines.push("");
  }

  lines.push("## Execution Status");
  lines.push("");
  lines.push("Application source modified: **NO**");
  lines.push("");
  lines.push("Tests executed: **NO**");
  lines.push("");
  lines.push("This agent only reads and analyzes the repository and generates test artifacts. Run the generated tests yourself (or via CI) to see pass/fail results.");

  return lines.join("\n");
}
