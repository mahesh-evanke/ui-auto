import type { LlmClient } from "../llm/llmClient.js";
import type { StepDefinitionEntry, StepIntent, TestScenario } from "../types.js";

const SYSTEM_PROMPT = `You break a single QA test scenario down into an ordered list of short step
intents - the individual actions/assertions a Gherkin scenario would perform, one per step.

You are given a list of AVAILABLE STEPS that the test framework already implements,
and a list of UI ELEMENTS that actually exist in the application under test.

Rules:
- Use ONLY element labels from the UI ELEMENTS list. Never invent an element name.
  If the list is empty, use labels taken verbatim from the scenario description.
- STRONGLY PREFER an available step. Copy its wording exactly, replacing each {string}
  placeholder with a concrete value in double quotes and each {int} with a number.
  Example: available step \`User clicks on {string} button\` with the Save button
  becomes: User clicks on "Save" button
- Only invent a new phrase if NO available step can express the action. Inventing a step
  that duplicates an available one is a mistake.
- Put every literal UI label, field name, or expected text in double quotes. This is
  required, not optional - unquoted literals cannot be matched later.
- keyword: "Given" for setup/navigation, "When" for user actions, "Then" for assertions.
- kind: "api" only if the step is explicitly about a backend/API request or response; otherwise "ui".
- 2-6 steps per scenario. Do not pad with irrelevant steps.
- Respond with ONLY a JSON object of this exact shape, no prose:
{
  "steps": [
    { "description": "string", "keyword": "Given" | "When" | "Then", "kind": "ui" | "api" }
  ]
}`;

function renderCatalog(catalog: StepDefinitionEntry[]): string {
  if (catalog.length === 0) return "(none available - write plain descriptive steps)";
  return catalog.map((s) => `- ${s.keyword} ${s.stepText}`).join("\n");
}

/**
 * `catalog` is the shortlist of steps the framework already implements (see
 * retrieval/stepDefinitionIndex.ts's shortlistSteps). Showing it to the model
 * up front is what drives reuse - relying only on post-hoc token matching
 * produced mostly invented prose that no step definition could satisfy.
 */
export async function planStepIntents(
  client: LlmClient,
  scenario: TestScenario,
  catalog: StepDefinitionEntry[] = [],
  uiElements = ""
): Promise<StepIntent[]> {
  const userPrompt = `AVAILABLE STEPS (reuse these wherever possible):
${renderCatalog(catalog)}

UI ELEMENTS that exist in the application under test (use these exact labels):
${uiElements || "(none found - use labels from the scenario description)"}

Scenario [${scenario.category}]: ${scenario.description}

Produce the step intents JSON now, reusing the available steps above wherever they fit
and referring only to the UI elements listed.`;

  const result = await client.chatJson<{ steps: StepIntent[] }>([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);

  return (result.steps ?? [])
    .filter((s) => s.description && s.keyword && s.kind)
    .map((s) => ({ ...s, description: stripLeadingKeyword(s.description) }))
    .filter((s) => s.description.length > 0);
}

/**
 * The model frequently copies a catalog line including its `Given`/`When`/
 * `Then` prefix. The renderer prepends the keyword itself, so leaving it in
 * produces invalid Gherkin like `Then Then User expects status code 200` -
 * and it also pollutes the tokens used for reuse matching.
 */
function stripLeadingKeyword(description: string): string {
  return description.replace(/^\s*(?:(?:Given|When|Then|And|But)\s+)+/i, "").trim();
}
