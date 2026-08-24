import type { LlmClient } from "../llm/llmClient.js";
import type { Observation, Requirement } from "../types.js";
import type { RetrievedFile } from "../retrieval/codeSearch.js";

const SYSTEM_PROMPT = `You are the Gap Analysis Agent inside an autonomous QA platform. You are given ONE
requirement (with its acceptance criteria) and excerpts of the source files most likely to implement
it, found by searching the target repository. Decide whether the requirement appears to be properly
implemented.

Rules:
- Judge only from the excerpts given - if they don't show enough to tell, that itself is an observation
  ("no code found implementing X" / "couldn't confirm Y from the available source").
- Only report a real gap: something an acceptance criterion calls for that the excerpts contradict, don't
  show, or show incompletely. Do not invent problems in code that looks fine - if everything checks out,
  return an empty observations array. Passing nothing is a valid, common, correct result.
- Each observation: title is a short one-line summary; description explains specifically what's missing
  or wrong and (when possible) which file/acceptance criterion it relates to.
- severity: "high" if the core behavior the requirement describes looks entirely missing or broken,
  "medium" if it's partially there or an edge case is unhandled, "low" for a minor/cosmetic gap.
- Respond with ONLY a JSON object of this exact shape, no prose:
{
  "observations": [
    { "title": "string", "description": "string", "severity": "high" | "medium" | "low" }
  ]
}`;

const LEGACY_ADDENDUM = `
This is a legacy modernization project. You are ALSO given excerpts from the legacy codebase being
replaced - treat the legacy code as the ground truth of what the current system actually does, since the
requirement doc can be incomplete or stale in a way running legacy code isn't. Flag it as an observation
if the new repo's behavior doesn't match what the legacy excerpts show, even if it satisfies the written
requirement text.`;

export interface GapAnalysisInput {
  requirement: Requirement;
  relevantFiles: RetrievedFile[];
  isModernization: boolean;
  legacyExcerpts: RetrievedFile[];
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
    ? `\n\nLEGACY CODEBASE excerpts (ground truth of current behavior):\n${renderExcerpts(input.legacyExcerpts, "legacy")}`
    : "";

  const userPrompt = `Requirement ${input.requirement.id}: ${input.requirement.description}

Acceptance criteria:
${criteria}

TARGET REPOSITORY excerpts (most likely relevant, found by search):
${renderExcerpts(input.relevantFiles, "target repository")}${legacySection}

Produce the observations JSON now.`;

  const result = await client.chatJson<{ observations: { title: string; description: string; severity: Observation["severity"] }[] }>([
    { role: "system", content: SYSTEM_PROMPT + (input.isModernization ? LEGACY_ADDENDUM : "") },
    { role: "user", content: userPrompt },
  ]);

  return (result.observations ?? [])
    .filter((o) => o.title && o.description && o.severity)
    .map((o) => ({ id: nextObservationId(), requirementId: input.requirement.id, ...o }));
}
