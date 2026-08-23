"use client";

import { useEffect, useState } from "react";

interface Status {
  provider: "ollama" | "openai" | "openrouter";
  openaiConnected: boolean;
  openaiModel: string;
  openrouterConnected: boolean;
  openrouterModel: string;
}

type CloudProvider = "openai" | "openrouter";

const PROVIDER_LABEL: Record<CloudProvider, string> = { openai: "OpenAI", openrouter: "OpenRouter" };
const PROVIDER_KEY_PLACEHOLDER: Record<CloudProvider, string> = { openai: "sk-...", openrouter: "sk-or-..." };
const PROVIDER_KEY_URL: Record<CloudProvider, string> = {
  openai: "https://platform.openai.com/api-keys",
  openrouter: "https://openrouter.ai/keys",
};

/**
 * Lets the user connect a cloud model provider (OpenAI or OpenRouter) as an
 * alternative to the local Ollama model, and switch between all three. A key
 * never comes back from the server once saved - GET /api/settings only ever
 * reports whether one is on file, never its value.
 */
export default function ModelProviderSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tokens, setTokens] = useState<Record<CloudProvider, string>>({ openai: "", openrouter: "" });
  const [models, setModels] = useState<Record<CloudProvider, string>>({ openai: "", openrouter: "" });
  const [busy, setBusy] = useState<CloudProvider | "switch" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data: Status) => setStatus(data))
      .catch(() =>
        setStatus({ provider: "ollama", openaiConnected: false, openaiModel: "gpt-4o-mini", openrouterConnected: false, openrouterModel: "openai/gpt-4o-mini" })
      );
  }

  useEffect(load, []);

  async function connect(provider: CloudProvider) {
    const token = tokens[provider];
    if (!token.trim()) {
      setError("Paste an API key first.");
      return;
    }
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch(`/api/settings/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, model: models[provider].trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTokens((t) => ({ ...t, [provider]: "" }));
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(provider: CloudProvider) {
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch(`/api/settings/${provider}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function setActiveProvider(provider: Status["provider"]) {
    if (!status || status.provider === provider) return;
    setBusy("switch");
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Model provider</h3>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  function connectedFlag(provider: CloudProvider): boolean {
    return provider === "openai" ? status!.openaiConnected : status!.openrouterConnected;
  }
  function connectedModel(provider: CloudProvider): string {
    return provider === "openai" ? status!.openaiModel : status!.openrouterModel;
  }

  function renderCloudProvider(provider: CloudProvider) {
    const connected = connectedFlag(provider);
    return (
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <strong>{PROVIDER_LABEL[provider]}</strong>
          {connected && <span className="badge pass">Connected</span>}
        </div>

        {connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span className="muted">model: {connectedModel(provider)}</span>
            <button className="btn secondary" disabled={busy !== null} onClick={() => disconnect(provider)}>
              {busy === provider ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8, maxWidth: 440 }}>
            <label className="muted" htmlFor={`${provider}-token`}>
              API key ({" "}
              <a href={PROVIDER_KEY_URL[provider]} target="_blank" rel="noreferrer">
                get one
              </a>{" "}
              )
            </label>
            <input
              id={`${provider}-token`}
              type="password"
              placeholder={PROVIDER_KEY_PLACEHOLDER[provider]}
              value={tokens[provider]}
              onChange={(e) => setTokens((t) => ({ ...t, [provider]: e.target.value }))}
              autoComplete="off"
            />
            <label className="muted" htmlFor={`${provider}-model`}>
              Model (optional)
            </label>
            <input
              id={`${provider}-model`}
              type="text"
              placeholder={provider === "openai" ? "gpt-4o-mini" : "openai/gpt-4o-mini"}
              value={models[provider]}
              onChange={(e) => setModels((m) => ({ ...m, [provider]: e.target.value }))}
            />
            <div>
              <button className="btn" disabled={busy !== null} onClick={() => connect(provider)}>
                {busy === provider ? "Connecting…" : `Connect ${PROVIDER_LABEL[provider]}`}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Model provider</h3>
      <p className="muted">Which LLM backend generates and reasons about tests. Local Ollama is the default and needs nothing connected.</p>

      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <button className={status.provider === "ollama" ? "btn" : "btn secondary"} disabled={busy !== null} onClick={() => setActiveProvider("ollama")}>
          Local Ollama
        </button>
        <button
          className={status.provider === "openai" ? "btn" : "btn secondary"}
          disabled={busy !== null || !status.openaiConnected}
          onClick={() => setActiveProvider("openai")}
          title={status.openaiConnected ? undefined : "Connect OpenAI below first"}
        >
          OpenAI
        </button>
        <button
          className={status.provider === "openrouter" ? "btn" : "btn secondary"}
          disabled={busy !== null || !status.openrouterConnected}
          onClick={() => setActiveProvider("openrouter")}
          title={status.openrouterConnected ? undefined : "Connect OpenRouter below first"}
        >
          OpenRouter
        </button>
      </div>

      {error && (
        <p className="muted" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}

      {renderCloudProvider("openai")}
      {renderCloudProvider("openrouter")}

      <p className="muted" style={{ marginTop: 16 }}>
        Keys are validated against the provider's real API before being saved, then stored locally in this
        project&apos;s <code>agent-workspace/</code> folder (gitignored, file-permission restricted) - never sent
        anywhere except that provider&apos;s own API. OpenRouter is a single key that can route to many models
        (including free ones) across providers; OpenAI is OpenAI&apos;s models directly.
      </p>
    </div>
  );
}
