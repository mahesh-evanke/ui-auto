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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

const MAX_EXCERPT_CHARS = 1200;
const MAX_FILE_READ_BYTES = 200_000;

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
        content = fs.readFileSync(abs, "utf-8");
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
        excerpt: content.slice(0, MAX_EXCERPT_CHARS),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
