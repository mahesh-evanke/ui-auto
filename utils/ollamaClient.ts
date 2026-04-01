/**
 * Minimal Ollama client for local LLM calls.
 *
 * Default endpoint: http://127.0.0.1:11434
 * Default model (per user): gpt-oss:20b-cloud
 */
export type OllamaGenerateRequest = {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: Record<string, unknown>;
};

export type OllamaGenerateResponse = {
  response: string;
  done: boolean;
};

function baseUrl(): string {
  const raw = process.env.OLLAMA_HOST?.trim();
  if (raw) return raw.replace(/\/+$/, '');
  return 'http://127.0.0.1:11434';
}

export function ollamaModel(): string {
  return process.env.AI_FIX_OLLAMA_MODEL?.trim() || 'gpt-oss:20b-cloud';
}

export async function ollamaGenerate(req: OllamaGenerateRequest): Promise<string> {
  const url = `${baseUrl()}/api/generate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...req, stream: false }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama generate failed: ${res.status} ${res.statusText}\n${body}`.trim());
  }
  const data = (await res.json()) as Partial<OllamaGenerateResponse>;
  return String(data.response ?? '');
}

