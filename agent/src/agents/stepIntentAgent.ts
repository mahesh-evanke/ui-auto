import type { LlmClient } from "../llm/llmClient.js";
import type { StepDefinitionEntry, StepIntent, TestScenario, TestScope } from "../types.js";

const COMMON_RULES = `Rules:
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
- 2-6 steps per scenario. Do not pad with irrelevant steps.
- Respond with ONLY a JSON object of this exact shape, no prose:
{
  "steps": [
    { "description": "string", "keyword": "Given" | "When" | "Then", "kind": "ui" | "api" }
  ]
}`;

const SCOPE_RULES: Record<TestScope, string> = {
  web: `- This is a UI-ONLY scenario. Every step's kind MUST be "ui". Never emit an "api" step,
  even if the action would realistically also fire a backend request - describe only what
  happens on screen (clicks, navigation, visible text).`,
  api: `- This is an API-ONLY scenario. Every step's kind MUST be "api" - requests and their
  responses (status codes, response fields). Do not describe clicking, navigating, or
  anything about what's visible on screen; there is no browser interaction here.`,
  both: `- This scenario spans UI and API: describe the real sequence a user's flow produces,
  in order. A UI action that would trigger a backend call ("clicks Login", "submits the
  form") is followed immediately by the "api" step asserting that call's result (status
  code / response field), THEN the UI continues from there (the next screen, the next
  trigger). Interleave kind "ui" and "api" steps in that trigger-then-assert order - do not
  group all UI steps first and all API steps last, and do not put every scenario's API
  assertion in a separate scenario from its trigger.`,
};

function systemPrompt(scope: TestScope): string {
  return `You break a single QA test scenario down into an ordered list of short step
intents - the individual actions/assertions a Gherkin scenario would perform, one per step.

You are given a list of AVAILABLE STEPS that the test framework already implements,
and a list of UI ELEMENTS that actually exist in the application under test.

${COMMON_RULES}
${SCOPE_RULES[scope]}`;
}

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
  uiElements = "",
  scope: TestScope = "both"
): Promise<StepIntent[]> {
  const userPrompt = `AVAILABLE STEPS (reuse these wherever possible):
${renderCatalog(catalog)}

UI ELEMENTS that exist in the application under test (use these exact labels):
${uiElements || "(none found - use labels from the scenario description)"}

Scenario [${scenario.category}]: ${scenario.description}

Produce the step intents JSON now, reusing the available steps above wherever they fit
and referring only to the UI elements listed.`;

  const result = await client.chatJson<{ steps: StepIntent[] }>([
    { role: "system", content: systemPrompt(scope) },
    { role: "user", content: userPrompt },
  ]);

  return (result.steps ?? [])
    .filter((s) => s.description && s.keyword && s.kind)
    .map((s) => ({ ...s, description: stripLeadingKeyword(s.description) }))
    // Belt and suspenders alongside the prompt rule above: a "web"/"api"
    // scope scenario that the model mis-kinds would otherwise slip an
    // out-of-scope step past shortlistSteps' catalog filtering (which only
    // narrows what's OFFERED, not what the model can still claim as kind).
    .filter((s) => scope === "both" || s.kind === (scope === "web" ? "ui" : "api"))
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
