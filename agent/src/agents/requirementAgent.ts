import type { LlmClient } from "../llm/llmClient.js";
import type { RepoAnalysis, RequirementSet } from "../types.js";

const SYSTEM_PROMPT = `You are the Requirement Agent inside an autonomous QA platform. You convert a
plain-English feature request or business rule into structured, testable requirements.
You do NOT write code. You only produce requirement analysis.

Rules:
- Break the input into distinct, atomic, testable requirements.
- Each requirement gets a unique id like "REQ-001", "REQ-002", incrementing.
- Each requirement needs 2-5 concrete acceptance criteria (things a QA engineer could verify).
- priority is "high", "medium", or "low".
- relatedUi should list plausible UI element/page names mentioned or implied (best guess, short strings).
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
