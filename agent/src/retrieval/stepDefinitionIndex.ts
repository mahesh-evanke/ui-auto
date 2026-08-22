import { extractSteps } from "../agents/referenceFrameworkAgent.js";
import type { RepoAnalysis, ResolvedStep, StepDefinitionEntry, StepIntent, TargetFrameworkAnalysis } from "../types.js";

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "should", "with", "user"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\{[a-z]+\}/g, "") // strip Cucumber expression placeholders like {string}/{int}
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Builds the combined reuse vocabulary: the reference framework's step
 * vocabulary plus the target repo's own existing step definitions (if it
 * already has Cucumber tests). Both sources are scanned deterministically
 * (src/agents/referenceFrameworkAgent.ts's regex extractor).
 */
export function indexTargetRepoSteps(analysis: RepoAnalysis, target: TargetFrameworkAnalysis): StepDefinitionEntry[] {
  const steps: StepDefinitionEntry[] = [];
  for (const relPath of target.existingStepDefFiles) {
    const abs = `${analysis.rootDir}/${relPath}`;
    const kind: "ui" | "api" = /\bapi\b/i.test(relPath) ? "api" : "ui";
    steps.push(...extractSteps(abs, kind));
  }
  return steps;
}

/**
 * The highest-scoring existing steps for a scenario, used to SHOW the model
 * the vocabulary it should be picking from before it writes any step text.
 *
 * Matching after the fact (findReusableStep below) can only rescue phrasing
 * that already happens to overlap; giving the model the real catalog up front
 * is what actually makes it reuse the framework's steps instead of inventing
 * prose like "The profile page is displayed". Core navigation/assertion steps
 * are always included since almost every scenario needs them but their
 * wording rarely overlaps a scenario description's tokens.
 */
export function shortlistSteps(text: string, index: StepDefinitionEntry[], limit = 24): StepDefinitionEntry[] {
  const tokens = new Set(tokenize(text));
  const scored = index
    .map((entry) => {
      const entryTokens = new Set(tokenize(entry.stepText));
      const overlap = [...tokens].filter((t) => entryTokens.has(t)).length;
      return { entry, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap);

  const picked: StepDefinitionEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: StepDefinitionEntry) => {
    if (seen.has(entry.stepText)) return;
    seen.add(entry.stepText);
    picked.push(entry);
  };

  const ALWAYS = [/navigates to \{string\} URL/i, /is on \{string\} screen/i, /clicks on \{string\} button/i, /text is present on the screen/i];
  for (const pattern of ALWAYS) {
    const hit = index.find((e) => pattern.test(e.stepText));
    if (hit) add(hit);
  }
  for (const { entry } of scored) {
    if (picked.length >= limit) break;
    add(entry);
  }
  return picked;
}

const PLACEHOLDER_RE = /\{(string|int|word|float)\}/g;

/**
 * A matched step template like `User clicks on {string} button` still has
 * Cucumber-expression placeholders in it - not valid Gherkin on its own.
 * stepIntentAgent.ts is prompted to quote every literal value in its step
 * descriptions specifically so they can be extracted here, in order, and
 * substituted into the template's placeholders. If there aren't enough
 * quoted values to fill every placeholder, filling is refused (returns
 * null) rather than emitting a step with a literal "{string}" left in it -
 * the caller then falls back to generating a brand-new step instead.
 */
function fillStepTemplate(template: string, description: string): string | null {
  const placeholders = template.match(PLACEHOLDER_RE) ?? [];
  if (placeholders.length === 0) return template;

  const quoted = [...description.matchAll(/"([^"]+)"|'([^']+)'/g)].map((m) => m[1] ?? m[2]);
  if (quoted.length < placeholders.length) return null;

  let i = 0;
  return template.replace(PLACEHOLDER_RE, (_match, kind: string) => {
    const value = quoted[i++];
    return kind === "string" ? `"${value}"` : value;
  });
}

/**
 * Token-overlap scoring (same approach as src/retrieval/codeSearch.ts) to
 * find an existing step that already covers a needed intent - deterministic,
 * not LLM-based, so results are reproducible and don't hallucinate a match
 * that doesn't really exist. Returns the step with placeholders already
 * filled in (see fillStepTemplate) - never a raw unfilled template.
 */
/**
 * Reduces a step to its structural shape by collapsing every concrete value
 * (quoted literal, bare number) and every Cucumber placeholder to a single
 * marker, so `User clicks on "Save" button` and the template
 * `User clicks on {string} button` compare equal.
 */
function normalizeToShape(text: string): string {
  return text
    .replace(/\{(string|int|word|float)\}/g, "{}")
    .replace(/"[^"]*"/g, "{}")
    .replace(/'[^']*'/g, "{}")
    .replace(/\b\d+(?:\.\d+)?\b/g, "{}")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function findReusableStep(intent: StepIntent, index: StepDefinitionEntry[], minScore = 2): ResolvedStep | null {
  const intentTokens = new Set(tokenize(intent.description));
  if (intentTokens.size === 0) return null;

  // Fast path: the model is shown the real step catalog (see shortlistSteps)
  // and asked to copy a step verbatim with values substituted. When it does,
  // the shapes match exactly - a definite reuse that token scoring might
  // otherwise rank below some longer, noisier step.
  const intentShape = normalizeToShape(intent.description);
  const exact = index.find((entry) => entry.kind === intent.kind && normalizeToShape(entry.stepText) === intentShape);
  if (exact) {
    // If the model echoed the template without substituting, fill it properly
    // rather than emitting a literal "{string}" into the .feature file.
    const text = /\{(string|int|word|float)\}/.test(intent.description)
      ? fillStepTemplate(exact.stepText, intent.description)
      : intent.description;
    if (text !== null) {
      return { text, keyword: exact.keyword, reused: true, sourceFile: exact.sourceFile };
    }
  }

  const scored = index
    .filter((entry) => entry.kind === intent.kind)
    .map((entry) => {
      const entryTokens = new Set(tokenize(entry.stepText));
      const overlap = [...intentTokens].filter((t) => entryTokens.has(t)).length;
      return { entry, overlap };
    })
    .filter((s) => s.overlap >= minScore)
    .sort((a, b) => b.overlap - a.overlap);

  for (const { entry } of scored) {
    const filled = fillStepTemplate(entry.stepText, intent.description);
    if (filled !== null) {
      return { text: filled, keyword: entry.keyword, reused: true, sourceFile: entry.sourceFile };
    }
    // Best-scoring template couldn't be filled (not enough quoted values in
    // the description) - try the next-best match rather than giving up.
  }
  return null;
}
