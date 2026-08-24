import type { LlmClient } from "../llm/llmClient.js";
import type { RepoAnalysis, RequirementSet, RequirementSourceInputs } from "../types.js";
import type { FetchedLink } from "../retrieval/linkFetcher.js";

const SYSTEM_PROMPT = `You are the Requirement Agent inside an autonomous QA platform. You convert a
plain-English feature request or business rule into structured, testable requirements.
You do NOT write code. You only produce requirement analysis.

Rules:
- Break the input into distinct, atomic, testable requirements.
- Each requirement gets a unique id like "REQ-001", "REQ-002", incrementing.
- Each requirement needs 2-5 concrete acceptance criteria (things a QA engineer could verify).
- priority is "high", "medium", or "low".
- relatedUi should list plausible UI element/page names mentioned or implied (best guess, short strings).
- NEVER invent a specific email address, password, name, phone number, or other value that looks like a
  real person's credentials or personal data - even as a "realistic example". If the input didn't supply
  one, describe it generically instead ("a valid registered email", "the correct password" ), never a
  concrete-looking string you made up. Only use a specific value if the user's own input literally
  contains it.
- Respond with ONLY a JSON object of this exact shape, no prose:
{
  "requirements": [
    {
      "id": "REQ-001",
      "description": "string",
      "priority": "high" | "medium" | "low",
      "acceptanceCriteria": [ { "id": "AC-001-1", "description": "string" } ],
      "relatedUi": ["string"]
    }
  ]
}`;

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
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: context },
  ]);

  if (!result.requirements || !Array.isArray(result.requirements) || result.requirements.length === 0) {
    throw new Error("Requirement Agent returned no requirements.");
  }
  return result;
}
