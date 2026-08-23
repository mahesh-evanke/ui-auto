import fs from "node:fs";
import path from "node:path";
import type { CandidateFile } from "../types.js";

export interface RetrievedFile {
  path: string;
  kind: CandidateFile["kind"];
  score: number;
  excerpt: string;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "must",
  "should", "when", "it", "this", "that", "with", "be", "must", "show", "user",
]);

/**
 * Plain token-overlap has zero synonym awareness, so a requirement written
 * as "sign-in page" scores near-zero against code that calls the same thing
 * "login" - "sign" and "in" don't share a single token with "login". That
 * mismatch was observed starving out the actual login form file in favor of
 * unrelated files that merely repeat "password"/"email" more often. These
 * are the handful of auth-flow synonym pairs common enough across
 * frameworks/starters to be worth normalizing before tokens are ever split,
 * applied identically to both the query and the file text being scored.
 */
const PHRASE_SYNONYMS: [RegExp, string][] = [
  [/sign[\s-]?in/gi, "login"],
  [/log[\s-]?in/gi, "login"],
  [/sign[\s-]?up/gi, "register"],
  [/sign[\s-]?out/gi, "logout"],
  [/log[\s-]?out/gi, "logout"],
];

function normalizeSynonyms(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PHRASE_SYNONYMS) out = out.replace(pattern, replacement);
  return out;
}

function tokenize(text: string): string[] {
  return normalizeSynonyms(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Only retrieval/uiElements.ts reads the full excerpt (testPlanningAgent and
// specGeneratorAgent both re-slice to ~400-500 chars regardless), so this
// mainly trades a bit more UI-element extraction coverage for prompt size,
// not a blanket increase to every downstream prompt.
const MAX_EXCERPT_CHARS = 2200;
const MAX_FILE_READ_BYTES = 200_000;

/** Opening tags of anything a test would actually click/fill/read - both plain HTML and PascalCase component-library wrappers (shadcn/ui, MUI, etc all use these names). */
const UI_MARKER_RE = /<(button|input|select|textarea|label|a|Button|Input|Select|TextArea|Label|Link)\b/;

/**
 * A naive prefix slice silently loses relevant content in any file where
 * imports, layout wrappers, or decorative markup (a large inline icon,
 * boilerplate JSDoc) precede the actual interactive elements - observed
 * hiding a real login form's Email/Password/Sign In behind ~900 characters
 * of card/header markup that came first in source order. Instead, window
 * the excerpt around the first interactive-element tag found, with a little
 * lead-in for context, so the part of the file worth reading is what
 * actually survives truncation. Falls back to a plain prefix slice for
 * files with no such tags (there's nothing better to center on).
 */
function excerptAround(content: string, maxChars: number): string {
  const match = UI_MARKER_RE.exec(content);
  if (!match) return content.slice(0, maxChars);
  const start = Math.max(0, match.index - 200);
  return content.slice(start, start + maxChars);
}

/**
 * Strips inline SVG markup before excerpting. An icon library's inline
 * `<svg>` (a Google-logo button icon, say) is pure decorative path data with
 * no testable UI text in it - but it can easily be several hundred
 * characters, and since the excerpt is a naive prefix slice, one large icon
 * near the top of a file can consume the entire budget and push the actual
 * form fields/button text (further down) out of the window entirely. This
 * was observed hiding a real login form's Email/Password/Sign In elements
 * behind a Google-icon <svg> block.
 */
function stripDecorativeSvg(content: string): string {
  return content.replace(/<svg\b[\s\S]*?<\/svg>/gi, "<svg .../>");
}

/**
 * Hybrid-lite retrieval: filename token overlap + in-file keyword hits.
 * No embeddings/external services - keeps this dependency-free and fast
 * enough to scope prompts down for a small local model.
 */
export function retrieveRelevantFiles(
  rootDir: string,
  candidateFiles: CandidateFile[],
  query: string,
  limit = 8
): RetrievedFile[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  const scored: RetrievedFile[] = [];

  for (const cf of candidateFiles) {
    const filenameTokens = tokenize(cf.path);
    let score = filenameTokens.filter((t) => queryTokens.has(t)).length * 3;

    const abs = path.join(rootDir, cf.path);
    let content = "";
    try {
      const stat = fs.statSync(abs);
      if (stat.size <= MAX_FILE_READ_BYTES) {
        content = stripDecorativeSvg(fs.readFileSync(abs, "utf-8"));
        const contentTokens = tokenize(content);
        const contentSet = new Set(contentTokens);
        score += [...queryTokens].filter((t) => contentSet.has(t)).length;
      }
    } catch {
      // unreadable/binary - skip content scoring
    }

    if (cf.kind === "page" || cf.kind === "component") score += 1;

    if (score > 0) {
      scored.push({
        path: cf.path,
        kind: cf.kind,
        score,
        excerpt: excerptAround(content, MAX_EXCERPT_CHARS),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
