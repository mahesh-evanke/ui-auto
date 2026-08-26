"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { Badge } from "../../components/ui/badge.js";

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
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="material-symbols-outlined">smart_toy</span>
            Model Provider
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-body-sm text-body-sm text-on-surface-variant">Loading…</p>
        </CardContent>
      </Card>
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
      <div className="border-t border-outline-variant pt-md">
        <div className="mb-sm flex items-center gap-sm">
          <span className="font-body-md text-body-md font-medium text-on-surface">{PROVIDER_LABEL[provider]}</span>
          {connected && <Badge variant="success">Connected</Badge>}
        </div>

        {connected ? (
          <div className="flex flex-wrap items-center gap-md">
            <span className="font-body-sm text-body-sm text-on-surface-variant">model: {connectedModel(provider)}</span>
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => disconnect(provider)}>
              {busy === provider ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        ) : (
          <div className="grid max-w-md gap-sm">
            <Label htmlFor={`${provider}-token`}>
              API key ({" "}
              <a href={PROVIDER_KEY_URL[provider]} target="_blank" rel="noreferrer" className="text-primary normal-case">
                get one
              </a>{" "}
              )
            </Label>
            <Input
              id={`${provider}-token`}
              type="password"
              placeholder={PROVIDER_KEY_PLACEHOLDER[provider]}
              value={tokens[provider]}
              onChange={(e) => setTokens((t) => ({ ...t, [provider]: e.target.value }))}
              autoComplete="off"
            />
            <Label htmlFor={`${provider}-model`}>Model (optional)</Label>
            <Input
              id={`${provider}-model`}
              type="text"
              placeholder={provider === "openai" ? "gpt-4o-mini" : "openai/gpt-4o-mini"}
              value={models[provider]}
              onChange={(e) => setModels((m) => ({ ...m, [provider]: e.target.value }))}
            />
            <div>
              <Button size="sm" disabled={busy !== null} onClick={() => connect(provider)}>
                {busy === provider ? "Connecting…" : `Connect ${PROVIDER_LABEL[provider]}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="material-symbols-outlined">smart_toy</span>
          Model Provider
        </CardTitle>
        <CardDescription>
          Which LLM backend generates and reasons about tests. Local Ollama is the default and needs nothing connected.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        <div className="flex flex-wrap gap-sm">
          <Button
            size="sm"
            variant={status.provider === "ollama" ? "default" : "outline"}
            disabled={busy !== null}
            onClick={() => setActiveProvider("ollama")}
          >
            Local Ollama
          </Button>
          <Button
            size="sm"
            variant={status.provider === "openai" ? "default" : "outline"}
            disabled={busy !== null || !status.openaiConnected}
            onClick={() => setActiveProvider("openai")}
            title={status.openaiConnected ? undefined : "Connect OpenAI below first"}
          >
            OpenAI
          </Button>
          <Button
            size="sm"
            variant={status.provider === "openrouter" ? "default" : "outline"}
            disabled={busy !== null || !status.openrouterConnected}
            onClick={() => setActiveProvider("openrouter")}
            title={status.openrouterConnected ? undefined : "Connect OpenRouter below first"}
          >
            OpenRouter
          </Button>
        </div>

        {error && <p className="font-body-sm text-body-sm text-error">{error}</p>}

        {renderCloudProvider("openai")}
        {renderCloudProvider("openrouter")}

        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Keys are validated against the provider's real API before being saved, then stored locally in this
          project&apos;s <code>agent-workspace/</code> folder (gitignored, file-permission restricted) - never sent
          anywhere except that provider&apos;s own API. OpenRouter is a single key that can route to many models
          (including free ones) across providers; OpenAI is OpenAI&apos;s models directly.
        </p>
      </CardContent>
    </Card>
  );
}
