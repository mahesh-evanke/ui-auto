import type { ScenarioStepLine } from "../agents/testFixerAgent.js";

const SCENARIO_RE = /^\s*Scenario(?: Outline)?:\s*(.+?)\s*$/;
const STEP_RE = /^\s*(Given|When|Then|And|But)\s+.+$/;

interface ScenarioSpan {
  title: string;
  /** Index of the "Scenario:" line itself. */
  headerLine: number;
  /** First line index (inclusive) of this scenario's own step lines. */
  stepStart: number;
  /**
   * Last line index (exclusive) of the CONTIGUOUS run of step lines
   * immediately after the header - not the next Scenario/Feature line.
   * gherkinGeneratorAgent.ts always writes steps back-to-back with no blank
   * lines between them, then one blank line before the next scenario -
   * stopping at the first non-step line keeps that blank line, and the next
   * scenario's own comment header, out of this span entirely. Splicing the
   * wider "up to the next Scenario:" span instead was deleting both.
   */
  stepEnd: number;
}

function findScenarios(lines: string[]): ScenarioSpan[] {
  const spans: ScenarioSpan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SCENARIO_RE);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && STEP_RE.test(lines[end])) end++;
    spans.push({ title: m[1], headerLine: i, stepStart: i + 1, stepEnd: end });
  }
  return spans;
}

/**
 * Rewrites ONE scenario's step lines in place - everything else in the
 * .feature (its title comment, other scenarios, blank-line spacing) is left
 * byte-for-byte untouched. Matches by exact scenario title, same as how
 * gherkinGeneratorAgent.ts writes it (`Scenario: ${scenario.title}`), so a
 * title collision between two scenarios would rewrite the first match only -
 * acceptable here since the run result being corrected was itself matched by
 * this same title from cucumber's own JSON report.
 */
export function replaceScenarioSteps(featureContent: string, scenarioTitle: string, newSteps: ScenarioStepLine[]): string {
  const lines = featureContent.split(/\r?\n/);
  const span = findScenarios(lines).find((s) => s.title === scenarioTitle);
  if (!span) return featureContent;

  const rendered = newSteps.map((s) => `    ${s.keyword} ${s.text}`);
  lines.splice(span.stepStart, span.stepEnd - span.stepStart, ...rendered);
  return lines.join("\n");
}

/** The Gherkin step lines currently under one scenario, keyword split from text - what the fixer needs as "original steps". */
export function getScenarioSteps(featureContent: string, scenarioTitle: string): ScenarioStepLine[] {
  const lines = featureContent.split(/\r?\n/);
  const span = findScenarios(lines).find((s) => s.title === scenarioTitle);
  if (!span) return [];

  const steps: ScenarioStepLine[] = [];
  for (let i = span.stepStart; i < span.stepEnd; i++) {
    const m = lines[i].match(STEP_RE);
    if (!m) continue;
    const trimmed = lines[i].trim();
    const keyword = m[1];
    steps.push({ keyword, text: trimmed.slice(keyword.length).trim() });
  }
  return steps;
}

/** Every scenario title currently in the feature - used to sanity-check that a "fixed" title still exists before trying to edit it. */
export function listScenarioTitles(featureContent: string): string[] {
  return findScenarios(featureContent.split(/\r?\n/)).map((s) => s.title);
}
