import type { OllamaClient } from "../llm/ollamaClient.js";
import type { RequirementSet, TestPlan, TestPlanItem } from "../types.js";
import type { RetrievedFile } from "../retrieval/codeSearch.js";

const SCENARIO_CATEGORIES = [
  "happy path", "alternative path", "validation", "boundary cases", "empty states",
  "loading states", "error states", "network failures", "authentication/authorization",
  "duplicate actions", "refresh behavior", "navigation behavior", "accessibility",
  "keyboard interaction", "mobile viewport", "desktop viewport", "regression",
];

const SYSTEM_PROMPT = `You are the Test Planning Agent inside an autonomous QA platform. Given one
requirement and relevant existing source files, decide which of the following test scenario
categories apply, and write concrete scenario descriptions a QA engineer/Playwright test could
implement: ${SCENARIO_CATEGORIES.join(", ")}.

Only pick categories that genuinely apply to this requirement - do not force all of them.
You do not write code. You only plan.

Respond with ONLY a JSON object of this exact shape, no prose:
{
  "scenarios": [
    { "id": "SC-1", "category": "happy path", "description": "string" }
  ]
}`;

export async function planTestsForRequirement(
  client: OllamaClient,
  requirementId: string,
  requirementDescription: string,
  acceptanceCriteria: string[],
  relevantFiles: RetrievedFile[]
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
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);

  return {
    requirementId,
    relevantFiles: relevantFiles.map((f) => f.path),
    scenarios: result.scenarios ?? [],
  };
}

export async function buildTestPlan(
  client: OllamaClient,
  requirements: RequirementSet,
  fileLookup: (req: { id: string; description: string }) => RetrievedFile[]
): Promise<TestPlan> {
  const items: TestPlanItem[] = [];
  for (const req of requirements.requirements) {
    const relevant = fileLookup(req);
    const item = await planTestsForRequirement(
      client,
      req.id,
      req.description,
      req.acceptanceCriteria.map((c) => c.description),
      relevant
    );
    items.push(item);
  }
  return { items };
}
