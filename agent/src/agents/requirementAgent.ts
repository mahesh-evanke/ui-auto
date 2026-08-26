import type { LlmClient } from "../llm/llmClient.js";
import type { RepoAnalysis, RequirementSet, RequirementSourceInputs } from "../types.js";
import type { FetchedLink } from "../retrieval/linkFetcher.js";
import { getPrompt } from "../promptStore.js";

/**
 * Merges every requirement source the user filled in - a pasted/uploaded
 * document, fetched link text, and free-text notes - into one requirement
 * text, purely by concatenation with clear section headers. No LLM call:
 * this only decides what goes INTO the prompt generateRequirements() sends,
 * it doesn't interpret anything.
 */
export function combineRequirementSources(sources: RequirementSourceInputs, fetchedLinks: FetchedLink[]): string {
  const sections: string[] = [];
  if (sources.documentText?.trim()) {
    sections.push(`=== Requirements document ===\n${sources.documentText.trim()}`);
  }
  for (const link of fetchedLinks) {
    sections.push(`=== From ${link.url} ===\n${link.text}`);
  }
  if (sources.notes?.trim()) {
    sections.push(`=== User notes ===\n${sources.notes.trim()}`);
  }
  return sections.join("\n\n");
}

export async function generateRequirements(
  client: LlmClient,
  requirementText: string,
  analysis: RepoAnalysis
): Promise<RequirementSet> {
  const context = `Project framework: ${analysis.framework}
Language: ${analysis.language}

Feature / rule requested by the user:
"""
${requirementText}
"""

Produce the structured requirements JSON now.`;

  const result = await client.chatJson<RequirementSet>([
    { role: "system", content: getPrompt("requirement-agent.system") },
    { role: "user", content: context },
  ]);

  if (!result.requirements || !Array.isArray(result.requirements) || result.requirements.length === 0) {
    throw new Error("Requirement Agent returned no requirements.");
  }
  return result;
}
