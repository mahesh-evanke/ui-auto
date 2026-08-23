import type { ChatMessage, LlmClient } from "./llmClient.js";
import { redactSecrets, sleep, extractJson } from "./llmUtils.js";

export interface OpenAiCompatibleOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Cheap, auth-required GET used to validate a key without spending an inference request. */
  validatePath: string;
  /** Extra headers merged into every request - OpenRouter recommends attribution headers, OpenAI needs none. */
  extraHeaders?: Record<string, string>;
}

/**
 * A plain OpenAI Chat Completions client, parameterized by base URL. Backs
 * both the OpenAI and OpenRouter providers, which differ only in host,
 * default model and (for OpenRouter) a couple of recommended attribution
 * headers - not in request/response shape.
 */
export class OpenAiCompatibleClient implements LlmClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private validatePath: string;
  private extraHeaders: Record<string, string>;

  constructor(opts: OpenAiCompatibleOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.validatePath = opts.validatePath;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}${this.validatePath}`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, ...this.extraHeaders },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async rawChat(body: Record<string, unknown>): Promise<string> {
    const attempt = async (): Promise<string> => {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 401 || res.status === 403) {
          throw new Error(`Request rejected (${res.status}). The API key may be invalid or lack access to this model. ${text}`);
        }
        if (res.status === 429) {
          throw new Error(`Rate limit hit (429). Wait a moment and retry, or check your account's usage/credits. ${text}`);
        }
        throw new Error(`Request failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    };

    try {
      return await attempt();
    } catch (err) {
      const isRetryable =
        err instanceof TypeError ||
        (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError" || /fetch failed/i.test(err.message)));
      if (!isRetryable) throw err;
      await sleep(1000);
      return attempt();
    }
  }

  async chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    const sanitized = messages.map((m) => ({ ...m, content: redactSecrets(m.content) }));
    return this.rawChat({
      model: this.model,
      messages: sanitized,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1500,
    });
  }

  /**
   * Chat expecting a JSON object. Requests response_format: json_object -
   * widely but not universally supported across models routed through
   * OpenRouter - and, same as OllamaClient, retries once with an explicit
   * correction if parsing still fails.
   */
  async chatJson<T>(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<T> {
    const sanitized = messages.map((m) => ({ ...m, content: redactSecrets(m.content) }));

    const call = (msgs: ChatMessage[]): Promise<string> =>
      this.rawChat({
        model: this.model,
        messages: msgs,
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxTokens ?? 800,
        response_format: { type: "json_object" },
      });

    const tryParse = (raw: string): T | null => {
      const extracted = extractJson(raw);
      if (!extracted) return null;
      try {
        return JSON.parse(extracted) as T;
      } catch {
        return null;
      }
    };

    const first = await call(sanitized);
    const parsedFirst = tryParse(first);
    if (parsedFirst !== null) return parsedFirst;

    const retryMessages: ChatMessage[] = [
      ...sanitized,
      { role: "assistant", content: first },
      {
        role: "user",
        content:
          "That was not valid JSON. Reply again with ONLY a single valid JSON object. No prose, no markdown fences, no explanation.",
      },
    ];
    const second = await call(retryMessages);
    const parsedSecond = tryParse(second);
    if (parsedSecond !== null) return parsedSecond;

    throw new Error(`Model did not return valid JSON after retry. Last response:\n${second.slice(0, 500)}`);
  }
}

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

export function createOpenAiClient(apiKey: string, model?: string): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({
    apiKey,
    model: model || DEFAULT_OPENAI_MODEL,
    baseUrl: OPENAI_BASE_URL,
    validatePath: "/models",
  });
}

export function createOpenRouterClient(apiKey: string, model?: string): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({
    apiKey,
    model: model || DEFAULT_OPENROUTER_MODEL,
    baseUrl: OPENROUTER_BASE_URL,
    validatePath: "/auth/key",
    // Recommended (not required) by OpenRouter so requests are attributed to
    // this tool rather than showing up as anonymous in their dashboards.
    extraHeaders: { "HTTP-Referer": "https://github.com", "X-Title": "TestPilot Agent" },
  });
}
