import type { LlmClient } from "../llm/llmClient.js";
import type { StepDefinitionEntry, StepIntent } from "../types.js";
import { getPrompt } from "../promptStore.js";

export interface ScenarioStepLine {
  keyword: string;
  text: string;
}

export interface FixerInput {
  scenarioTitle: string;
  originalSteps: ScenarioStepLine[];
  /** The exact step that failed, if cucumber told us which one - unknown for a whole-scenario/framework-level failure. */
  failedStepKeyword?: string;
  failedStepText?: string;
  errorMessage: string;
  catalog: StepDefinitionEntry[];
  uiElements: string;
}


function renderCatalog(catalog: StepDefinitionEntry[]): string {
  if (catalog.length === 0) return "(none available)";
  return catalog.map((s) => `- ${s.keyword} ${s.stepText}`).join("\n");
}

function renderSteps(steps: ScenarioStepLine[]): string {
  return steps.map((s) => `    ${s.keyword} ${s.text}`).join("\n");
}

export async function fixScenarioSteps(client: LlmClient, input: FixerInput): Promise<StepIntent[]> {
  const failedLine =
    input.failedStepKeyword && input.failedStepText
      ? `${input.failedStepKeyword} ${input.failedStepText}`
      : "(the specific failing line wasn't captured - infer from the error message and the full scenario)";

  const userPrompt = `Scenario: ${input.scenarioTitle}

Original steps:
${renderSteps(input.originalSteps)}

Step that failed:
${failedLine}

Error message from the test run:
${input.errorMessage}

AVAILABLE STEPS (reuse these wherever possible):
${renderCatalog(input.catalog)}

UI ELEMENTS that exist in the application under test (use these exact labels):
${input.uiElements || "(none found - use labels from the scenario)"}

Produce the corrected step intents JSON now.`;

  const result = await client.chatJson<{ steps: StepIntent[] }>([
    { role: "system", content: getPrompt("test-fixer.system") },
    { role: "user", content: userPrompt },
  ]);

  return (result.steps ?? []).filter((s) => s.description && s.keyword && s.kind);
}
