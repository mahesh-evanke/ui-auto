import type { LlmClient } from "../llm/llmClient.js";
import type { StepDefinitionEntry, StepIntent } from "../types.js";

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

const SYSTEM_PROMPT = `A generated Gherkin scenario just ran against the real, live application and one of
its steps failed. You are given the original steps, which one failed, and the real error message the
test runner produced. Diagnose the likely cause and produce a corrected, COMPLETE replacement list of
steps for the whole scenario - not just the failed line, since an early wrong step (a wrong element name,
a missing precondition) often explains everything after it too.

Common causes, in rough order of likelihood:
- A quoted literal (a button label, field name, or expected text) doesn't match what's actually on the
  page - e.g. "Text not found on screen: X" means X is wrong, not that the page is broken. If you don't
  know the correct value from the UI ELEMENTS list, prefer a broader, safer assertion the AVAILABLE STEPS
  can express (e.g. checking the URL changed, or a heading that IS in the UI ELEMENTS list) rather than
  guessing another specific string that's equally likely to be wrong.
- Steps out of logical order - an action's precondition (navigating, filling a field) is missing or
  comes after the thing that depends on it.
- "no matching step definition" - the original step's wording doesn't match anything in AVAILABLE STEPS
  closely enough; copy an available step's wording exactly instead.
- A step that needs something (an API request, a screen) that a prior step never set up.

Rules (same as normal generation):
- Use ONLY element labels from the UI ELEMENTS list. Never invent one.
- STRONGLY PREFER an available step, copied exactly, with {string}/{int} placeholders replaced by
  concrete quoted values.
- Put every literal UI label, field name, or expected text in double quotes.
- keyword: "Given" for setup/navigation, "When" for user actions, "Then" for assertions.
- 2-6 steps. If you cannot diagnose a plausible fix at all, return the original steps unchanged rather
  than guessing randomly.
- Respond with ONLY a JSON object of this exact shape, no prose:
{
  "steps": [
    { "description": "string", "keyword": "Given" | "When" | "Then", "kind": "ui" | "api" }
  ]
}`;

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
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);

  return (result.steps ?? []).filter((s) => s.description && s.keyword && s.kind);
}
