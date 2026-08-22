import type { GeneratedScenarioSteps, RequirementSet } from "../types.js";

/**
 * Purely deterministic formatting - by the time this runs, every step's text
 * has already been decided (reused verbatim from an existing step
 * definition, or handed off to stepDefinitionGeneratorAgent.ts for a new
 * one), so there is nothing left for an LLM to get wrong here.
 */
export function generateFeatureFile(featureTitle: string, requirements: RequirementSet, scenarios: GeneratedScenarioSteps[]): string {
  const lines: string[] = [];
  lines.push(`Feature: ${featureTitle}`);
  lines.push("");

  // A Scenario with no steps is invalid Gherkin and can never pass, so a
  // scenario the planner produced no usable steps for is dropped rather than
  // written out as an empty block.
  for (const scenario of scenarios.filter((s) => s.steps.length > 0)) {
    const req = requirements.requirements.find((r) => r.id === scenario.requirementId);
    lines.push(`  # ${scenario.requirementId} / ${scenario.scenarioId}${req ? ` - ${req.description}` : ""}`);
    lines.push(`  Scenario: ${scenario.title}`);
    for (const step of scenario.steps) {
      lines.push(`    ${step.keyword} ${step.text}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
