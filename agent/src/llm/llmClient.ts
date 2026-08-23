export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * The one shape every agent (requirementAgent, stepIntentAgent, etc.) needs
 * from a model backend. OllamaClient (local, default) and OpenAiCompatibleClient
 * (cloud, opt-in via Settings) both implement this, so nothing downstream of
 * pipeline.ts's client construction needs to know which one it got.
 */
export interface LlmClient {
  ping(): Promise<boolean>;
  chat(messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number }): Promise<string>;
  chatJson<T>(messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number }): Promise<T>;
}
