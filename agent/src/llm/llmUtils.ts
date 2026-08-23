/** Shared between OllamaClient and OpenAiCompatibleClient - JSON extraction/retry and secret redaction should behave identically regardless of backend. */

const SECRET_LIKE = /(api[_-]?key|secret|token|password|authorization)\s*[:=]\s*["']?[\w\-.]{8,}/gi;

/** Strips anything that looks like a credential out of prompt text before it's logged or sent - defense in depth against a scenario description or file excerpt accidentally containing one. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_LIKE, (m) => m.split(/[:=]/)[0] + ": [REDACTED]");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pulls a JSON object out of a raw model response that may be wrapped in prose or a markdown fence. */
export function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return candidate.slice(start, end + 1);
}
