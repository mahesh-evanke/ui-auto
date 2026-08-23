import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_WORKSPACE_DIR } from "../src/config.js";
import { createLlmClient } from "../src/llm/createLlmClient.js";
import { DEFAULT_COPILOT_MODEL } from "../src/llm/copilotClient.js";
import type { ModelProvider } from "../src/llm/createLlmClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// agent-workspace/ is already gitignored (see .gitignore) and holds
// per-job artifacts, so the Copilot token - the only secret this file
// stores - lives alongside them rather than in a new, easy-to-miss location.
const SETTINGS_PATH = path.join(__dirname, "..", AGENT_WORKSPACE_DIR, ".model-settings.json");

interface StoredSettings {
  provider: ModelProvider;
  copilotToken?: string;
  copilotModel?: string;
}

/** Client-safe view: same shape minus the token, plus whether one is on file. */
export interface ModelSettingsStatus {
  provider: ModelProvider;
  copilotConnected: boolean;
  copilotModel: string;
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
  // 0o600: this file holds a live GitHub token, same handling as any local
  // credential file (.env, ~/.netrc) - readable only by the current user.
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

/** For API routes rendering Settings: never includes the token itself. */
export function getModelSettingsStatus(): ModelSettingsStatus {
  const s = load();
  return {
    provider: s.provider,
    copilotConnected: Boolean(s.copilotToken),
    copilotModel: s.copilotModel || DEFAULT_COPILOT_MODEL,
  };
}

/** For job creation: the real settings, including the token if connected. Never send this object to the browser. */
export function getModelSettingsForJob(): StoredSettings {
  return load();
}

/**
 * Validates the token against GitHub Models (a cheap catalog-listing call,
 * not an inference request) before persisting it, so a typo'd or
 * insufficiently-scoped PAT is rejected immediately instead of surfacing as
 * a confusing failure on the next test-generation run.
 */
export async function connectCopilot(token: string, model?: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Token is required.");
  const chosenModel = model?.trim() || DEFAULT_COPILOT_MODEL;
  const client = createLlmClient({ provider: "copilot", copilotToken: trimmed, copilotModel: chosenModel, ollamaHost: "", ollamaModel: "" });
  const ok = await client.ping();
  if (!ok) {
    throw new Error(
      "Could not verify that token against GitHub Models. Check that it's a valid GitHub Personal Access Token with model access (fine-grained tokens need the \"models: read\" permission)."
    );
  }
  persist({ ...load(), provider: "copilot", copilotToken: trimmed, copilotModel: chosenModel });
}

/** Disconnects Copilot and falls back to the local Ollama provider. */
export function disconnectCopilot(): void {
  const current = load();
  persist({ provider: "ollama", copilotModel: current.copilotModel });
}

/** Switches the active provider without touching a stored Copilot token, so toggling back to Copilot later doesn't require reconnecting. */
export function setProvider(provider: ModelProvider): void {
  if (provider === "copilot" && !load().copilotToken) {
    throw new Error("Connect GitHub Copilot first.");
  }
  persist({ ...load(), provider });
}
