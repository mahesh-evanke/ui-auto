import { OllamaClient } from "./ollamaClient.js";
import { CopilotClient, DEFAULT_COPILOT_MODEL } from "./copilotClient.js";
import type { LlmClient } from "./llmClient.js";

export type ModelProvider = "ollama" | "copilot";

export interface LlmClientSettings {
  provider?: ModelProvider;
  ollamaHost: string;
  ollamaModel: string;
  copilotToken?: string;
  copilotModel?: string;
}

/**
 * Builds whichever backend the job was configured for. Everything past this
 * point (all the agents in src/agents/) depends only on the LlmClient
 * interface, so swapping providers needs no other change.
 */
export function createLlmClient(settings: LlmClientSettings): LlmClient {
  if (settings.provider === "copilot") {
    if (!settings.copilotToken) {
      throw new Error(
        "Copilot provider selected but no token is configured. Connect GitHub Copilot from Settings first."
      );
    }
    return new CopilotClient({ token: settings.copilotToken, model: settings.copilotModel || DEFAULT_COPILOT_MODEL });
  }
  return new OllamaClient({ host: settings.ollamaHost, model: settings.ollamaModel });
}
