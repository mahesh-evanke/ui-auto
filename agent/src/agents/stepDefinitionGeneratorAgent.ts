import type { OllamaClient } from "../llm/ollamaClient.js";
import type { ResolvedStep } from "../types.js";

const SYSTEM_PROMPT = `You write NEW Cucumber step definitions in TypeScript, using @cucumber/cucumber's
Given/When/Then and Playwright's page API. These are brand-new step definitions for literal step
text that has no existing equivalent - you are NOT modifying any existing file, this is a
standalone new file.

Every step MUST be registered as a TOP-LEVEL call to Given/When/Then - never wrapped inside any
other function. Follow this exact pattern for every step, changing only the step text and body:

import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

Given('the profile page is displayed', async function (this: any) {
  await this.page.goto(new URL('/profile', process.env.TESTPILOT_BASE_URL).toString());
});

Then('a "Save" button is visible', async function (this: any) {
  await expect(this.page.getByRole('button', { name: 'Save' })).toBeVisible();
});

Rules:
- "this.page" is the Cucumber World's Playwright Page - only real Playwright/@playwright/test APIs exist (page.goto, page.click, page.fill, page.getByRole/getByLabel/getByText/getByPlaceholder, expect(locator).toBeVisible()/toHaveText()/toBeEnabled() etc.). Do not invent methods like toHaveButton or waitForText - they do not exist.
- Any step that navigates MUST build its URL as new URL('<path>', process.env.TESTPILOT_BASE_URL).toString() - never a bare relative path, and never a hardcoded host - the base URL is provided at run time by whoever runs these tests, not known when this file is written.
- Register each step with its EXACT literal text as given (do not add {string}/{int} placeholders - these are one-off literal steps, not reusable templates).
- Prefer getByRole/getByLabel/getByText/getByPlaceholder locators over raw CSS/XPath.
- For "Given"/"When" steps describing an action (click, fill, select, check), perform that action on the page.
- For "Then" steps describing a verification, use expect(...) assertions.
- Do not implement anything beyond what the step text describes. No unrelated helper functions, no wrapper functions, no duplicate registrations.
- Output ONLY the raw TypeScript file content. No markdown fences, no prose before or after.`;

const MAX_STEPS_PER_CALL = 3;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function generateChunk(client: OllamaClient, steps: ResolvedStep[]): Promise<string> {
  const stepList = steps.map((s) => `${s.keyword}: "${s.text}"`).join("\n");
  const userPrompt = `New step definitions needed:
${stepList}

Generate the full TypeScript file now.`;

  const raw = await client.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
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
export async function generateStepDefinitions(client: OllamaClient, steps: ResolvedStep[]): Promise<string> {
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
