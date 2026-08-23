import { OllamaClient } from "./ollamaClient.js";
import { createOpenAiClient, createOpenRouterClient } from "./openAiCompatibleClient.js";
import type { LlmClient } from "./llmClient.js";

export type ModelProvider = "ollama" | "openai" | "openrouter";

export interface LlmClientSettings {
  provider?: ModelProvider;
  ollamaHost: string;
  ollamaModel: string;
  openaiToken?: string;
  openaiModel?: string;
  openrouterToken?: string;
  openrouterModel?: string;
}

/**
 * Builds whichever backend the job was configured for. Everything past this
 * point (all the agents in src/agents/) depends only on the LlmClient
 * interface, so swapping providers needs no other change.
 */
export function createLlmClient(settings: LlmClientSettings): LlmClient {
  if (settings.provider === "openai") {
    if (!settings.openaiToken) {
      throw new Error("OpenAI provider selected but no API key is configured. Connect it from Settings first.");
    }
    return createOpenAiClient(settings.openaiToken, settings.openaiModel);
  }
  if (settings.provider === "openrouter") {
    if (!settings.openrouterToken) {
      throw new Error("OpenRouter provider selected but no API key is configured. Connect it from Settings first.");
    }
    return createOpenRouterClient(settings.openrouterToken, settings.openrouterModel);
  }
  return new OllamaClient({ host: settings.ollamaHost, model: settings.ollamaModel });
}
