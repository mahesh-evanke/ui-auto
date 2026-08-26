import type { LlmClient } from "../llm/llmClient.js";
import type { ResolvedStep } from "../types.js";
import { getPrompt } from "../promptStore.js";

const MAX_STEPS_PER_CALL = 3;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function generateChunk(client: LlmClient, steps: ResolvedStep[]): Promise<string> {
  const stepList = steps.map((s) => `${s.keyword}: "${s.text}"`).join("\n");
  const userPrompt = `New step definitions needed:
${stepList}

Generate the full TypeScript file now.`;

  const raw = await client.chat(
    [
      { role: "system", content: getPrompt("step-definition-generator.system") },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.1 }
  );

  return stripFences(raw).trim();
}

/**
 * Generates ONE new step-definitions file for a batch of steps that had no
 * reuse match (src/retrieval/stepDefinitionIndex.ts). Split into small
 * chunks (a handful of literal, already-decided step texts per LLM call)
 * rather than one large request - narrowly-scoped generation is far more
 * reliable for a small local model than open-ended spec generation, and
 * batching all steps into a single very large prompt was observed to risk
 * a network-level request failure/timeout on this model.
 */
export async function generateStepDefinitions(client: LlmClient, steps: ResolvedStep[]): Promise<string> {
  const chunks = chunk(steps, MAX_STEPS_PER_CALL);
  // Sequential, not concurrent: a single local Ollama instance processes one
  // generation at a time anyway, so firing chunks concurrently just queues
  // requests behind an open connection - observed in practice to trip
  // "fetch failed" (a connection-level timeout) rather than improving
  // throughput.
  const parts: string[] = [];
  for (const c of chunks) {
    parts.push(await generateChunk(client, c));
  }

  // Keep the first chunk's imports; strip duplicate import lines from the rest.
  const merged = parts
    .map((content, i) => (i === 0 ? content : content.replace(/^import .+$/gm, "").trim()))
    .join("\n\n");

  return merged.trim() + "\n";
}

function stripFences(text: string): string {
  const fenceMatch = text.match(/```(?:ts|typescript|js)?\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1] : text;
}
