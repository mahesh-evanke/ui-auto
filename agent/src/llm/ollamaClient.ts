import type { ChatMessage, LlmClient } from "./llmClient.js";
import { redactSecrets, sleep, extractJson } from "./llmUtils.js";

export type { ChatMessage } from "./llmClient.js";

export interface OllamaClientOptions {
  host: string;
  model: string;
}

export class OllamaClient implements LlmClient {
  private host: string;
  private model: string;

  constructor(opts: OllamaClientOptions) {
    this.host = opts.host.replace(/\/$/, "");
    this.model = opts.model;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Low-level POST /api/chat with one retry on a network-level failure
   * (e.g. "fetch failed" from a dropped/reset connection) - large single
   * generations (many step definitions batched into one prompt) have been
   * observed to occasionally trip this, and it's worth one retry before
   * failing the whole job over what's usually a transient condition.
   */
  private async rawChat(body: Record<string, unknown>): Promise<string> {
    const attempt = async (): Promise<string> => {
      const res = await fetch(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        // Hard backstop: a degenerate/repetitive completion should be cut
        // off by num_predict above well before this, but if it somehow
        // isn't, don't let one bad generation hang the whole job.
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ollama request failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      return data.message?.content ?? "";
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

  /**
   * Free-form chat, returns raw text content. maxTokens (Ollama's
   * num_predict) bounds worst-case generation length - without it, a small
   * model occasionally gets stuck in a repetitive/degenerate completion loop
   * and the request just runs until an external connection timeout kills it
   * with an opaque "fetch failed" (observed in practice during large batched
   * code-generation prompts), rather than Ollama itself cutting it off.
   */
  async chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
    const sanitized = messages.map((m) => ({ ...m, content: redactSecrets(m.content) }));
    return this.rawChat({
      model: this.model,
      messages: sanitized,
      stream: false,
      options: { temperature: opts.temperature ?? 0.2, num_predict: opts.maxTokens ?? 1500 },
    });
  }

  /**
   * Chat expecting a JSON object response. Uses Ollama's format:"json" mode
   * and retries once with an explicit "valid JSON only" correction if
   * parsing fails - llama3.2:3b occasionally wraps JSON in prose.
   */
  async chatJson<T>(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<T> {
    const sanitized = messages.map((m) => ({ ...m, content: redactSecrets(m.content) }));

    const call = (msgs: ChatMessage[]): Promise<string> =>
      this.rawChat({
        model: this.model,
        messages: msgs,
        stream: false,
        format: "json",
        options: { temperature: opts.temperature ?? 0.1, num_predict: opts.maxTokens ?? 800 },
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

    throw new Error(
      `Model did not return valid JSON after retry. Last response:\n${second.slice(0, 500)}`
    );
  }
}
