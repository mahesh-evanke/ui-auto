import type { OllamaClient } from "../llm/ollamaClient.js";
import type { GeneratedScenarioSteps, GeneratedSpec, RepoAnalysis, RequirementSet } from "../types.js";

const SYSTEM_PROMPT = `You are a Test Generation Agent. You generate a single Playwright end-to-end
test spec file (TypeScript, using @playwright/test) that will verify an ALREADY-IMPLEMENTED
feature. You do NOT implement, run, or fix application code, and you never open a browser
yourself - you only write the test file's source code for someone else to run later.

Rules:
- Use "import { test, expect } from '@playwright/test';" at the top.
- Use page.goto('/') or relative paths - the baseURL is configured externally, do not hardcode a host.
- Prefer resilient locators: getByRole, getByLabel, getByText, getByTestId. Avoid brittle CSS selectors when a semantic one is plausible.
- Write one test() per scenario, grouped with test.describe() per requirement, using the already-decided step list (as comments plus corresponding Playwright actions/assertions) provided below - do not invent different steps.
- Include a comment mapping each test back to its requirement id and scenario id, e.g. "// REQ-001 / SC-1".
- Base selectors on the provided relevant file excerpts (existing page objects/components/fixtures) when available - reuse an existing pattern rather than guessing a new one.
- Output ONLY the raw TypeScript file content. No markdown fences, no prose before or after.`;

export async function generatePlaywrightSpec(
  client: OllamaClient,
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
      { role: "system", content: SYSTEM_PROMPT },
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
