import type { LlmClient } from "../llm/llmClient.js";
import type { RequirementSet, TestPlan, TestPlanItem, TestScope } from "../types.js";
import type { RetrievedFile } from "../retrieval/codeSearch.js";

const SCENARIO_CATEGORIES = [
  "happy path", "alternative path", "validation", "boundary cases", "empty states",
  "loading states", "error states", "network failures", "authentication/authorization",
  "duplicate actions", "refresh behavior", "navigation behavior", "accessibility",
  "keyboard interaction", "mobile viewport", "desktop viewport", "regression",
];

const SCOPE_GUIDANCE: Record<TestScope, string> = {
  web: `Scope: UI only. Every scenario description must be about what happens on screen -
what's visible, clickable, or navigable. Do not describe backend requests, status codes,
or response bodies; there is no API testing here.`,
  api: `Scope: API only. Every scenario description must be about a backend request and its
response - status codes, response fields, error responses. Do not describe screens,
clicks, or anything about the UI; there is no browser interaction here.`,
  both: `Scope: end-to-end. Write each scenario as the real sequence a user's flow produces -
a UI action that would trigger a backend call, followed by what that call returns, then
the UI continuing from there (e.g. filling a login form and clicking Login, followed by
the login request succeeding, followed by landing on the next screen and triggering the
next request). Describe that sequence in the scenario text so the step planner downstream
can turn it into alternating UI-then-API steps.`,
};

function systemPrompt(scope: TestScope): string {
  return `You are the Test Planning Agent inside an autonomous QA platform. Given one
requirement and relevant existing source files, decide which of the following test scenario
categories apply, and write concrete scenario descriptions a QA engineer/Playwright test could
implement: ${SCENARIO_CATEGORIES.join(", ")}.

${SCOPE_GUIDANCE[scope]}

Only pick categories that genuinely apply to this requirement - do not force all of them.
You do not write code. You only plan.

Respond with ONLY a JSON object of this exact shape, no prose:
{
  "scenarios": [
    { "id": "SC-1", "category": "happy path", "description": "string" }
  ]
}`;
}

export async function planTestsForRequirement(
  client: LlmClient,
  requirementId: string,
  requirementDescription: string,
  acceptanceCriteria: string[],
  relevantFiles: RetrievedFile[],
  scope: TestScope = "both"
): Promise<TestPlanItem> {
  const filesSummary = relevantFiles
    .map((f) => `- ${f.path} (${f.kind})\n  excerpt:\n  ${f.excerpt.slice(0, 500).replace(/\n/g, "\n  ")}`)
    .join("\n\n");

  const userPrompt = `Requirement ${requirementId}: ${requirementDescription}

Acceptance criteria:
${acceptanceCriteria.map((c) => `- ${c}`).join("\n")}

Relevant existing files found by search:
${filesSummary || "(none found)"}

Produce the scenario JSON now.`;

  const result = await client.chatJson<{ scenarios: TestPlanItem["scenarios"] }>([
    { role: "system", content: systemPrompt(scope) },
    { role: "user", content: userPrompt },
  ]);

  return {
    requirementId,
    relevantFiles: relevantFiles.map((f) => f.path),
    scenarios: result.scenarios ?? [],
  };
}

export async function buildTestPlan(
  client: LlmClient,
  requirements: RequirementSet,
  fileLookup: (req: { id: string; description: string }) => RetrievedFile[],
  scope: TestScope = "both"
): Promise<TestPlan> {
  const items: TestPlanItem[] = [];
  for (const req of requirements.requirements) {
    const relevant = fileLookup(req);
    const item = await planTestsForRequirement(
      client,
      req.id,
      req.description,
      req.acceptanceCriteria.map((c) => c.description),
      relevant,
      scope
    );
    items.push(item);
  }
  return { items };
}
