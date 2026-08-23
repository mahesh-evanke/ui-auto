import type { ChatMessage, LlmClient } from "./llmClient.js";
import { redactSecrets, sleep, extractJson } from "./llmUtils.js";

export interface CopilotClientOptions {
  /** A GitHub Personal Access Token (classic works; fine-grained needs "models: read"). */
  token: string;
  /** GitHub Models catalog id, e.g. "openai/gpt-4o-mini". */
  model: string;
}

const INFERENCE_URL = "https://models.github.ai/inference/chat/completions";
const CATALOG_URL = "https://models.github.ai/catalog/models";

export const DEFAULT_COPILOT_MODEL = "openai/gpt-4o-mini";

/**
 * "Connect GitHub Copilot" in Settings does not call GitHub's internal
 * Copilot Chat API - that endpoint is private to GitHub's own official
 * clients (VS Code, the Copilot CLI, ...) and is not something a third-party
 * OAuth app or PAT can use. What IS public and documented is GitHub Models
 * (https://docs.github.com/en/github-models): an OpenAI-compatible inference
 * API, authenticated with the same kind of Personal Access Token, serving
 * Copilot's underlying model catalog (GPT-4o, Llama, etc.) tied to the
 * user's GitHub account and Copilot entitlement. That's what this client
 * talks to - same account, same models, honest about which API it is.
 */
export class CopilotClient implements LlmClient {
  private token: string;
  private model: string;

  constructor(opts: CopilotClientOptions) {
    this.token = opts.token;
    this.model = opts.model || DEFAULT_COPILOT_MODEL;
  }

  /** Cheap validation call - lists the model catalog rather than spending an inference request. */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(CATALOG_URL, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async rawChat(body: Record<string, unknown>): Promise<string> {
    const attempt = async (): Promise<string> => {
      const res = await fetch(INFERENCE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `GitHub Models request rejected (${res.status}). The token may be invalid, expired, or lack model access. ${text}`
          );
        }
        if (res.status === 429) {
          throw new Error(`GitHub Models rate limit hit (429). Wait a moment and retry. ${text}`);
        }
        throw new Error(`GitHub Models request failed (${res.status}): ${text}`);
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
   * Chat expecting a JSON object. Requests response_format: json_object
   * (supported by the GPT-4o family this catalog defaults to) and, same as
   * OllamaClient, retries once with an explicit correction if parsing still
   * fails - a model can ignore response_format for an unsupported catalog
   * entry, so this can't be assumed to always short-circuit.
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
