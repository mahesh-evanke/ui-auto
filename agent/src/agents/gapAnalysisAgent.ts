import type { LlmClient } from "../llm/llmClient.js";
import type { Observation, Requirement } from "../types.js";
import type { RetrievedFile } from "../retrieval/codeSearch.js";
import { getPrompt } from "../promptStore.js";

export interface GapAnalysisInput {
  requirement: Requirement;
  relevantFiles: RetrievedFile[];
  isModernization: boolean;
  legacyExcerpts: RetrievedFile[];
  /** Free text describing the legacy system (doc/links/notes the user gave for it) - separate from the code excerpts above. */
  legacyContextText?: string;
}

function renderExcerpts(files: RetrievedFile[], label: string): string {
  if (files.length === 0) return `(no ${label} files found for this requirement)`;
  return files.map((f) => `--- ${f.path} ---\n${f.excerpt.slice(0, 1200)}`).join("\n\n");
}

let idCounter = 0;
function nextObservationId(): string {
  idCounter += 1;
  return `OBS-${String(idCounter).padStart(3, "0")}`;
}

export async function analyzeRequirementGap(client: LlmClient, input: GapAnalysisInput): Promise<Observation[]> {
  const criteria = input.requirement.acceptanceCriteria.map((c) => `- ${c.description}`).join("\n");
  const legacySection = input.isModernization
    ? `\n\nLEGACY CODEBASE excerpts (ground truth of current behavior):\n${renderExcerpts(input.legacyExcerpts, "legacy")}${
        input.legacyContextText?.trim()
          ? `\n\nLEGACY SYSTEM context (doc/notes describing the legacy system, provided by the user):\n${input.legacyContextText.trim()}`
          : ""
      }`
    : "";

  const userPrompt = `Requirement ${input.requirement.id}: ${input.requirement.description}

Acceptance criteria:
${criteria}

TARGET REPOSITORY excerpts (most likely relevant, found by search):
${renderExcerpts(input.relevantFiles, "target repository")}${legacySection}

Produce the observations JSON now.`;

  const systemPrompt = getPrompt("gap-analysis.system");
  const legacyAddendum = input.isModernization ? getPrompt("gap-analysis.legacy-addendum") : "";

  const result = await client.chatJson<{ observations: { title: string; description: string; severity: Observation["severity"] }[] }>([
    { role: "system", content: systemPrompt + legacyAddendum },
    { role: "user", content: userPrompt },
  ]);

  return (result.observations ?? [])
    .filter((o) => o.title && o.description && o.severity)
    .map((o) => ({ id: nextObservationId(), requirementId: input.requirement.id, ...o }));
}
