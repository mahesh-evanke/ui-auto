import type { LlmClient } from "../llm/llmClient.js";
import type { GeneratedScenarioSteps, GeneratedSpec, RepoAnalysis, RequirementSet } from "../types.js";
import { getPrompt } from "../promptStore.js";

export async function generatePlaywrightSpec(
  client: LlmClient,
  feature: string,
  requirements: RequirementSet,
  scenarioSteps: GeneratedScenarioSteps[],
  analysis: RepoAnalysis,
  relevantFileExcerpts: string
): Promise<GeneratedSpec> {
  const scenarioBlocks = scenarioSteps
    .map((s) => {
      const req = requirements.requirements.find((r) => r.id === s.requirementId);
      const stepLines = s.steps.map((st) => `    - ${st.keyword} ${st.text}${st.reused ? " (matches an existing convention)" : ""}`).join("\n");
      return `${s.requirementId} / ${s.scenarioId}: ${s.title}${req ? `\n  Requirement: ${req.description}` : ""}\n  Steps:\n${stepLines}`;
    })
    .join("\n\n");

  const userPrompt = `Feature under test: ${feature}
Framework: ${analysis.framework}

Scenarios and their already-decided steps:
${scenarioBlocks}

Relevant existing files in the repository (for selector/pattern grounding):
${relevantFileExcerpts || "(none found)"}

Generate the full Playwright spec file now.`;

  const raw = await client.chat(
    [
      { role: "system", content: getPrompt("spec-generator.system") },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.15 }
  );

  const content = stripFences(raw).trim() + "\n";
  const safeName = feature
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "generated-feature";

  return { fileName: `${safeName}.spec.ts`, content };
}

function stripFences(text: string): string {
  const fenceMatch = text.match(/```(?:ts|typescript|js)?\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1] : text;
}
