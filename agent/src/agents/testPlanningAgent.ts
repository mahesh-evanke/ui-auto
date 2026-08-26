import type { LlmClient } from "../llm/llmClient.js";
import type { RequirementSet, TestPlan, TestPlanItem, TestScope } from "../types.js";
import type { RetrievedFile } from "../retrieval/codeSearch.js";
import { getPrompt } from "../promptStore.js";

function systemPrompt(scope: TestScope): string {
  const template = getPrompt("test-planning.template");
  const categories = getPrompt("test-planning.categories");
  const scopeGuidance = getPrompt(`test-planning.scope-${scope}`);
  return template.replace("{{categories}}", categories).replace("{{scopeGuidance}}", scopeGuidance);
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
