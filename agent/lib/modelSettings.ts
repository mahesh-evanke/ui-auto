import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_WORKSPACE_DIR } from "../src/config.js";
import { createLlmClient } from "../src/llm/createLlmClient.js";
import { DEFAULT_OPENAI_MODEL, DEFAULT_OPENROUTER_MODEL } from "../src/llm/openAiCompatibleClient.js";
import type { ModelProvider } from "../src/llm/createLlmClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// agent-workspace/ is already gitignored (see .gitignore) and holds
// per-job artifacts, so the API keys - the only secrets this file stores -
// live alongside them rather than in a new, easy-to-miss location.
const SETTINGS_PATH = path.join(__dirname, "..", AGENT_WORKSPACE_DIR, ".model-settings.json");

interface StoredSettings {
  provider: ModelProvider;
  openaiToken?: string;
  openaiModel?: string;
  openrouterToken?: string;
  openrouterModel?: string;
}

/** Client-safe view: same shape minus the tokens, plus whether each is on file. */
export interface ModelSettingsStatus {
  provider: ModelProvider;
  openaiConnected: boolean;
  openaiModel: string;
  openrouterConnected: boolean;
  openrouterModel: string;
}

const DEFAULT_SETTINGS: StoredSettings = { provider: "ollama" };

// In-memory cache pinned to globalThis for the same reason jobRegistry.ts
// pins its job map there - Next.js dev mode can recompile a route module
// independently of others, and a plain module-scope variable would then
// silently diverge between routes within one server process.
const globalForSettings = globalThis as unknown as { __testpilotModelSettings?: StoredSettings };

function load(): StoredSettings {
  if (globalForSettings.__testpilotModelSettings) return globalForSettings.__testpilotModelSettings;
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoredSettings>;
    globalForSettings.__testpilotModelSettings = { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    globalForSettings.__testpilotModelSettings = { ...DEFAULT_SETTINGS };
  }
  return globalForSettings.__testpilotModelSettings;
}

function persist(settings: StoredSettings): void {
  globalForSettings.__testpilotModelSettings = settings;
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  // 0o600: this file holds live API keys, same handling as any local
  // credential file (.env, ~/.netrc) - readable only by the current user.
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

/** For API routes rendering Settings: never includes the tokens themselves. */
export function getModelSettingsStatus(): ModelSettingsStatus {
  const s = load();
  return {
    provider: s.provider,
    openaiConnected: Boolean(s.openaiToken),
    openaiModel: s.openaiModel || DEFAULT_OPENAI_MODEL,
    openrouterConnected: Boolean(s.openrouterToken),
    openrouterModel: s.openrouterModel || DEFAULT_OPENROUTER_MODEL,
  };
}

/** For job creation: the real settings, including tokens if connected. Never send this object to the browser. */
export function getModelSettingsForJob(): StoredSettings {
  return load();
}

/**
 * Validates a key against the provider's real API (a cheap auth-check call,
 * not an inference request) before persisting it, so a typo'd or revoked key
 * is rejected immediately instead of surfacing as a confusing failure on the
 * next test-generation run.
 */
async function connect(
  provider: "openai" | "openrouter",
  token: string,
  model: string | undefined,
  defaultModel: string
): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("API key is required.");
  const chosenModel = model?.trim() || defaultModel;
  const client = createLlmClient({
    provider,
    ollamaHost: "",
    ollamaModel: "",
    openaiToken: provider === "openai" ? trimmed : undefined,
    openaiModel: provider === "openai" ? chosenModel : undefined,
    openrouterToken: provider === "openrouter" ? trimmed : undefined,
    openrouterModel: provider === "openrouter" ? chosenModel : undefined,
  });
  const ok = await client.ping();
  if (!ok) {
    throw new Error(
      `Could not verify that key against ${provider === "openai" ? "OpenAI" : "OpenRouter"}. Check that it's valid and has not been revoked.`
    );
  }
  const current = load();
  if (provider === "openai") {
    persist({ ...current, provider: "openai", openaiToken: trimmed, openaiModel: chosenModel });
  } else {
    persist({ ...current, provider: "openrouter", openrouterToken: trimmed, openrouterModel: chosenModel });
  }
}

export function connectOpenAi(token: string, model?: string): Promise<void> {
  return connect("openai", token, model, DEFAULT_OPENAI_MODEL);
}

export function connectOpenRouter(token: string, model?: string): Promise<void> {
  return connect("openrouter", token, model, DEFAULT_OPENROUTER_MODEL);
}

/** Disconnects one provider's key and, if it was the active one, falls back to local Ollama. */
export function disconnect(provider: "openai" | "openrouter"): void {
  const current = load();
  const next: StoredSettings =
    provider === "openai"
      ? { ...current, openaiToken: undefined }
      : { ...current, openrouterToken: undefined };
  if (current.provider === provider) next.provider = "ollama";
  persist(next);
}

/** Switches the active provider without discarding a stored key for another provider, so toggling back later doesn't require reconnecting. */
export function setProvider(provider: ModelProvider): void {
  const current = load();
  if (provider === "openai" && !current.openaiToken) throw new Error("Connect OpenAI first.");
  if (provider === "openrouter" && !current.openrouterToken) throw new Error("Connect OpenRouter first.");
  persist({ ...current, provider });
}
