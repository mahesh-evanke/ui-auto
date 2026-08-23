"use client";

import { useEffect, useState } from "react";

interface Status {
  provider: "ollama" | "copilot";
  copilotConnected: boolean;
  copilotModel: string;
}

/**
 * Lets the user connect GitHub Copilot as an alternative to the local Ollama
 * model, and switch between the two. The token never comes back from the
 * server once saved - GET /api/settings only ever reports whether one is on
 * file (copilotConnected), never its value.
 */
export default function ModelProviderSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data: Status) => setStatus(data))
      .catch(() => setStatus({ provider: "ollama", copilotConnected: false, copilotModel: "openai/gpt-4o-mini" }));
  }

  useEffect(load, []);

  async function connect() {
    if (!token.trim()) {
      setError("Paste a GitHub Personal Access Token first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, model: model.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setToken("");
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/copilot", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function setProvider(provider: "ollama" | "copilot") {
    if (!status || status.provider === provider) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/copilot", {
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
      setBusy(false);
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

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Model provider</h3>
      <p className="muted">Which LLM backend generates and reasons about tests. Local Ollama is the default and needs nothing connected.</p>

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <button
          className={status.provider === "ollama" ? "btn" : "btn secondary"}
          disabled={busy}
          onClick={() => setProvider("ollama")}
        >
          Local Ollama
        </button>
        <button
          className={status.provider === "copilot" ? "btn" : "btn secondary"}
          disabled={busy || !status.copilotConnected}
          onClick={() => setProvider("copilot")}
          title={status.copilotConnected ? undefined : "Connect GitHub Copilot below first"}
        >
          GitHub Copilot
        </button>
      </div>

      {status.copilotConnected ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="badge pass">Connected</span>
          <span className="muted">model: {status.copilotModel}</span>
          <button className="btn secondary" disabled={busy} onClick={disconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8, maxWidth: 440 }}>
          <label className="muted" htmlFor="copilot-token">
            GitHub Personal Access Token
          </label>
          <input
            id="copilot-token"
            type="password"
            placeholder="ghp_..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <label className="muted" htmlFor="copilot-model">
            Model (optional)
          </label>
          <input
            id="copilot-model"
            type="text"
            placeholder="openai/gpt-4o-mini"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <div>
            <button className="btn" disabled={busy} onClick={connect}>
              {busy ? "Connecting…" : "Connect GitHub Copilot"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="muted" style={{ color: "var(--bad)", marginTop: 8 }}>
          {error}
        </p>
      )}

      <p className="muted" style={{ marginTop: 12 }}>
        This does not call Copilot Chat directly - that API is private to GitHub's own official
        clients. It uses{" "}
        <a href="https://docs.github.com/en/github-models" target="_blank" rel="noreferrer">
          GitHub Models
        </a>
        , the public, PAT-authenticated inference API serving the same model catalog tied to your
        GitHub account and Copilot entitlement. A classic PAT works as-is; a fine-grained token
        needs the &quot;models: read&quot; permission. The token is stored locally in this
        project&apos;s <code>agent-workspace/</code> folder (gitignored, file-permission
        restricted) and is never sent anywhere except GitHub&apos;s API.
      </p>
    </div>
  );
}
